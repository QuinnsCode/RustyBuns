import { test, expect } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ADVISORIES_URL, advise, ageGate, adviseApp, adviseBuilt, appLaunchCheck, checkDisabled, checkVersion, launchCheck, matching, validRange, type Advisory } from "../src/advisories.ts";

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

test("adviseBuilt: a bad build says what to rebuild with; an old-but-fine one says nothing", () => {
  const up = adviseBuilt("0.1.6", { advisories: bad, latest: "0.1.10" })!;
  expect(up).toContain("built with RustyBuns 0.1.6, a known-bad release");
  expect(up).toContain("rebuild with 0.1.10: bun add -d @rustybuns/cli@0.1.10 && rustybuns build desktop");
  expect(adviseBuilt("0.2.1", { advisories: bad, latest: "0.2.2" })).toContain("rebuild with 0.1.10");
  expect(adviseBuilt("0.1.8", { advisories: bad, latest: "0.1.10" })).toBeNull();
});

test("launchCheck: the notice in a dev build, one log line in a release build, off in CI", async () => {
  const path = join(mkdtempSync(join(tmpdir(), "rb-adv-")), "check.json");
  const fetcher = fakeFetch(bad, "0.1.10");
  const warn = console.warn;
  const said: string[] = [];
  console.warn = (m: string) => { said.push(m); };
  try {
    const dev = (await launchCheck("0.1.6", { dev: true, path, fetcher, env: {} }))!;
    expect(dev.split("\n").length).toBeGreaterThan(2);
    const release = (await launchCheck("0.1.6", { dev: false, path, fetcher, env: {} }))!;
    expect(release).not.toContain("\n");
    expect(release).toContain("[rustybuns] this app was built with RustyBuns 0.1.6, a known-bad release. · stale deps · rebuild with 0.1.10");
    expect(said).toEqual([dev, release]);
    expect(await launchCheck("0.1.8", { dev: true, path, fetcher, env: {} })).toBeNull();
    expect(await launchCheck(undefined, { dev: true, path, fetcher, env: {} })).toBeNull();
    expect(await launchCheck("0.1.6", { dev: true, path, fetcher, env: { CI: "true" } })).toBeNull();
    expect(said.length).toBe(2);
  } finally {
    console.warn = warn;
  }
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

test("adviseApp: tells the app's users which version to move to, and where", () => {
  const app = [
    { versions: "1.3.0", do: "upgrade", to: "latest", why: "saves are lost on quit", issue: "https://example.com/bug/7" },
    { versions: ">=2.0.0 <2.0.2", do: "downgrade", to: "1.4.0", why: "crashes at start" },
  ] satisfies Advisory[];
  expect(adviseApp("tsci", "1.3.0", { advisories: app, latest: "1.4.0", download: "https://example.com/app" }))
    .toBe("tsci 1.3.0 is a known-bad release.\n  saves are lost on quit (https://example.com/bug/7)\n  update to 1.4.0 from https://example.com/app");
  expect(adviseApp("tsci", "2.0.1", { advisories: app })).toContain("go back to 1.4.0");
  expect(adviseApp("tsci", "1.3.0", { advisories: app })).toContain("update to the latest version");
  // An old-but-fine app says nothing; only a listed release does.
  expect(adviseApp("tsci", "1.2.0", { advisories: app, latest: "1.4.0" })).toBeNull();
});

test("appLaunchCheck: the app's file, cached a day, shown in release builds, off in CI", async () => {
  const path = join(mkdtempSync(join(tmpdir(), "rb-app-")), "app.json");
  const calls: string[] = [];
  const url = "https://example.com/advisories.json";
  const fetcher = (async (u: string) => {
    calls.push(String(u));
    return Response.json({ latest: "1.4.0", advisories: [{ versions: "1.3.0", do: "upgrade", to: "latest", why: "saves are lost" }] });
  }) as unknown as typeof fetch;
  const warn = console.warn;
  const said: string[] = [];
  console.warn = (m: string) => { said.push(m); };
  try {
    const now = 1_000_000;
    // RB_VERSION carries the git sha after "+"; the check reads the version before it.
    const notice = await appLaunchCheck("tsci", "1.3.0+abc123", url, { path, fetcher, now, env: {} });
    expect(notice).toBe("tsci 1.3.0 is a known-bad release.\n  saves are lost\n  update to 1.4.0");
    expect(said).toEqual(["[tsci] tsci 1.3.0 is a known-bad release. · saves are lost · update to 1.4.0"]);
    expect(await appLaunchCheck("tsci", "1.4.0+abc123", url, { path, fetcher, now: now + 1000, env: {} })).toBeNull();
    expect(calls).toEqual([url]);
    await appLaunchCheck("tsci", "1.4.0", url, { path, fetcher, now: now + 25 * 3600 * 1000, env: {} });
    expect(calls.length).toBe(2);
    expect(await appLaunchCheck("tsci", undefined, url, { path, fetcher, now, env: {} })).toBeNull();
    expect(await appLaunchCheck("tsci", "1.3.0", url, { path, fetcher, now, env: { CI: "true" } })).toBeNull();
    // Offline: no notice, no throw.
    const offline = (async () => { throw new Error("offline"); }) as unknown as typeof fetch;
    const fresh = join(mkdtempSync(join(tmpdir(), "rb-app-")), "app.json");
    expect(await appLaunchCheck("tsci", "1.3.0", url, { path: fresh, fetcher: offline, now, env: {} })).toBeNull();
  } finally {
    console.warn = warn;
  }
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

test("a newer release the minimum release age holds back says so, with the ways out", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rb-gate-"));
  const home = mkdtempSync(join(tmpdir(), "rb-home-"));
  const t0 = 10_000_000_000;
  const fetcher = (async (url: string) => {
    if (String(url) === ADVISORIES_URL) return Response.json({ advisories: [] });
    if (String(url).endsWith("/latest")) return Response.json({ version: "0.1.13" });
    return Response.json({ time: { "0.1.13": new Date(t0 - 3 * 3600_000).toISOString() } });
  }) as unknown as typeof fetch;
  const run = (gate: number | null) => checkVersion("0.1.12", { path: join(mkdtempSync(join(tmpdir(), "rb-adv-")), "c.json"), fetcher, now: t0, gate });

  const held = (await run(86_400))!;
  expect(held).toContain("0.1.13 is out but your minimum release age (1d) is holding it back; it is 3h old");
  expect(held).toContain("pin 0.1.12");
  expect(held).toContain("exempt @rustybuns/*");
  // No gate, or one the release has already cleared: the ordinary "is out" line.
  expect(await run(null)).toBe("rustybuns 0.1.13 is out (you have 0.1.12): bun add -d @rustybuns/cli@latest");
  expect(await run(3600)).toContain("bun add -d @rustybuns/cli@latest");

  // The gate comes from bunfig.toml (seconds) or pnpm-workspace.yaml (minutes), unless we are exempt.
  expect(ageGate(dir, home)).toBeNull();
  writeFileSync(join(dir, "bunfig.toml"), "[install]\nminimumReleaseAge = 259200\n");
  expect(ageGate(dir, home)).toBe(259200);
  writeFileSync(join(dir, "bunfig.toml"), '[install]\nminimumReleaseAge = 259200\nminimumReleaseAgeExcludes = ["alchemy", "@rustybuns/cli"]\n');
  expect(ageGate(dir, home)).toBeNull();
  writeFileSync(join(dir, "bunfig.toml"), "");
  writeFileSync(join(dir, "pnpm-workspace.yaml"), "minimumReleaseAge: 1440\n");
  expect(ageGate(dir, home)).toBe(86_400);
  writeFileSync(join(dir, "pnpm-workspace.yaml"), 'minimumReleaseAge: 1440\nminimumReleaseAgeExclude:\n  - alchemy\n  - "@rustybuns/*"\n');
  expect(ageGate(dir, home)).toBeNull();
});
