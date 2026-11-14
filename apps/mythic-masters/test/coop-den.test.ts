// Walking together, a friend joins your fight (#4413): Ada walks up to her region's first keeper with Bo beside her,
// through the real Worker, Region and Duel rooms (scripts/party.ts standing in for the edge). Bo is asked to join and
// Cy, in another region, is not; the two of them fight that keeper (not a seeded wild one) to the same end on both
// pages, and each journey writes it down. A host who lies about the den gets a seeded wild one instead. And one of
// them binds it (#4430): the press rides the lockstep, so both pages roll it on the same tick and agree who bound it.
import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { serveParty } from "../scripts/party.ts";
import { bot } from "../src/bot.ts";
import { coopBind, recordCoop, type CoopAt } from "../src/coop.ts";
import { cleared, newJourney, PICKS, STARTERS } from "../src/journey.ts";
import { DuelLink } from "../src/net/duel-link.ts";
import { sum, type DenFoe, type DuelOut, type Pick } from "../src/net/duel.ts";
import { Online } from "../src/net/online.ts";
import { REGIONS } from "../src/regions.ts";
import { tsSim, type Live } from "../src/sim-wasm.ts";
import { coopTeams } from "../src/versus.ts";

setDefaultTimeout(60_000);
const party = serveParty(0);
afterAll(() => party.stop());

const until = async (what: string, ok: () => boolean, ms = 8000) => {
  const end = Date.now() + ms;
  while (!ok()) { if (Date.now() > end) throw new Error(`timed out: ${what}`); await Bun.sleep(10); }
};
type Ask = { who: string; den: string; c: string; lv: number; code: string };
const walker = (name: string, asks: Ask[]) => new Online("COOPWALK", { base: party.url, guest: { uid: `${name}-uid-0000`, name }, opened: () => [1, 2, 3, 4, 5, 6], onCoop: (a) => asks.push(a) });

/** One page in the co-op room: the fight it plays when the room says go, a bot for the player's hands, which press
 *  bind each tick the wild one is under `bind.under` of its health (as main.ts `coopRoll` reads them). `bind.wear`
 *  wears the wild one to a fifth at that tick (the page's `wear` hook), on every page alike, so the fight stays one. */
function page(code: string, uid: string, name: string, pick: Pick, foe?: DenFoe, bind = { under: 0, wear: 0 }) {
  const p = { live: null as Live | null, wild: null as ReturnType<typeof bot> | null, go: null as Extract<DuelOut, { t: "go" }> | null, bound: null as number | null };
  const link = new DuelLink(code, { base: party.url, guest: { uid, name }, kind: "coop", onGo: (g) => { p.go = g; p.wild = bot(g.picks.length, g.seed); p.live = tsSim(...coopTeams(g)); } });
  link.pick(pick, foe);
  const frame = (n: number) => {
    const live = p.live, step = link.step;
    if (!live || !step || live.m.over) return;
    const hands = bot(step.seat, 11 + step.seat);
    for (let k = 0; k < n && !live.m.over; k++) {
      const wild = live.m.f[live.m.f.length - 1]!, frac = () => wild.hp / wild.b.hp;
      if (live.m.tick === bind.wear) wild.hp = wild.b.hp * 0.2;
      const seats = step.next(() => ({ ...hands(live.m), bind: frac() < bind.under }));
      if (!seats) break;
      live.step([...seats, p.wild!(live.m)]);
      const by = live.m.over || !step.binds.length ? null : coopBind(step.binds, frac(), p.go!.seed, live.m.tick);
      if (by !== null) { p.bound = by; live.m.over = true; live.m.winner = 0; }
    }
    link.flush(live.m);
  };
  return { p, link, frame };
}

test("a friend in the region joins your fight at a keeper: one keeper, one end, both journeys write it", async () => {
  const asks: Ask[] = [], cyAsks: Ask[] = [];
  const ada = walker("Ada", []), bo = walker("Bo", asks), cy = walker("Cy", cyAsks);
  ada.update(5, 13800, 5600, 0, "hodag", performance.now()); bo.update(5, 13810, 5600, 0, "jackalope", performance.now()); cy.update(4, 9000, 5000, 0, "squonk", performance.now());
  await until("all in", () => [ada, bo, cy].every((o) => o.status === "in"));
  // A few steps each, a send apart: Ada and Bo by the first stone of region 5's trail, Cy in another region.
  for (let i = 0; i < 4; i++) {
    const t = performance.now() + i * 250;
    ada.update(5, 13800 + i, 5600, 0, "hodag", t); bo.update(5, 13810 + i, 5600, 0, "jackalope", t); cy.update(4, 9000 + i, 5000, 0, "squonk", t);
  }
  await until("ada sees bo beside her", () => ada.nearby() && [...bo.ghosts.values()].some((g) => g.name === "Ada" && g.pose.r === 5));
  await Bun.sleep(1100); // the room's rate limit, after the walk

  ada.met("keeper:5:0", "loveland-frogman", 34);
  const den = ada.coop("ADAKEEP1");
  expect(den).toEqual({ den: "keeper:5:0", c: "loveland-frogman", lv: 34 });
  await until("bo asked to join", () => asks.length === 1);
  expect(asks[0]).toMatchObject({ who: "Ada", den: "keeper:5:0", c: "loveland-frogman", lv: 34, code: "ADAKEEP1" });
  await Bun.sleep(200);
  expect(cyAsks).toEqual([]);

  // Ada waits in the room with the keeper; Bo comes in from the prompt. Both fight it, not a seeded wild one.
  const a = page("ADAKEEP1", "ada-uid-0000", "Ada", { c: "hodag", lv: 30 }, den!);
  await until("ada seated", () => a.link.seats?.you === 0);
  const b = page("ADAKEEP1", "bo-uid-0000", "Bo", { c: "jackalope", lv: 28 });
  await until("both told go", () => !!a.p.go && !!b.p.go);
  expect(b.p.go!.foe).toEqual(den!);
  expect(b.p.live!.m.f.map((f) => [f.c.id, f.team])).toEqual([["hodag", 0], ["jackalope", 0], ["loveland-frogman", 1]]);
  expect(b.p.live!.m.f[2]!.c.name).toBe(a.p.live!.m.f[2]!.c.name);
  while (!a.p.live!.m.over || !b.p.live!.m.over) { a.frame(8); b.frame(6); await Bun.sleep(8); }
  expect(sum(b.p.live!.m)).toBe(sum(a.p.live!.m));
  const won = a.p.live!.m.winner === 0;

  // Each page writes the fight into its own journey: the keeper seen, the XP (or the knockout), the stone lit.
  for (const [k, seat] of [[0, 0], [1, 1]] as const) {
    const j = newJourney(STARTERS.slice(k, k + PICKS))!, me = j.party[0]!, before = { level: me.level, xp: me.xp };
    const at: CoopAt = { region: REGIONS[4]!, kind: "keeper", k: 0, foe: { id: "loveland-frogman", level: 34 }, host: k === 0 };
    const live = a.p.live!, lines = recordCoop(j, me, at, won, live.m.f[seat]!.hp / live.m.f[seat]!.b.hp);
    expect(j.seen).toContain("loveland-frogman");
    expect(lines.length).toBeGreaterThan(0);
    if (won) { expect([me.level, me.xp]).not.toEqual([before.level, before.xp]); expect(cleared(j, 5)).toBe(1); }
    else { expect(me.hp).toBe(0); expect(cleared(j, 5)).toBe(0); }
  }
  a.link.close(); b.link.close(); ada.close(); bo.close(); cy.close();
});

test("a host's den the world can't hold is no foe: the room fights a seeded wild one", async () => {
  const a = page("LIARDEN1", "ada-uid-0000", "Ada", { c: "hodag", lv: 30 }, { den: "keeper:5:0", c: "jersey-devil", lv: 99 });
  await until("ada seated", () => a.link.seats?.you === 0);
  const b = page("LIARDEN1", "bo-uid-0000", "Bo", { c: "jackalope", lv: 28 });
  await until("both told go", () => !!a.p.go && !!b.p.go);
  expect(b.p.go!.foe).toBeUndefined();
  a.link.close(); b.link.close();
});

test("a friend binds the wild one: both pages end on the same tick, the bind in their journey, a line in yours", async () => {
  const a = page("BINDDEN1", "ada-uid-0000", "Ada", { c: "hodag", lv: 25 }, undefined, { under: 0, wear: 60 });
  await until("ada seated", () => a.link.seats?.you === 0);
  const b = page("BINDDEN1", "bo-uid-0000", "Bo", { c: "jackalope", lv: 25 }, undefined, { under: 0.45, wear: 60 });
  await until("both told go", () => !!a.p.go && !!b.p.go);
  while (!a.p.live!.m.over || !b.p.live!.m.over) { a.frame(8); b.frame(6); await Bun.sleep(8); }
  expect([a.p.bound, b.p.bound]).toEqual([1, 1]);
  expect(a.p.live!.m.tick).toBe(b.p.live!.m.tick);
  expect(sum(a.p.live!.m)).toBe(sum(b.p.live!.m));

  const wild = a.p.live!.m.f[2]!.c, at: CoopAt = { region: REGIONS[4]!, kind: "wild", k: 0, foe: { id: wild.id, level: 20 }, host: true };
  const ja = newJourney(STARTERS.slice(0, PICKS))!, jb = newJourney(STARTERS.slice(1, 1 + PICKS))!;
  const la = recordCoop(ja, ja.party[0]!, at, true, 1, { mine: false, who: "Bo" }), lb = recordCoop(jb, jb.party[0]!, { ...at, host: false }, true, 1, { mine: true, who: "You" });
  expect([...jb.party, ...jb.journal].map((m) => m.id)).toContain(wild.id);
  expect([...ja.party, ...ja.journal].map((m) => m.id)).not.toContain(wild.id);
  expect(la[0]).toContain("Bo bound");
  expect(lb[0]).toContain("The ink holds");
  a.link.close(); b.link.close();
});
