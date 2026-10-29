import { describe, expect, test } from "bun:test";
import { play, rate } from "../scripts/tune.ts";
import { ROSTER } from "../src/roster.ts";
import { IDLE, newMatch, step, type Input } from "../src/sim.ts";

const of = (id: string) => ROSTER.find((c) => c.id === id)!;
const [skirmisher, flyer, tank] = [of("jackalope"), of("jersey-devil"), of("hodag")];
const hold = (i: Partial<Input>): Input => ({ ...IDLE, ...i });

describe("a match", () => {
  test("bot against bot plays out to a winner, and the same seed plays the same fight", () => {
    const a = play(skirmisher, tank, 3), b = play(skirmisher, tank, 3);
    expect(a.winner === 0 || a.winner === 1).toBe(true);
    expect(a.ko?.kind).toBe("ko");
    expect(b).toEqual(a);
  });

  test.each([
    ["the Hodag", tank],
    ["the Jersey Devil", flyer],
  ])("the 3 kg Jackalope can beat %s: it wins 30-70% of bot matches", (_n, big) => {
    const r = rate(skirmisher, big, 100);
    expect(r.wins).toBeGreaterThanOrEqual(0.3);
    expect(r.wins).toBeLessThanOrEqual(0.7);
  });
});

describe("nothing hides in the air", () => {
  test("a flyer that holds altitude runs out of stamina and comes down", () => {
    const m = newMatch(flyer, skirmisher);
    step(m, [hold({ up: true }), IDLE]);         // jump
    for (let t = 0; t < 20; t++) step(m, [IDLE, IDLE]);
    step(m, [hold({ up: true }), IDLE]);         // take off
    expect(m.f[0].flying).toBe(true);
    let peak = 0;
    for (let t = 0; t < 60 * 15 && !m.f[0].onGround; t++) { step(m, [hold({ up: t % 2 === 0 }), IDLE]); peak = Math.max(peak, m.f[0].pos.y); }
    expect(peak).toBeGreaterThan(3);
    expect(m.f[0].onGround).toBe(true);
    expect(m.f[0].exhausted).toBe(true);
  });

  test("a grounded fighter's launcher reaches a flyer hovering overhead and knocks it out of the air", () => {
    const m = newMatch(skirmisher, flyer);
    const [me, it] = m.f;
    Object.assign(it, { flying: true, onGround: false, pos: { x: me.pos.x + 1.2, y: 3, z: 0 } });
    step(m, [hold({ up: true, heavy: true }), hold({ up: true })]);
    let hit = false;
    for (let t = 0; t < 40; t++) { step(m, [IDLE, IDLE]); hit ||= m.events.some((e) => e.kind === "hit" && e.by === 0); }
    expect(hit).toBe(true);
    expect(it.flying).toBe(false);
  });
});
