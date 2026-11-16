import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { issueMatcher } from "./bridge-lib.ts";
import { serve } from "./bridge.ts";

setDefaultTimeout(60_000);

const dir = mkdtempSync(join(tmpdir(), "bridge-"));
const tiersFile = join(dir, "tiers.json");
const server = serve({ port: 0, tiersFile, offline: true });
const base = `http://localhost:${server.port}`;
afterAll(() => { server.stop(true); rmSync(dir, { recursive: true, force: true }); });

type Data = { scanning: boolean; tiers: Record<string, string[]>; scan: { apps: { id: string; platforms: Record<string, number>; commit: unknown }[] } | null };
async function data(): Promise<Data> {
  for (;;) {
    const d: Data = await (await fetch(`${base}/api/data`)).json();
    if (!d.scanning && d.scan) return d;
    await Bun.sleep(200);
  }
}
const post = (body: unknown) => fetch(`${base}/api/tiers`, { method: "POST", body: JSON.stringify(body) });

test("the owner opens the bridge, sees every app, and drags two into tiers", async () => {
  const first = await data();
  const hippo = first.scan?.apps.find((a) => a.id === "hippo-tycoon");
  // Desktop binaries from CI, the edge on Cloudflare, installable on Android, no iOS shell.
  expect(hippo?.platforms).toMatchObject({ mac: 2, windows: 2, linux: 2, cloudflare: 1, android: 1, ios: 0 });
  expect(hippo?.commit).not.toBeNull();
  expect(first.tiers.S).toEqual([]);

  expect((await post({ app: "hippo-tycoon", tier: "B" })).status).toBe(200);
  expect((await post({ app: "qcrm", tier: "B", index: 0 })).status).toBe(200);
  // Moving one up takes it out of its old row.
  expect((await post({ app: "hippo-tycoon", tier: "S" })).status).toBe(200);
  const after = await data();
  expect(after.tiers.S).toEqual(["hippo-tycoon"]);
  expect(after.tiers.B).toEqual(["qcrm"]);
  // Saved where the next bridge (any checkout) reads it.
  expect(JSON.parse(readFileSync(tiersFile, "utf8")).S).toEqual(["hippo-tycoon"]);

  const bad = await post({ app: "qcrm", tier: "Z" });
  expect(bad.status).toBe(400);
  expect((await data()).tiers.B).toEqual(["qcrm"]);
});

test("issues land on the app their title names", () => {
  const about = issueMatcher([
    { id: "skate-tech-park", names: ["Skate Tech Park"] },
    { id: "codesplitter", names: ["codeSplitter"] },
    { id: "park-hide-seek", names: ["Park Hide & Seek"] },
    { id: "mythic-masters", names: ["Mythic Masters"] },
    { id: "rustybuns", names: [] },
    { id: "qcrm", names: ["qCRM"] },
  ]);
  const cases: [string, string[], string | null][] = [
    ["Skate Tech Park: footplants and handplants", [], "skate-tech-park"],
    ["MANUAL RUN: Park Hide & Seek iOS on a phone", ["manual run"], "park-hide-seek"],
    ["codeSplitters scale: one DO per repo", [], "codesplitter"],
    ["Mervin: three-way merges of moved files", [], "codesplitter"],
    ["CI: the hourly ring misses a push", [], "rustybuns"],
    ["Circuit boards in the workshop", [], null],
    ["Webhook retries drop a delivery", ["qcrm"], "qcrm"],
  ];
  for (const [title, labels, want] of cases) expect([title, about(title, labels)]).toEqual([title, want]);
});
