// Bundle the Worker (the fetch handler and the file Durable Object) and copy
// the pages: the site, the game, the feature list the home page's strip reads, the API reference and the MCP page. No framework.
import { mkdir, copyFile, writeFile } from "node:fs/promises";
import { headersFile } from "./src/security.ts";

await mkdir("dist/client", { recursive: true });
await copyFile("src/client.html", "dist/client/index.html");
await copyFile("src/play.html", "dist/client/play.html");
// The game's code city mode, which play.html loads on #c/<name>.
await copyFile("src/city.js", "dist/client/city.js");
await copyFile("src/features.html", "dist/client/features.html");
await copyFile("src/features.json", "dist/client/features.json");
// Not api.html: Cloudflare serves that at /api, over the Worker's JSON.
await copyFile("src/api.html", "dist/client/reference.html");
await copyFile("src/mcp.html", "dist/client/mcp.html");
// The pages' security headers, the same ones the Worker puts on its answers (src/security.ts).
await writeFile("dist/client/_headers", headersFile());
// Geist, served from here (no Google Fonts call): the stylesheet, both variable fonts and their license.
await mkdir("dist/client/fonts", { recursive: true });
for (const f of ["geist.css", "Geist-Variable.woff2", "GeistMono-Variable.woff2", "LICENSE.txt"]) await copyFile(`src/fonts/${f}`, `dist/client/fonts/${f}`);
// Lucide (the icons) and three.js (the game's 3D engine) the same way, from the pinned
// packages, so no visitor's browser asks a CDN for them.
await mkdir("dist/client/vendor", { recursive: true });
for (const [from, to] of [
  ["lucide/dist/umd/lucide.min.js", "lucide.min.js"], ["lucide/LICENSE", "lucide-LICENSE.txt"],
  ["three/build/three.module.js", "three.module.js"], ["three/LICENSE", "three-LICENSE.txt"],
]) await copyFile(`node_modules/${from}`, `dist/client/vendor/${to}`);
// Resolve packages as wrangler does for workerd, and leave node:* to the runtime
// (nodejs_compat). Without it Better Auth takes its browser build, whose stand-in
// AsyncLocalStorage is one slot shared by every request: overlapping requests
// clear each other's state and getSession throws "No request state found".
const r = await Bun.build({ entrypoints: ["src/worker.ts"], outdir: "dist/worker", target: "browser", conditions: ["workerd", "worker"], external: ["node:*"], format: "esm", naming: "worker.js" });
if (!r.success) { for (const l of r.logs) console.error(l); process.exit(1); }
// The CLI as one file for Bun or Node, so anyone can install it from the site (GET /install.sh
// fetches it and adds the shebang). Tree-shaking leaves just the tool list and the HTTP call.
const cli = await Bun.build({ entrypoints: ["cli.ts"], outdir: "dist/client", target: "node", format: "cjs", minify: true, naming: "cli.js" });
if (!cli.success) { for (const l of cli.logs) console.error(l); process.exit(1); }
