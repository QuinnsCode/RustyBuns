import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openBrowser } from "../src/launcher.ts";

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
