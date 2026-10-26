// Fatty borg's pure parts (src/fatty.ts): the steps, the guard against taking over a live deploy,
// reading build output, the comparison with the last run, and the sweeper finding fatty's stage.
import { describe, expect, test } from "bun:test";
import { sweep } from "../src/edge.ts";
import { APPS, builtPaths, deployBlocker, fattyStage, formatRun } from "../src/fatty.ts";

describe("fatty borg", () => {
  test("covers the three chunky examples, and only an edge app deploys", () => {
    expect(APPS.map((a) => a.name)).toEqual(["codesplitter", "park-hide-seek", "agent-office"]);
    expect(APPS.filter((a) => a.steps.some((s) => s.kind === "deploy")).map((a) => a.name)).toEqual(["codesplitter"]);
    const edge = APPS[0]!.steps.map((s) => s.kind);
    expect(edge).toEqual(["plan", "deploy", "smoke", "destroy"]);
    // every dir really is an app here
    for (const a of APPS) expect(Bun.file(`${import.meta.dir}/../../../${a.dir}/package.json`).size).toBeGreaterThan(0);
  });

  test("refuses a stage that would take over a pinned or adopted Worker", () => {
    const stage = fattyStage(1_700_000_000_000);
    expect(stage).toBe("fatty1700000000");
    expect(deployBlocker({ adopt: true, workerName: "codesplitter" }, undefined, stage)).toContain('the Worker name "codesplitter"');
    expect(deployBlocker({ adopt: true }, undefined, stage)).toContain("adopt");
    expect(deployBlocker({ adopt: true, workerName: "x" }, { [stage]: {} }, stage)).toBeNull();
    expect(deployBlocker({}, undefined, stage)).toBeNull();
    expect(deployBlocker(undefined, undefined, stage)).toBe("no edge target");
  });

  test("reads the paths a build printed", () => {
    expect(builtPaths("compiling\nbuilt dist/app-darwin-arm64\ndist/app-linux-x64\ndone")).toEqual(["dist/app-darwin-arm64", "dist/app-linux-x64"]);
    expect(builtPaths("nothing")).toEqual([]);
  });

  test("prints each step against the last run", () => {
    const run = { at: "now", apps: { a: [{ step: "build desktop", ok: true, ms: 12_000, bytes: 60 << 20 }, { step: "destroy", ok: false, ms: 5, bytes: null }] } };
    const last = { at: "then", apps: { a: [{ step: "build desktop", ok: true, ms: 10_000, bytes: 50 << 20 }] } };
    const out = formatRun(run, last).split("\n");
    expect(out[0]).toContain("12.0 s (+20% on 10.0 s)");
    expect(out[0]).toContain("60.0 MB (+20% on 50.0 MB)");
    expect(out[1]!.startsWith("✗")).toBe(true);
    expect(formatRun(run)).not.toContain("%");
  });

  test("the sweeper finds a fatty stage's leftovers by app and prefix, and spares slim borg's", async () => {
    const stage = fattyStage(Date.now());
    const list: Record<string, unknown> = {
      queues: [{ queue_id: "q1", queue_name: `codesplitter-jobs-${stage}-aaaa` }, { queue_id: "q2", queue_name: "codesplitter-jobs" }],
      "workers/scripts": [{ id: `borg-slim-worker-borg1700000000-aaaa` }],
      "d1/database": [], "storage/kv/namespaces": [], "r2/buckets": { buckets: [] },
    };
    const fake = (async (url: string, init?: RequestInit) => {
      const path = url.replace(/^.*\/accounts\/acct\//, "");
      return Response.json({ success: true, result: init?.method === "DELETE" ? {} : list[path.split("?")[0]!], result_info: { total_pages: 1 } });
    }) as typeof fetch;
    const swept = await sweep({ accountId: "acct", token: "t", fetch: fake, dryRun: true, stage, app: "codesplitter", prefix: "fatty" });
    expect(swept).toEqual([{ kind: "queue", name: `codesplitter-jobs-${stage}-aaaa` }]);
  });
});
