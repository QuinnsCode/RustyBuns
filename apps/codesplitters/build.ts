// Bundle the Worker (the fetch handler and the file Durable Object) and copy
// the pages: the site, the game, and the feature list the home page's strip reads. No framework.
import { mkdir, copyFile } from "node:fs/promises";

await mkdir("dist/client", { recursive: true });
await copyFile("src/client.html", "dist/client/index.html");
await copyFile("src/play.html", "dist/client/play.html");
await copyFile("src/features.html", "dist/client/features.html");
await copyFile("src/features.json", "dist/client/features.json");
// Resolve packages as wrangler does for workerd, and leave node:* to the runtime
// (nodejs_compat). Without it Better Auth takes its browser build, whose stand-in
// AsyncLocalStorage is one slot shared by every request: overlapping requests
// clear each other's state and getSession throws "No request state found".
const r = await Bun.build({ entrypoints: ["src/worker.ts"], outdir: "dist/worker", target: "browser", conditions: ["workerd", "worker"], external: ["node:*"], format: "esm", naming: "worker.js" });
if (!r.success) { for (const l of r.logs) console.error(l); process.exit(1); }
