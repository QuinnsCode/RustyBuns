// @rustybuns/render (spike): your React app as it is, drawn by an engine instead of a browser.
//
// open(url) does what the desktop window's browser does for a Rusty Buns app:
// it signs in with the launch token, reads the server's HTML into a DOM, runs the
// page's own scripts (the RSC payload, then the client bundle, which hydrates),
// and keeps the session alive: fetch, cookies, timers, navigation all go on.
// Nothing in the app changes. Each frame() hands over what changed as ops for
// the engine; send() turns the engine's input back into real DOM events.

import { Window } from "happy-dom";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Input, Op } from "./ops.ts";
import { Recorder } from "./record.ts";

export { Mirror, type MirrorNode } from "./mirror.ts";
export { Recorder } from "./record.ts";
export { ROOT, type Input, type Op } from "./ops.ts";

export interface Page {
  /** The DOM the app runs on, for checks; the engine only ever sees ops. */
  window: Window;
  /** The ops since the last frame, after the app's pending work has run. */
  frame(): Promise<Op[]>;
  /** The engine's input, dispatched as the DOM event a browser would fire. */
  send(input: Input): void;
  close(): Promise<void>;
}

export interface OpenOptions {
  /** The desktop token (desktop.json): exchanged for the session cookie like the window's first load. */
  token?: string;
}

// Names Bun also has, that must be the page's: its events, location and storage. Bun's own fetch
// (wrapped below), URL, timers and streams stay.
const FORWARD = new Set(["document", "location", "history", "navigator", "localStorage", "sessionStorage", "getComputedStyle",
  "requestAnimationFrame", "cancelAnimationFrame", "matchMedia", "customElements", "addEventListener", "removeEventListener",
  "dispatchEvent", "event", "onerror", "onpopstate"]);
const KEEP = new Set(["URL", "URLSearchParams", "Headers", "Request", "Response", "Blob", "File", "AbortController",
  "AbortSignal", "TextEncoder", "TextDecoder", "ReadableStream", "WritableStream", "TransformStream", "WebSocket", "Worker",
  "MessageChannel", "MessagePort", "BroadcastChannel", "Crypto", "CryptoKey", "SubtleCrypto", "Performance", "WebAssembly"]);

export async function open(url: string, opts: OpenOptions = {}): Promise<Page> {
  const origin = new URL(url).origin;
  const jar = new Map<string, string>();
  const bunFetch = globalThis.fetch;
  const modules = mkdtempSync(join(tmpdir(), "rb-render-"));
  const local = pathToFileURL(modules).href;
  let here = url;

  // The page's fetch: relative to the page, carrying the session, and a module's own
  // `new URL("x.wasm", import.meta.url)` points back at the server it came from.
  const pageFetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    let req = input instanceof Request ? new Request(input, init) : new Request(new URL(String(input).replace(local, origin), here), init);
    if (new URL(req.url).origin === origin) {
      const headers = new Headers(req.headers);
      const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
      if (cookie) headers.set("cookie", cookie);
      if (req.method !== "GET" && req.method !== "HEAD") headers.set("origin", origin);
      req = new Request(req, { headers });
    }
    const res = await bunFetch(req, { redirect: "manual" });
    for (const c of res.headers.getSetCookie()) {
      const [kv = ""] = c.split(";"), i = kv.indexOf("=");
      jar.set(kv.slice(0, i).trim(), kv.slice(i + 1));
    }
    const to = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && to) return pageFetch(new URL(to, req.url).href);
    return res;
  };

  const first = new URL(url);
  if (opts.token) first.searchParams.set("token", opts.token);
  const res = await pageFetch(first.href);
  const html = await res.text();
  if (!res.ok) throw new Error(`${url} answered ${res.status}: ${html.slice(0, 200)}`);

  // Scripts are ours to run (below), in Bun, so the page's code is the real module graph, not an eval sandbox.
  const window = new Window({
    url,
    settings: { disableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true, disableCSSFileLoading: true, disableIframePageLoading: true },
  });
  here = window.location.href;
  window.document.write(html);

  // The page's `window` and `self` are Bun's global itself, as in a browser, so `self.x = 1` in an
  // inline script and `globalThis.x` in the bundle are one value. The DOM's own window lends it
  // its APIs: its classes by value, the rest (location, history, events...) forwarded live.
  const g = globalThis as unknown as Record<string, unknown>;
  const w = window as unknown as Record<string, unknown>;
  const dom = (k: string) => !(k in g) || /Event|^Node|^HTML|^SVG|^Element|^Document|^DOM|^Mutation|^Text$|^Comment$|^Range$|^Selection$|^Storage$|^FormData$/.test(k);
  const lower = new Set<string>();
  for (let o: object | null = window; o && o !== Object.prototype; o = Object.getPrototypeOf(o))
    for (const k of Object.getOwnPropertyNames(o)) if (/^[a-z]/.test(k) && (FORWARD.has(k) || !(k in g))) lower.add(k);
  for (const k of ["window", "self", "globalThis", "fetch", "constructor"]) lower.delete(k);
  const upper = Object.getOwnPropertyNames(window).filter((k) => /^[A-Z]/.test(k) && !KEEP.has(k) && dom(k));
  const names = [...upper, ...lower, "window", "self", "fetch"].filter((k) => Object.getOwnPropertyDescriptor(g, k)?.configurable !== false);
  const saved = new Map(names.map((k) => [k, Object.getOwnPropertyDescriptor(g, k)] as const));
  const set = (k: string, d: PropertyDescriptor) => names.includes(k) && Object.defineProperty(g, k, { configurable: true, ...d });
  for (const k of upper) set(k, { value: w[k], writable: true });
  for (const k of lower) set(k, {
    get: () => { const v = w[k]; return typeof v === "function" ? v.bind(window) : v; },
    set: (v: unknown) => { w[k] = v; },
  });
  set("window", { value: globalThis, writable: true });
  set("self", { value: globalThis, writable: true });
  set("fetch", { value: pageFetch, writable: true });
  w.fetch = pageFetch;

  // A module and everything it imports, copied from the server into one folder by URL path,
  // so the bundle's relative imports resolve as they would in the browser.
  // Bundles import each other in circles, so walk the graph breadth-first rather than await each module's deps.
  const fetched = new Map<string, Promise<string[]>>();
  const copy = (u: URL): Promise<string[]> => {
    let p = fetched.get(u.pathname);
    if (!p) {
      p = (async () => {
        const r = await pageFetch(u.href);
        if (!r.ok) throw new Error(`module ${u.pathname}: ${r.status}`);
        const code = await r.text();
        const file = join(modules, u.pathname);
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, code);
        return new Bun.Transpiler({ loader: "js" }).scanImports(code).map((i) => i.path).filter((s) => s.startsWith(".") || s.startsWith("/"))
          .map((d) => new URL(d, u).href);
      })();
      fetched.set(u.pathname, p);
    }
    return p;
  };
  const load = async (spec: string) => {
    const entry = new URL(spec, here);
    if (entry.origin !== origin) throw new Error(`module from another origin: ${entry.href}`);
    const seen = new Set<string>();
    for (let wave = [entry.href]; wave.length;) {
      wave = wave.filter((h) => !seen.has(h) && seen.add(h) && new URL(h).origin === origin);
      wave = (await Promise.all(wave.map((h) => copy(new URL(h))))).flat();
    }
    return import(join(modules, entry.pathname));
  };
  g.__rbImport = load;

  const recorder = new Recorder(window.document, window.MutationObserver);

  // Classic scripts run in order as the parser met them; module scripts after, as `defer` does.
  const deferred: string[] = [];
  for (const s of Array.from(window.document.querySelectorAll("script"))) {
    const type = s.getAttribute("type") ?? "";
    const src = s.getAttribute("src");
    if (type === "module") { if (src) deferred.push(src); continue; }
    if (type && !/javascript/.test(type)) continue;
    const code = src ? await (await pageFetch(src)).text() : s.textContent ?? "";
    // An inline `import("/assets/x.js")` means the page's server, not this disk.
    try { (0, eval)(code.replace(/\bimport\(/g, "__rbImport(")); } catch (e) { console.error("[render] script failed:", e); }
  }
  for (const src of deferred) await load(src);

  const fire = (id: number, make: () => unknown) => {
    const node = recorder.node(id);
    if (node && "dispatchEvent" in node && typeof node.dispatchEvent === "function") node.dispatchEvent(make());
  };

  return {
    window,
    async frame() {
      // Discrete updates flush in a microtask, the rest on a macrotask; let both run.
      await new Promise((r) => setTimeout(r, 0));
      return recorder.take();
    },
    send(input) {
      if (input[0] === "click") return fire(input[1], () => new window.MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
      const field = recorder.node(input[1]);
      if (!field) return;
      // Typing changes the value under React's value tracker, so its onChange sees a new value.
      let proto: object | null = Object.getPrototypeOf(field);
      while (proto && !Object.getOwnPropertyDescriptor(proto, "value")) proto = Object.getPrototypeOf(proto);
      if (proto) Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(field, input[2]);
      fire(input[1], () => new window.Event("input", { bubbles: true }));
    },
    async close() {
      recorder.close();
      for (const [k, d] of saved) { if (d) Object.defineProperty(g, k, d); else delete g[k]; }
      delete g.__rbImport;
      await window.happyDOM.close();
      rmSync(modules, { recursive: true, force: true });
    },
  };
}
