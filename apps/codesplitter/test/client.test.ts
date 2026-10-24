import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
const html = readFileSync(join(import.meta.dir, "../src/client.html"), "utf8");

// #989 split the doctor's Save body one setting a line and lost an `||`, so no script on the page ran.
test("every inline script on the page parses", () => {
  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]!);
  expect(scripts.length).toBeGreaterThan(0);
  for (const s of scripts) expect(() => new Bun.Transpiler({ loader: "js" }).transformSync(s)).not.toThrow();
});

// The vein: who a repo listens to, its branches as tiles and curves, and its history.
describe("the vein", () => {
  const src = html.slice(html.indexOf("// The vein: a repo's family"), html.indexOf("/** The vein of a repo:"));
  const { gitMapModel, gitCurve, commitLanes, tagMarks } = new Function(`${src}; return { gitMapModel, gitCurve, commitLanes, tagMarks };`)();
  const link = (m: any, from: string, to: string) => m.links.find((l: any) => l.from === from && l.to === to);

  test("a dug fork was copied once and doesn't listen", () => {
    const m = gitMapModel({ owner: "ann", repo: "hono", r: { upstream: "github:honojs/hono", upstream_commit: "abcdef123", home: "cloud", branch: "main" } });
    expect(m.tiles.find((t: any) => t.id === "up")).toMatchObject({ name: "honojs/hono", href: "https://github.com/honojs/hono" });
    expect(link(m, "up", "here")).toMatchObject({ kind: "fork", label: "copied once", title: "copied once at abcdef1, and not listening since" });
    expect(m.tiles.find((t: any) => t.id === "up").sub).toBe("upstream · copied at abcdef1");
    expect(m.story).toContain("stopped listening");
  });

  test("a mirror listens both ways, and says what's moving", () => {
    const r = { upstream: "github:a/b", mirror: true, home: "local" };
    const calm = gitMapModel({ owner: "ann", repo: "b", r, mirror: { state: "ok", ahead: 0, behind: 0 } });
    expect(link(calm, "up", "here")).toMatchObject({ kind: "mirror", both: true, hot: false, label: "in step, both ways", pic: ["sync", { ahead: 0, behind: 0 }] });
    expect(calm.tiles[0].sub).toContain("git on your machine");
    const busy = gitMapModel({ owner: "ann", repo: "b", r, mirror: { state: "ok", ahead: 2, behind: 1 } });
    expect(link(busy, "up", "here")).toMatchObject({ hot: true, label: "1 to take in, 2 to send up" });
    expect(link(gitMapModel({ owner: "ann", repo: "b", r, mirror: { state: "down" } }), "up", "here").label).toBe("upstream down: we keep working");
    expect(link(gitMapModel({ owner: "ann", repo: "b", r, mirror: { state: "held" } }), "up", "here").both).toBe(false);
  });

  // Main's commits newest first, each merge followed by its branch's commits (as GET .../graph sends them).
  const c = (hash: string, parents: string[], o: Record<string, unknown> = {}) => ({ hash, parents, message: hash, author: "ann", at: 0, up: false, ...o });
  const at = (g: any) => Object.fromEntries(g.dots.map((d: any) => [d.hash, [d.x, d.lane]]));

  test("the vein's history: main in a row, oldest left, and a merged branch in a lane below from where it left to where it landed", () => {
    const g = commitLanes([c("m3", ["m2", "b2"]), c("b2", ["b1"], { side: "m3" }), c("b1", ["m1"], { side: "m3" }), c("m2", ["m1"]), c("m1", [], { up: true })]);
    expect(at(g)).toEqual({ m1: [0, 0], m2: [1, 0], b1: [2, 1], b2: [3, 1], m3: [4, 0] });
    expect(g.lanes).toBe(2);
    expect(g.dots.find((d: any) => d.hash === "m3").merge).toBe(true);
    // It leaves main at m1 and lands on the merge.
    expect(g.edges).toContainEqual({ x1: 0, l1: 0, x2: 2, l2: 1 });
    expect(g.edges).toContainEqual({ x1: 3, l1: 1, x2: 4, l2: 0 });
    expect(g.edges.some((e: any) => e.off)).toBe(false);
  });

});

// Line picks come as runs (#710): ⌘-click and gutter drags make gaps.
describe("picked lines as runs", () => {
  const src = html.slice(html.indexOf("/** Picked line indexes"), html.indexOf("// The game's door"));
  const { runsOf, runsLabel } = new Function(`${src}; return { runsOf, runsLabel };`)();

  test("labels say a line, a run, or several, and cut a long list short", () => {
    expect(runsLabel([[4, 4]])).toBe("line 4");
    expect(runsLabel([[4, 9]])).toBe("lines 4–9");
    expect(runsLabel([[4, 9], [12, 12], [20, 22]])).toBe("lines 4–9, 12, 20–22");
    expect(runsLabel([[1, 1], [3, 3], [5, 5], [7, 7], [9, 9]])).toBe("lines 1, 3, 5 and 2 more");
  });
});

// Branch names follow git, not the handle rule (#701); the page checks them as you type, as the server does.
describe("branch names", () => {
  const src = html.slice(html.indexOf("/** What's wrong with a branch name"), html.indexOf("/** Under a branch-name box"));
  const { branchNameError, tidyBranch } = new Function(`${src}; return { branchNameError, tidyBranch };`)();

  test("the page's rule says what the server's says", async () => {
    const server = (await import("../src/env.ts")).branchNameError;
    const names = ["feature/login", "Fix-Login", "v1.2", "under_score", "cs checks test", "tab\there", "a..b", "a~b", "a^b", "a:b", "a?b", "a*b", "a[b", "a\\b",
      "a@{b", "@", "-a", "/a", "a/", "a//b", "a.", "a/.b", ".a", "a.lock", "a.lock/b", "main", "", "x".repeat(255), "x".repeat(256), "é".repeat(128), "bell\x07"];
    for (const n of names) expect([n, branchNameError(n)]).toEqual([n, server(n)]);
    expect(names.filter((n) => !server(n))).toEqual(["feature/login", "Fix-Login", "v1.2", "under_score", "x".repeat(255)]);
  });

});

// The file page catches you up on what landed since your last visit, not only while the tab was hidden (#758).
describe("what changed since you were last here", () => {
  const src = html.slice(html.indexOf("const LAST_REVS"), html.indexOf("const rejectHunk"));
  const make = () => {
    const store = new Map<string, string>();
    const localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    return new Function("localStorage", `${src}; return { lastRevKey, lastRev, sawRev, changedRuns, LAST_REVS };`)(localStorage);
  };
  /** The account's copy (#779), with fetch and the clock stubbed. */
  const account = () => {
    const sent: unknown[] = [], timers = new Map<number, () => void>();
    let n = 0;
    const fetch = async (url: string, init: RequestInit) => void sent.push([url, init.method, JSON.parse(init.body as string)]);
    const setTimeout = (f: () => void) => (timers.set(++n, f), n);
    const clearTimeout = (id: number) => timers.delete(id);
    const fns = new Function("localStorage", "fetch", "setTimeout", "clearTimeout", `${src}; return { tellSeen, flushSeen };`)({}, fetch, setTimeout, clearTimeout);
    const tick = () => { const all = [...timers.values()]; timers.clear(); for (const f of all) f(); };
    return { ...fns, sent, tick, settle: () => new Promise((ok) => queueMicrotask(() => queueMicrotask(ok))) };
  };

  test("a file's last-seen rev is kept per repo, branch and path", () => {
    const { lastRevKey, lastRev, sawRev } = make();
    const main = lastRevKey("ann", "app", null, "a.ts"), fix = lastRevKey("ann", "app", "fix", "a.ts");
    expect(lastRev(main)).toBeNull();
    sawRev(main, 12);
    sawRev(fix, 3);
    expect([lastRev(main), lastRev(fix)]).toEqual([12, 3]);
  });

  test("changes fold into runs of changed or new lines, and gone ones are counted", () => {
    const { changedRuns } = make();
    const was = new Map([["a", "1"], ["b", "2"], ["c", "3"], ["d", "4"], ["e", "5"]]);
    const now = [{ id: "a", text: "1" }, { id: "b", text: "two" }, { id: "x", text: "new" }, { id: "c", text: "3" }, { id: "e", text: "five" }];
    expect(changedRuns(was, now)).toEqual({ runs: [["b", "x"], ["e"]], gone: 1 });
    expect(changedRuns(was, [...was].map(([id, text]) => ({ id, text })))).toEqual({ runs: [], gone: 0 });
  });

});

// The explorer's search box filters the whole tree by path.
describe("explorer search", () => {
  const src = html.slice(html.indexOf("function treeMatches"), html.indexOf("async function mountExplorer"));
  const treeMatches = new Function(`${src}; return treeMatches;`)();
  const f = (path: string) => ({ path, name: path.split("/").pop(), type: "file" });

  test("any case, name matches first, then shorter paths", () => {
    const files = ["test/slow.test.ts", "src/testing/a.ts", "sum.test.ts", "README.md"].map(f);
    expect(treeMatches(files, "TEST").map((h: any) => [h.e.path, h.at])).toEqual([["sum.test.ts", 4], ["test/slow.test.ts", 5], ["src/testing/a.ts", -1]]);
  });
});

// Picking lines from the keyboard, as in VS Code: arrows, shift+arrows, ⌘A, ⌘L, Esc.
describe("lineKey", () => {
  const src = html.slice(html.indexOf("function lineKey"), html.indexOf("/** Our own right-click menu"));
  const lineKey = new Function(`${src}; return lineKey;`)();
  const st = (picked: number[], anchor: number | null, cursor: number | null) => ({ picked: new Set(picked), anchor, cursor });
  const got = (r: any) => r && { picked: [...r.picked].sort((a: number, b: number) => a - b), anchor: r.anchor, cursor: r.cursor };

  test("arrows move one line, shift grows the pick from where it started", () => {
    expect(got(lineKey("ArrowDown", false, false, st([2], 2, 2), 6))).toEqual({ picked: [3], anchor: 3, cursor: 3 });
    expect(got(lineKey("ArrowDown", true, false, st([2], 2, 2), 6))).toEqual({ picked: [2, 3], anchor: 2, cursor: 3 });
    expect(got(lineKey("ArrowUp", true, false, st([2, 3], 2, 3), 6))).toEqual({ picked: [2], anchor: 2, cursor: 2 });
    expect(got(lineKey("ArrowDown", false, false, st([5], 5, 5), 6))).toEqual({ picked: [5], anchor: 5, cursor: 5 });
  });

});

// Selecting by rule, for the palette, the right-click menu and agents.
describe("picking lines by rule", () => {
  const src = html.slice(html.indexOf("const pickAll"), html.indexOf('/** "line 4", "lines 4'));
  const { pickAll, pickInvert, pickMatching, pickBy, pickBlock, pickDrop, pickRunAt, pickRanges } = new Function(`${src}; return { pickAll, pickInvert, pickMatching, pickBy, pickBlock, pickDrop, pickRunAt, pickRanges };`)();
  const sorted = (s: Set<number>) => [...s].sort((a, b) => a - b);
  const code = ["function a() {", "  if (x) {", "    one();", "", "    two();", "  }", "  three();", "}", "", "const b = 1;"];

  test("matching is a substring in any case, or /regex/", () => {
    expect(sorted(pickMatching(["Foo()", "bar", "fooBar"], "foo"))).toEqual([0, 2]);
    expect(sorted(pickMatching(["a1", "b", "c22"], "/\\d+$/"))).toEqual([0, 2]);
    expect(sorted(pickMatching(["a", "A"], "/a/i"))).toEqual([0, 1]);
  });

});

// Ship (the pop-out beside Clone): the infra map marks what destroy keeps. The helpers are plain
// functions of the graph `rustybuns infra --json` prints, so they run here without a page.
describe("the Ship pop-out's infra map", () => {
  const src = html.slice(html.indexOf("const INFRA_ICON"), html.indexOf("const flowRow"));
  const { infraMap } = new Function("icon", "esc", `${src}; return { infraMap };`)((n: string) => `<i ${n}>`, (s: string) => String(s)) as { infraMap: (g: unknown, sel?: string | null) => string };
  const graph = { app: "lab", stage: "prod", mode: "adopt", targets: ["edge"], edges: [], nodes: [
    { id: "worker", kind: "worker", label: "lab", protected: false },
    { id: "DB", kind: "d1", label: "DB", name: "lab-db", protected: false },
    { id: "INDEX", kind: "vectorize", label: "INDEX", name: "lab-index", protected: true },
    { id: "AI", kind: "ai", label: "AI", protected: false },
  ] };

  test("a protected tile is kept, locked and counted; an unprotected data tile is removed; a Worker-only binding is neither", () => {
    const out = infraMap(graph);
    expect(out).toMatch(/class="itile kept" data-n="INDEX"/);
    expect(out).toContain("<i lock>");
    expect(out).toContain("<b>1</b> kept on destroy");
    expect(out).toContain("<b>1</b> removed with their data");
    expect(out).toContain("ADOPT");
    expect(out.match(/<i trash-2>/g)?.length).toBe(2);   // the DB tile's badge, and the legend's
  });

});

// #1469: a repo or file view called the repo, branches and fit endpoints several times each.
describe("api shares repeated reads within a view", () => {
  const src = html.slice(html.indexOf("const sharedGets"), html.indexOf("const apiCall"));
  const make = () => {
    const calls: string[] = [];
    const apiCall = async (path: string, body?: unknown, method?: string) => { calls.push((method ?? (body === undefined ? "GET" : "POST")) + " " + path); return { path }; };
    const { api, sharedGets } = new Function("apiCall", `${src}; return { api, sharedGets };`)(apiCall);
    return { api, sharedGets, calls };
  };

  test("the repo, branches and fit are fetched once each", async () => {
    const { api, calls } = make();
    await Promise.all(["/repos/o/r", "/repos/o/r", "/repos/o/r", "/repos/o/r/branches", "/repos/o/r/branches", "/repos/o/r/fit", "/repos/o/r/fit", "/repos/o/r/tree?path="].map((p) => api(p)));
    expect(calls).toEqual(["GET /repos/o/r", "GET /repos/o/r/branches", "GET /repos/o/r/fit", "GET /repos/o/r/tree?path="]);
  });

});

// The lobby's invite button: a link back into the same room, in the mode and folder it's in.
describe("lobby invite link", () => {
  const play = readFileSync(join(import.meta.dir, "../src/play.html"), "utf8");
  const src = play.slice(play.indexOf("const inviteLink"), play.indexOf('$("#invite")'));
  const make = (s: { room: string; mode: string; diff: unknown; here: { path: string } | null }) =>
    new Function("location", "room", "mode", "diff", "here", `${src}; return inviteLink();`)({ origin: "https://cs.test" }, s.room, s.mode, s.diff, s.here);

  test("wreck keeps its mode and the folder", () => {
    expect(make({ room: "r/ana/dig", mode: "wreck", diff: null, here: { path: "src/a" } })).toBe("https://cs.test/play.html#r/ana/dig?mode=wreck&room=src%2Fa");
  });
});

