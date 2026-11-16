// A built page you can put on a phone's home screen and play with no signal (#4687, path 1): a vite plugin that adds
// the web manifest, the home-screen icons (drawn in code, so no binary in the repo), the iOS meta tags, and a service
// worker that keeps every built file. Online, a page load still asks the network first, so a deploy shows up on the
// next visit; offline, the kept copy answers. Anything not in the build (`/ws`, `/api`) goes to the network as before.
//
// Only the browser build should use it: a desktop build serves its page from the binary and needs none of this.
// The plugin is typed by shape, not by vite's `Plugin`, so @rustybuns/cli doesn't depend on vite.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

type Rgb = readonly [number, number, number];

export interface Installable {
  /** The name under the icon and in the app switcher. */
  name: string;
  /** Under the icon when `name` is too long. */
  shortName?: string;
  /** The splash and status-bar colour while the page loads, `#rrggbb`. */
  background: string;
  /** The browser chrome colour; `background` when unset. */
  theme?: string;
  /** The icon, one pixel at a time: `u` and `v` run 0..1 across and down. A full square: iOS rounds the corners. */
  icon: (u: number, v: number) => Rgb;
}

/** The parts of vite's plugin context this plugin uses. */
interface Emit { emitFile(f: { type: "asset"; fileName: string; source: string | Uint8Array }): unknown }
type Bundled = { type: "chunk"; code: string } | { type: "asset"; source: string | Uint8Array };

const SIZES = [180, 192, 512] as const;

/** The vite plugin: `plugins: [installable({ name, background, icon })]` in the browser build's config. */
export function installable(o: Installable) {
  let publicDir = "";
  const theme = o.theme ?? o.background;
  return {
    name: "rustybuns:installable",
    apply: "build" as const,
    enforce: "post" as const,   // after vite writes index.html into the bundle
    configResolved(c: { publicDir: string }) { publicDir = c.publicDir; },
    transformIndexHtml(html: string) {
      const head = [
        `<link rel="manifest" href="/manifest.webmanifest">`,
        `<link rel="apple-touch-icon" href="/icon-180.png">`,
        `<meta name="theme-color" content="${theme}">`,
        `<meta name="mobile-web-app-capable" content="yes">`,
        `<meta name="apple-mobile-web-app-capable" content="yes">`,
        `<meta name="apple-mobile-web-app-title" content="${o.shortName ?? o.name}">`,
        `<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">`,
        `<script>if("serviceWorker"in navigator)addEventListener("load",()=>navigator.serviceWorker.register("/sw.js"))</script>`,
      ].join("\n");
      return html.replace("</head>", `${head}\n</head>`);
    },
    async generateBundle(this: Emit, _out: unknown, bundle: Record<string, Bundled>) {
      const ours = new Map<string, string | Uint8Array>();
      for (const size of SIZES) ours.set(`icon-${size}.png`, await png(size, o.icon));
      ours.set("manifest.webmanifest", JSON.stringify(manifest(o, theme), null, 2));
      for (const [fileName, source] of ours) this.emitFile({ type: "asset", fileName, source });

      const files = new Map<string, string | Uint8Array>(ours);
      for (const [name, f] of Object.entries(bundle)) files.set(name, f.type === "chunk" ? f.code : f.source);
      for (const name of publicFiles(publicDir)) files.set(name, readFileSync(join(publicDir, name)));   // vite copies these after
      this.emitFile({ type: "asset", fileName: "sw.js", source: serviceWorker(files) });
    },
  };
}

function manifest(o: Installable, theme: string) {
  return {
    name: o.name,
    short_name: o.shortName ?? o.name,
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: o.background,
    theme_color: theme,
    icons: SIZES.filter((s) => s !== 180).map((s) => ({ src: `/icon-${s}.png`, sizes: `${s}x${s}`, type: "image/png", purpose: "any" })),
  };
}

/** Every file under `dir`, as paths from it with forward slashes. */
function publicFiles(dir: string): string[] {
  if (!dir) return [];
  const out: string[] = [];
  const walk = (d: string) => {
    let names: string[];
    try { names = readdirSync(d); } catch { return; }
    for (const n of names) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else out.push(relative(dir, p).split(sep).join("/"));
    }
  };
  walk(dir);
  return out.sort();
}

/**
 * The service worker for a build's files (path from the output folder to its bytes). Its cache is named for a hash of
 * every file, so any change makes a new cache and the old one is dropped once the new worker takes over.
 */
export function serviceWorker(files: ReadonlyMap<string, string | Uint8Array>): string {
  const keep = [...files.keys()].filter((n) => !n.endsWith(".map") && n !== "sw.js").sort();
  const hash = createHash("sha256");
  for (const n of keep) hash.update(n).update(files.get(n)!);
  const version = `rb-${hash.digest("hex").slice(0, 16)}`;
  const paths = [...new Set(["/", ...keep.map((n) => (n === "index.html" ? "/" : `/${n}`))])];   // the page, even when vite adds index.html later
  return `// Written by @rustybuns/cli/installable at build time.
const V = ${JSON.stringify(version)};
const FILES = ${JSON.stringify(paths)};
self.addEventListener("install", (e) => e.waitUntil(caches.open(V).then((c) => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener("activate", (e) => e.waitUntil(caches.keys()
  .then((ks) => Promise.all(ks.filter((k) => k.startsWith("rb-") && k !== V).map((k) => caches.delete(k))))
  .then(() => self.clients.claim())));
self.addEventListener("fetch", (e) => {
  const r = e.request;
  if (r.method !== "GET") return;
  const u = new URL(r.url);
  if (u.origin !== self.location.origin) return;
  if (r.mode === "navigate") {
    e.respondWith(fetch(r).catch(() => caches.open(V).then((c) => c.match("/")).then((hit) => hit || Response.error())));
    return;
  }
  if (!FILES.includes(u.pathname)) return;
  e.respondWith(caches.open(V).then((c) => c.match(u.pathname)).then((hit) => hit || fetch(r)));
});
`;
}

/** A square RGB PNG painted by `paint`, each pixel the mean of a 3x3 grid of samples so edges are smooth. */
export async function png(size: number, paint: (u: number, v: number) => Rgb): Promise<Uint8Array> {
  const row = size * 3 + 1;
  const raw = new Uint8Array(size * row);
  const n = 3;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let r = 0, g = 0, b = 0;
    for (let sy = 0; sy < n; sy++) for (let sx = 0; sx < n; sx++) {
      const c = paint((x + (sx + 0.5) / n) / size, (y + (sy + 0.5) / n) / size);
      r += c[0]; g += c[1]; b += c[2];
    }
    raw.set([r / (n * n), g / (n * n), b / (n * n)].map(Math.round), y * row + 1 + x * 3);
  }
  const ihdr = new Uint8Array(13);
  new DataView(ihdr.buffer).setUint32(0, size);
  new DataView(ihdr.buffer).setUint32(4, size);
  ihdr.set([8, 2, 0, 0, 0], 8);   // 8-bit RGB
  const deflated = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream("deflate"))).arrayBuffer());
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflated), chunk("IEND", new Uint8Array())];
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

const CRC = Array.from({ length: 256 }, (_, i) => {
  let c = i;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  let c = 0xffffffff;
  for (const b of out.subarray(4, 8 + data.length)) c = CRC[(c ^ b) & 255]! ^ (c >>> 8);
  dv.setUint32(8 + data.length, (c ^ 0xffffffff) >>> 0);
  return out;
}
