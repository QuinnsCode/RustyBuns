// Q Builder's remake (#6021): your parts written into the board, read back, play the riff as your board does, and the
// tscircuit source carries the same parts. The page's journey is builder-page.test.ts.
import { expect, test } from "bun:test";
import { builderPedal, play, remakeJson, remakeTsx, retest, scopeNets, theRiff } from "../src/circuit/builder.ts";
import { readBoard } from "../src/circuit/tscircuit.ts";

// Half a second of the riff is enough to tell boards apart, at a fifth of the work.
const input = theRiff().subarray(0, 24_000);

test.each([
  ["fuzz", { D3: "germanium", R3: "2.2" }],
  ["fuzz", { D1: "led", D3: "none", C4: "0.47" }],
  ["drive", { D1: "mosfet", C2: "4.7" }],
  ["dist", { D1: "none" }],
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

test("every scope net on the fuzz reads back volts, and IN is the guitar", () => {
  const def = builderPedal("fuzz"), nets = scopeNets("fuzz");
  expect(nets[0].label).toBe("IN");
  expect(nets.at(-1)?.label).toBe("OUT");
  for (const n of nets) {
    const p = play(def.net(7), input, n.node);
    expect(Math.max(...p.at!.map(Math.abs))).toBeGreaterThan(0.01);
  }
});
