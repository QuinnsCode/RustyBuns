import { test, expect } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ADVISORIES_URL, advise, checkDisabled, checkVersion, matching, validRange, type Advisory } from "../src/advisories.ts";

const bad: Advisory[] = [
  { versions: "0.1.6", do: "upgrade", to: "latest", why: "stale deps" },
  { versions: ">=0.2.0 <0.2.2", do: "downgrade", to: "0.1.10", why: "broken deploy", issue: 42 },
];

const fakeFetch = (advisories: Advisory[], latest: string, calls: string[] = []) =>
  (async (url: string) => {
    calls.push(String(url));
    return Response.json(String(url) === ADVISORIES_URL ? { advisories } : { version: latest });
  }) as unknown as typeof fetch;

test("matching: exact versions and ranges", () => {
  expect(matching("0.1.6", bad).map((a) => a.why)).toEqual(["stale deps"]);
  expect(matching("0.2.1", bad).map((a) => a.why)).toEqual(["broken deploy"]);
  expect(matching("0.2.2", bad)).toEqual([]);
  // Bun.semver matches a range it cannot parse against everything; those never match here.
  for (const versions of ["not a range", "0.1", "", "^0.1.6", "0.1.6 ||"]) expect(matching("0.1.6", [{ ...bad[0]!, versions }])).toEqual([]);
  expect(validRange("0.1.6 || >=0.2.0 <0.2.2")).toBe(true);
});

test("advise: a bad release says which way to go, an old one gets a line, a current one nothing", () => {
  const up = advise("0.1.6", { advisories: bad, latest: "0.1.10" })!;
  expect(up).toContain("known-bad");
  expect(up).toContain("upgrade: bun add -d @rustybuns/cli@0.1.10");

  const back = advise("0.2.0", { advisories: bad, latest: "0.2.1" })!;
  expect(back).toContain("go back: bun add -d @rustybuns/cli@0.1.10");
  expect(back).toContain("issues/42");

  expect(advise("0.1.8", { advisories: bad, latest: "0.1.10" })).toBe("rustybuns 0.1.10 is out (you have 0.1.8): bun add -d @rustybuns/cli@latest");
  expect(advise("0.1.10", { advisories: bad, latest: "0.1.10" })).toBeNull();
  expect(advise("0.1.11", { advisories: bad, latest: "0.1.10" })).toBeNull();
});

test("checkVersion: fetches once a day, keeps the cache when offline", async () => {
  const path = join(mkdtempSync(join(tmpdir(), "rb-adv-")), "check.json");
  const calls: string[] = [];
  const t0 = 1_000_000;
  expect(await checkVersion("0.1.6", { path, now: t0, fetcher: fakeFetch(bad, "0.1.10", calls) })).toContain("known-bad");
  expect(calls.length).toBe(2);

  // Within the day: the cache answers.
  expect(await checkVersion("0.1.6", { path, now: t0 + 1000, fetcher: fakeFetch([], "9.9.9", calls) })).toContain("@0.1.10");
  expect(calls.length).toBe(2);

  // A day later, offline: the old facts still answer, and nothing throws.
  const offline = (async () => { throw new Error("offline"); }) as unknown as typeof fetch;
  expect(await checkVersion("0.1.6", { path, now: t0 + 2 * 86_400_000, fetcher: offline })).toContain("known-bad");
  expect(JSON.parse(readFileSync(path, "utf8")).latest).toBe("0.1.10");
});

test("the check is off in CI and with RUSTYBUNS_NO_UPDATE_CHECK", () => {
  expect(checkDisabled({ CI: "true" })).toBe(true);
  expect(checkDisabled({ RUSTYBUNS_NO_UPDATE_CHECK: "1" })).toBe(true);
  expect(checkDisabled({})).toBe(false);
});

test("advisories.json: every entry is well formed", () => {
  const { advisories } = JSON.parse(readFileSync(new URL("../../../advisories.json", import.meta.url), "utf8")) as { advisories: Advisory[] };
  expect(advisories.length).toBeGreaterThan(0);
  for (const a of advisories) {
    expect(validRange(a.versions)).toBe(true);
    expect(["upgrade", "downgrade"]).toContain(a.do);
    expect(a.to === "latest" || /^\d+\.\d+\.\d+/.test(a.to)).toBe(true);
    expect(a.why.length).toBeGreaterThan(0);
    // The version it sends people to is not itself bad.
    if (a.to !== "latest") expect(matching(a.to, advisories)).toEqual([]);
  }
});
