import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { officeReload } from "../live/reload.ts";
import { sources } from "../scripts/mama.ts";
import { officeTriage } from "../triage/server.ts";

const office = () => {
  const dir = mkdtempSync(path.join(tmpdir(), "rb-reload-"));
  const pub = path.join(dir, "public"), srv = path.join(dir, "server");
  mkdirSync(path.join(pub, "assets"), { recursive: true });
  mkdirSync(path.join(pub, "druids"), { recursive: true });
  const bin = path.join(dir, "bin");
  mkdirSync(srv);
  mkdirSync(bin);
  writeFileSync(path.join(bin, "rb-triage.js"), "mcp one");
  writeFileSync(path.join(pub, "assets/rb-ester-aaa.js"), "one");
  writeFileSync(path.join(srv, "rb-triage.js"), "server one");
  return { pub, srv, bin };
};

test("a new page script moves page; a changed server bundle makes it stale; the same bytes rewritten change nothing", () => {
  const { pub, srv, bin } = office();
  const r = officeReload(pub, srv, bin, true, () => {});
  const before = r.state();
  expect(before.stale).toBe(false);
  writeFileSync(path.join(srv, "rb-triage.js"), "server one");
  expect(r.state()).toMatchObject({ page: before.page, stale: false });
  writeFileSync(path.join(pub, "assets/rb-ester-bbb.js"), "two");
  expect(r.state().page).not.toBe(before.page);
  expect(r.state().stale).toBe(false);
  writeFileSync(path.join(pub, "druids/druids.js"), "skin");
  const skinned = r.state().page;
  writeFileSync(path.join(pub, "druids/druids.js"), "skin two");
  expect(r.state().page).not.toBe(skinned);
  writeFileSync(path.join(srv, "rb-triage.js"), "server two");
  expect(r.state()).toMatchObject({ stale: true, boot: before.boot });
});

test("a changed workers' MCP bundle sets workers, not stale", () => {
  const { pub, srv, bin } = office();
  const r = officeReload(pub, srv, bin, true, () => {});
  expect(r.state()).toMatchObject({ stale: false, workers: false });
  writeFileSync(path.join(bin, "rb-triage.js"), "mcp one");
  expect(r.state().workers).toBe(false);
  writeFileSync(path.join(bin, "rb-triage.js"), "mcp two");
  expect(r.state()).toMatchObject({ stale: false, workers: true });
});

test("/__rb/reload answers the state, and restart needs the header and something that starts the office again", async () => {
  const { pub, srv, bin } = office();
  let restarted = 0;
  const route = (can: boolean) => officeTriage(tmpdir(), () => [], officeReload(pub, srv, bin, can, () => restarted++));
  expect((await route(true)("GET", new URL("http://office/__rb/reload"), false))!.body).toMatchObject({ stale: false, canRestart: true });
  const restart = new URL("http://office/__rb/reload/restart");
  expect((await route(true)("POST", restart, false))!.status).toBe(403);
  expect((await route(false)("POST", restart, true))!.status).toBe(409);
  expect((await route(true)("POST", restart, true))!.status).toBe(202);
  await new Promise((r) => setTimeout(r, 300));
  expect(restarted).toBe(1);
});

test("mama's source list is our code, not the build or the tests", () => {
  const files = sources().map((f) => path.relative(path.join(import.meta.dir, ".."), f));
  expect(files).toContain("reload/index.ts");
  expect(files).toContain("live/reload.ts");
  expect(files.some((f) => /^(office|node_modules|test)\//.test(f))).toBe(false);
});
