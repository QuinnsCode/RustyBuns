import { expect, test } from "bun:test";
import { classify, stackable, tierOf } from "./ci-tier.ts";

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
