// The DJ booth as a crew sets it up: the booth lines up (decks level with the mixer, front edges in one line, equal
// gaps, monitors at ear height aimed at the DJ), a turntable wired without its ground wire hums until the wire goes on
// the mixer's post, then both decks play through the tops and the crossfader moves the mix from one to the other.
import { expect, test } from "bun:test";
import type { Cable, CableKind } from "@rustybuns/gear";
import { DJ_BOOTH, DJ_BOOTH_MEDIA, GAP, TABLE, aimOff, booth, driverAt, frontEdge, gaps, judgeBooth } from "../src/venues/dj-booth.ts";
import { newWorld } from "../src/sim.ts";
import { mix, newDecks, play, setCross, tickDecks } from "../src/audio/decks.ts";

const c = (kind: CableKind, from: string, to: string, lengthM = 3): Cable => {
  const [a = "", aj = ""] = from.split(" "), [b = "", bj = ""] = to.split(" ");
  return { kind, lengthM, from: [a, aj], to: [b, bj] };
};

/** Power to everything, master to the tops (the left top's thru on to the powered sub), the booth outs to the monitors. */
const system: Cable[] = [
  c("power", "wall-1 power-out-1", "distro power-in"),
  ...["deck-1", "deck-2", "mixer", "mon-l", "mon-r", "top-l"].map((k, i) => c("power", `distro power-out-${i + 1}`, `${k} power-in`)),
  c("power", "wall-1 power-out-2", "top-r power-in", 5),
  c("power", "wall-2 power-out-1", "sub power-in"),
  c("xlr", "mixer xlr-out-1", "top-l xlr-in", 5),
  c("xlr", "mixer xlr-out-2", "top-r xlr-in", 5),
  c("xlr", "top-l xlr-out", "sub xlr-in", 5),
  c("xlr", "mixer xlr-out-3", "mon-l xlr-in"),
  c("xlr", "mixer xlr-out-4", "mon-r xlr-in"),
];
// Deck 1 into channel 2 and deck 2 into channel 3, the booth habit: one each side of the crossfader.
const decksIn = (input: "phono" | "rca") => [c("rca", "deck-1 rca-out", `mixer ${input}-in-2`, 1.5), c("rca", "deck-2 rca-out", `mixer ${input}-in-3`, 1.5)];

test.each(["vinyl", "media"] as const)("the %s booth lines up: level, one front line, equal gaps, monitors at the DJ's ear", (kind) => {
  const b = booth(kind), [d1, mixer, d2, ...rest] = b.items;
  for (const i of [d1!, mixer!, d2!]) expect(i.y).toBe(TABLE.h);
  expect(frontEdge(d1!)).toBeCloseTo(frontEdge(mixer!), 6);
  expect(frontEdge(d2!)).toBeCloseTo(frontEdge(mixer!), 6);
  const [left, right] = gaps(b);
  expect(left).toBeCloseTo(GAP, 6);
  expect(right).toBeCloseTo(GAP, 6);
  // The mixer centred on the table, the decks on the DJ's side of it (the front edge line is between the DJ and the table's middle).
  expect(mixer!.x).toBe(b.table.x);
  expect(frontEdge(mixer!)).toBeLessThan(b.table.z);
  expect(frontEdge(mixer!)).toBeGreaterThan(b.table.z - b.table.d / 2);
  const monitors = rest.filter((i) => i.gear === "fill-8-powered");
  expect(monitors).toHaveLength(2);
  for (const m of monitors) {
    expect(Math.abs(driverAt(m).y - b.head.y)).toBeLessThan(0.01);
    expect(aimOff(m, b.head).h).toBeLessThan(1);
  }
});

test("a turntable with no ground wire hums; the wire on the post stops it; both decks play and the crossfader moves the mix", () => {
  const w = newWorld(DJ_BOOTH), placed = w.items.map((i) => ({ id: i.key, gear: i.gear }));
  const ground2 = c("ground", "deck-2 ground-out", "mixer ground-in-2", 1.5);

  // Deck 1's ground wire left off: its channel hums, and only that deck.
  const humming = judgeBooth(DJ_BOOTH, placed, [...system, ...decksIn("phono"), ground2]);
  expect(humming.hum).toEqual(["deck-1"]);
  expect(humming.problems.map((p) => p.message)).toEqual([expect.stringContaining("deck-1 has no ground wire on mixer's post: it hums")]);
  expect(humming.routing).toEqual({ "deck-1": 2, "deck-2": 3 });

  // The wire on the post: no hum, nothing wrong, every speaker fed.
  const fixed = judgeBooth(DJ_BOOTH, placed, [...system, ...decksIn("phono"), ground2, c("ground", "deck-1 ground-out", "mixer ground-in-1", 1.5)]);
  expect(fixed.problems).toEqual([]);
  expect(fixed.hum).toEqual([]);
  expect([...fixed.fed].filter(([, on]) => !on)).toEqual([]);
  expect([...fixed.fed.keys()].sort()).toEqual(["mon-l", "mon-r", "sub", "top-l", "top-r"]);

  // Both decks play at their own tempos; hard left only deck 1 is heard, hard right only deck 2, centred both at -3 dB.
  const d = newDecks();
  play(d, 1);
  play(d, 2);
  tickDecks(d, 15);
  expect(d.deck.map((k) => Math.round(k.beat))).toEqual([31, 32]);
  const keys = ["deck-1", "deck-2"] as const;
  setCross(d, -1);
  expect(mix(d, keys, fixed.routing).gain).toEqual({ "deck-1": 0.8, "deck-2": 0 });
  setCross(d, 1);
  expect(mix(d, keys, fixed.routing).gain).toEqual({ "deck-1": 0, "deck-2": 0.8 });
  setCross(d, 0);
  expect(mix(d, keys, fixed.routing).gain).toEqual({ "deck-1": 0.566, "deck-2": 0.566 });
});

test("decks into the wrong inputs: a media player into phono distorts, a turntable into a line input is too quiet", () => {
  const media = newWorld(DJ_BOOTH_MEDIA), placed = media.items.map((i) => ({ id: i.key, gear: i.gear }));
  expect(judgeBooth(DJ_BOOTH_MEDIA, placed, [...system, ...decksIn("phono")]).distort).toEqual(["deck-1", "deck-2"]);
  expect(judgeBooth(DJ_BOOTH_MEDIA, placed, [...system, ...decksIn("rca")]).problems).toEqual([]);
  const vinyl = newWorld(DJ_BOOTH), tt = vinyl.items.map((i) => ({ id: i.key, gear: i.gear }));
  const grounds = [c("ground", "deck-1 ground-out", "mixer ground-in-1"), c("ground", "deck-2 ground-out", "mixer ground-in-2")];
  expect(judgeBooth(DJ_BOOTH, tt, [...system, ...decksIn("rca"), ...grounds]).problems.map((p) => p.kind)).toEqual(["level", "level"]);
});
