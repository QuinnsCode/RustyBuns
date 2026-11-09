// What the eqosys home shows under your friends: your spaces with how many are in each now, and the party you are in.
// Spaces and parties are Qollab's (QOLLAB.md); the home reads them through eqosys's own SPACE and PARTY bindings, as it reads the hub.
import { num, obj, type Of } from "@rustybuns/util/guard";
import { readJson } from "@rustybuns/util/http";
import type { Env } from "../env.ts";
import { PARTY_LIFE_MAX, partyOf, PartyPeek } from "./party.ts";
import { spaceOf } from "./space.ts";

/** How many spaces the home lists (the rest are on /spaces), and how many recent party codes it asks. */
export const SIDE_SPACES = 6, SIDE_PARTIES = 3;

export type SideSpace = { id: string; name: string; owner: boolean; on: number | null };
export type Side = { spaces: SideSpace[]; more: number; party: NonNullable<PartyPeek["party"]> | null };
const On = obj({ on: num(0, 1e6) });
type On = Of<typeof On>;

const ask = <T>(stub: { fetch(req: Request): Promise<Response> }, url: string, guard: (v: unknown) => T | null) =>
  stub.fetch(new Request(url)).then((r) => r.ok ? readJson(r, guard) : null).catch(() => null);

/** Your spaces (named in order, the first few) with who is on in each, and the party you sit in now, if any. */
export async function sideOf(conf: Env, me: string, now = Date.now()): Promise<Side> {
  const [spaces, count, seats] = await Promise.all([
    conf.DB.prepare("SELECT s.id, s.name, s.owner FROM space_members m JOIN spaces s ON s.id = m.space_id WHERE m.user_id = ? ORDER BY s.name LIMIT ?")
      .bind(me, SIDE_SPACES).all<{ id: string; name: string; owner: string }>(),
    conf.DB.prepare("SELECT COUNT(*) AS n FROM space_members WHERE user_id = ?").bind(me).first<number>("n"),
    conf.DB.prepare("SELECT code FROM party_seats WHERE user_id = ? AND at > ? ORDER BY at DESC LIMIT ?").bind(me, now - PARTY_LIFE_MAX, SIDE_PARTIES).all<{ code: string }>(),
  ]);
  const { SPACE, PARTY } = conf;
  const [ons, peeks] = await Promise.all([
    Promise.all(spaces.results.map((s) => SPACE ? ask<On>(spaceOf(SPACE, s.id), "https://space/on", On) : null)),
    Promise.all(seats.results.map((s) => PARTY ? ask<PartyPeek>(partyOf(PARTY, s.code), `https://party/peek?id=${encodeURIComponent(me)}`, PartyPeek) : null)),
  ]);
  return {
    spaces: spaces.results.map((s, i) => ({ id: s.id, name: s.name, owner: s.owner === me, on: ons[i]?.on ?? null })),
    more: Math.max(0, (count ?? 0) - spaces.results.length),
    party: peeks.find((p) => p?.party)?.party ?? null,
  };
}
