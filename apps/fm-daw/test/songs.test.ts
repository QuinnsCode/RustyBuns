import { expect, test } from "bun:test";
import { fromAddress } from "../src/songs.ts";

test("?song= opens that song, ?track= selects the track as numbered on screen", () => {
  const got = fromAddress("?song=wobble-lab&track=6");
  expect([got?.project.bpm, got?.project.tracks[got.track]?.name]).toEqual([140, "Wobble"]);
  expect(fromAddress("?song=wobble-lab&track=99")?.track).toBe(0);
  expect(fromAddress("?song=nope")).toBeNull();
  expect(fromAddress("")).toBeNull();
});
