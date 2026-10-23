import { expect, test } from "bun:test";
import type { SpaceBattleSpec, SpaceOrder } from "../src/battle/contract.ts";
import { HULL_PER_SHIP, ROUNDS, clash, encodePicks, exchange, fightPicks, playRound, replayPicks, startPicks, whyNot } from "../src/battle/space-picks.ts";
import { aiSpacePick } from "../src/war/ai.ts";

// A fixture straight from the contract, like the flown battle's.
const spec = (over: Partial<SpaceBattleSpec> = {}): SpaceBattleSpec => ({
  id: "1-kessa-orbit", turn: 1, system: "Kessa",
  factions: { attacker: "marines", defender: "wooka" }, hero: "attacker", heroLevel: 1,
  fleets: { attacker: 3, defender: 3 }, muster: { attacker: 2, defender: 2 }, batteries: { attacker: 0, defender: 0 }, seed: 42, ...over,
});
const vs = (a: SpaceOrder, d: SpaceOrder, over: Partial<SpaceBattleSpec> = {}) => exchange(startPicks(spec(over)), { attacker: a, defender: d });

test("the orders counter each other: broadside beats boarders, boarders beat a screen, a screen beats a broadside", () => {
  expect(clash("broadside", "board")).toBe("win");
  expect(clash("board", "screen")).toBe("win");
  expect(clash("screen", "broadside")).toBe("win");
  expect(clash("board", "broadside")).toBe("lose");
  expect(clash("broadside", "broadside")).toBe("even");
  // Every fighting order catches a fleet that turns its guns on the world.
  for (const o of ["broadside", "screen", "board"] as const) expect(clash(o, "bombard")).toBe("win");
  // The winner of a clash puts more into the other's hull than it takes, at equal fleets.
  for (const [w, l] of [["broadside", "board"], ["board", "screen"], ["screen", "broadside"]] as const) {
    const r = vs(w, l);
    expect(r.hit.defender).toBeGreaterThan(r.hit.attacker);
  }
  // A broadside costs a boarding party half its troops; a won boarding takes prizes.
  expect(vs("board", "broadside").boarders.attacker).toBe(1);
  expect(vs("board", "screen").prizes.attacker).toBeGreaterThan(0);
});

test("a bombardment kills armies below but takes every hit; pulling back halves the fire and rallies", () => {
  const r = vs("bombard", "broadside");
  expect(r.killed.defender).toBeGreaterThan(0);
  expect(r.hit.defender).toBe(0);
  expect(r.hit.attacker).toBeGreaterThan(0);
  // Batteries below add to it, and to a screen.
  expect(vs("bombard", "broadside", { batteries: { attacker: 0, defender: 2 }, muster: { attacker: 2, defender: 9 } }).killed.defender).toBeGreaterThanOrEqual(r.killed.defender);
  expect(vs("broadside", "screen", { batteries: { attacker: 0, defender: 2 } }).hit.attacker).toBeGreaterThan(vs("broadside", "screen").hit.attacker);
  // Pulling back: half of a broadside's parting shots, nothing back, nobody to board.
  expect(vs("broadside", "withdraw").hit.defender).toBeLessThan(vs("broadside", "broadside").hit.defender);
  expect(vs("broadside", "withdraw").hit.attacker).toBe(0);
  expect(vs("board", "withdraw").hit.defender).toBe(0);
  const b = startPicks(spec());
  playRound(b, { attacker: "withdraw", defender: "screen" });
  expect(b.rally.attacker).toBe(true);
  expect(exchange(b, { attacker: "broadside", defender: "broadside" }).hit.defender).toBeGreaterThan(vs("broadside", "broadside").hit.defender);
});

test("fleet numbers weigh in, and the muster force unlocks and strengthens boarding", () => {
  expect(vs("broadside", "broadside", { fleets: { attacker: 6, defender: 3 } }).hit.defender).toBeGreaterThan(vs("broadside", "broadside").hit.defender);
  expect(whyNot(startPicks(spec({ muster: { attacker: 0, defender: 2 } })), "attacker", "board")).toBe("No troops on the world below to board with");
  expect(vs("board", "screen", { muster: { attacker: 5, defender: 2 } }).hit.defender).toBeGreaterThan(vs("board", "screen", { muster: { attacker: 1, defender: 2 } }).hit.defender);
  // No order twice running.
  const b = startPicks(spec());
  playRound(b, { attacker: "broadside", defender: "screen" });
  expect(whyNot(b, "attacker", "broadside")).toBe("Not twice running");
  expect(() => playRound(b, { attacker: "broadside", defender: "board" })).toThrow();
});

test("a pick battle is a pure function of the spec and the picks, played again from the hero's log", () => {
  const picks: SpaceOrder[] = ["screen", "broadside", "withdraw", "screen"];
  const a = fightPicks(spec(), picks, aiSpacePick)!, b = fightPicks(spec(), picks, aiSpacePick)!;
  expect(a.round).toBe(ROUNDS);
  expect(a.over).toEqual(b.over!);
  expect(a.rounds.map((r) => r.picks.attacker)).toEqual(picks);
  expect(replayPicks(spec(), encodePicks(picks), aiSpacePick)).toEqual(a.over!);
  expect(a.over!.fleets.attacker).toBe(Math.floor(a.hull.attacker / HULL_PER_SHIP));
  // A pick the hero couldn't make, or a log that isn't picks, makes no battle.
  expect(replayPicks(spec(), encodePicks(["screen", "screen"]), aiSpacePick)).toBeNull();
  expect(replayPicks(spec(), "9x", aiSpacePick)).toBeNull();
  expect(replayPicks(spec(), "01234", aiSpacePick)).toBeNull();
});

test("the AI plays the Marines and the Wooka alike", () => {
  const swapped = (s: SpaceBattleSpec): SpaceBattleSpec => ({ ...s, factions: { attacker: s.factions.defender, defender: s.factions.attacker } });
  for (let seed = 1; seed <= 20; seed++) {
    const b = fightPicks(spec({ seed }), [], aiSpacePick)!;
    expect(fightPicks(swapped(spec({ seed })), [], aiSpacePick)!.over).toEqual(b.over!);
  }
});
