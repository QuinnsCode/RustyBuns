// The watchdog's decisions (#1562), kept apart from Cloudflare so a test can drive them. It imports
// nothing: the watchdog Worker (watchdog/worker.ts) is a separate deploy from the app it watches,
// so a crashed app can't take its own rescue down. One tick runs per cron: check the app, learn
// which version is live, and roll back to the newest version that was healthy once the app has
// failed `threshold` checks in a row.

/** What a tick keeps between runs. `good` is newest first: versions that passed a check while live. */
export interface WatchState { fails: number; good: string[]; unreported?: RolledBack[] }
/** A rollback, to tell the app about once it answers again. */
export interface RolledBack { from: string; to: string; at: number }

export interface WatchDeps {
  /** Is the app healthy: 200 from its health route (which reads the database). */
  check(): Promise<boolean>;
  /** The version taking all the traffic now. */
  active(): Promise<string>;
  /** Put `version` on 100% of the traffic. */
  rollback(version: string): Promise<void>;
  /** Tell the app a rollback happened; false if it couldn't be told. */
  report(r: RolledBack): Promise<boolean>;
  now(): number;
}

export type Outcome = "healthy" | "failing" | "rolled-back" | "no-good-version";
export const FRESH: WatchState = { fails: 0, good: [] };
const KEEP = 10;

export async function tick(deps: WatchDeps, prev: WatchState = FRESH, threshold = 3): Promise<{ state: WatchState; outcome: Outcome }> {
  const state: WatchState = { fails: prev.fails, good: [...prev.good], unreported: [...(prev.unreported ?? [])] };
  const live = await deps.active();
  if (await deps.check()) {
    state.fails = 0;
    // Only a version that answered while live is trusted as a place to come back to.
    state.good = [live, ...state.good.filter((v) => v !== live)].slice(0, KEEP);
    const left: RolledBack[] = [];
    for (const r of state.unreported!) if (!(await deps.report(r).catch(() => false))) left.push(r);
    state.unreported = left;
    return { state: clean(state), outcome: "healthy" };
  }
  state.fails++;
  // A version that fails is no place to come back to.
  state.good = state.good.filter((v) => v !== live);
  if (state.fails < threshold) return { state: clean(state), outcome: "failing" };
  const to = state.good[0];
  if (!to) return { state: clean(state), outcome: "no-good-version" };
  await deps.rollback(to);
  state.fails = 0;
  state.unreported!.push({ from: live, to, at: deps.now() });
  return { state: clean(state), outcome: "rolled-back" };
}

function clean(s: WatchState): WatchState {
  if (!s.unreported?.length) delete s.unreported;
  return s;
}

/** The version with all the traffic, from the Workers API's deployments list (newest first). */
export function liveVersion(body: { result?: { deployments?: { versions?: { version_id: string; percentage: number }[] }[] } }): string {
  const vs = body.result?.deployments?.[0]?.versions ?? [];
  const top = vs.reduce<(typeof vs)[number] | undefined>((a, v) => (!a || v.percentage > a.percentage ? v : a), undefined);
  if (!top) throw new Error("the Workers API listed no deployment");
  return top.version_id;
}
