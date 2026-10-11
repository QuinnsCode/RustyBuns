import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fresh, summarize } from "../codesplitters/news.ts";
import { codesplittersRoute, LIVE, site } from "../codesplitters/server.ts";

const branches = [
  { name: "fix-a", by: "ana", status: "merged", created_at: 1, merged_by: "ryan", merged_at: 50 },
  { name: "fix-b", by: "agent-claude", status: "open", created_at: 20 },
];
const checks = [
  { id: 1, name: "tests", status: "failed", finished_at: 10, created_at: 5 },
  { id: 2, name: "lint", status: "passed", finished_at: 30, created_at: 25 },
  { id: 3, name: "types", status: "failed", finished_at: 40, created_at: 35 },
];
const runs = [{ id: 9, agent: "agent-claude", status: "running", task: "fix the flake" }];

test("each board's twin: a failing check, the newest agent run, the latest branch move", () => {
  expect(summarize(branches, checks, runs)).toEqual({
    issues: { stamp: "check:3", text: "types failed on main" },
    queue: { stamp: "run:9:running", text: "agent-claude running: fix the flake" },
    pulls: { stamp: "branch:fix-a:merged", text: "fix-a merged by ryan" },
  });
  expect(summarize(null, checks.filter((c) => c.status === "passed"), [])).toEqual({ issues: null, queue: null, pulls: null });
});

test("the dot: nothing the first time, then whatever changed since you last looked", () => {
  const s = summarize(branches, checks, runs);
  const first = fresh(s, {});
  expect(first.boards).toEqual([]);
  expect(first.seen).toEqual({ issues: "check:3", queue: "run:9:running", pulls: "branch:fix-a:merged" });
  const later = fresh(summarize(branches, checks, [{ ...runs[0]!, status: "done" }]), first.seen);
  expect(later.boards).toEqual(["queue"]);
  expect(later.seen).toEqual(first.seen); // seen moves only when you click the mark

  // an empty board is seen empty: the first thing on it lights the dot
  const empty = fresh(summarize([], [], []), {});
  expect(empty).toEqual({ boards: [], seen: { issues: "", queue: "", pulls: "" } });
  expect(fresh(summarize(branches, [], []), empty.seen).boards).toEqual(["pulls"]);
});

test("where it asks: env, else the CLI's login, else the running desktop, else the live site; a desktop launch token becomes its cookie", () => {
  expect(site({ HOME: "/nowhere" })).toEqual({ url: LIVE, token: undefined });
  expect(site({ HOME: "/nowhere", CODESPLITTERS_URL: "http://127.0.0.1:5199/?token=abc", CODESPLITTERS_TOKEN: "cst_x" }))
    .toEqual({ url: "http://127.0.0.1:5199", token: "cst_x", cookie: "rb_token_5199=abc" });

  const home = mkdtempSync(path.join(tmpdir(), "office-cs-"));
  mkdirSync(path.join(home, ".codesplitters"));
  const leave = (pid: number) => writeFileSync(path.join(home, ".codesplitters/desktop.json"), JSON.stringify({ url: "http://127.0.0.1:5200", token: "t/k", pid }));
  leave(process.pid);
  expect(site({ HOME: home, CODESPLITTERS_TOKEN: "cst_x" })).toEqual({ url: "http://127.0.0.1:5200", token: "cst_x", cookie: "rb_token_5200=t/k" });
  expect(site({ HOME: home, CODESPLITTERS_URL: "https://elsewhere.example" }).url).toBe("https://elsewhere.example");
  leave(2 ** 22 + 1); // no such process: the app died and left its file behind
  expect(site({ HOME: home }).url).toBe(LIVE);
});

test("the route asks codeSplitters with the token, never hands it to the page, and caches a moment", async () => {
  const asked: [string, Headers][] = [];
  const get = (async (u: string, init: RequestInit) => {
    asked.push([u, new Headers(init.headers)]);
    const p = new URL(u).pathname;
    const body = p.endsWith("/branches") ? branches : p.endsWith("/checks") ? { runs: checks } : p.endsWith("/agents") ? runs : null;
    return body ? Response.json(body) : new Response("no", { status: 404 });
  }) as unknown as typeof fetch;
  const route = codesplittersRoute({ url: "http://127.0.0.1:5199", token: "cst_secret", cookie: "rb_token_5199=abc" }, get);
  const at = (q: string) => new URL(`http://office/__rb/codesplitters${q}`);

  expect(await route("GET", new URL("http://office/__rb/mem"))).toBeNull();
  expect((await route("POST", at("?repo=ryan/lab")))!.status).toBe(405);
  expect((await route("GET", at("?repo=../../etc")))!.status).toBe(400);
  expect((await route("GET", at("")))!.body).toEqual({ site: "http://127.0.0.1:5199", repo: null, boards: null });

  const a = await route("GET", at("?repo=ryan/lab"));
  expect(a!.body).toMatchObject({ repo: "ryan/lab", boards: { queue: { stamp: "run:9:running" } } });
  expect(JSON.stringify(a!.body)).not.toContain("cst_secret");
  expect(asked.map(([u]) => u)).toEqual([
    "http://127.0.0.1:5199/api/repos/ryan/lab/branches",
    "http://127.0.0.1:5199/api/repos/ryan/lab/checks?ref=main",
    "http://127.0.0.1:5199/api/repos/ryan/lab/agents",
  ]);
  expect(asked[0]![1].get("authorization")).toBe("Bearer cst_secret");
  expect(asked[0]![1].get("cookie")).toBe("rb_token_5199=abc");
  await route("GET", at("?repo=ryan/lab"));
  expect(asked).toHaveLength(3);
});
