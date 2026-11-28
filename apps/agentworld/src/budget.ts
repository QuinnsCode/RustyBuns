// What every room together may put into Artifacts: so many bytes a day, and so many ever. One room is bounded, the
// number of rooms is not, and git keeps every version, so the count only goes up. The Galaxy object keeps it
// (edge/galaxy.ts) and each Room asks it before a push (edge/worker.ts); scripts/dev.ts keeps one in memory.
// Counted as sent, before git compresses it, so what is stored stays under the count. No repo is ever deleted: a
// world is kept for good, and past ALL_BYTES it is the owner who raises it.
import { check, int, nul, obj, str } from "@rustybuns/util/guard";
import { json, readJson } from "@rustybuns/util/http";
import type { Kv } from "./galaxy.ts";

/** At $0.50 per GB-month past the first, ALL_BYTES is $2 a month at most. */
export const DAY_BYTES = 100_000_000, ALL_BYTES = 5_000_000_000;
/** What a push costs beyond its files (the commit, its trees, a new repo), so an empty one is not free. */
export const PUSH_BYTES = 4096;

/** Asks to put `bytes` more into Artifacts: null and they are counted, or why not, in words for whoever sent them. */
export type Spend = (bytes: number) => Promise<string | null>;

const Count = int(0, Number.MAX_SAFE_INTEGER);
const Day = obj({ day: str(10), bytes: Count });
const Ask = obj({ bytes: Count });
const Answer = obj({ refused: nul(str(200)) });

export class Budget {
  // One at a time, so two rooms that ask at once are both counted.
  private chain: Promise<unknown> = Promise.resolve();
  constructor(private kv: Kv, private max = { day: DAY_BYTES, all: ALL_BYTES }, private now = Date.now) {}

  spend: Spend = (bytes) => {
    const run = this.chain.then(async () => {
      const got = await this.kv.get(["b:all", "b:day"]);
      const day = new Date(this.now()).toISOString().slice(0, 10);
      const had = check(Day, got.get("b:day"));
      const today = (had?.day === day ? had.bytes : 0) + bytes + PUSH_BYTES;
      const all = (check(Count, got.get("b:all")) ?? 0) + bytes + PUSH_BYTES;
      if (all > this.max.all) return "Agent World's file storage is full, for every room: nothing new can be kept";
      if (today > this.max.day) return "Agent World has stored all it may today, across every room: try again after midnight UTC";
      await this.kv.put({ "b:all": all, "b:day": { day, bytes: today } });
      return null;
    });
    this.chain = run.catch(() => undefined);
    return run;
  };

  /** The object's side of `spendAt`. Only a Room may reach it: no public path leads here. */
  async http(req: Request): Promise<Response> {
    const ask = await readJson(req, Ask);
    return ask ? json({ refused: await this.spend(ask.bytes) }) : json({ error: "send { bytes }" }, 400);
  }
}

/** `Spend` against a Budget behind `fetch`. An answer that makes no sense throws: nothing is stored uncounted. */
export const spendAt = (fetch: (req: Request) => Promise<Response>): Spend => async (bytes) => {
  const res = await fetch(new Request("https://galaxy/spend", { method: "POST", body: JSON.stringify({ bytes }) }));
  const answer = check(Answer, await res.json());
  if (!answer) throw new Error(`the storage budget answered ${res.status}`);
  return answer.refused;
};
