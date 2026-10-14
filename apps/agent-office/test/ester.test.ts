import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { BOARD, DEXTER, createHelpers, holdFrom, repoWith, type Spawn } from "../ester/run.ts";
import { officeTriage } from "../triage/server.ts";

const repo = () => {
  const dir = mkdtempSync(path.join(tmpdir(), "rb-ester-"));
  mkdirSync(path.dirname(path.join(dir, BOARD)), { recursive: true });
  writeFileSync(path.join(dir, BOARD), "");
  mkdirSync(path.join(dir, "apps/agent-office/ester"), { recursive: true });
  writeFileSync(path.join(dir, DEXTER), "");
  return dir;
};
const settle = () => new Promise((r) => setTimeout(r, 5));

test("her hold line names the PRs, the last one wins", () => {
  expect(holdFrom(["x", "Ester says hold: #12, #345"])).toEqual([12, 345]);
  expect(holdFrom(["Ester says hold: #1", "Ester says hold: #2"])).toEqual([2]);
  expect(holdFrom(["all green"])).toEqual([]);
});

test("a run goes one at a time, keeps what it printed, and says hold when the board is red", async () => {
  let finish!: (code: number) => void;
  const seen: string[][] = [];
  const spawn: Spawn = (cmd, _cwd, onLine) => {
    seen.push(cmd.slice(1));
    onLine("the board breaks:");
    onLine("Ester says hold: #7");
    return new Promise((r) => (finish = r));
  };
  const { ester, mervin } = createHelpers(spawn);
  const dir = repo();
  expect(ester.start(dir)).toBeNull();
  expect(ester.start(dir)).toEqual({ status: 409, error: "Already on it" });
  expect(ester.state().phase).toBe("running");
  finish(1);
  await settle();
  expect(ester.state()).toMatchObject({ phase: "red", hold: [7], lines: ["the board breaks:", "Ester says hold: #7"] });
  expect(mervin.state().phase).toBe("idle");
  mervin.start(dir);
  finish(0);
  await settle();
  expect(mervin.state().phase).toBe("green");
  expect(seen).toEqual([[expect.stringMatching(/mervin-board\.ts$/), "--check"], [expect.stringMatching(/mervin-board\.ts$/)]]);
});

test("a crash or a repo without the board script is an error, not a hang", async () => {
  const { ester } = createHelpers(async () => 2);
  expect(ester.start(mkdtempSync(path.join(tmpdir(), "rb-ester-")))!.status).toBe(404);
  ester.start(repo());
  await settle();
  expect(ester.state()).toMatchObject({ phase: "error", error: "stopped with exit 2" });
});

test("the routes: a POST from the page needs the header, and only Ester and Mervin answer", async () => {
  const dir = repo();
  const routes = officeTriage(mkdtempSync(path.join(tmpdir(), "rb-ester-data-")), () => [{ id: "f1", dir }]);
  const to = (m: string, p: string, trusted = true) => routes(m, new URL(p, "http://o"), trusted);
  expect((await to("GET", "/__rb/helpers"))!.body).toMatchObject({ ester: { phase: "idle" }, mervin: { phase: "idle" }, dexter: { phase: "idle" } });
  expect((await to("POST", "/__rb/helpers/ester", false))!.status).toBe(403);
  expect((await to("POST", "/__rb/helpers/clippy"))!.status).toBe(404);
  expect((await to("GET", "/__rb/helpers/ester"))!.status).toBe(405);
});

test("the routes run a helper in the floor whose repo has the script, found from a subfolder", async () => {
  const other = mkdtempSync(path.join(tmpdir(), "rb-ester-other-")), root = repo();
  const sub = path.join(root, "apps/agent-office");
  expect(repoWith(BOARD, [other, sub])).toBe(root);
  expect(repoWith(BOARD, [other])).toBeNull();
  const routes = officeTriage(mkdtempSync(path.join(tmpdir(), "rb-ester-data-")), () => [{ id: "a", dir: other }, { id: "b", dir: sub }]);
  expect((await routes("POST", new URL("/__rb/helpers/dexter", "http://o"), true))!.status).toBe(202);
  const none = await officeTriage(mkdtempSync(path.join(tmpdir(), "rb-ester-data-")), () => [{ id: "a", dir: other }])("POST", new URL("/__rb/helpers/mervin", "http://o"), true);
  expect(none!.status).toBe(404);
  expect(JSON.stringify(none!.body)).toContain(other);
});
