import type { Env } from "./env";

/** Which repo: the pair nearly every route, row and queue message carries. */
export type RepoRef = { owner: string; repo: string };

/** One repo's row, the columns you name. `mirrored` adds "only if it mirrors upstream"; `liveAt` adds "only if it hasn't expired by then". */
export const repoRow = <T = Record<string, unknown>>(env: Env, owner: string, name: string, cols: string, opt: { mirrored?: boolean; liveAt?: number } = {}) =>
  env.DB.prepare(`SELECT ${cols} FROM repos WHERE owner = ? AND name = ?${opt.mirrored ? " AND mirror_url IS NOT NULL" : ""}${opt.liveAt === undefined ? "" : " AND (expires_at IS NULL OR expires_at > ?)"}`)
    .bind(...(opt.liveAt === undefined ? [owner, name] : [owner, name, opt.liveAt])).first<T>();
