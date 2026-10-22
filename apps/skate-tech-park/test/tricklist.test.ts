// Journey: the SkateBench trick list, typed into the sim in every park. From each spawn the rider rolls up to speed
// on flat ground, ollies, flicks one trick in the air and lands: the trick must score under its own name, with no bail.
import { expect, setDefaultTimeout, test } from "bun:test";
import { LEVELS } from "../src/levels/index.ts";
import type { ParkLevel } from "../src/levels/park.ts";
import { IDLE, start, step } from "../src/sim.ts";
import { TRICKS, type Flick } from "../src/tricks.ts";
import { build } from "./parks.ts";

setDefaultTimeout(60000);

/** One ollie-and-flick from a spawn: what the sim scored, and whether the rider fell. */
function tryTrick(l: ParkLevel, trick: Flick) {
  const sp = l.spawns[0]!, s = start(sp.x, sp.z, sp.yaw, l), lv = { ...l, obstacles: l.trees };
  let jumped = false, flicked = false, bailed = "", landed = false;
  for (let f = 0; f < 60 * 12 && !landed; f++) {
    const rolling = s.speed > 14 && !s.air && !jumped;
    if (rolling) jumped = true;
    const flick = s.air && s.airTime > 0.15 && !flicked ? trick : null;
    if (flick) flicked = true;
    step(s, { ...IDLE, throttle: 1, boost: !s.air && s.speed < 14, jump: rolling, flick }, lv);
    if (s.bail > 0) { bailed = s.last?.name ?? "bail"; break; }
    if (flicked && !s.air) landed = true;
  }
  return { bailed, landed, tricks: [...s.tricks], last: s.last?.name ?? "" };
}

for (const e of LEVELS.filter((l) => l.id !== "plaza")) {
  test(`${e.id}: every trick on the list lands from the first spawn`, async () => {
    const l = (await build(e)) as ParkLevel, failed: string[] = [];
    for (const trick of Object.keys(TRICKS) as Flick[]) {
      const r = tryTrick(l, trick);
      if (r.bailed || !r.landed || !r.last.startsWith(trick)) failed.push(`${trick}: ${r.bailed || (r.landed ? `scored "${r.last}"` : "never landed")}`);
    }
    expect(failed).toEqual([]);
  });
}
