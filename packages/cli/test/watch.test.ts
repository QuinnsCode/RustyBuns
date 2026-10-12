import { test, expect } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { changeCheck, swapper, watchIgnored, watchOutputs, type Host } from "../src/watch.ts";
import type { RustyBunsConfig } from "../src/config.ts";

/** A host that exits when killed, and records the signal. */
function fakeHost() {
  let exit!: (code: number) => void;
  const h = { killed: [] as string[], exited: new Promise<number | null>((r) => { exit = r; }), kill(sig?: string) { h.killed.push(sig ?? "SIGTERM"); exit(0); } };
  return h as Host & { killed: string[] };
}

function loop(build: () => Promise<unknown>) {
  const hosts: (Host & { killed: string[] })[] = [], again: boolean[] = [], logs: string[] = [];
  const l = swapper({ build, start: (a) => { again.push(a); const h = fakeHost(); hosts.push(h); return h; }, log: (s) => logs.push(s), quietMs: 5 });
  return { l, hosts, again, logs };
}

test("swapper: a good build swaps the host; only the first start opens a window", async () => {
  const { l, hosts, again } = loop(async () => {});
  await l.run();
  expect(hosts.length).toBe(1);
  l.changed("src/app.ts");
  await Bun.sleep(30);
  expect(hosts.length).toBe(2);
  expect(hosts[0].killed).toEqual(["SIGTERM"]);
  expect(again).toEqual([false, true]);
  await l.stop();
});

test("swapper: a failed build keeps the running host up", async () => {
  let fail = false;
  const { l, hosts, logs } = loop(async () => { if (fail) throw new Error("boom"); });
  await l.run();
  fail = true;
  l.changed("src/app.ts");
  await Bun.sleep(30);
  expect(hosts.length).toBe(1);
  expect(hosts[0].killed).toEqual([]);
  expect(logs.at(-1)).toContain("build failed, so the running host stays up");
  await l.stop();
});

test("swapper: saves during a build fold into one more build", async () => {
  let builds = 0, release!: () => void;
  const { l, hosts } = loop(() => { builds++; return builds === 2 ? new Promise<void>((r) => { release = r; }) : Promise.resolve(); });
  await l.run();
  l.changed("a.ts");
  await Bun.sleep(20);           // build 2 is running
  for (const f of ["b.ts", "c.ts", "d.ts"]) l.changed(f);
  release();
  await Bun.sleep(20);
  expect(builds).toBe(3);
  expect(hosts.length).toBe(3);
  await l.stop();
});

test("watchIgnored: dependencies, dot dirs, build output and Vite's temp config don't rebuild", () => {
  const c = { name: "x", targets: { desktop: { clientDir: "./web/out/", dataDir: "data" } } } as unknown as RustyBunsConfig;
  const outs = watchOutputs(c);
  expect(outs).toEqual(["dist", "native/dist", "web/out", "data"]);
  for (const p of ["node_modules/x/a.js", ".rustybuns/dev/desktop.js", ".git/index", "dist/desktop/index.html", "web/out/a.js",
    "data/app.sqlite", "native/target/release/x", "native/target-linux-x64/a", "vite.config.ts.timestamp-1712-abc.mjs"]) {
    expect(watchIgnored(p, outs)).toBe(true);
  }
  for (const p of ["src/app.tsx", "packages/desktop/world.ts", "native/crates/x/src/lib.rs", "distant.ts", "rustybuns.config.ts"]) {
    expect(watchIgnored(p, outs)).toBe(false);
  }
});

test("changeCheck: a file that was only read is not a change; a write, a new file or a delete is", () => {
  const dir = mkdtempSync(join(tmpdir(), "rb-watch-")), old = join(dir, "client.html"), fresh = join(dir, "new.ts");
  writeFileSync(old, "<html>");
  utimesSync(old, new Date(Date.now() - 60_000), new Date(Date.now() - 60_000));
  const moved = changeCheck();
  readFileSync(old);
  expect(moved(old)).toBe(false);
  expect(moved(old)).toBe(false);
  writeFileSync(old, "<html><body>");
  expect(moved(old)).toBe(true);
  writeFileSync(fresh, "x");
  expect(moved(fresh)).toBe(true);
  rmSync(fresh);
  expect(moved(fresh)).toBe(true);
});

test("changeCheck: a new file whose mtime trails the start by a few ms still counts (#853)", () => {
  const dir = mkdtempSync(join(tmpdir(), "rb-watch-")), fresh = join(dir, "new.ts");
  // Linux's coarse mtime clock can stamp a file just behind Date.now(); a later `since` stands in for that.
  const moved = changeCheck(Date.now() + 50);
  writeFileSync(fresh, "x");
  expect(moved(fresh)).toBe(true);
});
