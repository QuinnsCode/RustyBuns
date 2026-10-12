import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const html = readFileSync(join(import.meta.dir, "../src/client.html"), "utf8");
const css = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join("\n").replace(/\/\*[\s\S]*?\*\//g, "");
/** Every selector in the page's styles that reaches `.cls`, and its declarations. */
const rulesFor = (cls: string) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .flatMap(([, sel, body]) => sel!.split(",").map((s) => ({ sel: s.trim(), body: body! })))
  .filter(({ sel }) => new RegExp(String.raw`\.${cls}(?![\w-])`).test(sel));

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
    for (const b of ["data-resolve=\"mine\"", "data-resolve=\"rebase\"", "id=\"mirror-sync\"", "data-crew=\"1\"", "data-push=", "data-pull=", "data-open-ref="])
      expect(html).toMatch(new RegExp(`${b}[^>]*\\$\\{(picAttr|sync)`));
  });
});

// The git map: who a repo listens to, and its branches, as tiles and curves.
describe("the git map", () => {
  const src = html.slice(html.indexOf("// The git map: a repo's family"), html.indexOf("/** The git map of a repo:"));
  const { gitMapModel, gitCurve } = new Function(`${src}; return { gitMapModel, gitCurve };`)();
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
    expect(html).toContain(`<h2 draggable="true">\${icon(ic)}\${title}`);
    expect(html).not.toMatch(/<h3\b/);
  });

  test("the workbench's two asides have their own names", () => {
    expect(html).toContain(`<aside class="explorer" aria-label="Explorer">`);
    expect(html).toContain(`<aside class="details" aria-label="Details">`);
  });

  test("the feed, search, admin, invite, share, cut and error pages each open with an h1", () => {
    for (const h of [`<h1>\${icon("rss")} Your feed`, `<h1 class="page-h" style="margin:0 0 14px">\${icon("search")}`, `<h1>\${icon("gauge")} Rate limits`,
      `<h1>\${icon("activity")} Insights`, `<h1>\${icon("shovel")} Dig site`, `\${icon("mail-x")}<h1>Invite</h1>`, `\${icon("user-plus")}<h1>`,
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
