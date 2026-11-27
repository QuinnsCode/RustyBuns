// Gear on cables (src/circuit/patch.ts): what Q Amp's patch view does with a patch,
// from the stage as it comes through a pulled cable and back, and `compile`'s problems.
import { expect, setDefaultTimeout, test } from "bun:test";
import { AMPS } from "../src/circuit/amps.ts";
import { riff } from "../src/circuit/riff.ts";
import { MACHINE_GEAR, PEDAL_GEAR, STAGE, compile, heard, seriesCables, type Cable, type Patch } from "../src/circuit/patch.ts";
import { FULL_SCALE, applySettings } from "../src/amp/live.ts";

setDefaultTimeout(30_000);
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

test("the riff through every pedal, the amp's loop and the cab; pull the speaker cable, then patch round the pedals", () => {
  const stage = play(STAGE);
  expect(stage.chains).toEqual([["guitar", ...PEDAL_GEAR.map((g) => g.id), "head", ...MACHINE_GEAR.map((g) => g.id), "head", "cab"]]);
  expect(stage.problems).toEqual([]);
  expect(stage.peak).toBeGreaterThan(0.05);
  const withPedal = stage.links;

  // Pull the speaker cable out of the amp: silence, and the amp says why.
  const noCab = pull(STAGE, "head", "speaker");
  expect(play(noCab)).toMatchObject({ peak: 0, chains: [], problems: ["no-speaker"] });

  // Run the guitar straight into the cabinet: an instrument cable in a speaker jack, and still no amp.
  const wrong = plug(pull(noCab, "guitar", "out"), { from: ["guitar", "out"], to: ["cab", "in"], kind: "instrument" });
  expect(play(wrong)).toMatchObject({ peak: 0, chains: [["guitar", "cab"]], problems: ["wrong-cable", "empty-input", "no-speaker"] });

  // Guitar into the amp, the pedals left on the floor: sound again, one link fewer (no pedal).
  const direct = play({ placed: STAGE.placed, cables: [{ from: ["guitar", "out"], to: ["head", "in"] }, { from: ["cab", "in"], to: ["head", "speaker"] }] });
  expect(direct.chains).toEqual([["guitar", "head", "cab"]]);
  expect(direct.problems).toEqual([]);
  expect(direct.links).toBe(withPedal - 1);
  expect(direct.peak).toBeGreaterThan(0.05);
});

test("compile's problems", () => {
  const placed = ["guitar", "fuzz", "drive", "split", "blend", "head", "tape", "cab"].map((id) => ({ id, gear: id }));
  const speaker: Cable = { from: ["head", "speaker"], to: ["cab", "in"], kind: "speaker" };
  const rows: [string, readonly Cable[], [string, string[]][]][] = [
    ["fuzz into the amp", seriesCables(["fuzz"], []), []],
    ["fuzz out to the amp, nothing into it", seriesCables(["fuzz"], []).slice(1), [["empty-input", ["fuzz"]]]],
    ["the speaker run on an instrument cable", [...seriesCables(["fuzz"], []).slice(0, 2), { ...speaker, kind: "instrument" }], [["wrong-cable", ["head", "cab"]]]],
    ["no cabinet on the amp", seriesCables(["fuzz"], []).slice(0, 2), [["no-speaker", ["head"]]]],
    ["the amp's out back into the fuzz", [seriesCables(["fuzz"], [])[1], { from: ["head", "speaker"], to: ["fuzz", "in"], kind: "speaker" }],
      [["wrong-cable", ["head", "fuzz"]], ["loop", ["fuzz", "head"]]]],
    ["the fuzz cabled into itself", [...seriesCables([], []), { from: ["fuzz", "out"], to: ["fuzz", "in"] }], [["loop", ["fuzz"]]]],
    ["two inputs cabled together", [{ from: ["fuzz", "in"], to: ["head", "in"] }], [["direction", ["fuzz", "head"]]]],
    ["tape in the amp's loop: no loop problem", seriesCables(["fuzz"], ["tape"]), []],
    ["the send out to the tape, nothing back into the return", seriesCables(["fuzz"], ["tape"]).filter((c) => c.to[1] !== "return"), [["empty-input", ["head"]]]],
    ["split into fuzz and drive, blended back", [
      { from: ["guitar", "out"], to: ["split", "in"] }, { from: ["split", "a"], to: ["fuzz", "in"] }, { from: ["split", "b"], to: ["drive", "in"] },
      { from: ["fuzz", "out"], to: ["blend", "a"] }, { from: ["drive", "out"], to: ["blend", "b"] }, { from: ["blend", "out"], to: ["head", "in"] }, speaker,
    ], []],
    ["one side of the split left dry", [
      { from: ["guitar", "out"], to: ["split", "in"] }, { from: ["split", "a"], to: ["fuzz", "in"] }, { from: ["split", "b"], to: ["blend", "b"] },
      { from: ["fuzz", "out"], to: ["blend", "a"] }, { from: ["blend", "out"], to: ["head", "in"] }, speaker,
    ], []],
  ];
  for (const [what, cables, want] of rows) {
    const got = compile({ placed, cables }).problems.map((p): [string, string[]] => [p.kind, p.items]);
    expect([what, got]).toEqual([what, want]);
  }
  // In plain words, naming the jack.
  const send = compile({ placed, cables: rows[8][1] }).problems[0];
  expect(send).toMatchObject({ jack: "return", message: expect.stringContaining("Nothing is plugged into the Amp head's return") });
  expect(compile({ placed, cables: rows[5][1] }).problems[0].message).toStartWith("Q Fuzz is cabled into itself");
  // The split's two ways through, and the loop's way out of the amp and back.
  expect(compile({ placed, cables: rows[9][1] }).chains).toEqual([["guitar", "split", "fuzz", "blend", "head", "cab"], ["guitar", "split", "drive", "blend", "head", "cab"]]);
  expect(compile({ placed, cables: rows[7][1] }).chains).toEqual([["guitar", "fuzz", "head", "tape", "head", "cab"]]);
});
