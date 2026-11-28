import { HtmlLocator, HtmlScene } from "@effect/ui/html/testing";
import { Locator, Story } from "@effect/ui/testing";
import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { BUILD_TOOLS, decode, decodeReadFile, inputSchema, type Request, TOOLS } from "../src/tools.ts";
import { apply, FILE_MAX, listing, type Page, starter, WORLD_MAX } from "../src/page.ts";
import { worldDoc, WORLD_CSP } from "../src/world.ts";
import { step, connectLines, CopyText, CreateWorld, MarkMade, PageMessage, ProfilePageNoDeps, ReportPage } from "../src/ProfilePage.ts";
import { READY } from "../src/worlds.ts";

const tool = (name: string) => TOOLS.find((t) => t.name === name)!;
const props = { room: "testroom0001", origin: "http://localhost", initial: starter, full: false, landing: false, who: null, made: false };
const run = <A>(e: Effect.Effect<A, never, import("effect").Scope.Scope>) => Effect.runPromise(Effect.scoped(e));
const write = (path: string, text: string) => ({ call: { call: 1, tool: "page_write_file", request: { _tag: "WriteFile" as const, path, text } } });

describe("an agent's write", () => {
  test("is checked at the door: a file name like world.js, text only, a file's worth", () => {
    expect(decode(tool("page_write_file"), { path: "lib/noise.js", text: "export {}" })).toEqual({ _tag: "WriteFile", path: "lib/noise.js", text: "export {}" });
    for (const args of [
      { path: "../secrets.js", text: "" },
      { path: "a/b/c.js", text: "" },
      { path: "virus.exe", text: "" },
      { path: "world.js", text: "x".repeat(FILE_MAX + 1) },
      { path: "world.js" },
    ]) expect(() => decode(tool("page_write_file"), args)).toThrow();
    expect(() => decode(tool("page_set_backdrop"), { codesplitter: "../me/../admin" })).toThrow();
    expect(inputSchema(tool("page_write_file").schema).required).toEqual(["path", "text"]);
  });

  test("bounces with the field's name and a good value, not the pattern", () => {
    for (const [name, args, why] of [
      ["page_write_file", { path: "../secrets", text: "" }, "path: a file name like world.js"],
      ["page_write_file", { path: "world.js", text: "x".repeat(FILE_MAX + 1) }, "text: a file is text, 100,000 characters at most"],
      ["page_edit_file", { path: "world.js", replace: "" }, 'find: the exact text to replace, like sky("day")'],
      ["page_set_backdrop", { codesplitter: "../me" }, 'codesplitter: a codeSplitter handle like ada, or "" for none'],
      ["page_status", { text: "" }, "text: a few words, 80 characters at most"],
    ] as const) expect(() => decode(tool(name), args)).toThrow(why);
    const door = (name: string) => BUILD_TOOLS.find((t) => t.name === name)!;
    expect(() => decode(door("world_build"), {})).toThrow("code: world.js's whole code");
    expect(() => decode(door("world_edit"), { find: "", replace: "" })).toThrow('find: the exact text to replace');
    expect(() => decodeReadFile({})).toThrow("path: a file name like world.js");
  });

  test("adds, replaces and takes away files, and says when the world is full", () => {
    const ok = (p: Page, path: string, text: string) => { const r = apply(p, { _tag: "WriteFile", path, text }); if ("error" in r) throw new Error(r.error); return r.page; };
    let p = ok(starter, "style.css", "body{}");
    p = ok(p, "world.js", "// mine");
    expect(listing(p).map((f) => f.path)).toEqual(["index.html", "style.css", "world.js"]);
    expect(p.files["world.js"]).toBe("// mine");
    p = ok(p, "style.css", "");
    expect("style.css" in p.files).toBe(false);
    const big = "x".repeat(FILE_MAX);
    let full = p;
    for (let i = 0; i * FILE_MAX < WORLD_MAX - FILE_MAX; i++) full = ok(full, `big${i}.txt`, big);
    expect(apply(full, { _tag: "WriteFile", path: "one-more.txt", text: big })).toMatchObject({ error: expect.stringContaining("characters at most") });
  });

  test("lands in the world and answers; undo takes it back", () =>
    run(Effect.gen(function* () {
      const s = yield* Story.make(ProfilePageNoDeps, props);
      s.send(PageMessage.ReceivedAgentCall(write("world.js", "// a three.js scene")));
      expect(s.model.page.files["world.js"]).toBe("// a three.js scene");
      s.expectExact(ReportPage);
      expect(s.pending[0]!.command.args).toMatchObject({ call: 1, error: null });
      s.resolve(ReportPage, PageMessage.CompletedReportPage());
      s.send(PageMessage.ReceivedAgentCall({ call: { call: 2, tool: "page_undo", request: { _tag: "Undo" } } }));
      expect(s.model.page.files["world.js"]).toBe(starter.files["world.js"]!);
      s.resolve(ReportPage, PageMessage.CompletedReportPage());
      s.send(PageMessage.ReceivedAgentCall({ call: { call: 3, tool: "page_undo", request: { _tag: "Undo" } } }));
      expect(s.pending[0]!.command.args).toMatchObject({ call: 3, error: "nothing to undo" });
      s.resolve(ReportPage, PageMessage.CompletedReportPage());
    })));
});

describe("the sealed frame's document", () => {
  const world = (files: Record<string, string>) => worldDoc({ files });

  test("puts the world's own files inline, after the policy and the reporter", () => {
    const doc = world({
      "index.html": `<!doctype html><html><head><link rel="stylesheet" href="style.css"><script type="importmap">{"imports":{"three":"https://esm.sh/three@0.170.0"}}</script></head><body><script type="module" src="./main.js"></script><script src="https://unpkg.com/x.js"></script></body></html>`,
      "style.css": "body{color:red}",
      "main.js": `import * as THREE from "three"; import { noise } from "./lib/noise.js"; console.log("</script>", THREE, noise);`,
      "lib/noise.js": `import { k } from "../k.js"; export const noise = k;`,
      "k.js": "export const k = 1;",
    });
    expect(doc.startsWith(`<!doctype html><meta http-equiv="Content-Security-Policy" content="${WORLD_CSP}"><script>`)).toBe(true);
    expect(doc).toContain("<style>body{color:red}</style>");
    expect(doc).toContain(`from "@world/lib/noise.js"`);
    expect(doc).toContain("<\\/script>");
    expect(doc).toContain(`<script src="https://unpkg.com/x.js"></script>`);
    const map = JSON.parse(doc.match(/<script type="importmap">(.*?)<\/script>/)![1]!).imports;
    expect(map.three).toBe("https://esm.sh/three@0.170.0");
    expect(decodeURIComponent(map["@world/lib/noise.js"])).toContain(`from "@world/k.js"`);
    expect(doc.match(/type="importmap"/g)).toHaveLength(1);
  });

  test("says what to do when there is no index.html", () => {
    expect(world({ "world.js": "" })).toContain("No index.html yet");
  });
});

test("world_build on a ready-made world gives it an index.html that runs a module, and one undo takes both back", () => {
  const page = { files: READY[0]!.files };
  const built = step({ page, past: [] }, { _tag: "Build", code: "// mine" });
  expect(built.model.page.files["world.js"]).toBe("// mine");
  expect(built.model.page.files["index.html"]).toBe(starter.files["index.html"]!);
  expect(step(built.model, { _tag: "Undo" }).model.page).toEqual(page);
});

test("a person's Start over shows in the agent's log", () =>
  run(Effect.gen(function* () {
    const s = yield* HtmlScene.make(ProfilePageNoDeps, props);
    s.click(HtmlLocator.role("button", { name: "Start over" }))
      .expectExact(ReportPage)
      .resolve(ReportPage, PageMessage.CompletedReportPage())
      .expect(Locator.text("start over (you)")).toExist();
  })));

test("a copy button copies its agent's line for this room, and says so", () =>
  run(Effect.gen(function* () {
    const claude = connectLines(props.origin, props.room)[0]!;
    expect(claude.text).toBe("claude mcp add --transport http agent-page http://localhost/api/r/testroom0001/mcp");
    const s = yield* HtmlScene.make(ProfilePageNoDeps, props);
    s.click(HtmlLocator.role("button", { name: "Copy the Claude Code line" }))
      .expectExact(CopyText)
      .resolve(CopyText, PageMessage.CompletedCopy({ what: "Claude Code" }))
      .expect(HtmlLocator.role("button", { name: "Copied the Claude Code line" })).toExist();
  })));

test("Hide puts the console away, Show brings it back, and ?full opens with it put away", () =>
  run(Effect.gen(function* () {
    const s = yield* HtmlScene.make(ProfilePageNoDeps, props);
    s.click(HtmlLocator.role("button", { name: "Hide" }))
      .expect(HtmlLocator.role("complementary", { name: "Console" })).toBeAbsent()
      .click(HtmlLocator.role("button", { name: "Show" }))
      .expect(HtmlLocator.role("complementary", { name: "Console" })).toExist();
    const full = yield* HtmlScene.make(ProfilePageNoDeps, { ...props, full: true });
    full.expect(HtmlLocator.role("button", { name: "Show" })).toExist();
  })));

test("the step strip follows the agent: read, status, write, and a clean load is \"Your world is up\"; a frame error stops short", () =>
  run(Effect.gen(function* () {
    const now = (says: string) => Locator.inside(Locator.attr("aria-current", "step"), Locator.text(says));
    const call = (n: number, request: Request) => PageMessage.ReceivedAgentCall({ call: { call: n, tool: "agent", request } });
    const s = yield* HtmlScene.make(ProfilePageNoDeps, props);
    s.expect(now("Waiting for your AI")).toExist()
      .subscription("seen", PageMessage.Saw({ what: "read" })).expect(now("Your AI is here")).toExist()
      .subscription("agent", call(1, { _tag: "Status", text: "Asking about the ground" }))
      .resolve(ReportPage, PageMessage.CompletedReportPage())
      .expect(now("Asking you about your world")).toExist()
      .expect(Locator.text("Asking about the ground")).toExist()
      .subscription("agent", call(2, { _tag: "WriteFile", path: "world.js", text: "// dunes" }))
      .resolve(ReportPage, PageMessage.CompletedReportPage())
      .expect(now("Writing the code")).toExist()
      .subscription("seen", PageMessage.Saw({ what: "start" }))
      .subscription("seen", PageMessage.Saw({ what: "error" }))
      .subscription("seen", PageMessage.Saw({ what: "loaded" }))
      .expect(now("Writing the code")).toExist()
      .subscription("seen", PageMessage.Saw({ what: "start" }))
      .subscription("seen", PageMessage.Saw({ what: "loaded" }))
      .expect(now("Your world is up")).toExist()
      // Up after the AI's write: the page saves the world as made.
      .resolve(MarkMade, PageMessage.MadeWorld({ made: true }));
    // A status changes no file and leaves nothing to undo.
    const story = yield* Story.make(ProfilePageNoDeps, props);
    story.send(call(1, { _tag: "Status", text: "Asking about the weather" }));
    expect([story.model.status, story.model.past.length, story.model.page]).toEqual(["Asking about the weather", 0, starter]);
    story.resolve(ReportPage, PageMessage.CompletedReportPage());
  })));

test("the Galaxy is locked until your world is made: a ready-made world doesn't make it, your AI's clean write does", () =>
  run(Effect.gen(function* () {
    for (const [who, made, name] of [
      [null, false, "Agent Galaxy: Sign in and make your world first"],
      [null, true, "Agent Galaxy: Sign in and make your world first"],
      ["Ada", false, "Agent Galaxy: Make your world first"],
      ["Ada", true, "Agent Galaxy"],
    ] as const) (yield* HtmlScene.make(ProfilePageNoDeps, { ...props, who, made })).expect(HtmlLocator.role("button", { name })).toExist();

    const s = yield* Story.make(ProfilePageNoDeps, { ...props, who: "Ada" });
    const loads = () => { s.send(PageMessage.Saw({ what: "start" })); s.send(PageMessage.Saw({ what: "loaded" })); };
    s.send(PageMessage.ClickedGalaxy());
    expect(s.model.galaxy).toBe(false);
    // A person's click on a ready-made world: it loads clean, and nothing is made.
    s.send(PageMessage.ClickedTry({ name: READY[0]!.name }));
    s.resolve(ReportPage, PageMessage.CompletedReportPage());
    loads();
    expect([s.model.made, s.pending.length]).toEqual([false, 0]);
    // The AI's write loads clean: the page saves it as made, and the galaxy opens.
    s.send(PageMessage.ReceivedAgentCall(write("world.js", "// dunes")));
    s.resolve(ReportPage, PageMessage.CompletedReportPage());
    loads();
    s.expectExact(MarkMade);
    expect(s.pending[0]!.command.args).toMatchObject({ room: props.room, signedIn: true, page: { files: { "world.js": "// dunes" } } });
    s.resolve(MarkMade, PageMessage.MadeWorld({ made: true }));
    s.send(PageMessage.ClickedGalaxy());
    expect([s.model.made, s.model.galaxy]).toEqual([true, true]);
  })));

test("the landing is one screen: the three steps and Create your world; How it's built opens under it and closes again", () =>
  run(Effect.gen(function* () {
    const s = yield* HtmlScene.make(ProfilePageNoDeps, { ...props, landing: true });
    const how = HtmlLocator.role("button", { name: "How it's built" });
    for (const says of ["Connect your agent", "Ask for your world", "Walk the galaxy"]) s.expect(Locator.text(says)).toExist();
    s.expect(HtmlLocator.role("button", { name: /Create your world/ })).toExist()
      .expect(HtmlLocator.role("region", { name: "How it's built" })).toBeAbsent()
      .click(how).expect(HtmlLocator.role("region", { name: "How it's built" })).toExist()
      .click(how).expect(HtmlLocator.role("region", { name: "How it's built" })).toBeAbsent();
  })));

test("Create your world signs in, or says in one line that it can't, and Skip to the page still works", () =>
  run(Effect.gen(function* () {
    const s = yield* HtmlScene.make(ProfilePageNoDeps, { ...props, landing: true });
    const create = HtmlLocator.role("button", { name: /Create your world/ });
    s.click(create).expectExact(CreateWorld);
    expect(s.pending[0]!.command.args).toEqual({ room: props.room });
    s.resolve(CreateWorld, PageMessage.CreatedWorld({ went: "off" }))
      .expect(Locator.text("Sign-in isn't reachable", { exact: false })).toExist()
      .click(HtmlLocator.role("button", { name: "Skip to the page" }))
      .expect(HtmlLocator.role("complementary", { name: "Console" })).toExist();
    // Signed in already: the card opens this browser's world.
    const signedIn = yield* HtmlScene.make(ProfilePageNoDeps, { ...props, landing: true, who: "Ada" });
    signedIn.expect(Locator.text("Signed in as Ada", { exact: false })).toExist()
      .click(create).resolve(CreateWorld, PageMessage.CreatedWorld({ went: "here" }))
      .expect(HtmlLocator.role("complementary", { name: "Console" })).toExist();
  })));

test("a person tries a ready-made world from the landing, no AI connected, and Undo takes it back", () =>
  run(Effect.gen(function* () {
    const story = yield* Story.make(ProfilePageNoDeps, { ...props, landing: true });
    story.send(PageMessage.ClickedTry({ name: "Fish tank" }));
    expect(story.model.landing).toBe(false);
    expect(story.model.page.files["world.js"]).toContain("fish");
    story.resolve(ReportPage, PageMessage.CompletedReportPage());
    story.send(PageMessage.ClickedUndo());
    expect(story.model.page).toEqual(starter);
    story.resolve(ReportPage, PageMessage.CompletedReportPage());
  })));

test("a fresh room lands on the landing, and the AI's first write brings up the world", () =>
  run(Effect.gen(function* () {
    const story = yield* Story.make(ProfilePageNoDeps, { ...props, landing: true });
    story.send(PageMessage.ReceivedAgentCall(write("world.js", "// mine")));
    expect(story.model.landing).toBe(false);
    story.resolve(ReportPage, PageMessage.CompletedReportPage());
  })));
