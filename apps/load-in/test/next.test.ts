// The garage's first minute, as a new player plays it, with the Next line (src/next.ts) read at every step: it points
// at the cab out on the driveway, follows you in with it, sends you to the road case for a cable, then to each switch.
import { expect, test } from "bun:test";
import { newWorld, pickUp, putDown } from "../src/sim.ts";
import { newCables, plug, takeCable, walkWith } from "../src/cables/cables.ts";
import { idlePrompt, nextStep } from "../src/next.ts";
import { strike } from "../src/strike.ts";
import { DIVE_BAR } from "../src/venues/dive-bar.ts";

test("the Next line walks a new player through the garage's first minute", () => {
  const w = newWorld(), c = newCables(w), on = new Set<string>(), next = () => nextStep(w, c, on);
  // The centre prompt, looking at nothing: quiet while there's setting up to do, so it never argues with the Next line.
  const prompt = () => idlePrompt(w, c, on, { doors: false, open: false });
  expect(prompt()).toBe("");

  expect(next()).toEqual({ text: "Bring the guitar speaker cabinet in", key: "cab-4x12" });
  walkWith(w, c, 0.9, 8.6);
  w.you.yaw = 0;
  expect(pickUp(w, "cab-4x12")).toEqual({ ok: true });
  expect(next()?.text).toBe("Carry the guitar speaker cabinet inside");
  walkWith(w, c, -0.4, 1.4);
  expect(next()?.text).toBe("Set it down where it goes: F");
  expect(putDown(w)).toEqual({ ok: true });

  expect(next()).toEqual({ text: "Take a cable from the road case: F", key: "case" });
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
