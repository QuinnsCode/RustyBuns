// MIDI out to your own DAW: track N's notes go out on channel N, and panic lets go of every channel.
import { expect, test } from "bun:test";
import { allOffBytes, noteBytes } from "../src/ui/midi-out.ts";

test.each([
  // on, track, note, velocity -> bytes
  [true, 0, 60, 1, [0x90, 60, 127]],      // track 1, channel 1, full velocity
  [true, 11, 36, 0.5, [0x9b, 36, 64]],    // track 12, channel 12
  [true, 3, 64, 0, [0x93, 64, 1]],        // a silent touch still sounds: velocity 0 would read as note off
  [false, 6, 67, 0, [0x86, 67, 0]],       // note off on channel 7
  [true, 2, 130, 0.8, [0x92, 127, 102]],  // a drum root shifted past the top stays a note
] as const)("note on=%p track %p note %p vel %p", (on, track, midi, vel, bytes) => {
  expect(noteBytes(on, track, midi, vel)).toEqual([...bytes]);
});

test("panic sends all notes off on all sixteen channels", () => {
  const all = allOffBytes();
  expect(all).toHaveLength(16);
  expect(all[0]).toEqual([0xb0, 123, 0]);
  expect(all[15]).toEqual([0xbf, 123, 0]);
});
