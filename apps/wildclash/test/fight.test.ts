import { describe, expect, test } from "bun:test";
import { play, rate } from "../scripts/tune.ts";
import { creature, ROSTER, type Creature } from "../src/roster.ts";
import { IDLE, newMatch, step, type Input } from "../src/sim.ts";

// One of each archetype: a 6 kg hare, a winged devil, a spined tank and a branch-hurling bruiser.
const [skirmisher, flyer, tank, bruiser] = ["jackalope", "jersey-devil", "hodag", "agropelter"].map(creature) as [Creature, Creature, Creature, Creature];
const hold = (i: Partial<Input>): Input => ({ ...IDLE, ...i });

describe("a match", () => {
  test("bot against bot plays out to a winner, and the same seed plays the same fight", () => {
    const a = play(skirmisher, tank, 3), b = play(skirmisher, tank, 3);
    expect(a.winner === 0 || a.winner === 1).toBe(true);
    expect(a.ko?.kind).toBe("ko");
    expect(b).toEqual(a);
  });

  // Head to head some pairings lean (fields and bodies counter each other); across the roster none should.
  test.each([["the Jackalope", skirmisher], ["the Jersey Devil", flyer], ["the Hodag", tank], ["the Agropelter", bruiser]])(
    "%s wins 30-70% of bot matches against every fifth creature in the roster", (_name, a) => {
      const field = ROSTER.filter((o, i) => i % 5 === 0 && o.id !== a.id);
      const wins = field.reduce((n, o) => n + rate(a, o, 6).wins, 0) / field.length;
      expect(wins).toBeGreaterThanOrEqual(0.3);
      expect(wins).toBeLessThanOrEqual(0.7);
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

  test("a flyer's dive lands on the fighter below and bounces back up; guarded, it does a fifth", () => {
    const dive = (guard: boolean) => {
      const m = newMatch(flyer, tank);
      const [me, it] = m.f;
      Object.assign(me, { flying: true, onGround: false, pos: { x: it.pos.x - 3, y: 4, z: 0 }, yaw: 0 });
      step(m, [hold({ heavy: true, down: true }), hold({ guard })]);
      let damage = 0;
      for (let t = 0; t < 40 && !damage; t++) { step(m, [IDLE, hold({ guard })]); for (const e of m.events) if (e.kind === "hit" && e.by === 0) damage = e.damage; }
      return { damage, rising: me.vel.y > 0 && !me.onGround };
    };
    const open = dive(false), guarded = dive(true);
    expect(open.damage).toBeGreaterThan(10);
    expect(open.rising).toBe(true);
    expect(guarded.damage).toBeCloseTo(open.damage * 0.2, 1);
  });
});
