import type { Env } from "./env";

/** Which repo: the pair nearly every route, row and queue message carries. */
export type RepoRef = { owner: string; repo: string };

/** "The repo hasn't expired at the bound time", as SQL on the repos row at alias `a` (none: the table itself); `at` is its placeholder. */
export const live = (a = "", at = "?") => `(${a && a + "."}expires_at IS NULL OR ${a && a + "."}expires_at > ${at})`;
/** `JOIN repos r` on `t`'s owner and repo columns, live repos only: the time is the first bind of what follows the join. */
export const liveRepo = (t: string, at = "?") => `JOIN repos r ON r.owner = ${t}.owner AND r.name = ${t}.repo AND ${live("r", at)}`;
/** `JOIN branches b` on `t`'s owner, repo and branch columns. */
export const branchOf = (t: string) => `JOIN branches b ON b.owner = ${t}.owner AND b.repo = ${t}.repo AND b.name = ${t}.branch`;

/** One repo's row, the columns you name. `mirrored` adds "only if it mirrors upstream"; `liveAt` adds "only if it hasn't expired by then". */
export const repoRow = <T = Record<string, unknown>>(env: Env, owner: string, name: string, cols: string, opt: { mirrored?: boolean; liveAt?: number } = {}) =>
  env.DB.prepare(`SELECT ${cols} FROM repos WHERE owner = ? AND name = ?${opt.mirrored ? " AND mirror_url IS NOT NULL" : ""}${opt.liveAt === undefined ? "" : ` AND ${live()}`}`)
    .bind(...(opt.liveAt === undefined ? [owner, name] : [owner, name, opt.liveAt])).first<T>();
