// The Ship door (studios.ts, VISION.md): what each app last shipped, as its deploy reported it. `rustybuns deploy` (or
// `rustybuns report-deploy` after a plain `wrangler deploy`) POSTs /api/deploys with { app, stage, version, at }, signed with
// DEPLOY_REPORT_KEY in `x-eqosys-signature` (hex HMAC-SHA256 of the body, @rustybuns/util/bytes). One row per app and stage.
import { hmacSigned } from "@rustybuns/util/bytes";
import { check, int, obj, str, type Of } from "@rustybuns/util/guard";
import { appOf } from "./apps.ts";
import type { Env } from "./env.ts";

export const DeployReport = obj({ app: str(64, { min: 1 }), stage: str(32, { min: 1 }), version: str(64, { min: 1 }), at: int(0, 1e15) });
export type DeployReport = Of<typeof DeployReport>;
/** How far a report's `at` may be from now, either way: a replayed old report is refused. */
export const DEPLOY_SKEW_MS = 5 * 60_000;

/** A deploy's report, checked and kept: 503 with no key here, 401 unsigned, 400 malformed or stale, 404 for an app not in APPS. */
export async function recordDeploy(conf: Env, req: Request, now = Date.now()): Promise<{ status: 200 | 400 | 401 | 404 | 503 }> {
  const key = conf.DEPLOY_REPORT_KEY;
  if (!key) return { status: 503 };
  const body = await req.text();
  if (!await hmacSigned(key, body, req.headers.get("x-eqosys-signature") ?? "")) return { status: 401 };
  let parsed: unknown = null;
  try { parsed = JSON.parse(body); } catch { /* bad JSON is a bad body */ }
  const d = check(DeployReport, parsed);
  if (!d || Math.abs(d.at - now) > DEPLOY_SKEW_MS) return { status: 400 };
  if (!appOf(d.app)) return { status: 404 };
  // An older report arriving late never overwrites a newer one.
  await conf.DB.prepare(`INSERT INTO deploys (app, stage, version, at) VALUES (?, ?, ?, ?)
    ON CONFLICT (app, stage) DO UPDATE SET version = excluded.version, at = excluded.at WHERE excluded.at > deploys.at`).bind(d.app, d.stage, d.version, d.at).run();
  return { status: 200 };
}

export type Shipped = Omit<DeployReport, "app">;

/** Each app's newest deploy (any stage), by app. */
export async function lastDeploys(conf: Env, apps: string[]): Promise<Map<string, Shipped>> {
  if (!apps.length) return new Map();
  const { results } = await conf.DB.prepare(`SELECT app, stage, version, at FROM deploys WHERE app IN (${apps.map(() => "?").join(", ")}) ORDER BY at`)
    .bind(...apps).all<DeployReport>();
  return new Map(results.map(({ app, ...s }) => [app, s]));
}
