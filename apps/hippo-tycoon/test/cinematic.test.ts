import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { Cinematic, type CineHooks, type Sfx } from "../src/client/render/cinematic.ts";
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
