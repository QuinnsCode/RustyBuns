import { test, expect } from "bun:test";
import { billables, checkSpend, costReport, largeServer } from "../src/costs.ts";
import type { RustyBunsConfig } from "../src/config.ts";

const edge: RustyBunsConfig = {
  name: "game",
  worker: { main: "src/worker.ts", compatibilityDate: "2026-09-01", compatibilityFlags: [] },
  bindings: { WORLD: { type: "durable_object", className: "World" }, API_KEY: { type: "secret" } },
  targets: { edge: { provider: "cloudflare" } },
};
const boxed = (serverType: string, allowLargeServer?: boolean): RustyBunsConfig =>
  ({ ...edge, targets: { box: { provider: "hetzner", serverType, allowLargeServer } } });

test("largeServer: small shared tiers pass, tier 3+, dedicated and unknown names do not", () => {
  for (const t of ["cx22", "cx23", "cpx11", "cpx12", "cpx22", "cax11", "cax21"]) expect(largeServer(t)).toBe(false);
  for (const t of ["cpx31", "cx42", "cax41", "ccx13", "something-new"]) expect(largeServer(t)).toBe(true);
});

test("billables: edge lists usage resources only, secrets cost nothing", () => {
  const b = billables(edge);
  expect(b.map((r) => r.what)).toEqual([`Cloudflare Worker "game"`, "Durable Object WORLD"]);
  expect(b.every((r) => r.kind === "usage")).toBe(true);
  expect(costReport(edge)).not.toContain("destroy");
});

test("billables: a box is a fixed cost and the report says how to stop it", () => {
  const b = billables(boxed("cpx12"));
  expect(b.filter((r) => r.kind === "fixed").map((r) => r.what)).toEqual(["Hetzner cpx12 in nbg1", "Hetzner Volume 10 GB"]);
  expect(costReport(boxed("cpx12"))).toContain("rustybuns destroy");
});

test("checkSpend: a large box needs the opt-in, a small one does not", () => {
  expect(() => checkSpend(boxed("cpx12"))).not.toThrow();
  expect(() => checkSpend(boxed("ccx33"))).toThrow(/allowLargeServer/);
  expect(() => checkSpend(boxed("ccx33", true))).not.toThrow();
  expect(() => checkSpend(edge)).not.toThrow();
});
