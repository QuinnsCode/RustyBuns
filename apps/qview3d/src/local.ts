// Required Notice: Copyright (c) 2026 Ryan Quinn (QNTBR) (https://qntbr.com). PolyForm Noncommercial 1.0.0, see ../LICENSE.
//
// The Worker on Bun, for `bun run dev` and the tests: R2 is shell-bun's twin over a directory, and the built
// widget (dist/client) is served first, the way Cloudflare serves static assets before the Worker.
import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { sha256 } from "@rustybuns/util/bytes";
import { r2 } from "@rustybuns/shell-bun";
import type { Org, Product } from "./api.ts";
import { orgKey, productKey } from "./layout.ts";
import { standInMeshy } from "./local-meshy.ts";
import { DEMO_PRODUCTS } from "./demo.ts";
import { handle, type Env } from "./worker.ts";

const BUILT = resolve(import.meta.dir, "../dist/client");

/** The demo org's admin key, on this machine only: it makes samples on the stand-in Meshy. */
export const DEMO_ADMIN = "demo-admin-key";

/** The demo org: any page may embed it, one product per hat, an admin, and three samples. */
export async function seedDemo(bindings: Env) {
  const put = (k: string, v: Org | Product) => bindings.BUCKET.put(k, JSON.stringify(v), { httpMetadata: { contentType: "application/json" } });
  await put(orgKey("demo"), { origins: ["*"], admins: [await sha256(DEMO_ADMIN)], samples: 3 });
  for (const [id, p] of Object.entries(DEMO_PRODUCTS)) await put(productKey("demo", id), p);
}

/**
 * `meshy` is a real Meshy (a key and base); left out, the stand-in answers, in `standInSeconds` (8).
 * `seed: false` starts with an empty bucket, the way a fresh deploy does. `limits` are rate limit bindings (a fake, in the tests).
 * `assets` serves a widget built elsewhere (a test's own build) in place of dist/client. `eqosys` is the eqosys whose tokens sign people in.
 * Packs of samples are paid by the test provider (nothing charged) unless `env` says otherwise (`STRIPE_*`).
 */
export async function local(o: { dir: string; port?: number; secret?: string; meshy?: { key: string; base: string }; standInSeconds?: number; seed?: boolean; limits?: Pick<Env, "SIGN_LIMIT" | "SAMPLE_LIMIT">; assets?: string; eqosys?: string; env?: Partial<Env> }) {
  const STATIC = o.assets ? resolve(o.assets) : BUILT;
  const standIn = o.meshy ? null : await standInMeshy({ seconds: o.standInSeconds });
  const meshy = o.meshy ?? standIn!;
  const bindings: Env = { BUCKET: r2(join(o.dir, "bucket")), UPLOAD_SECRET: o.secret ?? crypto.randomUUID(), MESHY_API_KEY: meshy.key, MESHY_API_BASE: meshy.base, BILLING_TEST: "1", ...o.limits, ...(o.eqosys ? { EQOSYS_URL: o.eqosys } : {}), ...o.env };
  if (o.seed !== false) await seedDemo(bindings);
  const server = Bun.serve({
    port: o.port ?? 0,
    async fetch(req) {
      const path = decodeURIComponent(new URL(req.url).pathname);
      const file = join(STATIC, path.endsWith("/") ? `${path}index.html` : path);
      if (req.method === "GET" && file.startsWith(STATIC) && existsSync(file) && statSync(file).isFile()) {
        return new Response(Bun.file(file), { headers: { "access-control-allow-origin": "*", "cache-control": "no-cache" } });
      }
      return handle(req, bindings);
    },
  });
  return { url: `http://localhost:${server.port}`, bindings, standIn, stop: () => { server.stop(true); standIn?.stop(); } };
}
