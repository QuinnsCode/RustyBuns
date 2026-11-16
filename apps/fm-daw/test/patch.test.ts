// Gear on cables (src/circuit/patch.ts): what Q Amp's patch view does with a patch,
// from the stage as it comes through a pulled cable and back, and `compile`'s problems.
import { expect, setDefaultTimeout, test } from "bun:test";
import { AMPS } from "../src/circuit/amps.ts";
import { riff } from "../src/circuit/riff.ts";
import { STAGE, compile, heard, type Cable, type Patch } from "../src/circuit/patch.ts";
import { FULL_SCALE, applySettings } from "../src/amp/live.ts";

setDefaultTimeout(60_000);
const SR = 48000;

/** What the speakers put out for a patch, as the page does it: compile, then the rig, muted when nothing gets through. */
function play(patch: Patch) {
  const compiled = compile(patch), sound = heard(patch, compiled);
  const live = applySettings({ amp: "brit", pedal: sound.pedals ? "drive" : null, drive: 5, knobs: { ...AMPS[0].knobs }, bypass: false, oversample: 2, swaps: {}, mic: { at: 0.3, angle: 0 } }, null, SR);
  const dry = riff(SR).subarray(0, SR / 4), out = new Float32Array(dry.length);
  live.rig.process(dry, out);
  const peak = sound.audible ? Math.max(...out.map((v) => Math.abs(v / FULL_SCALE))) : 0;
  return { peak, links: live.rig.levels().length, problems: compiled.problems.map((p) => p.kind), chains: compiled.chains };
}
const pull = (p: Patch, item: string, jack: string): Patch => ({
  ...p, cables: p.cables.filter((c) => ![c.from, c.to].some(([i, j]) => i === item && j === jack)),
});
const plug = (p: Patch, c: Cable): Patch => ({ ...p, cables: [...p.cables, c] });

test("the riff through pedalboard, amp and cab; pull the speaker cable, then patch round the pedalboard", () => {
  const stage = play(STAGE);
  expect(stage.chains).toEqual([["guitar", "pedalboard", "head", "cab"]]);
  expect(stage.problems).toEqual([]);
  expect(stage.peak).toBeGreaterThan(0.05);
  const withPedal = stage.links;

  // Pull the speaker cable out of the amp: silence, and the amp says why.
  const noCab = pull(STAGE, "head", "speaker");
  expect(play(noCab)).toMatchObject({ peak: 0, chains: [], problems: ["no-speaker"] });

  // Run the guitar straight into the cabinet: an instrument cable in a speaker jack, and still no amp.
  const wrong = plug(pull(noCab, "guitar", "out"), { from: ["guitar", "out"], to: ["cab", "in"], kind: "instrument" });
  expect(play(wrong)).toMatchObject({ peak: 0, chains: [["guitar", "cab"]], problems: ["wrong-cable", "empty-input", "no-speaker"] });

  // Guitar into the amp, the pedalboard left on the floor: sound again, one link fewer (no pedal).
  const direct = play({ placed: STAGE.placed, cables: [{ from: ["guitar", "out"], to: ["head", "in"] }, { from: ["cab", "in"], to: ["head", "speaker"] }] });
  expect(direct.chains).toEqual([["guitar", "head", "cab"]]);
  expect(direct.problems).toEqual([]);
  expect(direct.links).toBe(withPedal - 1);
  expect(direct.peak).toBeGreaterThan(0.05);
});

test("compile's problems", () => {
  const rows: [string, readonly Cable[], [string, string[]][]][] = [
    ["the stage as it comes", STAGE.cables, []],
    ["pedalboard out to the amp, nothing into it", STAGE.cables.slice(1), [["empty-input", ["pedalboard"]]]],
    ["the speaker run on an instrument cable", [...STAGE.cables.slice(0, 2), { from: ["head", "speaker"], to: ["cab", "in"], kind: "instrument" }], [["wrong-cable", ["head", "cab"]]]],
    ["no cabinet on the amp", STAGE.cables.slice(0, 2), [["no-speaker", ["head"]]]],
    ["the amp's out back into the pedalboard", [STAGE.cables[1], { from: ["head", "speaker"], to: ["pedalboard", "in"], kind: "speaker" }],
      [["wrong-cable", ["head", "pedalboard"]], ["loop", ["pedalboard", "head"]]]],
    ["two inputs cabled together", [{ from: ["pedalboard", "in"], to: ["head", "in"] }], [["direction", ["pedalboard", "head"]]]],
  ];
  for (const [what, cables, want] of rows) {
    const got = compile({ placed: STAGE.placed, cables }).problems.map((p): [string, string[]] => [p.kind, p.items]);
    expect([what, got]).toEqual([what, want]);
  }
});
