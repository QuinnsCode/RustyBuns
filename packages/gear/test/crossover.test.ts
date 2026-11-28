// Crossovers (#6473): each rig's preset as its makers' sheets give it, and a split set wrong, heard as a hole, fixed.
import { expect, test } from "bun:test";
import { alignMs, BOX_CROSSOVERS, crossoverCheck, flatness, response, RIG_CROSSOVERS, rigCrossover, type Band } from "../src/crossover.ts";
import { CROSSOVER_STEPS, lessonStart, SUB_AHEAD_M } from "../src/crossover-lesson.ts";
import { gear, GEAR_IDS } from "../src/catalog.ts";
import { checkSteps } from "../src/steps.ts";
import { SYSTEM_IDS } from "../src/systems.ts";

const band = (rig: string, box: string, i = 0) => RIG_CROSSOVERS[rig]!.filter((b) => b.box === box)[i]!;
const edgeOf = (b: Band) => [b.dsp.hp ? `${b.dsp.hp.type}${b.dsp.hp.slope} ${b.dsp.hp.hz}` : "-", b.dsp.lp ? `${b.dsp.lp.type}${b.dsp.lp.slope} ${b.dsp.lp.hz}` : "-", b.dsp.gainDb, b.dsp.delayMs, b.dsp.polarity];

test("every rig has a preset whose bands the amp's DSP can run and whose drivers take them", () => {
  for (const id of SYSTEM_IDS) {
    const bands = rigCrossover(id);
    expect(bands.length, id).toBeGreaterThan(1);
    expect(crossoverCheck(bands).warnings, id).toEqual([]);
    for (const b of bands) expect(b.ref.length, `${id} ${b.way}`).toBeGreaterThan(10);
  }
});

test.each([
  // Funktion-One's Res2 Active with F121/F221: the 21" 28 Hz Butterworth to 85, +8 dB; the Res2's 8"+1" from 250, 3.268 ms
  ["the F221 under a Res2", band("dance-stack", "horn-sub-21"), ["bw24 28", "lr24 85", 8, 0, 1]],
  ["the Res2's mid-high pair", band("dance-stack", "stack-mid-high", 1), ["lr24 250", "-", 0, 3.268, 1]],
  // Danley's TH118: 30 Hz high-pass, 24 dB Butterworth
  ["the TH118's high-pass", band("synergy", "tapped-horn-18"), ["bw24 30", "lr24 100", 0, 0, 1]],
  // Void's Air Motion: the LF section 140 Hz to 600 Hz
  ["the Air Motion's LF", band("sculpted", "sculpted-3way"), ["lr24 140", "lr24 600", 0, 0, 1]],
  // Turbosound's Flashlight: 150 Hz, 1.3 kHz and 8 kHz
  ["the Flashlight's 12\"", band("tri-amp", "tri-amp-top"), ["lr24 150", "lr24 1300", 0, 0, 1]],
  ["the Flashlight's 6.5\"", band("tri-amp", "tri-amp-top", 1), ["lr24 1300", "lr24 8000", 0, 0, 1]],
  // QSC's KS118 at its 80 Hz default for K.2 tops
  ["the KS118's low-pass", band("line-array", "sub-18"), ["-", "lr24 80", 0, 0, 1]],
] as const)("%s is the sheet's", (_, b, want) => expect(edgeOf(b)).toEqual([...want]));

test("the sub set wrong is a hole at the split you can measure, and set right again it's gone", () => {
  const [sub, top] = rigCrossover("line-array");
  const right = [sub!.dsp, top!.dsp];
  expect(flatness(right, 30, 400).dipDb).toBeGreaterThan(-0.5);
  // flipped, the sub cancels the tops where both play: deep at 80 Hz
  const flipped = flatness([{ ...sub!.dsp, polarity: -1 }, top!.dsp], 30, 400);
  expect(flipped.dipDb).toBeLessThan(-20);
  expect(Math.abs(flipped.dipHz - 80)).toBeLessThan(8);
  // half a period late at the split (6.25 ms at 80 Hz) is a hole too
  expect(flatness([{ ...sub!.dsp, delayMs: 6.25 }, top!.dsp], 30, 400).dipDb).toBeLessThan(-20);
  // pulled apart (the sub to 60, the tops from 110), a gap between them
  expect(flatness([{ ...sub!.dsp, lp: { ...sub!.dsp.lp!, hz: 60 } }, { ...top!.dsp, hp: { ...top!.dsp.hp!, hz: 110 } }], 30, 400).dipDb).toBeLessThan(-6);
});

test("a horn fed lows is called out before it blows", () => {
  const [, , , hf] = rigCrossover("tri-amp");
  const wrong = { ...hf!, dsp: { ...hf!.dsp, hp: { ...hf!.dsp.hp!, hz: 1300 } } };
  expect(crossoverCheck([wrong]).warnings).toEqual([expect.stringContaining("under the 8000 Hz it can take: it will blow")]);
  expect(crossoverCheck([{ ...hf!, dsp: { ...hf!.dsp, hp: undefined } }]).warnings[0]).toContain("no high-pass");
});

test("on the tri-amp stack the room hears it: the preset plays flat, the bass flipped is a hole at 150 Hz, put back it's gone", () => {
  const preset = rigCrossover("tri-amp"), flipped = preset.map((b, i) => (i ? b : { ...b, dsp: { ...b.dsp, polarity: -1 as const } }));
  expect(crossoverCheck(preset)).toMatchObject({ warnings: [], dipDb: 0, bumpDb: 0 });
  const heard = crossoverCheck(flipped, preset.map((b) => b.dsp));
  expect(heard.dipDb).toBeLessThan(-10);
  expect(Math.abs(heard.dipHz - 150)).toBeLessThan(15);
  expect(crossoverCheck(flipped.map((b, i) => (i ? b : preset[0]!)), preset.map((b) => b.dsp)).dipDb).toBe(0);
});

// each speaker on its own, against the maker's numbers
test.each([
  ["top-12-powered", "powered", undefined, [80, 100, 125]], // QSC K12.2: its high-pass over a sub
  ["sub-18", "powered", undefined, [80, 100]], // QSC KS118: its low-pass menu
  ["wedge-12", "powered", undefined, [80]], // QSC CP12's Ext Sub voicings
  ["top-15-passive", "passive", 2200, undefined], // JBL JRX215
  ["wedge-12-passive", "passive", 2000, undefined], // JBL PRX412M
  ["sculpted-3way", "passive", 1700, undefined], // Void Air Motion's passive 8" and 1.5"
] as const)("%s on its own is the sheet's", (id, drive, internal, menu) => {
  const box = BOX_CROSSOVERS[id]!;
  expect([box.drive, box.internalHz, box.menu?.hz]).toEqual([drive, internal, menu && [...menu]]);
});

test("every speaker in the catalog says what splits it, and powered is what has no ohms", () => {
  for (const id of GEAR_IDS) {
    const speaker = gear(id).speaker;
    if (speaker) expect(BOX_CROSSOVERS[id]?.drive, id).toBe(speaker.ohms === null ? "powered" : "passive");
  }
});

test("the crossover lesson: each split found wrong is named, and the sub's delay closes the hole it leaves out front", () => {
  const bands = lessonStart(), preset = rigCrossover("tri-amp").map((b) => b.dsp);
  const now = () => checkSteps(CROSSOVER_STEPS, { bands, subAheadM: SUB_AHEAD_M });
  const next = () => now().find((s) => !s.done)?.why;
  const split = (i: number, hz: number) => {
    bands[i] = { ...bands[i]!, lp: { ...bands[i]!.lp!, hz } };
    bands[i + 1] = { ...bands[i + 1]!, hp: { ...bands[i + 1]!.hp!, hz } };
  };
  expect(next()).toContain("A gap: nothing carries 100 Hz to 220 Hz");
  split(0, 150);
  expect(next()).toContain("An overlap: both play 1.1 kHz to 1.3 kHz");
  split(1, 1300);
  expect(next()).toContain("it will blow");
  split(2, 8000);
  expect(next()).toMatch(/sub arrives 4\.4 ms before the tops, a \d+ dB hole/);
  const hole = () => Math.min(...response(bands, preset, SUB_AHEAD_M).sum);
  expect(hole()).toBeLessThan(-6);
  bands[0] = { ...bands[0]!, delayMs: alignMs(SUB_AHEAD_M) };
  expect(now().every((s) => s.done)).toBe(true);
  expect(hole()).toBeGreaterThan(-0.5);
});
