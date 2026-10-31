import { describe, expect, test } from "bun:test";
import { play, rate } from "../scripts/tune.ts";
import { creature, ROSTER, type Creature } from "../src/roster.ts";
import type { Field } from "../src/fields.ts";
import { frames, IDLE, newMatch, step, type Fighter, type Input } from "../src/sim.ts";

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

describe("the ledge", () => {
  test("a fighter that rises to the ring's lip catches it and climbs on; one tumbling from a hit doesn't", () => {
    const catches = (state: "free" | "stun") => {
      const m = newMatch(skirmisher, tank), [me] = m.f;
      Object.assign(me, { pos: { x: -16.6, y: -0.6, z: 0 }, vel: { x: 0, y: 3, z: 0 }, onGround: false, state, stun: 30 });
      for (let t = 0; t < 10; t++) step(m, [IDLE, IDLE]);
      return me.onGround && Math.hypot(me.pos.x, me.pos.z) < 16;
    };
    expect(catches("free")).toBe(true);
    expect(catches("stun")).toBe(false);
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

describe("fields leave marks", () => {
  // A hit of the given field, landed on a standing target right in front.
  const struck = (field: Field) => {
    const m = newMatch(skirmisher, tank), [me, it] = m.f;
    me.moves.light = { ...me.moves.light, field };
    Object.assign(it, { pos: { x: me.pos.x + 1.2, y: 0, z: 0 }, yaw: Math.PI });
    step(m, [hold({ light: true }), IDLE]);
    for (let t = 0; t < 12 && !m.events.some((e) => e.kind === "hit"); t++) step(m, [IDLE, IDLE]);
    return it;
  };
  test.each([
    ["ember burns", "ember" as Field, (it: Fighter) => it.marks.dot > 0 && it.marks.dotField === "ember"],
    ["venom poisons", "venom" as Field, (it: Fighter) => it.marks.dot > 0 && it.marks.dotField === "venom"],
    ["frost chills", "frost" as Field, (it: Fighter) => it.marks.chill > 0],
    ["grove roots", "grove" as Field, (it: Fighter) => it.marks.root > 0],
  ])("%s", (_name, field, check) => expect(check(struck(field))).toBe(true));

  test("a rooted fighter can't jump, and a burn keeps hurting after the hit", () => {
    const m = newMatch(tank, skirmisher), [rooted, burning] = m.f;
    rooted.marks.root = 30;
    burning.marks = { dot: 60, dotPer: 0.2, dotField: "ember", chill: 0, root: 0 };
    step(m, [hold({ up: true }), IDLE]);
    for (let t = 0; t < 59; t++) step(m, [IDLE, IDLE]);
    expect(rooted.pos.y).toBe(0);
    expect(burning.hp).toBeCloseTo(burning.b.hp - 12, 5);
  });
});

describe("weighty attacks", () => {
  test("a heavy swing spends stamina, can't be cancelled by another button, and leaves you in recovery", () => {
    const m = newMatch(tank, bruiser);
    m.f[1].pos.x = 14; // out of reach, so nothing lands
    const before = m.f[0].stamina;
    step(m, [hold({ heavy: true }), IDLE]);
    expect(m.f[0].state).toBe("attack");
    expect(m.f[0].stamina).toBeLessThan(before);
    const total = frames(m.f[0].moves.heavy);
    expect(total.startup).toBeGreaterThan(frames(m.f[0].moves.light).startup * 2);
    // Mashing light, dash and guard mid-swing changes nothing.
    for (let t = 1; t < total.startup + total.active + total.recovery - 1; t++) {
      step(m, [hold({ light: t % 2 === 0, dash: t % 3 === 0, guard: true }), IDLE]);
      expect(m.f[0].state).toBe("attack");
      expect(m.f[0].act?.move.slot).toBe("heavy");
    }
    step(m, [IDLE, IDLE]);
    expect(m.f[0].state).toBe("free");
  });

  test("swinging dry still swings, but recovers 50% slower", () => {
    const m = newMatch(tank, bruiser);
    m.f[0].stamina = 0.01;
    step(m, [hold({ heavy: true }), IDLE]);
    expect(m.f[0].state).toBe("attack");
    expect(m.f[0].exhausted).toBe(true);
    expect(m.f[0].act?.tired).toBe(true);
    expect(frames(m.f[0].moves.heavy, true).recovery).toBeGreaterThan(frames(m.f[0].moves.heavy).recovery * 1.4);
  });
});

describe("orbiting", () => {
  test("holding sideways circles the opponent at the same gap, facing them the whole way round", () => {
    const m = newMatch(skirmisher, tank), [me, them] = m.f;
    const gap = () => Math.hypot(them.pos.x - me.pos.x, them.pos.z - me.pos.z);
    const bearing = () => Math.atan2(me.pos.z - them.pos.z, me.pos.x - them.pos.x);
    for (let t = 0; t < 30; t++) step(m, [IDLE, IDLE]);
    const gap0 = gap(), b0 = bearing();
    let off = 0;
    for (let t = 0; t < 120; t++) {
      // sideways = a quarter turn off the line to them (what A or D is, camera behind you)
      const a = Math.atan2(them.pos.z - me.pos.z, them.pos.x - me.pos.x) + Math.PI / 2;
      step(m, [hold({ mx: Math.cos(a), mz: Math.sin(a) }), IDLE]);
      const face = Math.atan2(Math.sin(Math.atan2(them.pos.z - me.pos.z, them.pos.x - me.pos.x) - me.yaw), Math.cos(Math.atan2(them.pos.z - me.pos.z, them.pos.x - me.pos.x) - me.yaw));
      if (t > 20) off = Math.max(off, Math.abs(face));
    }
    expect(Math.abs(Math.atan2(Math.sin(bearing() - b0), Math.cos(bearing() - b0)))).toBeGreaterThan(0.6); // went round
    expect(Math.abs(gap() - gap0)).toBeLessThan(gap0 * 0.2);                                              // held the gap
    expect(off).toBeLessThan(0.5);                                                                         // faced them
  });
});
