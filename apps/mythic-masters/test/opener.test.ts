// The page's bot at the bell (src/opener.ts): it gives you a person's reaction time, it doesn't open the same way every
// round, and each opening does what it says: a read comes in, a guard covers up, a flying knee leaps in and swings.
import { expect, test } from "bun:test";
import { bot } from "../src/bot.ts";
import { opening, REACT, temper, type Opening } from "../src/opener.ts";
import { creature } from "../src/roster.ts";
import { IDLE, newMatch, step, type Match } from "../src/sim.ts";

/** You stand still at the bell; the tempered bot plays side 1 for `ticks`. */
function bell(plan: Opening, seed: number, ticks = 240) {
  const m: Match = newMatch(creature("hodag"), creature("jackalope"));
  const b = temper(bot(1, seed), 1, seed, plan);
  const seen = { firstMove: -1, guarded: 0, airborne: false, swungAt: -1, firstHit: -1 };
  for (let t = 0; t < ticks && !m.over; t++) {
    const i = b(m);
    step(m, [IDLE, i]);
    const f = m.f[1];
    if (seen.firstMove < 0 && (i.mx || i.mz || i.dash || i.up || i.heavy || i.light)) seen.firstMove = m.tick;
    if (f.state === "guard") seen.guarded++;
    if (!f.onGround) seen.airborne = true;
    if (seen.swungAt < 0 && f.state === "attack") seen.swungAt = m.tick;
    if (seen.firstHit < 0 && m.events.some((e) => e.kind === "hit" && e.by === 1)) seen.firstHit = m.tick;
  }
  return seen;
}

test.each(["read", "guard", "knee"] as const)("%s: nothing before a person could react, then it plays its opening", (plan) => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const s = bell(plan, seed);
    expect(s.firstMove).toBeGreaterThan(REACT.min);
    expect(s.firstHit === -1 || s.firstHit > REACT.min).toBe(true);
    if (plan === "guard") expect(s.guarded).toBeGreaterThan(30);
    if (plan === "knee") { expect(s.airborne).toBe(true); expect(s.swungAt).toBeGreaterThan(0); expect(s.swungAt).toBeLessThan(150); }
  }
});

test("over many rounds it opens all three ways", () => {
  const seen = new Set<Opening>();
  let r = 7;
  const rnd = () => ((r = (r * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < 40; k++) seen.add(opening(rnd));
  expect([...seen].sort()).toEqual(["guard", "knee", "read"]);
});
