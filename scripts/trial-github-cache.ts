// trial-github's memory of GitHub between runs, and its manners with the owner's REST budget
// (5,000 core calls an hour, shared by every agent and the office). Code-search pages and repo meta
// keep for a day; a package.json keeps for as long as its repo's pushed_at doesn't move.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const DAY = 864e5;

/** A file name under the cache dir for these parts: readable, and unique by hash. */
export function cacheKey(kind: "search" | "meta" | "pkg", ...parts: (string | number)[]): string {
  const slug = parts.join("_").replace(/[^\w.-]+/g, "_").replace(/^[._]+/, "").slice(0, 80);
  const hash = new Bun.CryptoHasher("sha256").update(JSON.stringify([kind, ...parts])).digest("hex").slice(0, 12);
  return `${kind}/${slug}-${hash}.json`;
}

/** JSON values on disk with the time they were written. `fresh` reads nothing but still writes. */
export class Cache {
  constructor(readonly dir: string, readonly fresh = false, readonly now = () => Date.now()) {}
  get<T>(key: string, ttlMs = Infinity): T | undefined {
    if (this.fresh) return undefined;
    try {
      const { at, value } = JSON.parse(readFileSync(join(this.dir, key), "utf8"));
      return this.now() - at <= ttlMs ? value : undefined;
    } catch { return undefined; }
  }
  set(key: string, value: unknown) {
    const f = join(this.dir, key);
    mkdirSync(dirname(f), { recursive: true });
    // whole files only: eight lookups write at once, and a run can be killed mid-write
    writeFileSync(`${f}.tmp`, JSON.stringify({ at: this.now(), value }));
    renameSync(`${f}.tmp`, f);
  }
}

export type Bucket = { limit: number; used: number; remaining: number; reset: number };
export type Rate = { core: Bucket; search: Bucket };

/** `gh api rate_limit`'s answer, as the two buckets a sweep spends: core and code search. */
export function parseRate(json: string): Rate | undefined {
  try {
    const r = JSON.parse(json).resources;
    return r?.core ? { core: r.core, search: r.code_search ?? r.search } : undefined;
  } catch { return undefined; }
}

const hhmm = (epochS: number) => new Date(epochS * 1000).toISOString().slice(11, 16);

/** `github core used/limit, search used/limit, reset HH:MM UTC` */
export const rateLine = (r: Rate) =>
  `github core ${r.core.used}/${r.core.limit}, search ${r.search?.used ?? "?"}/${r.search?.limit ?? "?"}, reset ${hhmm(r.core.reset)} UTC`;

/** Why the core bucket can't spare `needed` calls and still leave `reserve` for everyone else, or undefined if it can. */
export function overBudget(core: Bucket, needed: number, reserve = 500): string | undefined {
  if (core.remaining - needed >= reserve) return undefined;
  return `GitHub core budget too low: ${core.remaining} of ${core.limit} left, this search needs ${needed} uncached calls `
    + `plus a ${reserve}-call reserve for everyone else; it resets at ${hhmm(core.reset)} UTC. Rerun after that.`;
}
