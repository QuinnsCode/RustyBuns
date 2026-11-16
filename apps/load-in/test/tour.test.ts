// The tour from the first booking: the dive bar on rented gear, a good night books the bigger bar, whose kit outweighs
// the hatchback; a poor night there books you back; pay buys a distro and, saved up, the van, and the rent drops.
import { expect, test } from "bun:test";
import { BIGGER_BAR } from "../src/venues/bigger-bar.ts";
import { DIVE_BAR } from "../src/venues/dive-bar.ts";
import { PARK } from "../src/venues/park.ts";
import { bookedRung, buy, newTour, readTour, ready, record } from "../src/tour.ts";

test("a tour: rent what you lack, a pass books the next rung, a miss books you back, pay buys gear and a van", () => {
  let t = newTour();
  expect(bookedRung(t).level).toBe(DIVE_BAR);
  // The garage's one powered top comes along; the second top, the stands, the sub, the mixer and a case are rented.
  expect(ready(t, DIVE_BAR)).toEqual({
    missing: { "top-12-powered": 1, "stand-tripod": 2, "sub-18": 1, "mixer-small": 1, "road-case-m": 1 },
    kg: 121, fits: true, rentTruck: null, rent: 65, fee: 150,
  });

  const dive = record(t, DIVE_BAR, { score: 90, pay: 150, pass: true });
  expect(dive).toMatchObject({ net: 85, booked: "bigger-bar" });
  t = dive.tour;
  expect(t.cash).toBe(185);

  // Two subs, two passive tops and a rack: 239 kg, too much for the hatchback, so a van is rented too.
  const big = ready(t, BIGGER_BAR);
  expect(big).toMatchObject({ kg: 239, fits: false, rentTruck: "van", rent: 269, fee: 300 });

  // The cooler's circuit tripped at doors: paid late and short, and they'll have you back rather than move you up.
  const miss = record(t, BIGGER_BAR, { score: 40, pay: 240, pass: false });
  expect(miss).toMatchObject({ net: -29, booked: "bigger-bar" });
  t = miss.tour;

  expect(buy(t, "van")).toMatchObject({ ok: false, why: "that's $1200, you have $156" });
  expect(buy(t, "bar-cooler")).toMatchObject({ ok: false, why: "bar-cooler isn't for sale" });
  const distro = buy(t, "distro-box");
  expect(distro.ok).toBe(true);
  t = distro.tour;
  expect(t).toMatchObject({ cash: 76, owned: { "distro-box": 1 } });
  expect(ready(t, BIGGER_BAR).rent).toBe(269 - 4);

  // Saved up for the van: the kit fits, no truck rent, and the hatchback can't be bought back as an upgrade.
  t = { ...t, cash: 1300 };
  t = buy(t, "van").tour;
  expect(t).toMatchObject({ truck: "van", cash: 100 });
  expect(ready(t, BIGGER_BAR)).toMatchObject({ fits: true, rentTruck: null, rent: 145 });
  expect(buy(t, "hatchback")).toMatchObject({ ok: false });

  // A pass at the bigger bar books the community event; the top rung books itself.
  t = record(t, BIGGER_BAR, { score: 92, pay: 300, pass: true }).tour;
  expect(bookedRung(t).level).toBe(PARK);
  expect(record(t, PARK, { score: 88, pay: 400, pass: true }).booked).toBe("park");
  expect(t.nights.map((n) => [n.level, n.pass])).toEqual([["dive-bar", 1], ["bigger-bar", 0], ["bigger-bar", 1]]);
});

test("a save read back: a good one as it was, anything else a new tour", () => {
  const t = record(newTour(), DIVE_BAR, { score: 90, pay: 150, pass: true }).tour;
  expect(readTour(JSON.parse(JSON.stringify(t)))).toEqual(t);
  for (const bad of [null, "tour", { ...t, cash: "lots" }, { ...t, truck: "jet" }, { ...t, booked: "the moon" }]) {
    expect(readTour(bad)).toEqual(newTour());
  }
});
