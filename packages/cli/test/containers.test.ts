import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RustyBunsConfig } from "../src/config.ts";
import { bindingsWhy, containerBindings, contextHash, envFlags, freshness, listText, needDocker, pick, progressLine, readLedger, schemaNames, writeLedger } from "../src/containers.ts";

const cfg = {
  name: "demo",
  bindings: {
    SANDBOX: { type: "container", className: "Sandbox", dockerfile: "sandbox/Dockerfile", maxInstances: 2, instanceType: "basic" },
    CI: { type: "container", className: "Ci", dockerfile: "deploy/ci.Dockerfile" },
    DB: { type: "d1", databaseName: "x" },
  },
} as unknown as RustyBunsConfig;

test("bindings come from the config with Alchemy's context and defaults; pick names the unknown", () => {
  const bs = containerBindings(cfg);
  expect(bs.map((b) => [b.name, b.context, b.maxInstances, b.instanceType])).toEqual([["SANDBOX", "sandbox", 2, "basic"], ["CI", "deploy", 1, "lite"]]);
  expect(pick(bs, ["CI"]).map((b) => b.name)).toEqual(["CI"]);
  expect(() => pick(bs, ["NOPE"])).toThrow("no container binding NOPE. This app has: SANDBOX, CI");
});

test("staleness: a changed file changes the hash, and the ledger drives built / stale / not built", () => {
  const dir = mkdtempSync(join(tmpdir(), "rb-ctr-"));
  mkdirSync(join(dir, "ctx/node_modules"), { recursive: true });
  writeFileSync(join(dir, "ctx/Dockerfile"), "FROM scratch");
  writeFileSync(join(dir, "ctx/server.mjs"), "a");
  const h1 = contextHash(join(dir, "ctx"));
  writeFileSync(join(dir, "ctx/node_modules/x.js"), "ignored");
  expect(contextHash(join(dir, "ctx"))).toBe(h1);
  writeFileSync(join(dir, "ctx/server.mjs"), "b");
  const h2 = contextHash(join(dir, "ctx"));
  expect(h2).not.toBe(h1);

  const b = containerBindings(cfg)[0]!;
  expect(freshness(b, readLedger(dir), h1)).toBe("not built");
  writeLedger({ SANDBOX: { hash: h1, size: 8e8, at: Date.now() - 180_000, dockerfile: b.dockerfile } }, dir);
  expect(freshness(b, readLedger(dir), h1)).toBe("built");
  expect(freshness(b, readLedger(dir), h2)).toBe("stale");
  expect(listText([b], readLedger(dir), () => h1)).toContain("built 3m ago · 800 MB");
});

test("the Docker preflight says one thing, with the binding count, and passes when the daemon is up", () => {
  expect(() => needDocker(bindingsWhy(3), () => false)).toThrow("Docker isn't running. This app has 3 container bindings, and deploy builds their images locally. Start Docker Desktop and run this again.");
  expect(() => needDocker("x", () => true)).not.toThrow();
});

test("BuildKit progress lines become step n/m; --env pairs and .env.schema names are read, values never", () => {
  expect(progressLine("#7 [builder 3/9] RUN apt-get update")).toEqual({ step: 3, of: 9, what: "RUN apt-get update" });
  expect(progressLine("#7 0.5 Get:1 http://deb")).toBeNull();
  expect(envFlags(["a", "--env", "X=1=2", "--env-file", ".e", "b"])).toEqual({ env: { X: "1=2" }, file: ".e", rest: ["a", "b"] });
  const dir = mkdtempSync(join(tmpdir(), "rb-ctr-"));
  writeFileSync(join(dir, ".env.schema"), "# c\nGH_TOKEN=\nPLAIN=1\n");
  expect(schemaNames(dir)).toEqual(["GH_TOKEN", "PLAIN"]);
});
