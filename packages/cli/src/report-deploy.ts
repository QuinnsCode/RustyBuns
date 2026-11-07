// Telling eqosys what went out, for a studio's Ship door (apps/eqosys/src/deploys.ts): after a good `rustybuns deploy`, or by
// `rustybuns report-deploy` after a plain `wrangler deploy`. A signed POST of { app, stage, version, at }, the HMAC key being
// RB_DEPLOY_REPORT_KEY (eqosys's DEPLOY_REPORT_KEY). With no key it says so and does nothing; a refused report only warns,
// since the deploy itself went out.

/** @rustybuns/util/bytes's hmacHex, which eqosys checks against; the published CLI doesn't depend on @rustybuns/util, so its own copy. */
async function hmacHex(secret: string, body: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return Array.from(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body))), (x) => x.toString(16).padStart(2, "0")).join("");
}

export const EQOSYS = "https://eqosys.qntbr.com";

export interface Report { app: string; stage: string; version: string; at: number }

/** The version a deploy reports: the app's package.json version, plus the commit it was built from when there is one. */
export async function versionHere(cwd = process.cwd()): Promise<string> {
  const pkg = await Bun.file(`${cwd}/package.json`).json().catch(() => null) as unknown;
  const v = pkg && typeof pkg === "object" && "version" in pkg && typeof pkg.version === "string" ? pkg.version : "0.0.0";
  const git = Bun.spawnSync(["git", "rev-parse", "--short", "HEAD"], { cwd, stdout: "pipe", stderr: "ignore" });
  const sha = git.exitCode === 0 ? git.stdout.toString().trim() : "";
  return sha ? `${v}+${sha}` : v;
}

/** Send one report. Answers a line for the deploy's log. */
export async function reportDeploy(r: Report, env: Record<string, string | undefined> = process.env, send: typeof fetch = fetch): Promise<string> {
  const key = env.RB_DEPLOY_REPORT_KEY;
  if (!key) return "eqosys's Ship door wasn't told about this deploy: no RB_DEPLOY_REPORT_KEY";
  const body = JSON.stringify(r), url = `${(env.RB_EQOSYS_URL || EQOSYS).replace(/\/$/, "")}/api/deploys`;
  const res = await send(url, { method: "POST", body, headers: { "content-type": "application/json", "x-eqosys-signature": await hmacHex(key, body) } }).catch(() => null);
  if (res?.ok) return `told eqosys: ${r.app} ${r.stage} ${r.version}`;
  return `warning: eqosys didn't take the deploy report (${res ? res.status : "unreachable"}${res?.status === 404 ? `: ${r.app} isn't in its APPS` : ""}); the deploy itself went out`;
}
