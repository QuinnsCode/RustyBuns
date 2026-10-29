import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { startStage } from "../demo/stage.ts";
import { fromHash, names } from "../demo/scenarios.ts";

setDefaultTimeout(30_000);

// The stage on a real port, its routes asked the way the office's page scripts ask them.
const stage = await startStage({ scenario: "writes-ask-pending" });
afterAll(() => stage.stop());
const get = async (p: string) => (await fetch(stage.url + p)).json() as Promise<any>;
const post = (p: string, headers: Record<string, string> = {}) => fetch(stage.url + p, { method: "POST", headers }).then((r) => r.json() as Promise<any>);
const until = async <T>(f: () => Promise<T | false>) => { for (let i = 0; i < 100; i++) { const v = await f(); if (v) return v; await Bun.sleep(50); } throw new Error("never happened"); };
const go = (name: string) => post(`/__stage/go?scenario=${name}`);

test("a worker's push waits on the card; Always lets the next one through and lists the grant", async () => {
  const [ask] = (await until(async () => { const a = (await get("/__rb/asks")).asks; return a.length ? a : false; }));
  expect(ask.detail).toContain("git push origin office/gizmo-221a");
  expect(ask.always).toBe("push on QuinnsCode/RustyBuns");
  await post(`/__rb/asks/${ask.id}?allow=1&always=1`, { "x-rb-ask": "1" });
  await until(async () => (await get("/__stage/state")).log.length > 0);
  expect((await get("/__rb/grants")).grants.map((g: any) => [g.repo, g.kind])).toEqual([["QuinnsCode/RustyBuns", "push"]]);
  await post("/__stage/push?who=Byte");
  await until(async () => (await get("/__stage/state")).log.length > 1);
  expect((await get("/__rb/asks")).asks).toEqual([]);
  // a stranger's POST without the header is refused
  expect((await post(`/__rb/grants?do=revoke&repo=QuinnsCode/RustyBuns&kind=push`)).error).toContain("x-rb-ask");
});

test("the setup states: a typed code adds the account, Test turns a stale one red, Revoke drops it", async () => {
  await go("setup-sign-in-code");
  expect((await get("/__stage/state")).waiting).toBe(true);
  await post("/__stage/type");
  const done = await until(async () => { const c = await get("/__rb/connections"); return c.connections.length ? c : false; });
  expect(done.connections[0]).toMatchObject({ account: "octo-demo", status: "ok", access: "read" });

  await go("setup-test-red");
  const tones = (await get("/__rb/connections")).connections.map((c: any) => [c.account, c.status]);
  expect(tones).toEqual([["octo-demo", "ok"], ["stale-demo", "down"]]);
  expect((await post("/__rb/connections?do=revoke&id=github:stale-demo")).connections).toHaveLength(1);
});

test("Ester mid-run ticks, and a click on her starts a run that ends red with a hold list", async () => {
  await go("wall-ester-running");
  const mid = (await get("/__rb/helpers")).ester;
  expect(mid.phase).toBe("running");
  expect(Date.now() - mid.startedAt).toBeGreaterThan(44_000);
  expect(mid.lines.some((l: string) => l.startsWith("pass  apps/agent-office"))).toBe(true);
  expect((await get("/__rb/line")).open.length).toBeGreaterThan(3);
  await go("wall-ester-red");
  expect((await get("/__rb/helpers")).ester).toMatchObject({ phase: "red", hold: [103] });
});

test("every scenario starts and answers its state", async () => {
  for (const n of names()) { await go(n); expect((await get("/__stage/state")).scenario).toBe(n); }
  expect((await post("/__stage/go?scenario=nope")).error).toContain("scenario is one of");
  await expect(startStage({ scenario: "nope" })).rejects.toThrow("no scenario");
});

test("short links land in the state a MANUAL RUN needs", () => {
  expect([fromHash("#setup=github-signin"), fromHash("#settings=grants"), fromHash("#scenario=wall-mervin"), fromHash("#nope"), fromHash("")])
    .toEqual(["setup-sign-in-code", "writes-grants", "wall-mervin", null, null]);
});
