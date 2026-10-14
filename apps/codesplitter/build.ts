// Bundle the Worker (the fetch handler and the file Durable Object) and copy
// the pages: the site, the game, the feature list the home page's strip reads, the API reference and the MCP page. No framework.
import { mkdir, copyFile, readdir, readFile, writeFile } from "node:fs/promises";
import { headersFile, inlineScriptHashes } from "./src/security.ts";
import { features } from "./features.ts";
import { buildGitpath } from "./src/gitpath/build.ts";

await mkdir("dist/client", { recursive: true });
// The home page's styles and script go to content-hashed files, so a deploy that changes only one
// leaves the other cached, and the HTML itself is small. 'self' covers them, so the CSP needs no hash.
const home = await readFile("src/client.html", "utf8");
// The style is the head's; the script is the one at the end (the page's own code mentions <style> in strings).
const head = home.slice(0, home.indexOf("</head>"));
const css = [...head.matchAll(/<style>([\s\S]*?)<\/style>/g)];
const js = [...home.slice(head.length).matchAll(/<script>([\s\S]*?)<\/script>/g)];
if (css.length !== 1 || js.length !== 1) throw new Error(`src/client.html: expected one inline <style> in the head and one inline <script>, found ${css.length} and ${js.length}`);
await mkdir("dist/client/assets", { recursive: true });
const hashed = async (body: string, ext: string) => {
  const name = `app-${new Bun.CryptoHasher("sha256").update(body).digest("hex").slice(0, 10)}.${ext}`;
  await writeFile(`dist/client/assets/${name}`, body);
  return `/assets/${name}`;
};
const cssUrl = await hashed(css[0]![1]!, "css");
const jsUrl = await hashed(js[0]![1]!, "js");
await writeFile("dist/client/index.html", home
  .replace(css[0]![0], () => `<link href="${cssUrl}" rel="stylesheet">`)
  .replace(js[0]![0], () => `<script src="${jsUrl}"></script>`));
await copyFile("src/play.html", "dist/client/play.html");
// The game's code city mode, which play.html loads on #c/<name>.
await copyFile("src/city.js", "dist/client/city.js");
// The shop interiors it loads when you walk up to a ground floor (city.js: SHOP_MODULES).
await mkdir("dist/client/city-shops", { recursive: true });
for (const f of await readdir("src/city-shops")) await copyFile(`src/city-shops/${f}`, `dist/client/city-shops/${f}`);
// The QR code for the desktop's phone pairing link, drawn here so a desktop offline still makes one.
// The avatar parts and drawing (src/avatar.ts), which the profile editor and the code city both import.
const av = await Bun.build({ entrypoints: ["src/avatar.ts"], outdir: "dist/client", target: "browser", format: "esm", minify: true, naming: "avatar.js" });
if (!av.success) { for (const l of av.logs) console.error(l); process.exit(1); }
const qr = await Bun.build({ entrypoints: ["src/qr.ts"], outdir: "dist/client", target: "browser", format: "esm", minify: true, naming: "qr.js" });
if (!qr.success) { for (const l of qr.logs) console.error(l); process.exit(1); }
// gitpath: a file's history played down a highway (src/gitpath/): its page, script and sample.
await buildGitpath("dist/client");
await copyFile("src/features.html", "dist/client/features.html");
// Built from src/features/, one file per feature (features.ts).
await writeFile("dist/client/features.json", JSON.stringify(features()) + "\n");
// Not api.html: Cloudflare serves that at /api, over the Worker's JSON.
await copyFile("src/api.html", "dist/client/reference.html");
await copyFile("src/mcp.html", "dist/client/mcp.html");
// The pages' security headers, the same ones the Worker puts on its answers (src/security.ts),
// with the hashes of the pages' inline scripts: the enforced CSP runs those and no others.
const pages = ["index.html", "play.html", "features.html", "reference.html", "mcp.html"];
const hashes = new Set<string>();
for (const page of pages) for (const h of inlineScriptHashes(await readFile(`dist/client/${page}`, "utf8"))) hashes.add(h);
await writeFile("dist/client/_headers", headersFile([...hashes]) + "\n/assets/*\n  cache-control: public, max-age=31536000, immutable\n");
// Geist, served from here (no Google Fonts call): the stylesheet, both variable fonts and their license.
await mkdir("dist/client/fonts", { recursive: true });
for (const f of ["geist.css", "Geist-Variable.woff2", "GeistMono-Variable.woff2", "LICENSE.txt"]) await copyFile(`src/fonts/${f}`, `dist/client/fonts/${f}`);
// Lucide (the icons) and three.js (the game's 3D engine) the same way, from the pinned
// packages, so no visitor's browser asks a CDN for them.
await mkdir("dist/client/vendor", { recursive: true });
for (const [from, to] of [
  ["lucide/dist/umd/lucide.min.js", "lucide.min.js"], ["lucide/LICENSE", "lucide-LICENSE.txt"],
  ["three/build/three.module.min.js", "three.module.js"], ["three/LICENSE", "three-LICENSE.txt"],
]) await copyFile(`node_modules/${from}`, `dist/client/vendor/${to}`);
// Resolve packages as wrangler does for workerd, and leave node:* to the runtime
// (nodejs_compat). Without it Better Auth takes its browser build, whose stand-in
// AsyncLocalStorage is one slot shared by every request: overlapping requests
// clear each other's state and getSession throws "No request state found".
const r = await Bun.build({ entrypoints: ["src/worker.ts"], outdir: "dist/worker", target: "browser", conditions: ["workerd", "worker"], external: ["node:*"], format: "esm", naming: "worker.js",
  // Minified, so a cold isolate parses less; the linked map (uploaded with it, worker.sourceMaps)
  // keeps Workers Logs traces naming the source.
  minify: true, sourcemap: "linked" });
if (!r.success) { for (const l of r.logs) console.error(l); process.exit(1); }
// The CLI as one file for Bun or Node, so anyone can install it from the site (GET /install.sh
// fetches it and adds the shebang). Tree-shaking leaves just the tool list and the HTTP call.
const cli = await Bun.build({ entrypoints: ["cli.ts"], outdir: "dist/client", target: "node", format: "cjs", minify: true, naming: "cli.js" });
if (!cli.success) { for (const l of cli.logs) console.error(l); process.exit(1); }
