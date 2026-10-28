import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { connections } from "../connect/github.ts";
import { fileSecrets } from "../connect/keychain.ts";
import { LIGHT, accessWords, act, connectGithub, isFirstRun, loadBuilder, loadSetup, nightlyLine, parseSetup } from "../setup/model.ts";
import { fakeGitHub } from "../demo/fake-github.ts";

setDefaultTimeout(10_000);

// The page's fetches go to the real /__rb/connections route (connect/github.ts) with a fake GitHub behind it;
// /__rb/builder is a fixed answer.
const real = globalThis.fetch;
const gh = fakeGitHub();
const dir = mkdtempSync(`${tmpdir()}/setup-`);
const route = connections({ dir, clientId: "Iv1.test", secrets: fileSecrets(dir), fetch: (u, i) => real(u, i), web: gh.base, api: gh.base, wait: () => Bun.sleep(5) });
globalThis.fetch = (async (u: string, init?: RequestInit) => {
  const url = new URL(u, "http://office");
  if (url.pathname === "/__rb/builder") return Response.json({ connections: [{ id: "builder", kind: "builder", account: "q@Mac.local", status: "down", access: "read" }], setup: "sh setup", nightly: null });
  const r = await route(init?.method ?? "GET", url);
  return Response.json(r?.body ?? {}, { status: r?.status ?? 404 });
}) as typeof fetch;
afterAll(() => { globalThis.fetch = real; gh.stop(); });
const until = async (f: (s: Awaited<ReturnType<typeof loadSetup>>) => boolean) => { for (let i = 0; i < 200; i++) { const s = await loadSetup(); if (f(s)) return s; await Bun.sleep(10); } throw new Error("never happened"); };

test("the journey the cards show: empty, sign-in code, account, test, revoke", async () => {
  let s = await loadSetup();
  expect(isFirstRun(s)).toBe(true); // empty state + walk-through

  await connectGithub();
  s = await loadSetup();
  expect(s.pending[0]?.userCode).toBe("ABCD-0001");
  expect(isFirstRun(s)).toBe(false); // the code replaces the steps

  gh.type("dev1", "octo"); // the user entered the code
  s = await until((s) => s.connections.length === 1);
  expect(s.connections.map((c) => [c.account, LIGHT[c.status].tone, accessWords(c.access)])).toEqual([["octo", "green", "read-only"]]);

  await act("test", "github:octo");
  await act("revoke", "github:octo");
  expect(isFirstRun(await loadSetup())).toBe(true);
});

test("a failed action says why, and a second account is a second card", async () => {
  await expect(act("test", "nope")).rejects.toThrow();
  await connectGithub(); gh.type("dev2", "one");
  await until((s) => s.connections.length === 1);
  await connectGithub(); gh.type("dev3", "two");
  await until((s) => s.connections.length === 2);
  gh.expire("two"); // GitHub stops accepting its token
  await act("test", "github:two");
  const s = await loadSetup();
  expect(s.connections.map((c) => LIGHT[c.status].tone)).toEqual(["green", "red"]);
});

test("a reply of the wrong shape is no cards, not a crash", async () => {
  expect(parseSetup("x").error).toBeDefined();
  expect(parseSetup({ connections: [{ id: 1 }, { id: "a", kind: "github", account: "z", status: "weird" }, null], pending: [{ id: "p" }], ready: 1 })).toEqual({ connections: [], pending: [], ready: false });
});

test("the builder card comes from /__rb/builder; last night's line", async () => {
  expect((await loadBuilder())?.connections[0]?.status).toBe("down");
  expect(nightlyLine({ at: "2026-10-28T03:00:00Z", results: [{ app: "a", ok: true }, { app: "b", ok: false }] })).toContain("1 of 2 built, failed: b");
});
