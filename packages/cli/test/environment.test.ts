import { expect, test } from "bun:test";
import type { RustyBunsConfig } from "../src/config.ts";
import { environmentBanner, environmentOf, ephemeralProblem, realDestroyProblem } from "../src/environment.ts";
import { isolationFlags } from "../src/isolation.ts";
import { infraGraph, infraText } from "../src/infra.ts";

const cfg = (o: { adopt?: boolean; protect?: boolean } = {}): RustyBunsConfig => ({
  name: "shop",
  worker: { main: "src/index.ts" },
  bindings: { DB: { type: "d1", databaseName: "shop-db", ...(o.protect ? { protect: true } : {}) } },
  targets: { edge: { provider: "cloudflare", ...(o.adopt ? { adopt: true } : {}) } },
} as unknown as RustyBunsConfig);

test("a preview stage with nothing adopted or protected is EPHEMERAL; prod, adopt and protect make it REAL", () => {
  expect(environmentOf(cfg(), "preview-1")).toBe("ephemeral");
  expect(environmentOf(cfg(), "prod")).toBe("real");
  expect(environmentOf(cfg({ adopt: true }), "preview-1")).toBe("real");
  expect(environmentOf(cfg({ protect: true }), "preview-1")).toBe("real");
});

test("the banner opens with the environment and says why", () => {
  expect(environmentBanner(cfg(), "preview-1", "plan")).toStartWith("environment: EPHEMERAL (stage preview-1)");
  const real = environmentBanner(cfg({ protect: true }), "prod", "deploy");
  expect(real).toStartWith("environment: REAL (stage prod)");
  expect(real).toContain('because stage "prod" is named like production');
  expect(real).toContain("[KEPT]    D1 shop-db");
});

test("--ephemeral is refused on a REAL environment, and --real/--ephemeral set the isolation flags", () => {
  expect(ephemeralProblem(cfg(), "preview-1")).toBeNull();
  expect(ephemeralProblem(cfg(), "prod")).toContain("REAL");
  expect(isolationFlags(["--ephemeral"])).toMatchObject({ fresh: true, ephemeral: true });
  expect(isolationFlags(["--real"])).toMatchObject({ adoptExisting: true, real: true });
});

test("destroying a prod-named stage that deletes data needs --real; a preview stage does not", () => {
  expect(realDestroyProblem("destroy", cfg(), "prod", false)).toContain("--real");
  expect(realDestroyProblem("destroy", cfg(), "prod", true)).toBeNull();
  expect(realDestroyProblem("destroy", cfg(), "preview-1", false)).toBeNull();
  expect(realDestroyProblem("destroy", cfg({ protect: true }), "prod", false)).toBeNull();
  expect(realDestroyProblem("deploy", cfg(), "prod", false)).toBeNull();
});

test("the infra graph carries the environment for the UI", () => {
  const g = infraGraph(cfg(), "prod");
  expect(g).toMatchObject({ environment: "real" });
  expect(g.reasons.length).toBe(1);
  expect(infraText(g)).toContain("REAL · FRESH");
});
