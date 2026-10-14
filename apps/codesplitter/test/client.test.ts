import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const html = readFileSync(join(import.meta.dir, "../src/client.html"), "utf8");
const css = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join("\n").replace(/\/\*[\s\S]*?\*\//g, "");
/** Every selector in the page's styles that reaches `.cls`, and its declarations. */
const rulesFor = (cls: string) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .flatMap(([, sel, body]) => sel!.split(",").map((s) => ({ sel: s.trim(), body: body! })))
  .filter(({ sel }) => new RegExp(String.raw`\.${cls}(?![\w-])`).test(sel));

// #989 split the doctor's Save body one setting a line and lost an `||`, so no script on the page ran.
test("every inline script on the page parses", () => {
  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]!);
  expect(scripts.length).toBeGreaterThan(0);
  for (const s of scripts) expect(() => new Bun.Transpiler({ loader: "js" }).transformSync(s)).not.toThrow();
});

// The ⌘K palette opened as a narrow, tall box twice (#609, #678): a bare `.sheet` rule for
// another widget (the repo tabs, max-width: 200px) also styled the palette's sheet.
describe("the command palette and the drawer keep their size", () => {
  test("the palette's sheet is full width", () => {
    expect(html).toContain(`<div class="palette" id="palette" hidden><div class="sheet"`);
    const own = rulesFor("sheet").find((r) => r.sel === ".palette .sheet");
    expect(own?.body).toContain("width: min(640px, calc(100vw - 32px))");
  });

  test("no rule styles a .sheet outside the palette or the drawer", () => {
    expect(rulesFor("sheet").map((r) => r.sel).filter((s) => !/^\.(palette|drawer)(\.on)? \.sheet\b/.test(s))).toEqual([]);
  });
});

// Every git action draws what it does before you press it (#693).
describe("git action pictures", () => {
  const src = html.slice(html.indexOf("const GITPICS"), html.indexOf("const picAttr"));
  const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const { GITPICS, gitPic } = new Function("esc", `${src}; return { GITPICS, gitPic };`)(esc);
  const dots = (out: string) => [...out.matchAll(/<span class="dots">(.*?)<\/span>/g)].map(([, d]) => [...d!.matchAll(/<i class="(\w)"/g)].map((m) => m[1]).join(""));

  test("every kind draws two sides before and after, with a caption", () => {
    for (const kind of Object.keys(GITPICS)) {
      const out = gitPic([kind, { branch: "fix", ref: "dev", ahead: 1, behind: 1 }]);
      expect(dots(out)).toHaveLength(4);
      expect(out).toMatch(/<span class="say">[^<]+<\/span>/);
    }
  });

  test("a sync draws the commits waiting on each side, and nothing when in step", () => {
    expect(dots(gitPic(["sync", { ahead: 2, behind: 1 }]))).toEqual(["oou", "oomm", "ooumm", "ooumm"]);
    expect(gitPic(["sync", { ahead: 0, behind: 0 }])).toContain("Already in step");
  });

  test("the git actions on the page carry a picture", () => {
    for (const b of ["data-resolve=\"mine\"", "data-resolve=\"rebase\"", "id=\"mirror-sync\"", "data-crew=\"1\"", "data-push=", "data-pull=", "data-open-ref=", "data-cg=\"revert\"", "data-cg=\"pick\""])
      expect(html).toMatch(new RegExp(`${b}[^>]*\\$\\{(picAttr|sync)`));
  });
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

  test("a dug fork whose upstream moved on says how far, in orange, with the pull", () => {
    const r = { upstream: "github:honojs/hono", upstream_commit: "abcdef123", home: "cloud", branch: "main" };
    expect(link(gitMapModel({ owner: "ann", repo: "hono", r: { ...r, upstream_tip: "abcdef123", upstream_behind: 0 } }), "up", "here").label).toBe("copied once");
    const moved = gitMapModel({ owner: "ann", repo: "hono", r: { ...r, upstream_tip: "1234567", upstream_behind: 3 } });
    expect(link(moved, "up", "here")).toMatchObject({ kind: "fork", hot: true, label: "3 new upstream", pic: ["pull", { branch: "a new branch", ref: "main" }] });
    expect(moved.story).toContain("moved on");
    // GitHub wouldn't count them.
    expect(link(gitMapModel({ owner: "ann", repo: "hono", r: { ...r, upstream_tip: "1234567", upstream_behind: null } }), "up", "here").label).toBe("new upstream");
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

  test("branches hang off the repo, and upstream's branches wire to the ones that follow them", () => {
    const m = gitMapModel({ owner: "ann", repo: "b", r: { upstream: "github:a/b", mirror: true }, mirror: { state: "ok" },
      branches: [{ name: "fix", by: "agent-1", status: "open" }, { name: "old", status: "merged" }],
      upBranches: [{ ref: "dev", branch: "fix" }, { ref: "next", branch: null }] });
    expect(link(m, "here", "b:fix")).toMatchObject({ kind: "branch", pic: ["merge", { branch: "fix" }] });
    expect(link(m, "here", "b:old")).toMatchObject({ kind: "done", label: "merged", pic: null });
    expect(link(m, "ub:dev", "b:fix")).toMatchObject({ kind: "follows", pic: ["pull", { branch: "fix", ref: "dev" }] });
    expect(m.links.filter((l: any) => l.from === "ub:next")).toEqual([]);
  });

  test("a repo with no upstream says so, and a long branch list says how many it left out", () => {
    const branches = Array.from({ length: 12 }, (_, i) => ({ name: `b${i}`, status: "open" }));
    const m = gitMapModel({ owner: "ann", repo: "x", r: {}, branches });
    expect(m.tiles.some((t: any) => t.id === "up")).toBe(false);
    expect(m.story).toContain("no upstream");
    expect(m.more).toBe(4);
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

  test("branches that ran at once take lanes of their own; one after another share", () => {
    // b ran from m1 to m4, and a from m2 to m3 alongside it. d ran from m4 to m5, after b landed.
    const g = commitLanes([
      c("m5", ["m4", "d1"]), c("d1", ["m4"], { side: "m5" }),
      c("m4", ["m3", "b1"]), c("b1", ["m1"], { side: "m4" }),
      c("m3", ["m2", "a1"]), c("a1", ["m2"], { side: "m3" }),
      c("m2", ["m1"]), c("m1", ["m0"]),
    ], true);
    const lane = (h: string) => at(g)[h][1];
    expect([lane("b1"), lane("a1"), lane("d1")]).toEqual([1, 2, 1]);
    // Every parent sits left of its children.
    for (const e of g.edges) expect(e.x1).toBeLessThan(e.x2);
    // m0 isn't shown: main trails off to the left.
    expect(g.edges).toContainEqual({ x1: -1, l1: 0, x2: 0, l2: 0, off: true });
  });

  test("tags sit on the commits shown; the rest are further back (#879)", () => {
    const m = tagMarks([c("m2", ["m1"]), c("m1", [])], [{ name: "v2", commit: "m2" }, { name: "v2-final", commit: "m2" }, { name: "v1", commit: "m0" }]);
    expect(m).toEqual({ on: { m2: ["v2", "v2-final"] }, off: ["v1"] });
    expect(tagMarks([c("m1", [])])).toEqual({ on: {}, off: [] });
  });

  test("a branch merged twice keeps its older commits left of the first merge", () => {
    const g = commitLanes([c("m3", ["m2", "b2"]), c("b2", ["b1"], { side: "m3" }), c("m2", ["m1", "b1"]), c("b1", ["m1"], { side: "m2" }), c("m1", [])]);
    for (const e of g.edges) expect(e.x1).toBeLessThan(e.x2);
  });

  test("a curve leaves and lands level, its label at the middle", () => {
    expect(gitCurve(0, 0, 200, 100)).toEqual({ d: "M0 0C100 0,100 100,200 100", mx: 100, my: 50 });
    expect(gitCurve(0, 0, 200, 0, 80)).toEqual({ d: "M0 0C100 80,100 80,200 0", mx: 100, my: 60 });
  });
});

// Line picks come as runs (#710): ⌘-click and gutter drags make gaps.
describe("picked lines as runs", () => {
  const src = html.slice(html.indexOf("/** Picked line indexes"), html.indexOf("// The game's door"));
  const { runsOf, runsLabel } = new Function(`${src}; return { runsOf, runsLabel };`)();

  test("indexes fold into 1-based runs, in order", () => {
    expect(runsOf(new Set([9, 2, 4, 3]))).toEqual([[3, 5], [10, 10]]);
    expect(runsOf(new Set())).toEqual([]);
  });

  test("labels say a line, a run, or several, and cut a long list short", () => {
    expect(runsLabel([[4, 4]])).toBe("line 4");
    expect(runsLabel([[4, 9]])).toBe("lines 4–9");
    expect(runsLabel([[4, 9], [12, 12], [20, 22]])).toBe("lines 4–9, 12, 20–22");
    expect(runsLabel([[1, 1], [3, 3], [5, 5], [7, 7], [9, 9]])).toBe("lines 1, 3, 5 and 2 more");
  });
});

// A pressed Follow button read as a warning in orange (#710): only its eye turns orange.
test("Following keeps the button neutral", () => {
  const pressed = rulesFor("follow").filter((r) => r.sel.includes('aria-pressed="true"'));
  expect(pressed.map((r) => r.sel)).toEqual(['.btn.follow[aria-pressed="true"] svg']);
  expect(pressed[0]!.body).not.toMatch(/border|background/);
});

// The owner couldn't find where to make a token, and its copy buttons ran off the column (#729).
describe("the profile's tokens", () => {
  test("a copyline's input shrinks, so its copy button stays in the column", () => {
    expect(rulesFor("copyline").find((r) => r.sel === ".copyline input")?.body).toContain("min-width: 0");
  });

  test("#/me/tokens opens Tokens and apps", () => {
    expect(html).toContain('location.replace(`#/u/${me()}${open === "tokens" ? "/tokens" : ""}`)');
    expect(html).toContain('wireTokens(undefined, open === "tokens")');
    expect(html).toContain('<details class="more" id="tokens-more"${open ? " open" : ""}>');
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

  test("spaces turn into dashes as you type", () => {
    expect(tidyBranch("cs checks  test")).toBe("cs-checks-test");
    expect(tidyBranch("feature/login")).toBe("feature/login");
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

  test("only the newest files are kept", () => {
    const { lastRev, sawRev, LAST_REVS } = make();
    for (let i = 0; i <= LAST_REVS; i++) sawRev(`f${i}`, i);
    sawRev("f1", 99);
    sawRev("new", 1);
    expect(lastRev("f0")).toBeNull();
    expect(lastRev("f2")).toBeNull();
    expect(lastRev("f1")).toBe(99);
  });

  test("changes fold into runs of changed or new lines, and gone ones are counted", () => {
    const { changedRuns } = make();
    const was = new Map([["a", "1"], ["b", "2"], ["c", "3"], ["d", "4"], ["e", "5"]]);
    const now = [{ id: "a", text: "1" }, { id: "b", text: "two" }, { id: "x", text: "new" }, { id: "c", text: "3" }, { id: "e", text: "five" }];
    expect(changedRuns(was, now)).toEqual({ runs: [["b", "x"], ["e"]], gone: 1 });
    expect(changedRuns(was, [...was].map(([id, text]) => ({ id, text })))).toEqual({ runs: [], gone: 0 });
  });

  test("signed in, a file's rev goes up to the account once it settles, after the account's was read", async () => {
    const { tellSeen, flushSeen, sent, tick, settle } = account();
    let read!: () => void;
    const accountRead = new Promise<void>((ok) => (read = ok));
    tellSeen("a", 3, accountRead);
    tellSeen("a", 4, accountRead);
    tellSeen("b", 1);
    tick();
    await settle();
    // b went; a waits on the read, and goes once, at its latest rev.
    expect(sent).toEqual([["/api/me/seen", "PUT", { key: "b", rev: 1 }]]);
    read();
    await settle();
    expect(sent.slice(1)).toEqual([["/api/me/seen", "PUT", { key: "a", rev: 4 }]]);
    // The tab hiding sends what's waiting at once.
    tellSeen("c", 7);
    flushSeen();
    await settle();
    expect(sent.at(-1)).toEqual(["/api/me/seen", "PUT", { key: "c", rev: 7 }]);
    tick();
    await settle();
    expect(sent).toHaveLength(3);
  });
});

// axe's leftovers from the accessibility pass (#768).
describe("headings and landmarks", () => {
  test("a repo's side panels are h2s under the page's h1, not h3s", () => {
    expect(html).toContain(`<h2>\${icon(ic)}\${title}</h2>`);
    expect(html).not.toMatch(/<h3\b/);
  });

  test("the side's panels sit on tabs: code, hosted, features, and shipping apart", () => {
    const src = html.slice(html.indexOf("const DOCK_TAB_OF"), html.indexOf("/** Make the details side a dock"));
    const tabOf = new Function(`${src}; return dockTabOf;`)();
    expect(["editing", "commits", "branches", "about"].map(tabOf)).toEqual(["code", "code", "code", "code"]);
    expect(["upstream", "crew", "webhooks", "delete-this-repo"].map(tabOf)).toEqual(["hosted", "hosted", "hosted", "hosted"]);
    expect(["agents", "beam", "dependencies"].map(tabOf)).toEqual(["features", "features", "features"]);
    expect(["deploy", "preview-deploy", "rusty-buns"].map(tabOf)).toEqual(["ship", "ship", "ship"]);
  });

  test("the workbench's two asides have their own names", () => {
    expect(html).toContain(`<aside class="explorer" aria-label="Explorer">`);
    expect(html).toContain(`<aside class="details" aria-label="Details">`);
  });

  test("the feed, search, admin, invite, share, cut and error pages each open with an h1", () => {
    for (const h of [`<h1>\${icon("rss")} Your feed`, `<h1 class="page-h" style="margin:0 0 14px">\${icon("search")}`, `<h1>\${icon("gauge")} Rate limits`,
      `<h1>\${icon("activity")} Insights`, `<h1>\${icon("map")} Survey`, `\${icon("mail-x")}<h1>Invite</h1>`, `\${icon("user-plus")}<h1>`,
      `\${icon("share-2")}<h1>`, `\${icon("scissors")}<h1>`, `<h1 class="sr">Couldn't open this page</h1>`]) expect(html).toContain(h);
  });
});

// The live contrast sweep (#784): text the sweep caught below 4.5:1.
describe("text contrast", () => {
  test("orange letters on the dark flap tiles use the light orange", () => {
    expect(rulesFor("flap-cell").filter((r) => r.body.includes("--accent-ink"))).toEqual([]);
    expect(rulesFor("st").find((r) => r.sel === ".flap-cell.st b")?.body).toContain("var(--accent-glow)");
  });

  test("the hero's phases and the city door fade by colour, not by opacity", () => {
    expect(rulesFor("phases").find((r) => r.sel === ".phases li")?.body).not.toContain("opacity");
    expect(rulesFor("city-door").find((r) => r.sel === ".city-door a")?.body).not.toContain("opacity");
  });
});

// Let's show you around: sign in, dig, the code page, then the right bar a panel a step.
describe("the tour", () => {
  const src = html.slice(html.indexOf("function tourLand"), html.indexOf("let tourTimer"));
  const tourLand = new Function(`${src}; return tourLand;`)();
  const steps = [{ at: null }, { at: "a" }, { at: "b" }, { at: "c" }];

  test("it steps past what isn't on the page, the way you were going", () => {
    const here = (s: { at: string }) => s.at !== "b";
    expect(tourLand(steps, 2, 1, here)).toBe(3);
    expect(tourLand(steps, 2, -1, here)).toBe(1);
    expect(tourLand(steps, 3, 1, () => false)).toBe(0);
  });

  test("every panel it shows is a panel a repo page draws", () => {
    const keys = [...html.slice(html.indexOf("const PANEL_SAY"), html.indexOf("const $$")).matchAll(/^\s+"?([\w-]+)"?: \["/gm)].map((m) => m[1]);
    const drawn = new Set([...html.matchAll(/sec\("[\w-]+", "([^"]+)"/g)].map((m) => m[1]!.toLowerCase().replace(/\W+/g, "-")));
    expect(keys.length).toBeGreaterThan(10);
    expect(keys.filter((k) => !drawn.has(k!))).toEqual([]);
  });

  test("the home page and every repo page can start it", () => {
    expect(html).toContain(`id="hero-tour"`);
    expect(html).toContain(`id="tour-here"`);
  });
});

// The explorer's search box filters the whole tree by path.
describe("explorer search", () => {
  const src = html.slice(html.indexOf("function treeMatches"), html.indexOf("async function mountExplorer"));
  const treeMatches = new Function(`${src}; return treeMatches;`)();
  const f = (path: string) => ({ path, name: path.split("/").pop(), type: "file" });

  test("the box sits at the top of the explorer", () => {
    expect(html).toContain(`Explorer</div><label class="tree-find">`);
  });

  test("any case, name matches first, then shorter paths", () => {
    const files = ["test/slow.test.ts", "src/testing/a.ts", "sum.test.ts", "README.md"].map(f);
    expect(treeMatches(files, "TEST").map((h: any) => [h.e.path, h.at])).toEqual([["sum.test.ts", 4], ["test/slow.test.ts", 5], ["src/testing/a.ts", -1]]);
  });
});

// The profile's pulse, drawn as an isometric block of the week's hours: a pillar per busy hour, a floor tile per quiet one.
describe("the isometric pulse", () => {
  const src = html.slice(html.indexOf("const pulseIso = "), html.indexOf("/** Fill each [data-pulse=name]"));
  const pulseIso = new Function("esc", `${src}; return pulseIso;`)((s: string) => s);

  test("a pillar per busy hour, as tall as its share of the busiest", () => {
    const hours = Array(168).fill(0); hours[3] = 10; hours[100] = 5;
    const svg: string = pulseIso({ hours, total: 15, from: 0, live_at: null });
    expect(svg.match(/class="floor"/g)?.length).toBe(166);
    expect(svg.match(/class="t"/g)?.length).toBe(2);
    expect(svg).toContain("10 lines</title>");
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

  test("⌘A picks all, ⌘L adds the next line, Esc drops the pick", () => {
    expect(got(lineKey("a", false, true, st([], null, null), 4))).toEqual({ picked: [0, 1, 2, 3], anchor: 0, cursor: 3 });
    expect(got(lineKey("l", false, true, st([], null, 1), 4))).toEqual({ picked: [1], anchor: 1, cursor: 1 });
    expect(got(lineKey("l", false, true, st([1], 1, 1), 4))).toEqual({ picked: [1, 2], anchor: 1, cursor: 2 });
    expect(got(lineKey("Escape", false, false, st([1, 2], 1, 2), 4))).toEqual({ picked: [], anchor: null, cursor: 2 });
    expect(lineKey("Escape", false, false, st([], null, 2), 4)).toBeNull();
    expect(lineKey("c", false, true, st([1], 1, 1), 4)).toBeNull();
  });
});

// Selecting by rule, for the palette, the right-click menu and agents.
describe("picking lines by rule", () => {
  const src = html.slice(html.indexOf("const pickAll"), html.indexOf('/** "line 4", "lines 4'));
  const { pickAll, pickInvert, pickMatching, pickBy, pickBlock, pickDrop, pickRunAt, pickRanges } = new Function(`${src}; return { pickAll, pickInvert, pickMatching, pickBy, pickBlock, pickDrop, pickRunAt, pickRanges };`)();
  const sorted = (s: Set<number>) => [...s].sort((a, b) => a - b);
  const code = ["function a() {", "  if (x) {", "    one();", "", "    two();", "  }", "  three();", "}", "", "const b = 1;"];

  test("invert flips the pick, all picks everything", () => {
    expect(sorted(pickInvert(new Set([0, 2]), 4))).toEqual([1, 3]);
    expect(sorted(pickAll(3))).toEqual([0, 1, 2]);
  });

  test("unselecting drops a line, a run, or typed ranges", () => {
    const picked = new Set([1, 2, 3, 7, 8]);
    expect(sorted(pickDrop(picked, new Set([2])))).toEqual([1, 3, 7, 8]);
    expect(sorted(pickRunAt(picked, 2))).toEqual([1, 2, 3]);
    expect(sorted(pickRunAt(picked, 5))).toEqual([]);
    expect(sorted(pickRanges("3-4, 9", 10))).toEqual([2, 3, 8]);
    expect(sorted(pickRanges("8-", 10))).toEqual([7, 8, 9]);
    expect(sorted(pickRanges("5-3", 10))).toEqual([2, 3, 4]);
    expect(() => pickRanges("x", 10)).toThrow();
  });

  test("matching is a substring in any case, or /regex/", () => {
    expect(sorted(pickMatching(["Foo()", "bar", "fooBar"], "foo"))).toEqual([0, 2]);
    expect(sorted(pickMatching(["a1", "b", "c22"], "/\\d+$/"))).toEqual([0, 2]);
    expect(sorted(pickMatching(["a", "A"], "/a/i"))).toEqual([0, 1]);
  });

  test("by names the author, with or without @ or agent-", () => {
    const lines = [{ by: "ryan" }, { by: "agent-claude" }, { by: "ryan" }];
    expect(sorted(pickBy(lines, "@ryan"))).toEqual([0, 2]);
    expect(sorted(pickBy(lines, "claude"))).toEqual([1]);
  });

  test("expanding goes to same-depth lines, then the block, then the file", () => {
    const one = pickBlock(code, new Set([2]));
    expect(sorted(one)).toEqual([2, 3, 4]);
    const block = pickBlock(code, one);
    expect(sorted(block)).toEqual([1, 2, 3, 4, 5]);
    expect(sorted(pickBlock(code, block))).toEqual([1, 2, 3, 4, 5, 6]);
    const fn = pickBlock(code, new Set([1, 2, 3, 4, 5, 6]));
    expect(sorted(fn)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(sorted(pickBlock(code, fn))).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  test("Home/End jump and ⌘I inverts from the keys", () => {
    const lk = new Function(`${html.slice(html.indexOf("function lineKey"), html.indexOf("/**\n * What else picks"))}; return lineKey;`)();
    const st = (picked: number[], anchor: number | null, cursor: number | null) => ({ picked: new Set(picked), anchor, cursor });
    expect([...lk("End", true, false, st([1], 1, 1), 5).picked]).toEqual([1, 2, 3, 4]);
    expect([...lk("Home", false, false, st([3], 3, 3), 5).picked]).toEqual([0]);
    expect([...lk("i", false, true, st([0, 1], 0, 1), 4).picked]).toEqual([2, 3]);
  });

  test("agents get the selection tools", () => {
    for (const t of ["select_lines", "deselect_lines", "select_all_lines", "invert_selection", "expand_selection", "select_matching", "select_lines_by", "selected_lines"]) expect(html).toContain(`name: "${t}"`);
  });
});

// Switching files took ~2s live: branches, then the repo and commits, then the file, one after another.
describe("a file page loads in one round trip", () => {
  const f = html.slice(html.indexOf("  async f(owner, repo, path) {"), html.indexOf("mountExplorer($(\"#tree\")", html.indexOf("  async f(owner, repo, path) {")));
  test("the file and its commits are asked for before the branch list comes back", () => {
    expect(f.indexOf("let early = reads(picked)")).toBeGreaterThan(-1);
    expect(f.indexOf("let early = reads(picked)")).toBeLessThan(f.indexOf("await Promise.all([branchHere(owner, repo)"));
  });
  test("the explorer draws the last page's tree at once, then reads it fresh", () => {
    expect(html).toContain("await draw(); cache.clear(); every = null; repoTrees.set(key, cache);");
  });
});

// The daily path (sign in with Google, dig up a link, edit, commit, make private, share, collab, deploy)
// is one click each, from the landing page and from every repo page's header.
describe("the daily flow is one click away", () => {
  test("the landing page leads with Continue with Google when it is offered", () => {
    expect(html).toContain('id="hero-google"');
    expect(html).toContain('session.providers?.includes("google")');
  });
  test("every repo header carries the flow bar, and each step is wired to a real control", () => {
    expect(html).toContain("${views.flowBar(owner, repo, r)}");
    for (const k of ["edit", "commit", "private", "share", "invite", "deploy"]) expect(html).toContain(`step("${k}"`);
    expect(html).toContain('go("commit", (t) => t.click())');
    expect(html).toContain('needSel("lock"');
    expect(html).toContain('needSel("share"');
  });
});

// Getting started's table of contents plays the tour's steps by title; a renamed step would leave a dead entry.
test("every Getting started entry names a real tour step", () => {
  const guide = html.slice(html.indexOf("const GUIDE = ["), html.indexOf("let guideRepos"));
  const steps = [...guide.matchAll(/step: "([^"]+)"/g)].map((m) => m[1]!);
  expect(steps.length).toBeGreaterThan(0);
  for (const t of steps) expect(html).toContain(`t: "${t}"`);
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

  test("the toolbar has Ship for the owner, wired to its panel", () => {
    expect(html).toContain(`id="ship"`);
    expect(html).toContain(`id="ship-panel"`);
    expect(html).toContain("views.wireShip(owner, repo);");
  });
});

// The secret under a file: the oldest lines fall apart, by age tier.
describe("rot mode", () => {
  const src = html.slice(html.indexOf("const DECAY_TIERS"), html.indexOf("function codeRows"));
  const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const { decayTiers, rotText } = new Function("esc", `${src}; return { decayTiers, rotText };`)(esc);

  test("age tiers are relative to the file: oldest lines rot most, a one-rev file stays whole", () => {
    expect(decayTiers([5, 5, 5])).toEqual([0, 0, 0]);
    const t = decayTiers([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(t[0]).toBe(4);
    expect(t.at(-1)).toBe(0);
    expect(t).toEqual([...t].sort((a, b) => b - a));
  });

  test("rotting keeps the characters and their order", () => {
    const text = "export const answer = 42; // <b>";
    for (const tier of [1, 2, 3, 4]) {
      const out = rotText(text, tier, "l1");
      expect(out.replace(/<i [^>]*>/g, "").replace(/<\/?[is]>/g, "").replaceAll("&#60;", "<").replaceAll("&#62;", ">")).toBe(text);
    }
    expect(rotText(text.repeat(8), 4, "l1")).toContain("<i ");
    expect(rotText(text, 0, "l1")).toBe(esc(text));
  });

  test("the bottom of the file has the button", () => {
    expect(html).toContain('id="dust"');
  });
});
