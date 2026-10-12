// Tier 2's guard rails (src/edge.ts): the cost cap read from the plan, and the sweeper that finds
// borg's leftovers by the start time in their stage. No network: the Cloudflare API is faked.
import { describe, expect, test } from "bun:test";
import { costReport } from "../../../packages/cli/src/costs.ts";
import config from "../rustybuns.config.ts";
import { billablesFromPlan, overCap, sweep, stageName, stageStarted, stale } from "../src/edge.ts";

// What `rustybuns plan` prints first for slim borg (packages/cli/src/costs.ts costReport).
const PLAN = `billable resources in this stack:
  Cloudflare Worker "borg-slim"  usage  requests + CPU time
  D1 DB                          usage  rows read/written + storage
  KV KV                          usage  reads/writes + storage
  R2 BUCKET                      usage  storage + operations (egress is free)
  Durable Object PROBE           usage  duration while awake: open sockets, timers, tick loops
  Queue JOBS                     usage  10k operations a day free, 1M a month on Workers Paid, then $0.40 per million; a message is about three (write, read, delete)
  account-side caps and alerts: COSTS.md

Plan: 7 to create`;

describe("the cost cap", () => {
  test("reads slim borg's billables from the plan, and lets them through", () => {
    expect(billablesFromPlan(PLAN).map((b) => b.what)).toEqual(['Cloudflare Worker "borg-slim"', "D1 DB", "KV KV", "R2 BUCKET", "Durable Object PROBE", "Queue JOBS"]);
    expect(overCap(PLAN)).toEqual([]);
  });

  test("reads the table the CLI prints today for this config", () => {
    expect(billablesFromPlan(costReport(config)).length).toBe(6);
    expect(overCap(costReport(config))).toEqual([]);
  });

  test("refuses a fixed cost, a Paid-only resource, a grown stack, and a plan it can't read", () => {
    const fixed = PLAN.replace("  account-side", "  Hetzner cx22 in fsn1  fixed  billed hourly until destroyed, even powered off\n  account-side");
    expect(overCap(fixed).join("\n")).toContain("Hetzner cx22 in fsn1 bills fixed");
    expect(overCap(fixed).join("\n")).toContain("7 billable resources, over the cap of 6");
    const paid = PLAN.replace("  account-side", "  Container BOX (lite, at most 1)  usage  Workers Paid only; CPU, memory and disk\n  account-side");
    expect(overCap(paid, { maxResources: 7, allowPaid: false })).toEqual(["Container BOX (lite, at most 1) needs Workers Paid (Workers Paid only; CPU, memory and disk)"]);
    expect(overCap(paid, { maxResources: 7, allowPaid: true })).toEqual([]);
    expect(overCap("Plan: 7 to create")).toEqual(["no billable resources table in the plan output, so the cost can't be checked"]);
  });
});

describe("the sweeper", () => {
  const now = Date.UTC(2026, 9, 12, 3, 0);
  const old = stageName(now - 2 * 3600_000), fresh = stageName(now - 10 * 60_000);

  test("a stage carries its start time, and only borg's names match", () => {
    expect(stageStarted(`borg-slim-DB-${old}-abcdefghijklmnop`)).toBe(Math.floor((now - 2 * 3600_000) / 1000) * 1000);
    expect(stale(`borg-slim-bucket-${old}-abcdefghijklmnop`, now)).toBe(true);
    expect(stale(`borg-slim-bucket-${fresh}-abcdefghijklmnop`, now)).toBe(false);
    expect(stale(`borg-slim-Worker-live_ryan-abcdefghijklmnop`, now)).toBe(false);   // someone's own deploy
    expect(stale(`codesplitter-DB-${old}-abcdefghijklmnop`, now)).toBe(false);
  });

  test("deletes stale borg resources of every kind, queues first, and keeps the rest", async () => {
    const calls: string[] = [];
    const list: Record<string, unknown> = {
      queues: [{ queue_id: "q1", queue_name: `borg-slim-jobs-${old}-aaaa` }, { queue_id: "q2", queue_name: `borg-slim-jobs-${fresh}-bbbb` }],
      "workers/scripts": [{ id: `borg-slim-worker-${old}-aaaa` }, { id: "codesplitter" }],
      "d1/database": [{ uuid: "d1", name: `borg-slim-DB-${old}-aaaa` }],
      "storage/kv/namespaces": [{ id: "k1", title: `borg-slim-KV-${old}-aaaa` }],
      "r2/buckets": { buckets: [{ name: `borg-slim-bucket-${old}-aaaa` }, { name: "photos" }] },
    };
    const fake = (async (url: string, init?: RequestInit) => {
      const path = url.replace(/^.*\/accounts\/acct\//, "");
      calls.push(`${init?.method} ${path}`);
      if (init?.method === "DELETE") return Response.json(path.startsWith("r2/") ? { success: false, errors: [{ message: "bucket not empty" }] } : { success: true });
      return Response.json({ success: true, result: list[path.split("?")[0]!], result_info: { total_pages: 1 } });
    }) as typeof fetch;

    const swept = await sweep({ accountId: "acct", token: "t", now, fetch: fake });
    expect(swept).toEqual([
      { kind: "queue", name: `borg-slim-jobs-${old}-aaaa` },
      { kind: "worker", name: `borg-slim-worker-${old}-aaaa` },
      { kind: "d1", name: `borg-slim-DB-${old}-aaaa` },
      { kind: "kv", name: `borg-slim-KV-${old}-aaaa` },
      { kind: "r2", name: `borg-slim-bucket-${old}-aaaa`, error: "DELETE r2/buckets/borg-slim-bucket-" + old + "-aaaa: bucket not empty" },
    ]);
    expect(calls.filter((c) => c.startsWith("DELETE"))).toEqual([
      "DELETE queues/q1", `DELETE workers/scripts/borg-slim-worker-${old}-aaaa?force=true`, "DELETE d1/database/d1", "DELETE storage/kv/namespaces/k1", `DELETE r2/buckets/borg-slim-bucket-${old}-aaaa`,
    ]);

    calls.length = 0;
    expect((await sweep({ accountId: "acct", token: "t", now, fetch: fake, dryRun: true })).length).toBe(5);
    // A run sweeps its own stage on the way out, however young: its destroy may have failed.
    const own = await sweep({ accountId: "acct", token: "t", now, fetch: fake, dryRun: true, stage: fresh });
    expect(own.map((s) => s.name)).toContain(`borg-slim-jobs-${fresh}-bbbb`);
    expect(own.length).toBe(6);
    expect(calls.some((c) => c.startsWith("DELETE"))).toBe(false);
  });
});
