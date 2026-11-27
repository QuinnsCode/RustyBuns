// Q Builder's remake (#6021): your parts written into the board, read back, play the riff as your board does, and the
// tscircuit source carries the same parts. The page's journey is builder-page.test.ts.
import { expect, test } from "bun:test";
import { builderPedal, editNets, parseValue, play, remakeJson, remakeTsx, retest, scopeNets, theRiff, type Edit } from "../src/circuit/builder.ts";
import { readBoard } from "../src/circuit/tscircuit.ts";

// Half a second of the riff is enough to tell boards apart, at a fifth of the work.
const input = theRiff().subarray(0, 24_000);

test.each([
  ["fuzz", { D3: "germanium", R3: "2.2" }],
  ["fuzz", { D1: "led", D3: "none", C4: "0.47" }],
  ["drive", { D1: "mosfet", C2: "4.7" }],
  ["dist", { D1: "none" }],
  ["phase", { R1: "2.2" }], // an effect: its LFO runs through all three, the same each time (#6118)
  ["comp", { R1: "2.2" }], // and an envelope, which listens to the output
] as const)("%s %o: the remake plays as your board, not as the stock one", (id, swaps) => {
  const r = retest(builderPedal(id), 7, swaps, input);
  expect(r.same).toBe(true);
  expect(r.misses).toBe(0);
  expect(r.differs).toBeGreaterThan(-60); // the swap is heard: not the stock board
});

test("the remade source names each new part and leaves an emptied socket's holes unfitted", async () => {
  const tsx = remakeTsx("fuzz", await Bun.file(`${import.meta.dir}/../circuits/fuzz.tsx`).text(), { D1: "germanium", D3: "none", R3: "2.2" }, "Q Fuzz");
  const line = (part: string) => tsx.split("\n").find((l) => l.includes(`name="${part}"`)) ?? "";
  expect(line("D1")).toContain('manufacturerPartNumber="1N34A"');
  expect(line("D3")).toContain("doNotPlace");
  expect(line("R3")).toContain('resistance="4.7k"');
  expect(line("R4")).toContain('resistance="4.7k"'); // untouched
  // the JSON remake drops the emptied socket's diodes, so the bench hears nothing there
  expect(readBoard(remakeJson("fuzz", { D3: "none" })).parts.map((p) => p.name)).not.toContain("D3");
});

// #6423: the circuit itself changed, not only a value: a part added, one taken off, an end moved to another net.
const net = (label: string) => editNets("fuzz").find((n) => n.label === label)?.key ?? "";
const changed: Edit[] = [
  { t: "add", part: "C5", kind: "cap", value: 100e-9, a: net("R3 · D3 · D4 · R4"), b: net("GND") },
  { t: "remove", part: "R2" },
  { t: "move", part: "D3", pin: "cathode", to: net("OUT") },
];

test("a changed fuzz (C5 added, R2 off, D3 rewired, R2's swap left behind): the remake plays as your board", () => {
  const r = retest(builderPedal("fuzz"), 7, { D1: "germanium", R2: "2.2" }, input, changed);
  expect(r.same).toBe(true);
  expect(r.misses).toBe(0);
  expect(r.differs).toBeGreaterThan(-60);
});

test("the changed fuzz's source: the new part and its traces in, the removed one out, and it says the layout must be routed again", async () => {
  const tsx = remakeTsx("fuzz", await Bun.file(`${import.meta.dir}/../circuits/fuzz.tsx`).text(), {}, "Q Fuzz", changed);
  const lines = tsx.split("\n");
  expect(lines[0]).toContain("layout and Gerbers don't fit");
  expect(lines).toContain('    <capacitor name="C5" capacitance="100nF" footprint="0603" />');
  expect(lines).toContain('    <trace from=".C5 > .pin2" to="net.GND" />');
  expect(lines).toContain('    <trace from=".D3 > .pin2" to="net.OUT" />');
  expect(tsx).not.toContain(".R2 >");
  expect(lines.filter((l) => l.includes('name="R2"'))).toEqual([]);
});

test.each([["10k", 10e3], ["4.7u", 4.7e-6], ["100n", 100e-9], ["22pF", 22e-12], ["1M", 1e6], ["470Ω", 470], ["2.2 k", 2.2e3]])("%s reads as %d", (text, v) => {
  expect(parseValue(text)).toBeCloseTo(v, 15);
});
test("a value that isn't one reads as NaN", () => expect(parseValue("lots")).toBeNaN());

test("every scope net on the fuzz reads back volts, and IN is the guitar", () => {
  const def = builderPedal("fuzz"), nets = scopeNets("fuzz");
  expect(nets[0].label).toBe("IN");
  expect(nets.at(-1)?.label).toBe("OUT");
  for (const n of nets) {
    const p = play(def.net(7), input, n.node);
    expect(Math.max(...p.at!.map(Math.abs))).toBeGreaterThan(0.01);
  }
});
