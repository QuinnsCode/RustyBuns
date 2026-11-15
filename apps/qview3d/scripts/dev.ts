// QView3D on this machine: the Worker on Bun with R2 in .data/ and the demo org seeded, behind a Vite dev server
// that serves the demo shop (public/) and the widget straight from src/, so an edit shows on reload.
//
//   bun run dev                  http://localhost:5190, samples on the free stand-in Meshy
//   QVIEW_PORT=5300 bun run dev
//   bunx varlock run -- bun run dev   samples on the real Meshy (MESHY_API_KEY from 1Password): billed in credits
//   EQOSYS_URL=http://localhost:5180 bun run dev   the shops page (orgs.html) signs in through a local eqosys
// It also prints a sandbox link (try.html), the page a friend lands on from the owner's hand-off.
import { join } from "node:path";
import { createServer } from "vite";
import { local } from "../src/local.ts";
import { MESHY_BASE } from "../src/meshy.ts";
import { openSandbox, sandboxLink } from "../src/sandboxes.ts";
import { PORTS } from "@rustybuns/util/ports";

const app = join(import.meta.dir, "..");
const key = process.env.MESHY_API_KEY;
const api = await local({ dir: join(app, ".data"), meshy: key ? { key, base: MESHY_BASE } : undefined, eqosys: process.env.EQOSYS_URL });
const target = api.url;
// A sandbox on this machine, so the hand-off page opens without a local eqosys. Renewed on each start.
const LOCAL_SANDBOX = "try-local", LOCAL_SANDBOX_KEY = "try-local-key";
await openSandbox(api.bindings, LOCAL_SANDBOX, LOCAL_SANDBOX_KEY, { samples: 2, days: 14 });
const vite = await createServer({
  configFile: false,
  root: join(app, "public"),
  publicDir: false,
  server: {
    port: Number(process.env.QVIEW_PORT ?? PORTS.qview3d),
    fs: { allow: [app, join(app, "../..")] },
    // The Host header passes through, so links the Worker writes (the guide, saved designs) name this server.
    proxy: Object.fromEntries(["/api", "/u", "/r", "/v1/embed.md", "/v1/frame", "/llms.txt"].map((p) => [p, { target, changeOrigin: false }])),
  },
  plugins: [{
    // The URL shops paste, answered from source in dev.
    name: "qview3d-entry",
    configureServer(s) {
      s.middlewares.use((req, _res, next) => {
        if (req.url?.startsWith("/v1/qview3d.js")) req.url = `/@fs${join(app, "src/widget/index.ts")}`;
        if (req.url?.startsWith("/v1/admin.js")) req.url = `/@fs${join(app, "src/admin.ts")}`;
        if (req.url?.startsWith("/v1/orgs.js")) req.url = `/@fs${join(app, "src/orgs-page.ts")}`;
        if (req.url?.startsWith("/v1/try.js")) req.url = `/@fs${join(app, "src/try-page.ts")}`;
        next();
      });
    },
  }],
});
await vite.listen();
const url = vite.resolvedUrls?.local[0] ?? `http://localhost:${vite.config.server.port}/`;
console.log(key ? "Samples go to the real Meshy: each one is billed in Meshy credits." : "Samples go to the stand-in Meshy: free, and always a tumbler.");
console.log(`QView3D demo shop: ${url}  samples: ${url}admin.html  shops: ${url}orgs.html  (widget: ${url}v1/qview3d.js, API: ${target})`);
console.log(`A sandbox, as a friend gets it: ${sandboxLink(url.replace(/\/$/, ""), LOCAL_SANDBOX, LOCAL_SANDBOX_KEY)}`);
