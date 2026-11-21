// The tour from the first booking: the first gig on rented gear, then every rung to the arena, the following growing
// with each good night and the pay with the heads; a poor night books you back and costs you some of your crowd; pay
// buys a distro and, saved up, the van, and the rent drops.
import { expect, test } from "bun:test";
import { VENUES } from "../src/clock.ts";
import { BIGGER_BAR } from "../src/venues/bigger-bar.ts";
import { FIRST_GIG } from "../src/venues/first-gig.ts";
import { homeOpen } from "../src/tour-view.ts";
import { FIRST_FOLLOWING, LADDER, RIGS, bookedRung, buy, crowd, newTour, readTour, ready, record } from "../src/tour.ts";

test("from the first gig to the red-rock amphitheatre: each pass books the next rung, and the following and the pay climb", () => {
  let t = newTour();
  expect(bookedRung(t).level).toBe(FIRST_GIG);
  // The garage owns none of the first gig's kit: the desk, the rack, the wedge, the mic and its stand are rented.
  expect(ready(t, FIRST_GIG)).toMatchObject({ missing: { "mixer-small": 1, "amp-rack-4u": 1, "wedge-12-passive": 1, "mic-stand": 1, "mic-condenser": 1 }, fits: true, fee: 120 });

  const booked: string[] = [], following: number[] = [], pay: number[] = [];
  for (const rung of LADDER) {
    const fee = VENUES[rung.level.name]!.fee;
    const night = record(t, rung.level, { score: 90, pay: fee, pass: true });
    // A room is never fuller than it holds.
    expect(night.heads).toBeLessThanOrEqual(RIGS[rung.level.name]!.people);
    pay.push(night.net + ready(t, rung.level).rent);
    t = night.tour;
    booked.push(night.booked);
    following.push(t.following);
  }
  expect(booked).toEqual(["band-night", "dive-bar", "bigger-bar", "park", "desert", "festival", "small-arena", "arena", "amphitheatre", "amphitheatre"]);
  for (let i = 1; i < LADDER.length; i++) {
    expect(following[i]!).toBeGreaterThan(following[i - 1]!);
    expect(pay[i]!).toBeGreaterThan(pay[i - 1]!);
  }

  // A miss at the top, the amphitheatre: booked back, and a share of the following stays home next time.
  const miss = record(t, LADDER.at(-1)!.level, { score: 40, pay: 4000, pass: false });
  expect(miss.booked).toBe("amphitheatre");
  expect(miss.tour.following).toBeLessThan(t.following);
});

test("every rung's rig is at least the one below it, count by count", () => {
  const rigs = LADDER.map((r) => RIGS[r.level.name]!);
  for (const [i, rig] of rigs.entries()) {
    if (i === 0) continue;
    // The amphitheatre tops the ladder by its rig and its throw: its bowl seats fewer than the arena.
    const counts = (["people", "tops", "subs", "wedges", "amps", "kw", "runs", "crew"] as const).filter((k) => !(k === "people" && LADDER[i]!.level.name === "amphitheatre"));
    for (const k of counts) expect(rig[k]).toBeGreaterThanOrEqual(rigs[i - 1]![k]);
  }
  expect(rigs.at(-2)).toMatchObject({ people: 15000 });
  expect(rigs.at(-1)).toMatchObject({ people: 9500 });
});

test("rent what you lack, a miss books you back, pay buys a distro and the van, and the rent drops", () => {
  let t = { ...newTour(), booked: "bigger-bar", cash: 300 };
  // Two subs, two passive tops and a rack: 239 kg, too much for the hatchback, so a van is rented too.
  expect(ready(t, BIGGER_BAR)).toMatchObject({ kg: 239, fits: false, rentTruck: "van", rent: 269, fee: 300 });
  // The cooler's circuit tripped at doors: paid short, booked back, and some of your friends stay home.
  const heads = crowd(t, BIGGER_BAR).heads;
  expect(heads).toBe(100 + FIRST_FOLLOWING);
  const miss = record(t, BIGGER_BAR, { score: 40, pay: 240, pass: false });
  expect(miss).toMatchObject({ net: Math.round((240 * heads) / 250) - 269, booked: "bigger-bar" });
  expect(miss.tour.following).toBe(16);
  t = miss.tour;

  expect(buy(t, "van")).toMatchObject({ ok: false, why: `that's $1200, you have $${t.cash}` });
  expect(buy(t, "bar-cooler")).toMatchObject({ ok: false, why: "bar-cooler isn't for sale" });
  t = buy(t, "distro-box").tour;
  expect(t.owned["distro-box"]).toBe(1);
  expect(ready(t, BIGGER_BAR).rent).toBe(269 - 4);

  // Saved up for the van: the kit fits, no truck rent, and the hatchback can't be bought back as an upgrade.
  t = buy({ ...t, cash: 1300 }, "van").tour;
  expect(t).toMatchObject({ truck: "van", cash: 100 });
  expect(ready(t, BIGGER_BAR)).toMatchObject({ fits: true, rentTruck: null, rent: 145 });
  expect(buy(t, "hatchback")).toMatchObject({ ok: false });
});

test("a save read back: a good one as it was, one from before the following as your friends, anything else a new tour", () => {
  const t = record(newTour(), FIRST_GIG, { score: 90, pay: 120, pass: true }).tour;
  expect(readTour(JSON.parse(JSON.stringify(t)))).toEqual(t);
  const { following: _, ...old } = { ...t, booked: "dive-bar" };
  expect(readTour(old)).toEqual({ ...t, booked: "dive-bar", following: FIRST_FOLLOWING });
  for (const bad of [null, "tour", { ...t, cash: "lots" }, { ...t, truck: "jet" }, { ...t, booked: "the moon" }]) {
    expect(readTour(bad)).toEqual(newTour());
  }
});

test("home base starts folded for a newcomer, so Play is what they see, and open once they have played a night", () => {
  const t = newTour();
  expect(homeOpen(t)).toBe(false);
  expect(homeOpen(record(t, FIRST_GIG, { score: 40, pay: 0, pass: false }).tour)).toBe(true);
});
