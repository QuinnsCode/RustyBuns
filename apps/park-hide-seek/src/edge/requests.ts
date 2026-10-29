// "Request a park survey": one ParkRequests Durable Object (idFromName("parks")) keeps
// a vote count per national park, one vote per player per park. The menu shows
// the most wanted; the owner reads the same list to pick the next park to survey
// (fetch-zones.ts: landmarks, a park map, more zones). Every park has a zone already,
// so only the unsurveyed ones can be voted for, from a fixed list (src/parks/nps.ts).

import { privateJson } from "@rustybuns/util/http";
import type { ParksReply } from "../api.ts";
import { NATIONAL_PARKS } from "../parks/nps.ts";
import { SURVEYED_PARKS } from "../zones/zone.ts";

/** The parks you can ask for: every national park that hasn't been surveyed yet. */
export const REQUESTABLE = NATIONAL_PARKS.filter((p) => !SURVEYED_PARKS.has(p.code));
const CODES = new Set(REQUESTABLE.map((p) => p.code));

/** The slice of Durable Object storage this needs (and a Map-backed fake in tests). */
export interface VoteStore {
  get<T>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  list<T>(opts: { prefix: string }): Promise<Map<string, T>>;
}

export type Votes = ParksReply["votes"];

export class ParkVotes {
  constructor(private store: VoteStore) {}

  async votes(): Promise<Votes> {
    const out: Votes = {};
    for (const [k, n] of await this.store.list<number>({ prefix: "n:" })) out[k.slice(2)] = n;
    return out;
  }

  /** Count `voter`'s vote for `code`, once. False for a park that can't be asked for. */
  async vote(code: string, voter: string): Promise<boolean> {
    if (!CODES.has(code)) return false;
    const mark = `v:${code}:${voter}`;
    if (await this.store.get(mark)) return true;
    await this.store.put(mark, 1);
    await this.store.put(`n:${code}`, ((await this.store.get<number>(`n:${code}`)) ?? 0) + 1);
    return true;
  }
}

export class ParkRequests {
  private tally: ParkVotes;

  constructor(ctx: { storage: VoteStore }) { this.tally = new ParkVotes(ctx.storage); }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === "POST") {
      const ok = await this.tally.vote(url.searchParams.get("code") ?? "", url.searchParams.get("voter") ?? "");
      if (!ok) return new Response("not a park you can request", { status: 400 });
    }
    return privateJson({ votes: await this.tally.votes() } satisfies ParksReply);
  }
}
