// Required Notice: Copyright (c) 2026 Ryan Quinn (QNTBR) (https://qntbr.com). PolyForm Noncommercial 1.0.0, see ../LICENSE.
//
// The Worker on Bun, for `bun run dev` and the tests: R2 is shell-bun's twin over a directory, D1 its sqlite twin in
// the same directory (the migrations run at boot, as a deploy runs them), the Cache API a map in memory, and the built
// widget (dist/client) is served first, the way Cloudflare serves static assets before the Worker.
import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { sha256 } from "@rustybuns/util/bytes";
import { applyD1Migrations, d1, r2 } from "@rustybuns/shell-bun";
import { standInMeshy } from "./local-meshy.ts";
import { DEMO_ORG, DEMO_SETTINGS } from "./demo.ts";
import { putOrg, type SettingsCache } from "./settings.ts";
import { handle, type Env } from "./worker.ts";

const BUILT = resolve(import.meta.dir, "../dist/client");

/** The demo org's admin key, on this machine only: it makes samples on the stand-in Meshy. */
export const DEMO_ADMIN = "demo-admin-key";

/** The demo org the migrations seeded, made a full one: it keeps files, has an admin key and three samples. */
export async function seedDemo(bindings: Env) {
  await putOrg(bindings, DEMO_ORG, { ...DEMO_SETTINGS, admins: [await sha256(DEMO_ADMIN)], samples: 3, readOnly: false });
}

/** caches.default for the twin: kept in memory for each entry's max-age, as the edge keeps it. */
function memoryCache(): SettingsCache {
  const kept = new Map<string, { body: string; headers: [string, string][]; until: number }>();
  return {
    async match(req) {
      const e = kept.get(req.url);
      if (!e || e.until < Date.now()) return undefined;
      return new Response(e.body, { headers: e.headers });
    },
    async put(req, res) {
      const age = Number(res.headers.get("cache-control")?.match(/max-age=(\d+)/)?.[1] ?? 0);
      if (age > 0) kept.set(req.url, { body: await res.text(), headers: [...res.headers], until: Date.now() + age * 1000 });
    },
    async delete(req) { return kept.delete(req.url); },
  };
}

/**
 * `meshy` is a real Meshy (a key and base); left out, the stand-in answers, in `standInSeconds` (8).
 * `seed: false` starts the way a fresh deploy does: an empty bucket, and only the migrations' public demo in D1. `limits` are rate limit bindings (a fake, in the tests).
 * `assets` serves a widget built elsewhere (a test's own build) in place of dist/client. `eqosys` is the eqosys whose tokens sign people in.
 * Packs of samples are paid by the test provider (nothing charged) unless `env` says otherwise (`STRIPE_*`).
 */
export async function local(o: { dir: string; port?: number; secret?: string; meshy?: { key: string; base: string }; standInSeconds?: number; seed?: boolean; limits?: Pick<Env, "SIGN_LIMIT" | "SAMPLE_LIMIT">; assets?: string; eqosys?: string; env?: Partial<Env> }) {
  const STATIC = o.assets ? resolve(o.assets) : BUILT;
  const standIn = o.meshy ? null : await standInMeshy({ seconds: o.standInSeconds });
  const meshy = o.meshy ?? standIn!;
  const db = d1(join(o.dir, "settings.sqlite"));
  await applyD1Migrations(db, resolve(import.meta.dir, "../migrations"));
  const bindings: Env = { BUCKET: r2(join(o.dir, "bucket")), DB: db, SETTINGS_CACHE: memoryCache(), UPLOAD_SECRET: o.secret ?? crypto.randomUUID(), MESHY_API_KEY: meshy.key, MESHY_API_BASE: meshy.base, BILLING_TEST: "1", ...o.limits, ...(o.eqosys ? { EQOSYS_URL: o.eqosys } : {}), ...o.env };
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
