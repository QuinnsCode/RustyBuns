import { HtmlLocator, HtmlScene } from "@effect/ui/html/testing";
import { Locator, Story } from "@effect/ui/testing";
import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { decode, inputSchema, TOOLS } from "../src/tools.ts";
import { apply, FILE_MAX, listing, type Page, starter, WORLD_MAX } from "../src/page.ts";
import { worldDoc, WORLD_CSP } from "../src/world.ts";
import { connectLines, CopyText, PageMessage, ProfilePageNoDeps, ReportPage } from "../src/ProfilePage.ts";

const tool = (name: string) => TOOLS.find((t) => t.name === name)!;
const props = { room: "testroom0001", origin: "http://localhost", initial: starter, full: false, landing: false };
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

test("Full screen puts the dock away and Show dock brings it back", () =>
  run(Effect.gen(function* () {
    const s = yield* HtmlScene.make(ProfilePageNoDeps, props);
    s.click(HtmlLocator.role("button", { name: "Full screen" }))
      .expect(HtmlLocator.role("button", { name: "Show dock" })).toExist();
    s.click(HtmlLocator.role("button", { name: "Show dock" }))
      .expect(HtmlLocator.role("button", { name: "Full screen" })).toExist();
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

test("a fresh room lands on the landing: Copy copies its Claude Code line, and the AI's first write brings up the world", () =>
  run(Effect.gen(function* () {
    const fresh = { ...props, landing: true };
    const s = yield* HtmlScene.make(ProfilePageNoDeps, fresh);
    s.expect(Locator.text("How it works")).toExist();
    s.expect(Locator.text("How it's built")).toExist();
    s.click(HtmlLocator.role("button", { name: "Copy" }))
      .expectExact(CopyText);
    expect(s.pending[0]!.command.args).toMatchObject({ text: connectLines(props.origin, props.room)[0]!.text });
    s.resolve(CopyText, PageMessage.CompletedCopy({ what: "Claude Code" })).expect(HtmlLocator.role("button", { name: "Copied" })).toExist();
    const story = yield* Story.make(ProfilePageNoDeps, fresh);
    story.send(PageMessage.ReceivedAgentCall(write("world.js", "// mine")));
    expect(story.model.landing).toBe(false);
    story.resolve(ReportPage, PageMessage.CompletedReportPage());
  })));
