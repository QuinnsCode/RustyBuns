// The garage's first minute, as a new player plays it, with the Next line (src/next.ts) read at every step: it points
// at the cab out on the driveway, follows you in with it, sends you to the cable case for a cable, then to each switch.
// Till the cab is in your hands the screen shows only the Next line (`begun`: no score card yet).
import { expect, test } from "bun:test";
import { newWorld, pickUp, putDown } from "../src/sim.ts";
import { newCables, plug, takeCable, walkWith } from "../src/cables/cables.ts";
import { begun, idlePrompt, nextStep, towardMark, towardName } from "../src/next.ts";
import { strike } from "../src/strike.ts";
import { DIVE_BAR } from "../src/venues/dive-bar.ts";

test("the Next line walks a new player through the garage's first minute", () => {
  const w = newWorld(), c = newCables(w), on = new Set<string>(), next = () => nextStep(w, c, on);
  // The centre prompt, looking at nothing: quiet while there's setting up to do, so it never argues with the Next line.
  const prompt = () => idlePrompt(w, c, on, { doors: false, open: false });
  expect(prompt()).toBe("");
  expect(begun(w, c)).toBe(false);

  expect(next()).toEqual({ text: "Bring the guitar speaker cabinet in", key: "cab-4x12" });
  walkWith(w, c, 0.9, 8.6);
  w.you.yaw = 0;
  expect(pickUp(w, "cab-4x12")).toEqual({ ok: true });
  expect(begun(w, c)).toBe(true);
  expect(next()?.text).toBe("Carry the guitar speaker cabinet inside");
  walkWith(w, c, -0.4, 1.4);
  expect(next()?.text).toBe("Set it down where it goes: F");
  expect(putDown(w)).toEqual({ ok: true });

  expect(next()).toEqual({ text: "Take a cable from the cable case: F", key: "case" });
  walkWith(w, c, -1.6, 3.2);
  expect(takeCable(w, c, "power")).toEqual({ ok: true });
  expect(next()?.text).toBe("Plug it in: look at a jack and press F");
  walkWith(w, c, -2.2, 0.6);
  expect(plug(w, c, "outlet", "power-out-1")).toEqual({ ok: true });

  // Then each switch in the garage, one at a time, until there's nothing left to say.
  for (const [key, what] of [["amp-head", "guitar amp head"], ["cab-4x12", "guitar speaker cabinet"], ["top", '12" two-way powered speaker']]) {
    expect(next()).toEqual({ text: `Switch on the ${what}: look at it, press P`, key });
    on.add(key);
  }
  expect(next()).toBeNull();

  // Set up and playing: now the show can be struck, and once it is, the truck shut.
  expect(prompt()).toBe("L strike and load out");
  expect(strike(w)).toEqual({ ok: true });
  expect(prompt()).toBe("T shut the truck");
});

test("at a venue with doors, L strike waits for the doors to open", () => {
  const w = newWorld(DIVE_BAR), c = newCables(w), on = new Set<string>();
  expect(idlePrompt(w, c, on, { doors: true, open: false })).toBe("");
  expect(idlePrompt(w, c, on, { doors: true, open: true })).toBe("L strike and load out");
});

test("in the dive bar the stands go to their tape on the stage, then the speakers onto them, then the cable case", () => {
  const w = newWorld(DIVE_BAR), c = newCables(w), on = new Set<string>(), next = () => nextStep(w, c, on);
  // The stand nearest the door first, sent to its tape mark (the arrow names the tape), then the other.
  expect(next()).toEqual({ text: "Take stand R to its tape on the stage: F", key: "stand-r", at: { x: 1.7, z: 2.0 } });
  for (const [stand, x] of [["stand-r", 1.7], ["stand-l", -1.7]] as const) {
    const s = w.items.find((i) => i.key === stand)!;
    walkWith(w, c, s.x - 0.9, s.z);
    w.you.yaw = -Math.PI / 2;
    expect(pickUp(w, stand)).toEqual({ ok: true });
    expect(next()).toEqual({ text: "Set it on its tape on the stage: F", at: { x, z: 2.0 } });
    expect(towardMark(w, { x, z: 2.0 })).toMatch(new RegExp(`^tape for stand ${stand.slice(-1).toUpperCase()}, \\d+ m$`));
    Object.assign(s, { x, z: 2.0 });
    w.held = null;
  }
  expect(next()).toEqual({ text: "Grab TOP R: F", key: "top-r", to: "stand-r" });
  walkWith(w, c, -0.4, 11.2);
  w.you.yaw = 0;
  expect(pickUp(w, "top-r")).toEqual({ ok: true });
  expect(next()).toEqual({ text: "Carry it to the stand: F sets it on", key: "stand-r", to: "stand-r" });
  // The edge arrow names the stand as the speaker's, and how far it is, not the stand's catalogue line.
  expect(towardName(w, c, "stand-r")).toMatch(/^stand for TOP R, \d+ m$/);
  expect(towardName(w, c, "top-l")).toMatch(/^TOP L, \d+ m$/);
  // Both tops up on their stands (the dive bar's settle puts a top on the pole it is set over).
  for (const [top, stand] of [["top-r", "stand-r"], ["top-l", "stand-l"]] as const) {
    w.held = null;
    const s = w.items.find((i) => i.key === stand)!;
    Object.assign(w.items.find((i) => i.key === top)!, { x: s.x, z: s.z, y: 1.2 });
  }
  expect(next()).toEqual({ text: "Take a cable from the cable case: F", key: "case-1" });
});
