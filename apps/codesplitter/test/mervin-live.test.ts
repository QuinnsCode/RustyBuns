import { expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emitTo, waitWhilePaused } from "../scripts/mervin-merge.ts";
import { feed, feedDeploy, pause } from "../scripts/mervin-watch.ts";

setDefaultTimeout(15_000);

test("pausing holds the next merge until the pause is lifted, and the feed carries the events", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mervin-live-"));
  try {
    expect(await waitWhilePaused(dir)).toBe(false); // nothing paused: no wait
    emitTo(dir, { kind: "start", pr: 7 });
    emitTo(dir, { kind: "pause", paused: true });
    expect(feed(dir, 1)).toMatchObject({ steps: [{ kind: "pause", paused: true }], next: 2, paused: false });
    pause(dir, true);
    expect(feed(dir, 0).paused).toBe(true);
    let held = 0, waits = 0;
    const out = await waitWhilePaused(dir, () => held++, 1, async () => { if (++waits === 3) pause(dir, false); });
    expect([out, held, waits]).toEqual([true, 1, 3]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("deploy and health from an infra graph land in the feed as deploy-lane steps", () => {
  const dir = mkdtempSync(join(tmpdir(), "mervin-deploy-"));
  try {
    expect(feedDeploy(dir, { app: "a", nodes: [{ id: "w", kind: "worker", label: "api", health: { status: "down" } }, { id: "x", kind: "r2", label: "bucket" }] })).toBe(1);
    expect(feed(dir, 0).steps).toMatchObject([{ kind: "step", lane: "deploy", name: "a/api down", state: "fail" }]);
    expect(() => feedDeploy(dir, { nope: 1 })).toThrow("not an infra graph");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
