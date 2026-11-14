// QView3D on this machine: the Worker on Bun with R2 in .data/ and the demo org seeded, behind a Vite dev server
// that serves the demo shop (public/) and the widget straight from src/, so an edit shows on reload.
//
//   bun run dev                  http://localhost:5190, samples on the free stand-in Meshy
//   QVIEW_PORT=5300 bun run dev
//   bunx varlock run -- bun run dev   samples on the real Meshy (MESHY_API_KEY from 1Password): billed in credits
import { join } from "node:path";
import { createServer } from "vite";
import { local } from "../src/local.ts";
import { MESHY_BASE } from "../src/meshy.ts";

const app = join(import.meta.dir, "..");
const key = process.env.MESHY_API_KEY;
const api = await local({ dir: join(app, ".data"), meshy: key ? { key, base: MESHY_BASE } : undefined });
const target = api.url;
const vite = await createServer({
  configFile: false,
  root: join(app, "public"),
  publicDir: false,
  server: {
    port: Number(process.env.QVIEW_PORT ?? 5190),
    fs: { allow: [app, join(app, "../..")] },
    proxy: { "/api": target, "/u": target, "/r": target },
  },
  plugins: [{
    // The URL shops paste, answered from source in dev.
    name: "qview3d-entry",
    configureServer(s) {
      s.middlewares.use((req, _res, next) => {
        if (req.url?.startsWith("/v1/qview3d.js")) req.url = `/@fs${join(app, "src/widget/index.ts")}`;
        if (req.url?.startsWith("/v1/admin.js")) req.url = `/@fs${join(app, "src/admin.ts")}`;
        next();
      });
    },
  }],
});
await vite.listen();
const url = vite.resolvedUrls?.local[0] ?? `http://localhost:${vite.config.server.port}/`;
console.log(key ? "Samples go to the real Meshy: each one is billed in Meshy credits." : "Samples go to the stand-in Meshy: free, and always a tumbler.");
console.log(`QView3D demo shop: ${url}  samples: ${url}admin.html  (widget: ${url}v1/qview3d.js, API: ${target})`);
