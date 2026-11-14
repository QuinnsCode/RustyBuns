// QView3D on this machine: the Worker on Bun with R2 in .data/ and the demo org seeded, behind a Vite dev server
// that serves the demo shop (public/) and the widget straight from src/, so an edit shows on reload.
//
//   bun run dev                  http://localhost:5190
//   QVIEW_PORT=5300 bun run dev
import { join } from "node:path";
import { createServer } from "vite";
import { local } from "../src/local.ts";

const app = join(import.meta.dir, "..");
const api = await local({ dir: join(app, ".data") });
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
console.log(`QView3D demo shop: ${url}  samples: ${url}admin.html  (widget: ${url}v1/qview3d.js, API: ${target})`);
