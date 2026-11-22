import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { bisect, classify, dial, readVerdicts, recordVerdict, stackable, testWaves, tierLine, tierOf, trustFile, type Tier, type Verdict } from "./ci-tier.ts";

test("each file lands in its tier", () => {
  expect(tierOf("README.md")).toBe(0);
  expect(tierOf("apps/codesplitter/src/repos.ts")).toBe(1);
  expect(tierOf("apps/codesplitter/README.md")).toBe(0);
  expect(tierOf("packages/cli/src/index.ts")).toBe(2);
  expect(tierOf("bun.lock")).toBe(2);
  expect(tierOf("apps/codesplitter/sandbox/Dockerfile")).toBe(3);
  expect(tierOf("deploy-sandbox/ci.Dockerfile")).toBe(3);
  expect(tierOf(".github/workflows/apps.yml")).toBe(3);
  expect(tierOf(".github/workflows/npm-publish.yml")).toBe(4);
  expect(tierOf("apps/x/.dev.vars")).toBe(4);
  expect(tierOf(".env.schema")).toBe(2);
});

test("a diff takes its highest tier, and only 3 and 4 refuse to stack", () => {
  expect(classify([])).toBe(0);
  expect(classify(["README.md", "apps/borg/src/a.ts"])).toBe(1);
  expect(classify(["apps/borg/src/a.ts", "scripts/ci-apps.ts"])).toBe(3);
  expect([0, 1, 2, 3, 4].map((t) => stackable(t as 0))).toEqual([true, true, true, false, false]);
});

test("the builder's tier line says whether a diff may share a run", () => {
  expect(tierLine(["apps/borg/src/a.ts"])).toBe("tier 1 (one app): may share a test run");
  expect(tierLine(["scripts/ci-apps.ts"])).toBe("tier 3 (tooling): runs alone, never stacked");
  expect(tierLine(["apps/x/wrangler.jsonc"])).toBe("tier 4 (secrets or deploys): a person checks it before it merges");
});

test("a batch with a tooling PR runs in two waves, and a red batch of four bisects to the bad PR", async () => {
  const files: Record<number, string[]> = { 1: ["README.md"], 2: ["apps/borg/src/a.ts"], 3: ["scripts/ci-apps.ts"], 4: ["apps/golf/src/b.ts"] };
  expect(testWaves([1, 2, 3, 4], (n) => files[n]!)).toEqual([[1, 2, 4], [3]]);
  const tried: number[][] = [];
  const out = await bisect([1, 2, 3, 4], async (b) => (tried.push(b), !b.includes(3)));
  expect(out).toEqual({ good: [1, 2, 4], bad: [3], runs: 5 });
  expect(tried).toEqual([[1, 2, 3, 4], [1, 2], [3, 4], [3], [4]]);
});

test("the trust dial: five clean runs in two weeks earn the targeted run, one failure or a riskier tier takes it away", async () => {
  const now = 100 * 86_400_000, day = 86_400_000;
  const clean = (n: number, who = "ana", tier = 1): Verdict[] => Array.from({ length: n }, (_, i) => ({ who, tier, passed: true, at: now - (i + 1) * day }));
  const cases: [string, Verdict[], Tier, boolean][] = [
    ["a new agent", [], 1, false],
    ["four clean", clean(4), 1, false],
    ["five clean", clean(5), 1, true],
    ["five clean, then a failure", [...clean(5), { who: "ana", tier: 1, passed: false, at: now - 1000 }], 1, false],
    ["a failure, then five clean", [{ who: "ana", tier: 1, passed: false, at: now - 9 * day }, ...clean(5)], 1, true],
    ["five clean, but someone else's", clean(5, "bo"), 1, false],
    ["five clean, but on tier 0", clean(5, "ana", 0), 1, false],
    ["five clean, but a month ago", clean(5).map((v) => ({ ...v, at: v.at - 30 * day })), 1, false],
    ["five clean on shared code", clean(5, "ana", 2), 2, false],
  ];
  for (const [name, history, tier, targeted] of cases) expect([name, dial(history, "ana", tier, now).targeted]).toEqual([name, targeted]);

  const dir = mkdtempSync(`${tmpdir()}/trust-`);
  process.env.BUILDER_TRUST = `${dir}/trust.jsonl`;
  try {
    for (const v of clean(5)) await recordVerdict(v);
    await Bun.write(trustFile(), (await Bun.file(trustFile()).text()) + "not json\n" + JSON.stringify({ who: "ana", tier: 9 }) + "\n");
    expect(dial(await readVerdicts(), "ana", 1, now).targeted).toBe(true);
  } finally {
    delete process.env.BUILDER_TRUST;
  }
});
