// installable (#4687): a build gets a manifest, home-screen icons and a service worker that plays the page offline.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installable } from "../src/installable.ts";

/** Builds a fake vite output through the plugin's hooks; returns the html and every emitted file. */
async function build(publicFiles: Record<string, string>) {
  const pub = mkdtempSync(join(tmpdir(), "installable-"));
  for (const [name, text] of Object.entries(publicFiles)) {
    mkdirSync(join(pub, name, ".."), { recursive: true });
    writeFileSync(join(pub, name), text);
  }
  const plugin = installable({ name: "Hippo Tycoon", shortName: "Hippo", background: "#08100d", icon: (u) => (u < 0.5 ? [0, 0, 0] : [255, 255, 255]) });
  plugin.configResolved({ publicDir: pub });
  const html = plugin.transformIndexHtml("<html><head><title>x</title></head><body></body></html>");
  const emitted = new Map<string, string | Uint8Array>();
  await plugin.generateBundle.call({ emitFile: (f) => emitted.set(f.fileName, f.source) }, {}, {
    "index.html": { type: "asset", source: html },
    "assets/main-abc.js": { type: "chunk", code: "console.log(1)" },
    "assets/main-abc.js.map": { type: "asset", source: "{}" },
  });
  return { html, emitted };
}

/** A service-worker scope with in-memory caches and a network that can be cut. */
function scope(source: string) {
  const handlers: Record<string, (e: any) => void> = {};
  const stores = new Map<string, Map<string, Response>>();
  const net = { up: true, hits: [] as string[] };
  const origin = "https://hippo.example";
  const fetchFn = async (r: Request | string) => {
    const url = new URL(typeof r === "string" ? r : r.url, origin);
    if (!net.up) throw new TypeError("offline");
    net.hits.push(url.pathname);
    return new Response(`net ${url.pathname}`);
  };
  const open = async (name: string) => {
    const m = stores.get(name) ?? new Map<string, Response>();
    stores.set(name, m);
    return {
      addAll: async (paths: string[]) => { for (const p of paths) m.set(p, await fetchFn(p)); },
      match: async (p: string) => m.get(p)?.clone(),
    };
  };
  const caches = { open, keys: async () => [...stores.keys()], delete: async (k: string) => stores.delete(k) };
  const self = { addEventListener: (t: string, h: (e: any) => void) => (handlers[t] = h), skipWaiting: async () => {}, clients: { claim: async () => {} }, location: { origin } };
  new Function("self", "caches", "fetch", "Response", source)(self, caches, fetchFn, Response);
  const run = async (type: string, extra: object = {}) => {
    let done: Promise<unknown> = Promise.resolve(undefined);
    let answer: Promise<Response> | undefined;
    handlers[type]!({ ...extra, waitUntil: (p: Promise<unknown>) => (done = p), respondWith: (p: Promise<Response>) => (answer = p) });
    await done;
    return answer && (await answer);
  };
  const get = (path: string, mode = "cors") => run("fetch", { request: { method: "GET", url: origin + path, mode } });
  return { run, get, stores, net };
}

describe("installable", () => {
  test("the page gets the manifest, icons and iOS tags", async () => {
    const { html, emitted } = await build({});
    expect(html).toContain(`rel="manifest"`);
    expect(html).toContain(`rel="apple-touch-icon" href="/icon-180.png"`);
    const manifest = JSON.parse(String(emitted.get("manifest.webmanifest")));
    expect(manifest).toMatchObject({ name: "Hippo Tycoon", short_name: "Hippo", display: "standalone", start_url: "/" });
    const icon = emitted.get("icon-512.png") as Uint8Array;
    expect([...icon.subarray(1, 4)].map((c) => String.fromCharCode(c)).join("")).toBe("PNG");
    expect(new DataView(icon.buffer, icon.byteOffset).getUint32(16)).toBe(512);
  });

  test("installed once, the game plays with the network gone; the socket still goes to the network", async () => {
    const { emitted } = await build({ "hippo_sim.wasm": "wasm", "sounds/gulp.ogg": "ogg" });
    const sw = scope(String(emitted.get("sw.js")));
    await sw.run("install");
    await sw.run("activate");

    sw.net.up = false;
    expect(await (await sw.get("/?room=ABCD", "navigate"))!.text()).toBe("net /");   // the kept page, fetched at install
    for (const p of ["/assets/main-abc.js", "/hippo_sim.wasm", "/sounds/gulp.ogg", "/icon-192.png"]) expect((await sw.get(p))?.ok).toBe(true);
    expect(await sw.get("/assets/main-abc.js.map")).toBeUndefined();   // not kept: left to the network
    expect(await sw.get("/ws?room=ABCD")).toBeUndefined();

    sw.net.up = true;
    expect(await (await sw.get("/", "navigate"))!.text()).toBe("net /");   // online, a page load asks the network first
    expect(sw.net.hits.at(-1)).toBe("/");
  });

  test("a new build replaces the old cache", async () => {
    const a = String((await build({ "hippo_sim.wasm": "v1" })).emitted.get("sw.js"));
    const b = String((await build({ "hippo_sim.wasm": "v2" })).emitted.get("sw.js"));
    expect(a).not.toBe(b);
    const sw = scope(a);
    await sw.run("install");
    const next = scope(b);
    next.stores.set([...sw.stores.keys()][0]!, new Map());   // the old cache, still on the phone
    await next.run("install");
    await next.run("activate");
    expect(next.stores.size).toBe(1);
  });
});
