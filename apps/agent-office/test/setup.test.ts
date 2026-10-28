import { afterAll, expect, test } from "bun:test";
import { LIGHT, accessWords, act, connectGithub, isFirstRun, loadBuilder, loadSetup, nightlyLine, parseSetup } from "../setup/model.ts";

// STUB of #2502's /__rb/connections (not merged yet): swap for the real connections() route once it lands.
let accounts: { id: string; kind: string; account: string; status: string; access: string }[] = [];
let pending: { id: string; userCode: string; uri: string; expiresAt: number }[] = [];
const server = Bun.serve({
  port: 0,
  fetch(req) {
    const url = new URL(req.url), id = url.searchParams.get("id");
    if (url.pathname === "/__rb/builder") return Response.json({ connections: [{ id: "builder", kind: "builder", account: "q@Mac.local", status: "down", access: "read" }], setup: "sh setup", nightly: null });
    const what = url.searchParams.get("do");
    if (req.method === "POST" && what === "github") pending = [{ id: "p1", userCode: "ABCD-1234", uri: "https://github.com/login/device", expiresAt: Date.now() + 9e5 }];
    if (what === "cancel") pending = pending.filter((p) => p.id !== id);
    if (what === "revoke") accounts = accounts.filter((a) => a.id !== id);
    if (what === "test" && !accounts.some((a) => a.id === id)) return Response.json({ error: "No such connection" }, { status: 404 });
    return Response.json({ connections: accounts, pending, ready: true });
  },
});
const real = globalThis.fetch;
globalThis.fetch = ((u: string, init?: RequestInit) => real(`http://127.0.0.1:${server.port}${u}`, init)) as typeof fetch;
afterAll(() => { globalThis.fetch = real; server.stop(true); });

test("the journey the cards show: empty, sign-in code, account, test, revoke", async () => {
  let s = await loadSetup();
  expect(isFirstRun(s)).toBe(true); // empty state + walk-through

  await connectGithub();
  s = await loadSetup();
  expect(s.pending[0]?.userCode).toBe("ABCD-1234");
  expect(isFirstRun(s)).toBe(false); // the code replaces the steps

  accounts = [{ id: "gh1", kind: "github", account: "octo", status: "ok", access: "read" }]; // the user entered the code
  pending = [];
  s = await loadSetup();
  expect(s.connections.map((c) => [c.account, LIGHT[c.status].tone, accessWords(c.access)])).toEqual([["octo", "green", "read-only"]]);

  await act("test", "gh1");
  await act("revoke", "gh1");
  expect(isFirstRun(await loadSetup())).toBe(true);
});

test("a failed action says why, and a second account is a second card", async () => {
  await expect(act("test", "nope")).rejects.toThrow("No such connection");
  accounts = [{ id: "a", kind: "github", account: "one", status: "ok", access: "read" }, { id: "b", kind: "github", account: "two", status: "down", access: "write" }];
  const s = await loadSetup();
  expect(s.connections.map((c) => LIGHT[c.status].tone)).toEqual(["green", "red"]);
  expect(accessWords(s.connections[1]!.access)).toBe("write");
});

test("a reply of the wrong shape is no cards, not a crash", async () => {
  expect(parseSetup("x").error).toBeDefined();
  expect(parseSetup({ connections: [{ id: 1 }, { id: "a", kind: "github", account: "z", status: "weird" }, null], pending: [{ id: "p" }], ready: 1 })).toEqual({ connections: [], pending: [], ready: false });
});

test("the builder card comes from /__rb/builder; last night's line", async () => {
  expect((await loadBuilder())?.connections[0]?.status).toBe("down");
  expect(nightlyLine({ at: "2026-10-28T03:00:00Z", results: [{ app: "a", ok: true }, { app: "b", ok: false }] })).toContain("1 of 2 built, failed: b");
});
