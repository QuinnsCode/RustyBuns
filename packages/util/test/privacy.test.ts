// The corners of @rustybuns/util/privacy an app's journey test won't reach: which countries are Europe, what a seal refuses,
// and a vault's consent ledger (eqosys's journey covers the region, the download and shredding: apps/eqosys/test/privacy.test.ts).
import { expect, test } from "bun:test";
import { newDataKey, regionOf, seal, unseal, Vault } from "../src/privacy.ts";

test("Europe is the EU, the EEA, the UK and Switzerland, by what Cloudflare says", () => {
  const cases: [unknown, "eu" | null][] = [
    [{ country: "DE", isEUCountry: "1" }, "eu"], [{ country: "NO" }, "eu"], [{ country: "GB" }, "eu"], [{ country: "CH" }, "eu"],
    [{ country: "US" }, null], [{ country: "TR" }, null], [undefined, null], [{}, null],
  ];
  for (const [cf, want] of cases) expect([cf, regionOf(cf)]).toEqual([cf, want]);
});

test("a seal opens only with its key and for its place", async () => {
  const key = newDataKey(), data = new TextEncoder().encode("level 7");
  const sealed = await seal(key, data, "u1/game/run");
  expect(await unseal(key, sealed, "u1/game/run")).toEqual(data);
  expect(await unseal(key, sealed, "u2/game/run")).toBeNull();
  expect(await unseal(newDataKey(), sealed, "u1/game/run")).toBeNull();
  sealed[sealed.length - 1]! ^= 1;
  expect(await unseal(key, sealed, "u1/game/run")).toBeNull();
});

test("consent is a ledger: the latest per purpose is in force, every change is kept, and shredding forgets it", async () => {
  const m = new Map<string, unknown>();
  const vault = new Vault({ get: async <T>(k: string) => m.get(k) as T | undefined, put: async (k, v) => void m.set(k, v), delete: async (k) => m.delete(k) });
  const post = (path: string, body: unknown) => vault.fetch(new Request(`https://vault${path}`, { method: "POST", body: JSON.stringify(body) }));
  await post("/consent", { purpose: "analytics", granted: true, version: "2026-11", at: 1 });
  await post("/consent", { purpose: "analytics", granted: false, version: "2026-11", at: 2 });
  expect((await post("/consent", { purpose: "Analytics!", granted: true, version: "x", at: 3 })).status).toBe(400);
  const state = await vault.state();
  expect(state.consents.analytics?.granted).toBe(false);
  expect(state.ledger.map((c) => c.granted)).toEqual([true, false]);
  expect(state.log.map((a) => a.kind)).toEqual(["consent", "consent"]);
  const key = await vault.key();
  expect(await vault.key()).toBe(key);
  await vault.shred();
  expect(await vault.state()).toEqual({ region: null, consents: {}, ledger: [], log: [] });
  expect(await vault.key()).not.toBe(key);
});
