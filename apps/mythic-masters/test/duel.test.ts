// Two friends fight (net/duel.ts, edge/duel.ts): two pages join one duel through the real Worker and Duel room
// (scripts/party.ts standing in for the edge), each picks from its line-up, and each plays the fight on its own sim
// from nothing but the two players' inputs. Both must see the same fight to the last tick, the same winner, and a
// rematch must start clean. A third player is turned away, and a page that leaves is seen to go. Teamed up (#4400), two
// pages fight one wild creature, each page playing the wild one's seeded bot, and both see the same end.
import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { serveParty } from "../scripts/party.ts";
import { bot } from "../src/bot.ts";
import { atLevel } from "../src/journey.ts";
import { creature } from "../src/roster.ts";
import { DuelLink } from "../src/net/duel-link.ts";
import { pack, sum, unpack, type DuelOut, type Pick, type RoomKind } from "../src/net/duel.ts";
import { tsSim, type Live } from "../src/sim-wasm.ts";
import { coopTeams } from "../src/versus.ts";

setDefaultTimeout(60_000);
const party = serveParty(0);
afterAll(() => party.stop());

const until = async (what: string, ok: () => boolean, ms = 8000) => {
  const end = Date.now() + ms;
  while (!ok()) { if (Date.now() > end) throw new Error(`timed out: ${what}`); await Bun.sleep(10); }
};

/** One page: its link, and the fight it plays when the room says go, a bot standing in for the player's hands. */
function page(code: string, uid: string, name: string, pick: Pick, kind: RoomKind = "duel") {
  const p = { live: null as Live | null, wild: null as ReturnType<typeof bot> | null, stalls: 0, desync: false, go: 0, frame: (n?: number) => { void n; } };
  const start = (g: Extract<DuelOut, { t: "go" }>) => {
    if (kind === "duel") return tsSim(atLevel(creature(g.picks[0]!.c), g.picks[0]!.lv), atLevel(creature(g.picks[1]!.c), g.picks[1]!.lv));
    p.wild = bot(g.picks.length, g.seed); // the wild one fights last in m.f, its hands the same seeded bot on every page
    return tsSim(...coopTeams(g));
  };
  const link = new DuelLink(code, {
    base: party.url, guest: { uid, name }, kind,
    onGo: (g) => { p.go++; p.live = start(g); },
    onDesync: () => { p.desync = true; },
  });
  link.pick(pick);
  /** A frame: up to `n` ticks, as many as both inputs are in for. */
  p.frame = (n = 2) => {
    const live = p.live, step = link.step;
    if (!live || !step || live.m.over) return;
    const hands = bot(step.seat, 11 + step.seat);
    for (let k = 0; k < n && !live.m.over; k++) {
      const seats = step.next(() => hands(live.m));
      if (!seats) { p.stalls++; break; }
      live.step(p.wild ? [...seats, p.wild(live.m)] : seats);
    }
    link.flush(live.m);
  };
  return { ...p, link, get live() { return p.live; }, get stalls() { return p.stalls; }, get desync() { return p.desync; }, get go() { return p.go; }, frame: p.frame };
}

test("two friends play one fight: same ticks, same winner, a clean rematch; a third is refused", async () => {
  const a = page("DUELTEST1", "a1a1a1a1a1a1a1a1a1a1a1a1", "Alice", { c: "hodag", lv: 12 });
  await until("alice seated", () => a.link.seats?.you === 0);
  const b = page("DUELTEST1", "b2b2b2b2b2b2b2b2b2b2b2b2", "Bob", { c: "jackalope", lv: 15 });
  await until("both told go", () => a.go === 1 && b.go === 1);
  expect(a.link.seats?.names).toEqual(["Alice", "Bob"]);
  expect(b.link.seats?.you).toBe(1);
  // Each page plays seat 0 as the hodag and seat 1 as the jackalope, whoever it is.
  expect(a.live!.m.f.map((f) => f.c.id)).toEqual(["hodag", "jackalope"]);
  expect(b.live!.m.f.map((f) => f.c.stats)).toEqual(a.live!.m.f.map((f) => f.c.stats));

  // A stranger with the link finds both chairs taken.
  const c = page("DUELTEST1", "c3c3c3c3c3c3c3c3c3c3c3c3", "Carol", { c: "squonk", lv: 3 });
  await until("carol refused", () => c.link.status === "full");

  // Two pages at their own pace: A runs ahead and waits on B's inputs; neither ever guesses.
  // Under the room's rate, as a page at 60 Hz is, but a dozen times faster than real time.
  while (!a.live!.m.over || !b.live!.m.over) { a.frame(8); b.frame(6); await Bun.sleep(8); }
  expect(b.live!.m.tick).toBe(a.live!.m.tick);
  expect(sum(b.live!.m)).toBe(sum(a.live!.m));
  expect(b.live!.m.winner).toBe(a.live!.m.winner);
  expect(a.desync || b.desync).toBe(false);
  expect(a.stalls).toBeGreaterThan(0); // the faster page did wait

  // Rematch: both pick again, round two starts from tick 1 with the new picks.
  a.link.pick({ c: "hodag", lv: 12 }); b.link.pick({ c: "squonk", lv: 4 });
  await until("rematch", () => a.go === 2 && b.go === 2);
  expect(a.link.step?.r).toBe(2);
  for (const end = Date.now() + 10_000; (a.live!.m.tick < 300 || b.live!.m.tick < 300) && Date.now() < end;) { a.frame(8); b.frame(6); await Bun.sleep(8); }
  expect(a.live!.m.f.map((f) => f.c.id)).toEqual(["hodag", "squonk"]);
  expect(Math.min(a.live!.m.tick, b.live!.m.tick)).toBeGreaterThanOrEqual(300);
  expect(a.desync || b.desync).toBe(false);

  // B closes the tab: A sees the chair empty.
  b.link.close();
  await until("bob gone", () => a.link.seats?.names[1] === null);
  a.link.close(); c.link.close();
});

test("two friends team up against a wild one: both pages play it to the same knockout", async () => {
  const a = page("COOPTEST1", "a1a1a1a1a1a1a1a1a1a1a1a1", "Alice", { c: "hodag", lv: 20 }, "coop");
  await until("alice seated", () => a.link.seats?.you === 0);
  expect(a.link.seats?.names.length).toBe(4); // a co-op room has four chairs, and starts with two
  const b = page("COOPTEST1", "b2b2b2b2b2b2b2b2b2b2b2b2", "Bob", { c: "jackalope", lv: 20 }, "coop");
  await until("both told go", () => a.go === 1 && b.go === 1);
  // Both friends on one side, the same wild one on the other, on both pages.
  const sides = (l: Live) => l.m.f.map((f) => [f.c.id, f.team]);
  expect(sides(a.live!).slice(0, 2)).toEqual([["hodag", 0], ["jackalope", 0]]);
  expect(sides(b.live!)).toEqual(sides(a.live!));
  expect(a.live!.m.f[2]!.team).toBe(1);

  while (!a.live!.m.over || !b.live!.m.over) { a.frame(8); b.frame(6); await Bun.sleep(8); }
  const end = (l: Live) => ({ tick: l.m.tick, sum: sum(l.m), winner: l.m.winner, ko: l.m.events.find((e) => e.kind === "ko") });
  expect(end(b.live!)).toEqual(end(a.live!));
  expect(["hp", "ring-out"]).toContain(end(a.live!).ko?.kind === "ko" ? end(a.live!).ko!.how : "none"); // a knockout, not the clock
  expect(a.desync || b.desync).toBe(false);
  console.log(`co-op: over at tick ${a.live!.m.tick}, team ${a.live!.m.winner} won, ${JSON.stringify(end(a.live!).ko)}`);
  a.link.close(); b.link.close();
});

test("the stick rounds the same way on both pages, and stays inside the circle", () => {
  for (const [mx, mz] of [[0.7071, 0.7071], [1, 0], [-0.33, 0.94], [0, 0]] as const) {
    const i = unpack(pack({ mx, mz, up: true, down: false, light: false, heavy: true, special: false, ultimate: false, guard: false, dash: true, big: false }));
    expect(Math.hypot(i.mx, i.mz)).toBeLessThanOrEqual(1);
    expect(unpack(pack(i))).toEqual(i);
    expect([i.up, i.heavy, i.dash, i.light]).toEqual([true, true, true, false]);
  }
});

test("a challenge is a friend's recent note from this game with a duel link on this site, one per friend", async () => {
  const { challenges, CHALLENGE_MS } = await import("../src/versus.ts");
  const now = 1_800_000_000_000, site = "https://mythic-masters.example";
  const note = (from: string, at: number, link: string, app = "mythic-masters", kind = "app") => ({ key: `${from}${at}`, at, kind, from: { id: from, name: from.toUpperCase() }, app, text: "challenges you", link });
  const got = challenges({ friends: [], notes: [
    note("ann", now - 1000, `${site}/?duel=BCDFGHJK`),
    note("ann", now - 5000, `${site}/?duel=OLDOLDOL`), // her older one
    note("ben", now - CHALLENGE_MS - 1, `${site}/?duel=LATELATE`), // stale
    note("cy", now - 1000, `https://elsewhere.example/?duel=BCDFGHJK`), // another site
    note("di", now - 1000, `${site}/?duel=BCDFGHJK`, "skate-tech-park"), // another game
    note("ed", now - 2000, `${site}/?world=1`), // not a duel
    note("fi", now - 3000, `${site}/?duel=MNPQRSTV`),
    note("gu", now - 4000, `${site}/?coop=WXZWXZWX`), // teaming up
  ] }, site, now);
  expect(got).toEqual([{ from: "ANN", code: "BCDFGHJK", at: now - 1000 }, { from: "FI", code: "MNPQRSTV", at: now - 3000 }, { from: "GU", code: "WXZWXZWX", at: now - 4000, kind: "coop" }]);
});
