// worker.redactQueryStrings: Workers Logs keep each request's URL without its
// query string (`observability.redact_query_string`).
//
// Alchemy can't set it: its upload schema has no such field and drops it, and
// every script upload resets it to false on Cloudflare's side (checked live,
// #553). So `rustybuns deploy` sets it through the script settings API after
// each deploy, on the Worker that Alchemy's state says it deployed.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** The deployed Worker's script name and account, from `.alchemy/state/<app>/<stage>/Worker.json`. */
export function deployedWorker(projectDir: string, app: string, stage: string): { workerName: string; accountId: string } | null {
  const file = join(projectDir, ".alchemy", "state", app, stage, "Worker.json");
  if (!existsSync(file)) return null;
  try {
    const attr = JSON.parse(readFileSync(file, "utf8"))?.attr;
    return typeof attr?.workerName === "string" && typeof attr?.accountId === "string"
      ? { workerName: attr.workerName, accountId: attr.accountId } : null;
  } catch { return null; }
}

/**
 * Turn on `observability.redact_query_string` for one Worker, keeping the rest of
 * its observability settings. "already" when it was on, "off" when the Worker has
 * no observability settings to redact in.
 */
export async function redactQueryStrings(o: { accountId: string; workerName: string; token: string; fetch?: typeof fetch }): Promise<"set" | "already" | "off"> {
  const f = o.fetch ?? fetch;
  const url = `https://api.cloudflare.com/client/v4/accounts/${o.accountId}/workers/scripts/${encodeURIComponent(o.workerName)}/script-settings`;
  const headers = { Authorization: `Bearer ${o.token}`, "content-type": "application/json" };
  const call = async (init: RequestInit) => {
    const r = (await (await f(url, { ...init, headers })).json().catch(() => null)) as { success?: boolean; errors?: { message?: string }[]; result?: any } | null;
    if (!r?.success) throw new Error(`Cloudflare script settings for ${o.workerName}: ${r?.errors?.map((e) => e.message).join("; ") || "no answer"}`);
    return r.result;
  };
  const current = (await call({ method: "GET" }))?.observability;
  if (!current) return "off";
  if (current.redact_query_string === true) return "already";
  const after = (await call({ method: "PATCH", body: JSON.stringify({ observability: { ...current, redact_query_string: true } }) }))?.observability;
  if (after?.redact_query_string !== true) throw new Error(`Cloudflare took the script settings for ${o.workerName} but redact_query_string is still off`);
  return "set";
}
