// A PR that bumps a pin in package.json but not bun.lock (#4370) fails; one that bumps both passes.
import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { drift } from "./lock-drift.ts";

const repo = (pin: string, locked: string) => {
  const root = mkdtempSync(join(tmpdir(), "lock-drift-"));
  mkdirSync(join(root, "apps/hono-example"), { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "rustybuns", workspaces: ["apps/*"] }));
  writeFileSync(join(root, "apps/hono-example/package.json"), JSON.stringify({ name: "hono-example", dependencies: { hono: pin } }));
  // bun.lock's own shape, trailing commas and all.
  writeFileSync(join(root, "bun.lock"), `{\n  "lockfileVersion": 1,\n  "workspaces": {\n    "": { "name": "rustybuns", },\n    "apps/hono-example": { "name": "hono-example", "dependencies": { "hono": "${locked}", }, },\n  },\n  "packages": {},\n}\n`);
  return root;
};

test.each([
  ["both bumped", "4.13.16", "4.13.16", []],
  ["only package.json bumped", "4.13.16", "4.13.14", ["apps/hono-example dependencies hono: 4.13.16 in package.json vs 4.13.14 in bun.lock"]],
])("%s", async (_, pin, locked, want) => {
  expect(await drift(repo(pin, locked))).toEqual(want);
});
