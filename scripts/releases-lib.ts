// The releases page's rules (scripts/releases.ts): which dot a repo or app gets, and how merged PRs count per day and week.

/** live: its prod link answers. error: the link is down or its last run failed. testing: being built, not released yet.
 *  code: a code example only, never released (a license keeps it out, or it exists to show the framework). */
export type Dot = "live" | "error" | "testing" | "code";

/** RustyBuns apps that are code to read, not products: framework examples, and apps built on code whose license we don't ship. */
export const CODE_ONLY = new Set([
  "example", "agent-demo", "borg", "borg-postgres", "elysia-conduit", "terraviz-demo", "tscircuit-desktop", "test-swarm", "kitesurf-bench",
]);
export const codeOnly = (id: string) => CODE_ONLY.has(id) || id.endsWith("-example");

type Up = { ok: boolean } | null;

/** An app in RustyBuns. `light` is the bridge's (red: its hourly tests failed or its live page is down); `released` is a release tag that went green. */
export function appDot(a: { id: string; link: string | null; live: Up; light: string; releaseOk: boolean | null; released: boolean }): Dot {
  if (codeOnly(a.id)) return "code";
  if (a.light === "red" || a.releaseOk === false) return "error";
  if (a.live?.ok || (!a.link && a.released)) return "live";
  return "testing";
}

/** Another repo: its homepage is its prod link, its default branch's last workflow run its tests. */
export function repoDot(r: { archived: boolean; link: string | null; live: Up; lastRun: string | null; daysQuiet: number }): Dot {
  if (r.archived) return "code";
  if ((r.link && r.live && !r.live.ok) || r.lastRun === "failure") return "error";
  if (r.live?.ok) return "live";
  return r.daysQuiet <= 30 ? "testing" : "code";
}

export type Counts = { today: number; week: number };

/** Merged PRs per key since local midnight and over the last 7 days. `keys` names what a PR counts for (a repo, or each app it touched). */
export function tally<P extends { mergedAt: string }>(prs: P[], keys: (p: P) => string[], now = new Date()): Map<string, Counts> {
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const weekAgo = now.getTime() - 7 * 86_400_000;
  const out = new Map<string, Counts>();
  for (const p of prs) {
    const at = Date.parse(p.mergedAt);
    if (!(at >= weekAgo)) continue;
    for (const k of new Set(keys(p))) {
      const c = out.get(k) ?? { today: 0, week: 0 };
      c.week++;
      if (at >= midnight) c.today++;
      out.set(k, c);
    }
  }
  return out;
}

/** The app a changed file belongs to: apps/<id>/..., or `rustybuns` for packages/. */
export const appOfPath = (path: string) => path.startsWith("packages/") ? "rustybuns" : path.startsWith("apps/") ? path.split("/")[1] ?? null : null;

/** Busiest first: most merged today, then this week; a tie goes to the one that's live. */
export function busiest<R extends Counts & { name: string; dot: Dot }>(rows: R[]): R[] {
  const rank: Record<Dot, number> = { error: 0, live: 1, testing: 2, code: 3 };
  return [...rows].sort((a, b) => b.today - a.today || b.week - a.week || rank[a.dot] - rank[b.dot] || a.name.localeCompare(b.name));
}
