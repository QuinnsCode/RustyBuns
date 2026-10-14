// The watchdog Worker (#1562): a cron that health-checks codeSplitter and, when it fails
// repeatedly, rolls it back to the last version that was healthy. A separate Worker from the
// app, on purpose: it never takes the deploy path, so a crashed app can't block its own rescue.
// Cloudflare keeps the versions, so there's no second copy of the app, only this cron.
// See watchdog/README.md for deploying it.

import { FRESH, liveVersion, tick, type WatchState } from "../src/watchdog-core.ts";

interface Kv { get(k: string): Promise<string | null>; put(k: string, v: string): Promise<void> }
interface Env {
  STATE: Kv;
  /** The app, e.g. https://codesplitter.example.workers.dev */
  PRIMARY_URL: string;
  CF_ACCOUNT_ID: string;
  /** The app's Worker name. */
  SCRIPT_NAME: string;
  /** A token that may edit Workers Scripts on the account (owner-set, from 1Password). */
  CF_API_TOKEN: string;
  /** Shared with the app's WATCHDOG_SECRET. */
  WATCHDOG_SECRET: string;
  /** owner/repo the app's own code lives in, whose hooks hear about a rollback. */
  REPORT_REPO: string;
  /** Failed checks in a row before a rollback (default 3). */
  FAILS?: string;
}

const API = "https://api.cloudflare.com/client/v4";

export default {
  async scheduled(_c: unknown, env: Env) {
    const script = `${API}/accounts/${env.CF_ACCOUNT_ID}/workers/scripts/${env.SCRIPT_NAME}/deployments`;
    const auth = { authorization: `Bearer ${env.CF_API_TOKEN}`, "content-type": "application/json" };
    const prev = JSON.parse((await env.STATE.get("state")) ?? "null") as WatchState | null;
    const { state, outcome } = await tick({
      check: async () => (await fetch(`${env.PRIMARY_URL}/api/health`, { signal: AbortSignal.timeout(10_000) }).catch(() => null))?.ok === true,
      active: async () => liveVersion((await (await fetch(script, { headers: auth })).json()) as Parameters<typeof liveVersion>[0]),
      rollback: async (version) => {
        const res = await fetch(script, { method: "POST", headers: auth, body: JSON.stringify({ strategy: "percentage", versions: [{ version_id: version, percentage: 100 }], annotations: { "workers/message": "watchdog rollback" } }) });
        if (!res.ok) throw new Error(`rollback: ${res.status} ${await res.text()}`);
      },
      report: async (r) => (await fetch(`${env.PRIMARY_URL}/api/watchdog/rolled-back`, {
        method: "POST", headers: { authorization: `Bearer ${env.WATCHDOG_SECRET}` }, body: JSON.stringify({ repo: env.REPORT_REPO, ...r }),
      })).ok,
      now: Date.now,
    }, prev ?? FRESH, Number(env.FAILS) || 3);
    await env.STATE.put("state", JSON.stringify(state));
    console.log(JSON.stringify({ outcome, fails: state.fails, good: state.good[0] }));
  },
};
