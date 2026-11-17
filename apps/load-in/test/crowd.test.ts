// The crowd as a player meets it in the dive bar: tops on their stands at the lowest, 1.2 m, aimed at the room and the
// sub on stage pass at soundcheck. The doors open and ninety people pack in: the back hears the tops through every row
// of heads, goes quiet and dull, the score with the room full drops under the pass and the back drifts forward. Raise
// the stands so the tops fire over the heads, push the fader 2 dB, and the back comes back and dances. The same calls
// `window.loadIn` makes (doors() lets the crowd in through the bar view's `letIn`).
import { expect, test } from "bun:test";
import { newWorld, pickUp, putDown, type World, walkTo } from "../src/sim.ts";
import { CROWD, DIVE_BAR, PASS, aim, crowdState, master, raise, scores, settle } from "../src/venues/dive-bar.ts";
import { expectTonight, letIn } from "../src/crowd/crowd.ts";
import { hear, switchedOnIsFed } from "../src/audio/hear.ts";

const DEG = Math.PI / 180;

function carry(w: World, key: string, x: number, z: number) {
  const i = w.items.find((o) => o.key === key)!;
  walkTo(w, i.x, i.z + 0.9);
  w.you.yaw = 0;
  expect(pickUp(w, key)).toEqual({ ok: true });
  walkTo(w, x, z);
  w.you.yaw = 0;
  expect(putDown(w)).toEqual({ ok: true });
  settle(w);
}

test("tops at 1.2 m pass soundcheck, lose the back once the room is full, and win it back raised over the heads", () => {
  const w = newWorld(DIVE_BAR), at = (key: string) => w.items.find((i) => i.key === key)!;
  carry(w, "stand-l", -1.7, 2.0);
  carry(w, "stand-r", 1.7, 2.0);
  carry(w, "top-l", -1.7, 1.95);
  carry(w, "top-r", 1.7, 1.95);
  carry(w, "sub", 0.4, 1.3);
  walkTo(w, -1.0, 2.4);
  expect(aim(w, "top-l", { turn: 30 * DEG - at("top-l").rot })).toEqual({ ok: true });
  walkTo(w, 1.0, 2.4);
  expect(aim(w, "top-r", { turn: -at("top-r").rot })).toEqual({ ok: true });

  // Soundcheck, the room empty: it passes, and the score expected with the room full is already short.
  const check = scores(w);
  expect(check.soundcheck.pass).toBe(true);
  expect(check.full.score).toBeLessThan(PASS);

  // An empty walk to the back of the crowd area and back to the stage, to time against a full room.
  const open = walkTo(w, 0.5, 8) + walkTo(w, 1.0, 2.4);
  // Where the back of the crowd will stand: the tops' highs as they reach you, empty.
  walkTo(w, 0.5, 8);
  const emptyBack = hear(w, new Set(["top-l", "top-r", "sub"]), switchedOnIsFed);

  // On tour, the floor holds what the tour says is coming (an early night: forty), not the full ninety.
  const early = newWorld(DIVE_BAR);
  expectTonight(early, 40);
  expect(letIn(early, CROWD).people).toBe(40);

  // Doors: ninety in, packed at the stage. The room tightens (Sabine) and the crowd is loud on its own.
  letIn(w, CROWD);
  const room = crowdState(w);
  expect(room.count).toBe(90);
  expect(room.full.rt60).toBeLessThan(room.empty.rt60 / 2);
  expect(room.full.noise).toBeGreaterThan(85);

  // At the back, the same speakers are quieter and duller through the heads; the bass the sub plays is untouched.
  const fullBack = hear(w, new Set(["top-l", "top-r", "sub"]), switchedOnIsFed);
  expect(fullBack.high!).toBeLessThan(emptyBack.high! - 2);
  expect(fullBack.speakers.find((s) => s.key === "top-r")!.brightHz).toBeLessThan(emptyBack.speakers.find((s) => s.key === "top-r")!.brightHz);
  expect(fullBack.low).toBe(emptyBack.low);
  expect(fullBack.room?.people).toBe(90);

  // The back region hears less than at soundcheck and drifts toward the stage; the show's score drops.
  const back = room.regions.find((r) => r.name === "back")!;
  expect(back.full!).toBeLessThan(back.soundcheck!);
  expect(back.doing).toBe("drifting forward");
  expect(scores(w).full.pass).toBe(false);

  // Walking back to the stage through the crowd is slower than the empty walk.
  expect(walkTo(w, 1.0, 2.4) + walkTo(w, 0.5, 8) + walkTo(w, 1.0, 2.4)).toBeGreaterThan(open * 1.5);

  // Raise both stands to 2 m (the tops fire over the heads) and push the fader 2 dB.
  walkTo(w, 1.0, 2.4);
  expect(raise(w, "stand-r", 2.0)).toEqual({ ok: true });
  walkTo(w, -1.0, 2.4);
  expect(raise(w, "stand-l", 2.0)).toEqual({ ok: true });
  master(w, -12);
  const fixed = crowdState(w);
  expect(scores(w).full.pass).toBe(true);
  expect(fixed.regions.map((r) => r.doing)).toEqual(["dancing", "dancing", "dancing"]);
});
