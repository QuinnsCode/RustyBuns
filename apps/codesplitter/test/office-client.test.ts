// The office's client moved under /office/ (src/office-client.ts, #3423 slice 2), on a small stand-in for the release:
// its pages and bundles point at /office/ and the floor's routes, a release that moved a path stops the build, and a
// build for any stage but office-preview leaves no copy behind.
import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { copyOfficeClient, officeClientFor } from "../src/office-client.ts";

/** A prepared office with one page and one bundle, written the way the release writes them. */
function fakeOffice(bundle: string) {
  const dir = mkdtempSync(path.join(tmpdir(), "office-client-"));
  mkdirSync(path.join(dir, "dist/public/assets"), { recursive: true });
  writeFileSync(path.join(dir, "LICENSE"), "MIT License\n\nCopyright (c) 2026 AgentSystemLabs\n");
  writeFileSync(path.join(dir, "dist/public/index.html"), `<link rel="icon" href="/favicon.svg" /><script src="/druids/druids.js"></script><script src="/assets/main-x.js"></script><body></body>`);
  writeFileSync(path.join(dir, "dist/public/assets/main-x.js"), bundle);
  return dir;
}
const BUNDLE = "function p(e){return\"/\"+e}new WebSocket(`${a}://${location.host}/ws?${o}`);fetch(`/api/whoami`);location.href=`/login`;";

test("the client's paths land under /office/ and on the floor's routes, with the licence and credit beside it", () => {
  const office = fakeOffice(BUNDLE), to = path.join(office, "out");
  copyOfficeClient(office, to);
  expect(readFileSync(path.join(to, "assets/main-x.js"), "utf8")).toBe(
    "function p(e){return\"/office/\"+e}new WebSocket(`${a}://${location.host}/api/office/ws?${o}`);fetch(`/api/office/whoami`);location.href=`/`;");
  const index = readFileSync(path.join(to, "index.html"), "utf8");
  expect(index).toContain(`src="/office/assets/main-x.js"`);
  expect(index).toContain("WebDevCody");
  expect(readFileSync(path.join(to, "LICENSE.txt"), "utf8")).toContain("AgentSystemLabs");
  expect(readFileSync(path.join(to, "credits.html"), "utf8")).toContain("https://github.com/AgentSystemLabs/agent-office");
});

test("a release that moved the socket stops the build, and other stages drop a leftover copy", async () => {
  const office = fakeOffice(BUNDLE.replace("/ws?", "/socket?"));
  expect(() => copyOfficeClient(office, path.join(office, "out"))).toThrow("no file had the socket path");

  const app = mkdtempSync(path.join(tmpdir(), "office-app-"));
  mkdirSync(path.join(app, "dist/client/office"), { recursive: true });
  expect(await officeClientFor("production", app)).toBe(false);
  expect(existsSync(path.join(app, "dist/client/office"))).toBe(false);
});
