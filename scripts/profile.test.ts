// The flame-graph summaries (scripts/profile.ts): self time and held heap per function, from the shapes Chrome writes.
import { expect, test } from "bun:test";
import { cpuHot, heapHot } from "./profile.ts";

const frame = (functionName: string, lineNumber = 9) => ({ functionName, url: "http://127.0.0.1:4173/assets/index-abc.js?v=1", lineNumber, columnNumber: 3, scriptId: "1" });

test("self time goes to each sample's own function, and heap to the function that allocated it; a wrong shape is empty", () => {
  // root > frame > solve; the time between a sample and the next is the sample's
  const cpu = {
    nodes: [{ id: 1, callFrame: frame("(root)", -1), children: [2] }, { id: 2, callFrame: frame("frame"), children: [3] }, { id: 3, callFrame: frame("solve", 41) }],
    samples: [3, 3, 2, 3], timeDeltas: [0, 3000, 1000, 2000], startTime: 0, endTime: 6000,
  };
  expect(cpuHot(cpu).map((h) => [h.fn, h.at, h.value, h.pct])).toEqual([["solve", "index-abc.js:42", 4, 66.7], ["frame", "index-abc.js:10", 2, 33.3]]);
  const heap = { head: { callFrame: frame("(root)", -1), selfSize: 0, children: [
    { callFrame: frame("Mat"), selfSize: 3 * 1048576, children: [{ callFrame: frame("solve", 41), selfSize: 1048576, children: [] }] },
    { callFrame: { ...frame(""), url: "" }, selfSize: 0, children: [] },
  ] }, samples: [] };
  expect(heapHot(heap, 2).map((h) => [h.fn, h.at, h.value, h.pct])).toEqual([["Mat", "index-abc.js:10", 3, 75], ["solve", "index-abc.js:42", 1, 25]]);
  expect(cpuHot({ nodes: "no" })).toEqual([]);
  expect(heapHot(null)).toEqual([]);
});
