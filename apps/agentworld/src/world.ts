// The sealed frame a world runs in, the way codeSplitter runs a person's page: index.html with its own files put
// inline, a Content-Security-Policy first (libraries from four CDNs only; no fetch, sockets or forms), and a small
// reporter that tells the page what went wrong in there (errors, blocked loads), which page_read hands the agent.
// The frame is `sandbox="allow-scripts"` with no same-origin: an opaque origin, so no cookies, storage or reach into
// this page. Pure strings here (no DOM), so the Worker could serve the same document later.
import { camera } from "./camera.ts";
import { KIT } from "./kit.ts";
import type { Page } from "./page.ts";

/** Where a world may load libraries from, pinned versions being the author's job (as codeSplitter's LIBRARY_HOSTS). */
export const LIBRARY_HOSTS = ["https://esm.sh", "https://cdn.jsdelivr.net", "https://unpkg.com", "https://cdnjs.cloudflare.com"];

export const WORLD_CSP = [
  "default-src 'none'",
  `script-src 'unsafe-inline' data: ${LIBRARY_HOSTS.join(" ")}`,
  "style-src 'unsafe-inline' https://fonts.googleapis.com",
  "font-src data: https://fonts.gstatic.com",
  "img-src data: blob:",
  "media-src data: blob:",
  "connect-src data: blob:",
  "worker-src blob:",
  "form-action 'none'",
  "base-uri 'none'",
].join("; ");

/** What a world's frame says to the page, under this key: it started, it loaded, or something went wrong. */
export const SAID_KEY = "agentworld_world";

// Runs first in the frame. Errors with the file they came from (each inlined file carries a sourceURL), loads the
// frame wouldn't make, and console.error, each cut to a line.
const REPORTER = `(() => {
  const say = (kind, text) => { try { parent.postMessage({ ${SAID_KEY}: true, kind, text: String(text).slice(0, 400) }, "*"); } catch {} };
  say("start", "");
  addEventListener("load", () => say("loaded", ""));
  addEventListener("error", (e) => {
    if (e.target && e.target !== window) return say("error", "couldn't load " + (e.target.src || e.target.href || e.target.tagName));
    const at = e.filename ? " (" + e.filename.split("/").pop() + ":" + e.lineno + ")" : "";
    say("error", (e.message || "error") + at);
  }, true);
  addEventListener("unhandledrejection", (e) => say("error", "unhandled: " + ((e.reason && e.reason.message) || e.reason)));
  addEventListener("securitypolicyviolation", (e) => say("blocked", e.blockedURI + " (" + e.effectiveDirective + ": the frame is sealed)"));
  const ce = console.error.bind(console);
  console.error = (...a) => { say("error", a.map(String).join(" ")); ce(...a); };
})();`;

const attr = (tag: string, name: string) => tag.match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, "i"))?.[2] ?? null;
/** One of the world's own paths, from a name in index.html (`world.js`, `./world.js`), or null for anything else. */
const own = (files: Page["files"], dir: string, name: string): string | null => {
  if (/^[a-z]+:|^\/\//i.test(name)) return null;
  const parts = (name.startsWith("/") ? name.slice(1) : `${dir}${name}`).split("/");
  const out: string[] = [];
  for (const p of parts) { if (p === "..") out.pop(); else if (p !== "." && p !== "") out.push(p); }
  const path = out.join("/");
  return path in files ? path : null;
};
const dirOf = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/") + 1) : "");
const safeIn = (text: string, tag: string) => text.replace(new RegExp(`</${tag}`, "gi"), `<\\/${tag}`);

/** A module's imports of the world's own files, as bare `@world/<path>` names that the import map resolves. */
const bareImports = (files: Page["files"], from: string, text: string) =>
  text.replace(/(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(["'])([^"']+)\2/g, (m, lead: string, q: string, spec: string) => {
    const p = spec.startsWith(".") || spec.startsWith("/") ? own(files, dirOf(from), spec) : null;
    return p ? `${lead}${q}@world/${p}${q}` : m;
  });

/** The document the frame opens: index.html, its own scripts and styles put inline, sealed and reporting. */
export function worldDoc(page: Page): string {
  const files = page.files;
  const index = files["index.html"];
  if (index === undefined) return `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#05060f;color:#9aa0c4;font:14px ui-monospace,monospace;display:grid;place-items:center;height:100vh">No index.html yet: ask your AI to write one.`;
  const scripts = Object.keys(files).filter((p) => /\.m?js$/.test(p));
  const imports: Record<string, string> = Object.fromEntries(scripts.map((p) => [`@world/${p}`, `data:text/javascript;charset=utf-8,${encodeURIComponent(`${bareImports(files, p, files[p]!)}\n//# sourceURL=${p}`)}`]));
  // The kit's bare name has no extension, so no file of the world's (its own kit.js is `@world/kit.js`) can take it.
  imports["@world/kit"] = `data:text/javascript;charset=utf-8,${encodeURIComponent(`${KIT}\n//# sourceURL=@world/kit`)}`;
  let html = index
    .replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (m, attrs: string, body: string) => {
      const src = attr(attrs, "src");
      const type = attr(attrs, "type");
      if (type === "importmap") {
        // The world's own import map (three.js from a CDN, say) and the map of its files become one.
        try { const map: unknown = JSON.parse(body); const mine = typeof map === "object" && map !== null && "imports" in map && typeof map.imports === "object" ? map.imports : {}; Object.assign(imports, mine); } catch { /* a bad map: ours alone */ }
        return "";
      }
      const p = src === null ? null : own(files, "", src);
      if (p === null) return type === "module" && body.trim() ? m.replace(body, safeIn(bareImports(files, "index.html", body), "script")) : m;
      const rest = attrs.replace(/\bsrc\s*=\s*(["']).*?\1/i, "");
      const text = type === "module" ? bareImports(files, p, files[p]!) : files[p]!;
      return `<script${rest}>${safeIn(text, "script")}\n//# sourceURL=${p}</script>`;
    })
    .replace(/<link\b[^>]*>/gi, (m) => {
      const href = attr(m, "href");
      const p = href === null || !/stylesheet/i.test(attr(m, "rel") ?? "") ? null : own(files, "", href);
      return p === null ? m : `<style>${safeIn(files[p]!, "style")}</style>`;
    });
  const head = `<meta http-equiv="Content-Security-Policy" content="${WORLD_CSP}"><script>${REPORTER}\n${camera(SAID_KEY)}</script><script type="importmap">${safeIn(JSON.stringify({ imports }), "script")}</script>`;
  // First in the document, so nothing of the world's runs before the policy and the reporter.
  const doctype = html.match(/^\s*<!doctype[^>]*>/i)?.[0] ?? "";
  html = html.slice(doctype.length);
  return `${doctype || "<!doctype html>"}${head}${html}`;
}
