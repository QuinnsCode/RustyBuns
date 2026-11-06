// A flame-graph run of a page in headless Chrome (scripts/chrome.ts): a CPU profile and a sampled heap profile of whatever
// the page does between `startProfile` and `stopProfile`, written where DevTools (Performance > Load profile, Memory > Load) and
// speedscope open them as flame graphs, plus the hottest functions by self time and what holds the most heap, short enough
// to paste in a PR. apps/mythic-masters/scripts/walk-budget.ts --profile <dir> runs it over the frame-budget walk.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { arr, check, num, obj, opt, raw, str } from "../packages/util/src/guard.ts";
import type { Tab } from "./chrome.ts";

const n = () => num(-1e15, 1e15);
const Frame = obj({ functionName: str(4000, { min: 0 }), url: str(4000, { min: 0 }), lineNumber: n() });
const CpuNode = obj({ id: n(), callFrame: Frame });
const Cpu = obj({ nodes: arr(CpuNode, 1e7), samples: arr(n(), 1e8), timeDeltas: arr(n(), 1e8) });
const HeapRoot = obj({ head: obj({ selfSize: n(), callFrame: Frame, children: arr(raw, 1e6) }) });
const HeapKid = obj({ selfSize: n(), callFrame: Frame, children: opt(arr(raw, 1e6)) });

/** One line of a summary: where (function, file:line) and how much (ms of self time, or MB allocated). */
export interface Hot { fn: string; at: string; value: number; pct: number }

const where = (f: { functionName: string; url: string; lineNumber: number }) => ({
  fn: f.functionName || "(anonymous)",
  // a built chunk's name and line; the profile file itself has the columns
  at: f.url ? `${f.url.split("/").pop()?.split("?")[0]}:${f.lineNumber + 1}` : "(native)",
});

/** Start sampling the CPU (every `intervalUs` microseconds) and the heap's allocations. */
export async function startProfile(tab: Tab, intervalUs = 500) {
  await tab.call("Profiler.enable");
  await tab.call("Profiler.setSamplingInterval", { interval: intervalUs });
  await tab.call("Profiler.start");
  await tab.call("HeapProfiler.enable");
  await tab.call("HeapProfiler.startSampling", { samplingInterval: 32768 });
}

/** Stop both, write `<dir>/<name>.cpuprofile` and `.heapprofile`, and return the `top` hottest of each. */
export async function stopProfile(tab: Tab, dir: string, name: string, top = 12): Promise<{ cpu: Hot[]; heap: Hot[]; files: string[] }> {
  const cpuRaw: unknown = (await tab.call("Profiler.stop"))?.profile;
  const heapRaw: unknown = (await tab.call("HeapProfiler.stopSampling"))?.profile;
  mkdirSync(dir, { recursive: true });
  const files = [join(dir, `${name}.cpuprofile`), join(dir, `${name}.heapprofile`)];
  writeFileSync(files[0]!, JSON.stringify(cpuRaw));
  writeFileSync(files[1]!, JSON.stringify(heapRaw));
  return { cpu: cpuHot(cpuRaw, top), heap: heapHot(heapRaw, top), files };
}

/** Self time per function (the time between a sample and the next goes to the sample's node), idle and GC left in. */
export function cpuHot(profile: unknown, top = 12): Hot[] {
  const p = check(Cpu, profile);
  if (!p) return [];
  const byId = new Map(p.nodes.map((x) => [x.id, x]));
  const self = new Map<string, Hot>();
  let total = 0;
  p.samples.forEach((id, i) => {
    const node = byId.get(id), us = p.timeDeltas[i + 1] ?? 0;
    if (!node) return;
    const w = where(node.callFrame), key = `${w.fn} ${w.at}`;
    const h = self.get(key) ?? { ...w, value: 0, pct: 0 };
    h.value += us / 1000; total += us / 1000;
    self.set(key, h);
  });
  return [...self.values()].sort((a, b) => b.value - a.value).slice(0, top).map((h) => ({ ...h, value: +h.value.toFixed(1), pct: +((100 * h.value) / (total || 1)).toFixed(1) }));
}

/** Bytes still held at the end of the run, by the function that allocated them (sampled every 32 KB). */
export function heapHot(profile: unknown, top = 12): Hot[] {
  const root = check(HeapRoot, profile);
  if (!root) return [];
  const self = new Map<string, Hot>();
  let total = 0;
  const walk = (x: unknown) => {
    const k = check(HeapKid, x);
    if (!k) return;
    const w = where(k.callFrame), key = `${w.fn} ${w.at}`;
    const h = self.get(key) ?? { ...w, value: 0, pct: 0 };
    h.value += k.selfSize; total += k.selfSize;
    self.set(key, h);
    for (const c of k.children ?? []) walk(c);
  };
  walk(root.head);
  return [...self.values()].sort((a, b) => b.value - a.value).slice(0, top).map((h) => ({ ...h, value: +(h.value / 1048576).toFixed(2), pct: +((100 * h.value) / (total || 1)).toFixed(1) }));
}

