import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openBrowser, writeDesktopFile } from "../src/launcher.ts";

const logs: string[] = [];
const log = console.log;
afterEach(() => { console.log = log; logs.length = 0; delete process.env["RB_NO_BROWSER"]; });
const capture = () => { console.log = (...a: unknown[]) => { logs.push(a.join(" ")); }; };

test("openBrowser: the token stays out of stdout and the browser's argv", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rb-launch-"));
  const argv = join(dir, "argv"), browser = join(dir, "browser");
  writeFileSync(browser, `#!/bin/sh\necho "$@" > ${JSON.stringify(argv)}\n`);
  chmodSync(browser, 0o755);
  delete process.env["RB_NO_BROWSER"];
  capture();
  await openBrowser({ url: "http://127.0.0.1:9", token: "SECRET", code: "once", browser });
  for (let i = 0; i < 100 && !(await Bun.file(argv).exists()); i++) await Bun.sleep(10);
  expect(logs.join("\n")).toBe("[rustybuns] open http://127.0.0.1:9");
  const args = readFileSync(argv, "utf8");
  expect(args).toContain("--app=http://127.0.0.1:9/?rb_launch=once");
  expect(args).not.toContain("SECRET");
});

test("openBrowser: with RB_NO_BROWSER the token URL is printed, since nothing else can open it", async () => {
  process.env["RB_NO_BROWSER"] = "1";
  capture();
  await openBrowser({ url: "http://127.0.0.1:9", token: "SECRET", code: "once" });
  expect(logs).toEqual(["[rustybuns] open http://127.0.0.1:9/?token=SECRET"]);
});

test("openBrowser: a browser that cannot start falls back to printing the token URL", async () => {
  capture();
  await openBrowser({ url: "http://127.0.0.1:9", token: "SECRET", code: "once", browser: "/nonexistent/browser" });
  expect(logs.at(-1)).toContain("Open this yourself:\n  http://127.0.0.1:9/?token=SECRET");
});

test("writeDesktopFile: {url, token} for this user alone, replacing a looser older file; nothing without a token", () => {
  const dir = mkdtempSync(join(tmpdir(), "rb-desktop-"));
  writeFileSync(join(dir, "desktop.json"), "stale", { mode: 0o644 });
  const file = writeDesktopFile(dir, "http://127.0.0.1:9", "SECRET")!;
  expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ url: "http://127.0.0.1:9", token: "SECRET", pid: process.pid });
  if (process.platform !== "win32") expect(statSync(file).mode & 0o777).toBe(0o600);
  expect(writeDesktopFile(mkdtempSync(join(tmpdir(), "rb-desktop-")), "http://127.0.0.1:9", undefined)).toBeUndefined();
});

test("writeDesktopFile: gone when the app exits, unless another copy took it over", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rb-desktop-"));
  const run = (then: string) => Bun.spawnSync(["bun", "-e",
    `const { writeDesktopFile } = await import(${JSON.stringify(join(import.meta.dir, "../src/launcher.ts"))}); const f = writeDesktopFile(${JSON.stringify(dir)}, "http://x", "t"); ${then}`]);
  expect(run("").exitCode).toBe(0);
  expect(await Bun.file(join(dir, "desktop.json")).exists()).toBe(false);
  expect(run(`require("node:fs").writeFileSync(f, "theirs");`).exitCode).toBe(0);
  expect(readFileSync(join(dir, "desktop.json"), "utf8")).toBe("theirs");
});
