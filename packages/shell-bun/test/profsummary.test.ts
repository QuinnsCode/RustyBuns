import { test, expect } from "bun:test";
import { mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cpuProfile } from "../src/cpuprof.ts";
import { formatProfileSummary, listSaved, summarizeProfile, type CpuProfile } from "../src/profsummary.ts";

const frame = (functionName: string, line = 0) => ({ functionName, url: functionName.startsWith("(") ? "" : `file:///src/${functionName}.ts`, lineNumber: line });

// root → main → render → (layout ← recursive) and root → (idle), 1ms a sample
const profile: CpuProfile = {
  nodes: [
    { id: 1, callFrame: frame("(root)"), children: [2, 6, 7] },
    { id: 2, callFrame: frame("main", 9), children: [3] },
    { id: 3, callFrame: frame("render", 19), children: [4] },
    { id: 4, callFrame: frame("layout", 29), children: [5] },
    { id: 5, callFrame: frame("layout", 29) },
    { id: 6, callFrame: frame("(idle)") },
    { id: 7, callFrame: frame("(garbage collector)") },
  ],
  startTime: 0, endTime: 10_000,
  samples: [5, 5, 5, 4, 3, 3, 2, 6, 6, 7],
  timeDeltas: Array(10).fill(1000),
};

test("summarizeProfile: self and total time, the stack under the hottest frame, recursion counted once", () => {
  const s = summarizeProfile(profile, 3);
  expect(s).toMatchObject({ durationMs: 10, samples: 10, idlePct: 20, gcPct: 10 });
  expect(s.self.map((f) => [f.fn, f.ms, f.pct])).toEqual([["layout", 4, 40], ["render", 2, 20], ["main", 1, 10]]);
  expect(s.self[0]).toMatchObject({ at: "src/layout.ts:30", stack: ["layout src/layout.ts:30", "render src/render.ts:20", "main src/main.ts:10"] });
  // layout recursed, but each sample counts it once
  expect(s.total.map((f) => [f.fn, f.ms])).toEqual([["main", 7], ["render", 6], ["layout", 4]]);
  const text = formatProfileSummary(s);
  expect(text).toContain("idle 20%");
  expect(text).toContain("← layout src/layout.ts:30 ← render");
  expect(formatProfileSummary(summarizeProfile({ nodes: [profile.nodes[0]!], startTime: 5, endTime: 5, samples: [], timeDeltas: [] }))).toStartWith("no samples");
});

test("summarizeProfile: a real profile names the busy function", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rb-prof-"));
  const p = cpuProfile({ dir, ms: 120 });
  setTimeout(function spin() { const end = Date.now() + 60; let x = 0; while (Date.now() < end) x += Math.sqrt(x + 1); }, 10);
  const { file } = await p;
  const s = summarizeProfile(JSON.parse(readFileSync(file, "utf8")));
  expect(s.total.map((f) => f.fn)).toContain("spin");
  expect(s.samples).toBeGreaterThan(0);
});

test("listSaved: newest first, only the kind asked for, nothing for a missing dir", () => {
  const dir = mkdtempSync(join(tmpdir(), "rb-saved-"));
  for (const [f, t] of [["a.cpuprofile", 1000], ["b.cpuprofile", 2000], ["c.heapsnapshot", 3000]] as const) {
    writeFileSync(join(dir, f), "{}");
    utimesSync(join(dir, f), t, t);
  }
  expect(listSaved(dir, ".cpuprofile").map((f) => f.id)).toEqual(["b.cpuprofile", "a.cpuprofile"]);
  expect(listSaved(join(dir, "nope"), ".cpuprofile")).toEqual([]);
});
