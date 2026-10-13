import { test, expect } from "bun:test";
import { cronGaps, DO_IDLE_S, estimate, formatEstimate, loadUsage, usageFlags } from "../src/usage-estimate.ts";
import type { UsageSnapshot } from "@rustybuns/shell-bun/usage";

// Shaped like the large app in #1224: a minute cron whose tick runs sweeps through a DO per query.
const snap: UsageSnapshot = {
  since: 0, uptimeS: 3600,
  causes: {
    "cron * * * * *": { runs: 60, busyMs: 60_000, ops: { "DB_DO.requests": 1200, "DB_DO.objects": 120, "DB_DO.busyMs": 6000, "JOBS.sent": 120 } },
    request: { runs: 36, busyMs: 900, ops: { "DB.rowsRead": 360, "DB.rowsWritten": 36, "MEDIA.classB": 36 } },
    "queue JOBS": { runs: 120, busyMs: 2400, ops: { "DB.rowsWritten": 240 } },
  },
};

test("cronGaps: a tick count a month and the seconds between them", () => {
  expect(cronGaps("* * * * *").length).toBe(43_200);
  expect(cronGaps("0 * * * *").every((g) => g === 3600)).toBe(true);
  expect(cronGaps("0 3 * * *").length).toBe(30);
});

test("estimate: per tick x ticks a month, per request x the rate, a consumer x the messages sent to it", () => {
  const e = estimate(snap);
  const cron = e.causes.find((c) => c.cause === "cron * * * * *")!;
  expect(cron.runs).toBe(43_200);
  expect(cron.perRun["DB_DO.requests"]).toBe(20);
  expect(cron.monthly["DB_DO.requests"]).toBe(864_000);
  // Two objects a tick, each poked every 60 s with a ~70 s idle tail: awake the whole month.
  expect(cron.awake).toEqual([{ binding: "DB_DO", objects: 2, everyS: 60 }]);
  expect(cron.monthly["DB_DO.gbS"]).toBeCloseTo(2 * 30 * 86_400 * 0.128);
  const req = e.causes.find((c) => c.cause === "request")!;
  expect(req.runs).toBe(36 * 24 * 30);   // the rate this run saw
  expect(estimate(snap, { requestsPerDay: 1000 }).causes.find((c) => c.cause === "request")!.runs).toBe(30_000);
  const q = e.causes.find((c) => c.cause === "queue JOBS")!;
  expect(q.runs).toBe(2 * 43_200);
  expect(q.monthly["DB.rowsWritten"]).toBe(4 * 43_200);
  // DO duration past the 400k GB-s included is the bill: ~663k GB-s, ~$3.29.
  const dur = e.rows.find((r) => r.label === "DO duration, GB-s")!;
  expect(dur.usd).toBeCloseTo((dur.amount - 400_000) / 1e6 * 12.5);
  expect(e.rows.find((r) => r.label === "Queue ops")!.amount).toBe(3 * 2 * 43_200);
  const text = formatEstimate(e);
  expect(text).toContain("! keeps 2 DB_DO objects awake 24/7");
  expect(text).toContain("Worker requests");
  expect(text).toContain("not counted:");
});

test("estimate: an hourly cron lets its object sleep between ticks", () => {
  const e = estimate({ since: 0, uptimeS: 7200, causes: { "cron 0 * * * *": { runs: 2, busyMs: 100, ops: { "W.requests": 2, "W.objects": 2, "W.busyMs": 0 } } } });
  const c = e.causes[0]!;
  expect(c.awake).toEqual([]);
  expect(c.monthly["W.gbS"]).toBeCloseTo(720 * DO_IDLE_S * 0.128);
});

test("usageFlags and loadUsage: flags come out of the args; a box URL gets /__rb/usage", async () => {
  expect(usageFlags(["--usage", "u.json", "--requests-per-day=500", "--no-check"])).toEqual({ usage: "u.json", requestsPerDay: 500, rest: ["--no-check"] });
  expect(() => usageFlags(["--requests-per-day", "lots"])).toThrow("wants a number");
  let asked = "";
  const got = await loadUsage("https://box.example/", (async (u: string) => { asked = u; return Response.json(snap); }) as any);
  expect(asked).toBe("https://box.example/__rb/usage");
  expect(got.uptimeS).toBe(3600);
  await expect(loadUsage("/nope/usage.json")).rejects.toThrow("no such file");
});
