// The witch's five shadow-boxing on their cards (src/spar.ts): the drills run on the fight's own sim, so a quick
// beast covers more floor than a heavy one, and no drill ever drops a beast off the ring (a fallen one is an empty window).
import { expect, test } from "bun:test";
import { STARTERS } from "../src/journey.ts";
import { creature } from "../src/roster.ts";
import { ARENA, HZ } from "../src/sim.ts";
import { DRILLS, sparMatch, sparStep, STATS, type Drill, type Stat } from "../src/spar.ts";

const drill = (stat: Stat): Drill => ({ stat, beat: 0, left: DRILLS[stat][0]![1] });

test("on the speed drill the jackalope runs further than the hodag", () => {
  const far = (id: string) => {
    let m = sparMatch(creature(id)), most = 0;
    const d = drill("speed"), x0 = m.f[0].pos.x;
    for (let t = 0; t < 60; t++) { m = sparStep(m, d, "speed"); most = Math.max(most, m.f[0].pos.x - x0); }
    return most;
  };
  expect(far("jackalope")).toBeGreaterThan(far("hodag") * 1.3);
});

test("every starter goes round all six drills for a minute and stays on the ring", () => {
  for (const id of STARTERS) {
    let m = sparMatch(creature(id));
    const d = drill("speed"), seen = new Set<Stat>();
    for (let t = 0; t < 60 * HZ; t++) {
      m = sparStep(m, d, null);
      seen.add(d.stat);
      const { x, z } = m.f[0].pos;
      if (Math.hypot(x, z) > ARENA.radius) throw new Error(`${id} left the ring on ${d.stat} at tick ${t}`);
    }
    expect([...seen].sort()).toEqual([...STATS].sort());
  }
});
