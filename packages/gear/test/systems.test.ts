// The open-air rigs (systems.ts): what a crew has to bring for them.
import { expect, test } from "bun:test";
import { SYSTEMS, ampChannels } from "../src/index.ts";

test("a rig takes an amp channel a way of every passive box; a powered box brings its own", () => {
  // the horn stack: bin, mid-bass, and a two-way mid-high horn, a stack
  expect(ampChannels(SYSTEMS["dance-stack"], 4)).toBe(16);
  // tri-amped tops over a single-way bass bin
  expect(ampChannels(SYSTEMS["tri-amp"], 2)).toBe(8);
  // every box of the line array is powered, its subs too: no amp rack at all
  expect(ampChannels(SYSTEMS["line-array"], 4)).toBe(0);
});
