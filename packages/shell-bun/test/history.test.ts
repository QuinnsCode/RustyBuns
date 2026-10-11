import { test, expect } from "bun:test";
import { appendFileSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatHistory, history, historyRuns, readHistory } from "../src/history.ts";
import { profRoute } from "../src/cpuprof.ts";
import type { MemStats } from "../src/memwatch.ts";
import type { ProfileSummary } from "../src/profsummary.ts";

const mem = (rssMb: number, maxMb: number | null = null): MemStats =>
  ({ rssMb, heapMb: rssMb / 2, peakRssMb: rssMb, uptimeS: 0, slopeMbPerHour: null, hoursToMax: null, maxMb, samples: 3 });
const summary: ProfileSummary = {
  durationMs: 5000, samples: 4000, idlePct: 10, gcPct: 2, total: [],
  self: [1, 2, 3, 4, 5, 6, 7].map((i) => ({ fn: `f${i}`, at: `src/f.ts:${i}`, ms: 100 - i, pct: 20 - i })),
};

// A clock that moves 30 minutes a call.
function clock() { let t = Date.parse("2026-10-11T10:00:00Z"); return () => { const d = new Date(t); t += 30 * 60_000; return d; }; }

test("history: runs per boot, newest first, with the slope, profiles and a ceiling", () => {
  const file = join(mkdtempSync(join(tmpdir(), "rb-hist-")), "data", "history.jsonl");
  const h = history({ file, now: clock() });
  h.boot("v1 abc1234");
  for (const mb of [100, 101, 100]) h.mem(mem(mb));
  h.boot("v2 def5678");
  for (const mb of [100, 110, 120, 130]) h.mem(mem(mb, 128));
  h.profile("ceiling-x.cpuprofile", summary, "ceiling");
  h.ceiling(mem(130, 128));

  const runs = historyRuns(h.read());
  expect(runs).toHaveLength(2);
  expect(runs[0]).toMatchObject({ build: "v2 def5678", mem: { samples: 4, firstMb: 100, lastMb: 130, peakMb: 130, slopeMbPerHour: 20 }, ceiling: { rssMb: 130, maxMb: 128 } });
  expect(runs[0]!.profiles[0]!.self).toHaveLength(5);
  expect(runs[1]).toMatchObject({ build: "v1 abc1234", mem: { slopeMbPerHour: 0 }, ceiling: null, profiles: [] });

  const text = formatHistory(runs);
  expect(text).toContain("this run: 2026-10-11 12:00Z, 3h");
  expect(text).toContain("rss 100→130 MB (peak 130), +20 MB/h · went over the 128 MB ceiling at 130 MB and restarted");
  expect(text).toContain("profile ceiling-x.cpuprofile (ceiling, 4000 samples, idle 10%): f1 19% src/f.ts:1, f2 18%");
  expect(text).toContain("1 run back: 2026-10-11 10:00Z, 1.5h · v1 abc1234 · rss 100→100 MB (peak 101), +0 MB/h");
  expect(formatHistory([])).toContain("no history yet");
});

test("history: keeps the newest lines, skips a torn one, and lines before any boot make a run", () => {
  const file = join(mkdtempSync(join(tmpdir(), "rb-hist-")), "history.jsonl");
  const h = history({ file, keep: 10, now: clock() });
  for (let i = 0; i < 25; i++) h.mem(mem(i));
  appendFileSync(file, '{"at":"2026-10-1');
  const lines = readFileSync(file, "utf8").split("\n").filter(Boolean);
  expect(lines.length).toBeLessThanOrEqual(13);
  const entries = readHistory(file);
  expect(entries.at(-1)).toMatchObject({ kind: "mem", rssMb: 24 });
  expect(historyRuns(entries)).toMatchObject([{ pid: null, mem: { lastMb: 24 } }]);
});

test("profRoute: GET /__rb/history behind the secret, with each profile in it", async () => {
  const SECRET = "a-long-enough-secret", dir = mkdtempSync(join(tmpdir(), "rb-hist-"));
  const h = history({ file: join(dir, "history.jsonl") });
  h.boot();
  const req = (method: string, path: string, auth = `Bearer ${SECRET}`) => new Request("http://box" + path, { method, headers: { Authorization: auth } });
  // without a history the path is the app's
  expect(await profRoute({ dir, secret: SECRET, log: () => {} })(req("GET", "/__rb/history"))).toBeNull();
  const route = profRoute({ dir, secret: SECRET, log: () => {}, history: h });
  expect((await route(req("GET", "/__rb/history", "Bearer nope")))!.status).toBe(401);
  expect((await route(req("POST", "/__rb/history")))!.status).toBe(405);
  expect((await route(req("POST", "/__rb/prof?s=0.05")))!.status).toBe(200);
  const { runs } = await (await route(req("GET", "/__rb/history")))!.json();
  expect(runs).toHaveLength(1);
  expect(runs[0].profiles[0]).toMatchObject({ kind: "profile", reason: "asked" });
  expect(runs[0].profiles[0].id).toMatch(/^cpu-.*\.cpuprofile$/);
});
