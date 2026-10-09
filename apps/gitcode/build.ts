// Bundle the Worker (the fetch handler and the file Durable Object) and copy
// the one-page client. No framework.
import { mkdir, copyFile } from "node:fs/promises";

await mkdir("dist/client", { recursive: true });
await copyFile("src/client.html", "dist/client/index.html");
const r = await Bun.build({ entrypoints: ["src/worker.ts"], outdir: "dist/worker", target: "browser", format: "esm", naming: "worker.js" });
if (!r.success) { for (const l of r.logs) console.error(l); process.exit(1); }
