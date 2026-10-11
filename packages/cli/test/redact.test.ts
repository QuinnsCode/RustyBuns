import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deployedWorker, redactQueryStrings } from "../src/redact.ts";

const live = { enabled: true, head_sampling_rate: 1, redact_query_string: false, logs: { enabled: true, invocation_logs: true, persist: true } };

/** A stand-in for the script settings API: GET answers with `obs`, PATCH stores what it's sent. */
function settingsApi(obs: any) {
  const calls: { method: string; url: string; body?: any; auth: string | null }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method: String(init.method), url, body, auth: new Headers(init.headers).get("authorization") });
    if (init.method === "PATCH") obs = body.observability;
    return Response.json({ success: true, errors: [], result: { observability: obs } });
  }) as unknown as typeof fetch;
  return { f, calls };
}

test("turns redaction on and keeps the rest of the observability settings", async () => {
  const { f, calls } = settingsApi(live);
  expect(await redactQueryStrings({ accountId: "acct", workerName: "codesplitters", token: "tok", fetch: f })).toBe("set");
  expect(calls.map((c) => c.method)).toEqual(["GET", "PATCH"]);
  expect(calls[0]!.url).toBe("https://api.cloudflare.com/client/v4/accounts/acct/workers/scripts/codesplitters/script-settings");
  expect(calls[0]!.auth).toBe("Bearer tok");
  expect(calls[1]!.body).toEqual({ observability: { ...live, redact_query_string: true } });
});

test("leaves a Worker that already redacts alone, and one without logs settings", async () => {
  const on = settingsApi({ ...live, redact_query_string: true });
  expect(await redactQueryStrings({ accountId: "a", workerName: "w", token: "t", fetch: on.f })).toBe("already");
  expect(on.calls.map((c) => c.method)).toEqual(["GET"]);
  const none = settingsApi(null);
  expect(await redactQueryStrings({ accountId: "a", workerName: "w", token: "t", fetch: none.f })).toBe("off");
});

test("a refused call throws with Cloudflare's message", async () => {
  const f = (async () => Response.json({ success: false, errors: [{ message: "Authentication error" }] })) as unknown as typeof fetch;
  await expect(redactQueryStrings({ accountId: "a", workerName: "w", token: "t", fetch: f })).rejects.toThrow("Authentication error");
});

test("finds the deployed Worker's name and account in Alchemy's state", () => {
  const dir = mkdtempSync(join(tmpdir(), "rb-redact-"));
  expect(deployedWorker(dir, "app", "prod")).toBeNull();
  mkdirSync(join(dir, ".alchemy", "state", "app", "prod"), { recursive: true });
  writeFileSync(join(dir, ".alchemy", "state", "app", "prod", "Worker.json"), JSON.stringify({ attr: { workerName: "app-prod-x1", accountId: "acct" } }));
  expect(deployedWorker(dir, "app", "prod")).toEqual({ workerName: "app-prod-x1", accountId: "acct" });
});
