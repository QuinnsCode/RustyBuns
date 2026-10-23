// The same Worker `handle` on a plain Bun server: `bun src/serve.ts` after `bun run build`. Railway, AWS or a
// box under a desk can run it, so the API has somewhere to go if Cloudflare is down. Reads PORT,
// ARTSTEW_URL, GEOBOXQ_LICENSE and GEOBOXQ_URL from the environment.
import { join, normalize, resolve } from "node:path";
import { handle, type Env } from "./worker.ts";

const root = resolve(import.meta.dir, "../dist/client");

/** What the assets binding does at the edge: a file if there is one, else the page (client-side routes). */
const ASSETS: NonNullable<Env["ASSETS"]> = {
  async fetch(req) {
    const path = normalize(decodeURIComponent(new URL(req.url).pathname));
    const file = Bun.file(join(root, path));
    const ok = join(root, path).startsWith(root) && path !== "/" && await file.exists();
    return new Response(ok ? file : Bun.file(join(root, "index.html")));
  },
};

export function serve(port = Number(process.env.PORT ?? 8787), env: Partial<Env> = process.env as Partial<Env>) {
  return Bun.serve({ port, fetch: (req) => handle(req, { ...env, ASSETS }).catch(() => Response.json({ error: "server error" }, { status: 500 })) });
}

if (import.meta.main) console.log(`GeoBoxQ on http://localhost:${serve().port}`);
