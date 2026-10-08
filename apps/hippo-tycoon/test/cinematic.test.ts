import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { Cinematic, finaleName, flightDir, STYLES, type CineHooks, type Sfx } from "../src/client/render/cinematic.ts";
import type { HippoRig } from "../src/client/render/hippo.ts";

function rigs() {
  return Array.from({ length: 4 }, (_, i) => {
    const group = new THREE.Group(); group.scale.setScalar(1.3); group.rotation.y = i;
    return { group, belt: false, posed: 0, pose() { this.posed++; }, setChampion(on: boolean) { this.belt = on; } };
  });
}
function setup() {
  const rs = rigs(), log = { popups: [] as string[], sfx: [] as Sfx[], shakes: 0, emits: 0 };
  const hooks: CineHooks = {
    fx: { emit: () => { log.emits++; } } as never,
    popup: (t) => { log.popups.push(t); }, shake: () => { log.shakes++; }, sfx: (s) => { log.sfx.push(s); },
  };
  const c = new Cinematic(rs as unknown as HippoRig[], hooks);
  return { rs, c, log };
}
const run = (c: Cinematic, until: number, step = 1 / 30) => { for (let t = 0; t <= until; t += step) { c.override = t; c.update(0, t); } };

describe("the wrestling finale", () => {
  test("the richest hippo gets the belt and tosses the losers out, last place first, the runner-up to the stars", () => {
    const { rs, c, log } = setup();
    c.start([0, 40, 10, 25], [0, 0, 0, 0], 0);                          // sum 75: the early tosses start at "spin"
    expect(rs.map((r) => r.belt)).toEqual([false, true, false, false]);
    run(c, 2.0 + 3 * 3.0 + 0.5);                                         // intro, three tosses, a moment after
    expect(log.popups.filter((p) => p === "GRABBED!").length).toBe(3);
    expect(log.popups).toContain("AIRPLANE SPIN!");                      // seat 0 had the least: spin first
    expect(log.popups).toContain("SLAMMED!");                            // then seat 2
    expect(log.popups).toContain("TO THE MOON!");                        // the runner-up, seat 3, last
    expect(log.popups.filter((p) => p === "★").length).toBe(1);          // and exactly one star
    expect(log.popups.filter((p) => p.endsWith("IS OUT!")).length).toBe(2);
    expect(log.sfx.filter((s) => s === "bell").length).toBe(1);
    for (const s of ["slam", "whoosh", "splat", "ding"] as Sfx[]) expect(log.sfx).toContain(s);
    expect(rs.map((r) => r.group.visible)).toEqual([false, true, false, false]);   // the losers are gone, the champion stays
  });

  test("another round, another mix: the early tosses start somewhere else", () => {
    const { c, log } = setup();
    c.start([0, 40, 11, 25], [0, 0, 0, 0], 0);                          // sum 76: starts at "slam", then "punt"
    run(c, 12);
    expect(log.popups).toContain("SLAMMED!"); expect(log.popups).toContain("PUNT!"); expect(log.popups).toContain("TO THE MOON!");
    expect(log.popups).not.toContain("AIRPLANE SPIN!");
  });

  test("a tie shares the belt, nobody tied is thrown, and the rest still are", () => {
    const { rs, c, log } = setup();
    c.start([30, 30, 4, 4], [0, 0, 0, 0], 0);
    expect(rs.map((r) => r.belt)).toEqual([true, true, false, false]);
    run(c, 2 + 2 * 3 + 0.5);
    expect(rs.map((r) => r.group.visible)).toEqual([true, true, false, false]);
    expect(log.popups.filter((p) => p === "GRABBED!").length).toBe(2);
  });

  test("everyone tied: a victory dance and no tossing", () => {
    const { rs, c, log } = setup();
    c.start([7, 7, 7, 7], [0, 0, 0, 0], 0);
    run(c, 10);
    expect(rs.every((r) => r.group.visible && r.belt)).toBe(true);
    expect(log.popups).toEqual([]);
  });

  test("it never produces a NaN or a runaway position, and stop() puts everything back", () => {
    const { rs, c } = setup();
    c.start([0, 40, 10, 25], [0.4, -0.2, 0.9, 0], 0);
    for (let t = 0; t <= 12; t += 0.05) {
      c.override = t; c.update(0, t);
      for (const r of rs) {
        const p = r.group.position;
        expect(Number.isFinite(p.x + p.y + p.z)).toBe(true);
        expect(Math.hypot(p.x, p.z)).toBeLessThan(80);
        expect(p.y).toBeLessThan(45);          // the star toss leaves the frame on purpose
      }
    }
    c.stop();
    expect(rs.every((r) => r.group.visible && !r.belt && r.group.scale.x === 1.3 && r.group.rotation.x === 0)).toBe(true);
    expect(c.active).toBe(false);
  });
});

describe("the finale, polished", () => {
  const CAMERA = new THREE.Vector3(0, 14.2 * 1.18, 26.5 * 1.18);          // the gameplay shot at 16:9

  test("the landing popup names the player (or the whole bot name), not the first word of the character", () => {
    const { c, log } = setup();
    const seats = [{ name: "Ryan", human: true }, { name: "Crude Carl", human: false }, { name: "x", human: false }, { name: "A Very Long Display Name Indeed", human: true }];
    c.start([0, 40, 10, 25], [0, 0, 0, 0], 0, { names: seats.map((_, i) => finaleName(i, seats)) });
    run(c, 12);
    const out = log.popups.filter((p) => p.endsWith("IS OUT!"));
    expect(out).toEqual(["RYAN IS OUT!", "BIG BARREL BERTHA IS OUT!"]);           // seat 0 (human), then seat 2 (a bot)
    expect(log.popups.some((p) => p.startsWith("BIG IS OUT"))).toBe(false);
    expect(finaleName(3, seats)).toBe("A VERY LONG DISPL…");
    expect(finaleName(0, [{ name: "   ", human: true }])).toBe("BARON GULPINGTON");  // a blank name falls back
  });

  test("no toss flies at the lens: the camera-side seat is thrown off to the side", () => {
    for (let seat = 0; seat < 4; seat++) {
      const { rs, c } = setup();
      const scores = [10, 10, 10, 10]; scores[seat] = 0; scores[(seat + 1) % 4] = 40;   // `seat` is thrown first, by spin
      for (const style of STYLES) {
        c.stop(); c.start(scores, [0, 0, 0, 0], 0, { styles: [style, style, style] });
        for (let t = 2; t <= 4.5; t += 1 / 60) {
          c.override = t; c.update(0, t);
          const p = rs[seat]!.group.position;
          if (rs[seat]!.group.visible) expect(p.distanceTo(CAMERA)).toBeGreaterThan(12);
        }
      }
    }
    const camSide = flightDir(new THREE.Vector3(0, 0, 8.6));                // seat 0 sits between the pan and the camera
    expect(Math.abs(camSide.x)).toBeGreaterThan(0.9);
    expect(flightDir(new THREE.Vector3(8.6, 0, 0)).x).toBeCloseTo(1);       // the side seats fly straight out
  });

  test("the camera leans in for the grab and pulls back for the star; reduced motion holds it still", () => {
    const { c } = setup();
    c.start([0, 40, 10, 25], [0, 0, 0, 0], 0);
    const at = (t: number) => { c.override = t; c.update(0, t); return c.shot.push; };
    expect(at(1)).toBe(0);                                                  // the intro
    expect(at(2 + 1.0)).toBeGreaterThan(0.3);                               // first toss, mid-grab
    const star = 2 + 2 * 3;                                                 // the runner-up's toss
    expect(at(star + 1.9)).toBeLessThan(-0.5);                              // the launch: pull back
    c.calm = true;
    for (const t of [3, star + 1.9]) expect(at(t)).toBe(0);
  });

  test("Skip jumps to the end with nothing left to fire, and Rematch (stop) puts every rig back", () => {
    const { rs, c, log } = setup();
    c.start([0, 40, 10, 25], [0, 0, 0, 0], 0);
    run(c, 2.6);                                                            // into the first grab
    c.override = null;
    const before = log.popups.length, sfx = log.sfx.length;
    c.skip(5000); c.update(5000, 5);
    expect(c.clock(5000)).toBeCloseTo(c.duration);
    expect(rs.map((r) => r.group.visible)).toEqual([false, true, false, false]);
    for (let now = 5000; now < 9000; now += 33) c.update(now, now / 1000);
    expect(log.popups.length).toBe(before);                                 // no burst of leftover popups or sounds
    expect(log.sfx.length).toBe(sfx);
    expect(c.shot.push).toBe(0);
    c.stop();
    expect(rs.every((r) => r.group.visible && !r.belt && r.group.scale.x === 1.3 && r.group.rotation.x === 0 && r.group.rotation.z === 0)).toBe(true);
    expect(c.active).toBe(false); expect(c.override).toBe(null); expect(c.duration).toBe(0);
  });

  test("pause holds the moment and resume carries on from it", () => {
    const { c } = setup();
    c.start([0, 40, 10, 25], [0, 0, 0, 0], 0);
    c.pause(1500); expect(c.clock(9999)).toBeCloseTo(1.5);
    c.resume(4000); expect(c.clock(5000)).toBeCloseTo(2.5);
  });

  test("when your own seat wins, the finale ends on you; otherwise it names the winner", () => {
    const mine = setup();
    mine.c.start([0, 40, 10, 25], [0, 0, 0, 0], 0, { mine: [1] });
    run(mine.c, mine.c.duration + 1.5);
    expect(mine.log.popups).toContain("YOU'RE THE TYCOON!");
    expect(mine.log.popups).toContain("CARL TAKES IT ALL!");                // the champion's opening line
    expect(mine.c.shot.push).toBeGreaterThan(0.3);                          // the hero shot
    expect(mine.rs[1]!.group.rotation.y).toBeCloseTo(Math.PI, 1);           // turned to the crowd (the camera)

    const theirs = setup();
    theirs.c.start([0, 40, 10, 25], [0, 0, 0, 0], 0, { mine: [0] });
    run(theirs.c, theirs.c.duration + 1.5);
    expect(theirs.log.popups).not.toContain("YOU'RE THE TYCOON!");
    expect(theirs.log.popups).toContain("CRUDE CARL WINS");
  });

  test("reduced motion: the losers fly without tumbling and nobody shivers", () => {
    const { rs, c } = setup();
    c.calm = true;
    c.start([0, 40, 10, 25], [0, 0, 0, 0], 0);
    const star = 2 + 2 * 3;                                                 // the runner-up (seat 3) goes last, to the stars
    for (let t = 0; t < star + 2.4; t += 1 / 30) {
      c.override = t; c.update(0, t);
      const r = rs[3]!.group.rotation;
      if (t < star) expect(r.z).toBe(0);                                    // cowering: no shiver
      if (t >= star + 1.5) expect([r.x, r.z]).toEqual([0, 0]);              // flying: no tumble
    }
  });
});
