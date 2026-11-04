import { describe, expect, test } from "bun:test";
import { play, rate } from "../scripts/tune.ts";
import { creature, ROSTER, type Creature } from "../src/roster.ts";
import type { Field } from "../src/fields.ts";
import { BUFFER, COST, frames, HANG, IDLE, newMatch, ORBIT, RED, step, type Fighter, type Input } from "../src/sim.ts";
import type { Move } from "../src/moves.ts";
import { bot } from "../src/bot.ts";
import { ledgeOff } from "../src/beasts.ts";

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
  /** The hare rising to the ring's lip from just below it, in `state`. */
  const rising = (state: "free" | "stun" = "free") => {
    const m = newMatch(skirmisher, tank), [me] = m.f;
    Object.assign(me, { pos: { x: -16.6, y: -0.6, z: 0 }, vel: { x: 0, y: 0.5, z: 0 }, onGround: false, state, stun: 30 });
    for (let t = 0; t < 10; t++) step(m, [IDLE, IDLE]);
    return { m, me };
  };

  test("a fighter that reaches the lip hangs on it facing the ring, safe at first, and climbs, rolls in or comes up swinging; one tumbling from a hit doesn't catch it", () => {
    expect(rising("stun").me.state).not.toBe("ledge");
    for (const [press, want, off] of [["up", "free", "climb"], ["dash", "free", "roll"], ["light", "attack", "swing"]] as const) {
      const { m, me } = rising();
      expect([me.state, me.invuln > 0, Math.abs(me.yaw) < 0.01]).toEqual(["ledge", true, true]);
      step(m, [hold({ [press]: true }), IDLE]);
      // the puppet tells the three ways off apart by what the sim left behind
      expect([me.state, me.onGround, Math.hypot(me.pos.x, me.pos.z) < 16, ledgeOff(me)]).toEqual([want, true, true, off]);
    }
    // The roll comes in further than the climb.
    const climb = rising(), roll = rising();
    step(climb.m, [hold({ up: true }), IDLE]); step(roll.m, [hold({ dash: true }), IDLE]);
    expect(Math.hypot(roll.me.pos.x, roll.me.pos.z)).toBeLessThan(Math.hypot(climb.me.pos.x, climb.me.pos.z) - 2);
  });

  test("hang too long and you drop; the second grab before you've stood again isn't safe", () => {
    const { m, me } = rising();
    for (let t = 0; t < HANG.max + 2; t++) step(m, [IDLE, IDLE]);
    expect(me.state).not.toBe("ledge");
    Object.assign(me, { pos: { x: -16.6, y: -0.6, z: 0 }, vel: { x: 0, y: 0.5, z: 0 }, drop: 0, invuln: 0 });
    for (let t = 0; t < 10; t++) step(m, [IDLE, IDLE]);
    expect([me.state, me.invuln]).toEqual(["ledge", 0]);
  });

  test("a heavy from the lip on someone hanging there spikes them down and off", () => {
    const { m, me } = rising(), them = m.f[1];
    for (let t = 0; t < HANG.safe + 2; t++) step(m, [IDLE, IDLE]); // the safe frames run out
    Object.assign(them, { pos: { x: -16 + them.b.radius + 0.4, y: 0, z: 0 }, yaw: Math.PI, spin: 0 });
    let spiked = false;
    step(m, [IDLE, hold({ heavy: true })]);
    for (let t = 0; t < 4 * 60 && !m.over; t++) { step(m, [IDLE, IDLE]); spiked ||= m.events.some((e) => e.kind === "hit" && e.spike); }
    expect(spiked).toBe(true);
    expect(m.winner).toBe(1);
    expect(me.pos.y).toBeLessThan(-5);
  });
});

describe("nothing hides in the air", () => {
  test("a flyer that holds altitude runs out of stamina and comes down", () => {
    const m = newMatch(flyer, skirmisher);
    for (let t = 0; t < 20; t++) step(m, [hold({ up: t < 12 }), IDLE]); // jump, held for the full height
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

describe("squaring up", () => {
  /** Holds sideways round the other fighter for `ticks`; how far round it went (radians). */
  function circle(me: Creature, them: Creature, ticks: number) {
    const m = newMatch(me, them), [f, o] = m.f;
    f.pos.x = o.pos.x - (f.b.radius + o.b.radius + 2); // at arm's length, where circling is the dance it's meant to stop
    for (let t = 0; t < 30; t++) step(m, [IDLE, IDLE]);
    const bearing = () => Math.atan2(f.pos.z - o.pos.z, f.pos.x - o.pos.x), b0 = bearing();
    let went = 0, prev = b0;
    for (let t = 0; t < ticks; t++) {
      const a = Math.atan2(o.pos.z - f.pos.z, o.pos.x - f.pos.x) + Math.PI / 2;
      step(m, [hold({ mx: Math.cos(a), mz: Math.sin(a) }), IDLE]);
      went += Math.atan2(Math.sin(bearing() - prev), Math.cos(bearing() - prev)); prev = bearing();
    }
    return { m, f, went: Math.abs(went) };
  }

  test("a small quick body circles far faster than a big slow one, and both are slower sideways than straight", () => {
    const quick = circle(skirmisher, tank, 120), slow = circle(tank, skirmisher, 120);
    expect(quick.went).toBeGreaterThan(slow.went * 2.5);
    expect(quick.f.b.lateral).toBeLessThan(1);
    expect(slow.f.b.lateral).toBeLessThan(0.3);
  });

  test("keep circling and it costs pace and stamina; stand and square up and the cost goes away", () => {
    const { m, f } = circle(skirmisher, tank, 5 * 60);
    expect(Math.abs(f.orbit)).toBeGreaterThan(ORBIT.free);
    expect(f.stamina).toBeLessThan(f.b.stamina * 0.8);
    for (let t = 0; t < 8 * 60; t++) step(m, [IDLE, IDLE]);
    expect(Math.abs(f.orbit)).toBe(0);
    expect(f.stamina).toBe(f.b.stamina);
  });

  test("turning has momentum: a big body takes longer to face back round than a quick one", () => {
    const flipTime = (me: Creature) => {
      const m = newMatch(me, tank), f = m.f[0];
      f.yaw = Math.PI; // back to them
      let t = 0;
      for (; t < 240 && Math.abs(Math.atan2(Math.sin(f.yaw), Math.cos(f.yaw))) > 0.2; t++) step(m, [IDLE, IDLE]);
      return t;
    };
    expect(flipTime(tank)).toBeGreaterThan(flipTime(skirmisher) * 2);
  });
});

describe("red health", () => {
  /** The tank lands a light on the hare standing in front of it. */
  function jab(m: ReturnType<typeof newMatch>) {
    m.f[1].pos = { x: m.f[0].pos.x + m.f[0].b.radius + m.f[1].b.radius + 0.3, y: 0, z: 0 }; m.f[1].vel = { x: 0, y: 0, z: 0 }; m.f[0].yaw = 0; m.f[0].spin = 0;
    const before = m.f[1].hp;
    step(m, [hold({ light: true }), IDLE]);
    for (let t = 0; t < 40 && m.f[1].hp === before; t++) step(m, [IDLE, IDLE]);
    for (let t = 0; t < 40 && m.f[0].state !== "free"; t++) step(m, [IDLE, IDLE]);
  }
  const close = () => newMatch(tank, skirmisher);

  test("part of a hit comes back if you get clear, and a second hit soon after makes it real", () => {
    const m = close(), f = m.f[1];
    jab(m);
    const lost = f.b.hp - f.hp;
    expect(f.red).toBeCloseTo(lost * RED.share, 5);
    for (let t = 0; t < RED.wait + 5 * 60; t++) step(m, [IDLE, IDLE]);
    expect(f.hp).toBeCloseTo(f.b.hp - lost * (1 - RED.share), 5);

    const n = close(), g = n.f[1];
    jab(n);
    const first = g.b.hp - g.hp;
    jab(n);
    const after = g.b.hp - g.hp;
    expect(after).toBeGreaterThan(first * 1.5);
    for (let t = 0; t < RED.wait + 10 * 60; t++) step(n, [IDLE, IDLE]);
    // Only the second hit's red came back; the first one's turned real.
    expect(g.b.hp - g.hp).toBeGreaterThan(after * (1 - RED.share) + 0.5);
  });
});

describe("the bruiser bot", () => {
  test("swings at a target caught in its recovery, and otherwise keeps moving around it", () => {
    const m = newMatch(bruiser, tank), me = bot(0, 1);
    const reach = m.f[0].b.radius + m.f[1].b.radius + 1;
    m.f[0].pos = { x: 0, y: 0, z: 0 }; m.f[1].pos = { x: reach, y: 0, z: 0 }; m.f[0].yaw = 0;
    m.f[1].state = "attack"; m.f[1].act = { move: m.f[1].moves.heavy, hit: false, dive: false };
    m.f[1].t = 999; // well into its recovery
    let swung = false;
    for (let k = 0; k < 6; k++) { const i = me(m); swung ||= i.heavy || i.light; }
    expect(swung).toBe(true);

    const free = newMatch(bruiser, tank), b = bot(0, 2), bearing = () => Math.atan2(free.f[0].pos.z - free.f[1].pos.z, free.f[0].pos.x - free.f[1].pos.x);
    free.f[0].pos = { x: -8, y: 0, z: 0 }; free.f[1].pos = { x: 0, y: 0, z: 0 };
    for (let k = 0; k < 60 && free.f[0].state !== "attack"; k++) step(free, [b(free), IDLE]);
    expect(Math.abs(bearing() - Math.PI)).toBeGreaterThan(0.01);
  });
});

describe("tight like a platform fighter", () => {
  test("a press made in a heavy's recovery goes off on the first free frame", () => {
    const m = newMatch(tank, bruiser), [me] = m.f;
    m.f[1].pos.x = 14;
    step(m, [hold({ heavy: true }), IDLE]);
    const fr = frames(me.moves.heavy), end = fr.startup + fr.active + fr.recovery;
    for (let t = 1; t < end - 3; t++) step(m, [IDLE, IDLE]);
    step(m, [hold({ light: true }), IDLE]); // a few frames early: kept, not lost
    let swung = -1;
    for (let t = 0; t < BUFFER && swung < 0; t++) { step(m, [IDLE, IDLE]); if (me.act?.move.slot === "light") swung = t; }
    expect(swung).toBeGreaterThanOrEqual(0);
  });

  test("a tapped jump is a short hop, a held one goes higher, and guard in the air brings you down sooner", () => {
    const flight = (input: (t: number) => Partial<Input>) => {
      const m = newMatch(bruiser, tank), [me] = m.f;
      let peak = 0, t = 0;
      do { step(m, [hold(input(t)), IDLE]); peak = Math.max(peak, me.pos.y); t++; } while (!me.onGround && t < 200);
      return { peak, frames: t };
    };
    const tap = flight((t) => ({ up: t === 0 })), full = flight(() => ({ up: true })), drop = flight((t) => ({ up: t < 40, guard: t >= 20 }));
    expect(full.peak).toBeGreaterThan(tap.peak * 1.5);
    expect(drop.frames).toBeLessThan(full.frames);
  });

  test("a light that lands can be pressed again before its recovery ends: a jab string", () => {
    const m = newMatch(skirmisher, tank), [me, it] = m.f;
    Object.assign(it, { pos: { x: me.pos.x + 1.2, y: 0, z: 0 }, yaw: Math.PI });
    step(m, [hold({ light: true }), IDLE]);
    const fr = frames(me.moves.light);
    for (let t = 1; t < fr.startup + fr.active; t++) step(m, [IDLE, IDLE]);
    expect(me.act?.hit).toBe(true);
    step(m, [hold({ light: true }), IDLE]);
    expect(me.t).toBeLessThan(fr.startup); // a fresh swing, not the old one's recovery
  });
});

describe("ranged moves are shapes on the ground", () => {
  // The caster fires from the left at a target on its right; `dodge` is what the target holds from the press on.
  // Returns who took a hit from the move.
  const fire = (caster: Creature, slot: "special" | "ultimate", gap: number, dodge: Partial<Input>) => {
    const m = newMatch(caster, skirmisher), [me, it] = m.f;
    Object.assign(me, { pos: { x: -gap / 2, y: 0, z: 0 }, yaw: 0, energy: 100 });
    Object.assign(it, { pos: { x: gap / 2, y: 0, z: 0 }, yaw: Math.PI });
    const struck = new Set<number>();
    step(m, [hold({ [slot]: true }), hold(dodge)]);
    for (let t = 0; t < 150; t++) { step(m, [IDLE, hold(dodge)]); for (const e of m.events) if (e.kind === "hit") struck.add(e.on); }
    return [...struck].sort();
  };
  test.each([
    // A narrow column (the field special) goes where they stood at the press: standing still is hit, a sidestep isn't.
    ["a column hits a target that stands", tank, "special", 8, {}, [1]],
    ["a sidestep dodges a narrow column", tank, "special", 8, { mz: 1 }, []],
    // A lobbed blast lands on the spot they stood when it left: stepping back out of the ring leaves it.
    ["a blast lands on a target that stands", bruiser, "ultimate", 8, {}, [1]],
    ["a step back leaves a blast", bruiser, "ultimate", 8, { mx: 1 }, []],
    // Your own blast catches you too when you stand where it lands.
    ["a blast lobbed at close range catches its caster too", bruiser, "ultimate", 2, {}, [0, 1]],
  ] as const)("%s", (_name, caster, slot, gap, dodge, hurt) => expect(fire(caster, slot, gap, dodge)).toEqual([...hurt]));
});

describe("tempo: charges, streams and fades", () => {
  // The caster stands on the left facing a target `gap` m away that stands still; `press(t)` is what the caster holds
  // on tick t. Returns the hits the target took and the caster.
  const play = (caster: Creature, gap: number, press: (t: number) => Partial<Input>, ticks = 240, tempo?: Move["tempo"]) => {
    const m = newMatch(caster, tank), [me, it] = m.f;
    Object.assign(me, { pos: { x: -gap / 2, y: 0, z: 0 }, yaw: 0, energy: 100 });
    Object.assign(it, { pos: { x: gap / 2, y: 0, z: 0 }, yaw: Math.PI });
    if (tempo) me.moves.beam = { ...me.moves.beam, tempo };
    const hits: number[] = [];
    for (let t = 0; t < ticks; t++) { step(m, [hold(press(t)), IDLE]); for (const e of m.events) if (e.kind === "hit" && e.on === 1) hits.push(e.damage); }
    return { hits, me };
  };

  test("a held strong waits at the end of its wind-up and lands harder than a tap", () => {
    const tap = play(bruiser, 2.6, (t) => ({ heavy: t < 2 })), full = play(bruiser, 2.6, (t) => ({ heavy: t < 90 }));
    expect(tap.hits).toHaveLength(1);
    expect(full.hits).toHaveLength(1);
    expect(full.hits[0]!).toBeGreaterThan(tap.hits[0]! * 1.3);
  });

  test("the Big button fires the beam slot; a full charge reaches a target a tap falls short of, and pays on release", () => {
    const tap = play(bruiser, 17, (t) => ({ big: t < 2 })), full = play(bruiser, 17, (t) => ({ big: t < 120 }));
    expect(tap.hits).toEqual([]);
    expect(full.hits).toHaveLength(1);
    expect(play(bruiser, 17, () => ({ big: true }), 60).me.energy).toBe(100); // still charging: nothing paid yet
    // Special no longer turns into the beam when you move at them.
    const special = play(bruiser, 6, (t) => ({ special: t < 2, mx: 1 }), 60);
    expect(special.me.energy).toBeGreaterThan(100 - COST.beam); // paid the special's 15, not the beam's 35
  });

  test("a breath held keeps pouring and hitting, roaring up and draining energy; let go and it stops", () => {
    const short = play(tank, 5, (t) => ({ big: t < 2 })), long = play(tank, 5, (t) => ({ big: t < 200 }));
    expect(long.hits.length).toBeGreaterThan(short.hits.length + 4);
    expect(long.hits.at(-1)!).toBeGreaterThan(long.hits[0]!); // it roars up
    expect(long.me.energy).toBeLessThan(short.me.energy);
  });

  test("a fade's big hit lands first, then weaker ones until it sputters out", () => {
    const { hits } = play(bruiser, 6, (t) => ({ big: t < 2 }), 240, { kind: "fade", run: 1.5, to: 0.2 });
    expect(hits.length).toBeGreaterThan(2);
    expect(Math.max(...hits.slice(1))).toBeLessThan(hits[0]! * 0.6);
  });

  test("where the target stands decides the damage: a column hits harder close than at its tip", () => {
    const near = play(bruiser, 3, (t) => ({ special: t < 2 }), 90), far = play(bruiser, 10, (t) => ({ special: t < 2 }), 90);
    expect(near.hits[0]!).toBeGreaterThan(far.hits[0]! * 1.3);
  });
});
