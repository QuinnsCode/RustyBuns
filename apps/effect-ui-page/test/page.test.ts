import { HtmlLocator, HtmlScene } from "@effect/ui/html/testing";
import { Locator, Story } from "@effect/ui/testing";
import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { decode, inputSchema, TOOLS } from "../src/tools.ts";
import { apply, starter } from "../src/page.ts";
import { connectLines, CopyText, PageMessage, ProfilePageNoDeps, ReportPage } from "../src/ProfilePage.ts";

const tool = (name: string) => TOOLS.find((t) => t.name === name)!;
const props = { room: "testroom0001", origin: "http://localhost", initial: starter, full: false };
const run = <A>(e: Effect.Effect<A, never, import("effect").Scope.Scope>) => Effect.runPromise(Effect.scoped(e));

describe("an agent's tool call", () => {
  test("is checked against the Schema before it reaches the page", () => {
    expect(decode(tool("page_set_theme"), { accent: "#112233", font: "serif" })).toEqual({ _tag: "SetTheme", accent: "#112233", font: "serif" });
    for (const [name, args] of [
      ["page_set_theme", { accent: "red" }],
      ["page_set_theme", { font: "comic" }],
      ["page_add_block", { kind: "links", title: "Me", items: [{ label: "x", url: "javascript:alert(1)" }] }],
      ["page_add_block", { title: "no kind" }],
      ["page_set_backdrop", { codesplitter: "../me/../admin" }],
    ] as const) expect(() => decode(tool(name), args)).toThrow();
  });

  test("puts a codeSplitter page behind the blocks, and takes it away", () => {
    const asked = decode(tool("page_set_backdrop"), { codesplitter: "quinn" });
    expect(asked).toEqual({ _tag: "SetBackdrop", codesplitter: "quinn" });
    const set = apply(starter, { _tag: "SetBackdrop", codesplitter: "quinn" });
    expect("page" in set && set.page.backdrop).toBe("quinn");
    const off = "page" in set ? apply(set.page, { _tag: "SetBackdrop", codesplitter: "" }) : set;
    expect("page" in off && "backdrop" in off.page).toBe(false);
  });

  test("tells the agent which arguments it takes", () => {
    const s = inputSchema(tool("page_add_block").schema);
    expect(s.properties.at).toMatchObject({ type: "integer" });
    expect(Object.keys(s.properties).sort()).toEqual(["at", "body", "items", "kind", "title"]);
    expect(s.required).toEqual(["kind", "title"]);
    expect(JSON.stringify(s.properties.kind)).toContain('"quote"');
  });

  test("adds, moves, edits and removes blocks, and names the ids when one is wrong", () => {
    let page = starter;
    const ok = (a: Parameters<typeof apply>[1]) => {
      const r = apply(page, a);
      if ("error" in r) throw new Error(r.error);
      page = r.page;
    };
    ok({ _tag: "AddBlock", kind: "stats", title: "Numbers", items: [{ label: "repos", value: "12" }] });
    ok({ _tag: "MoveBlock", id: "b2", to: 0 });
    ok({ _tag: "EditBlock", id: "b1", title: "Hello" });
    expect(page.blocks.map((b) => [b.id, b.title])).toEqual([["b2", "Numbers"], ["b1", "Hello"]]);
    ok({ _tag: "RemoveBlock", id: "b2" });
    expect(apply(page, { _tag: "RemoveBlock", id: "b9" })).toEqual({ error: 'no block "b9": the blocks are b1' });
  });

  test("changes the page and answers with it; undo takes it back", () =>
    run(Effect.gen(function* () {
      const s = yield* Story.make(ProfilePageNoDeps, props);
      s.send(PageMessage.ReceivedAgentCall({ call: { call: 1, tool: "page_set_profile", request: { _tag: "SetProfile", name: "Ada" } } }));
      expect(s.model.page.name).toBe("Ada");
      s.expectExact(ReportPage);
      expect(s.pending[0]!.command.args).toMatchObject({ call: 1, error: null, page: { name: "Ada" } });
      s.resolve(ReportPage, PageMessage.CompletedReportPage());
      s.send(PageMessage.ReceivedAgentCall({ call: { call: 2, tool: "page_undo", request: { _tag: "Undo" } } }));
      expect(s.model.page.name).toBe(starter.name);
      s.resolve(ReportPage, PageMessage.CompletedReportPage());
      s.send(PageMessage.ReceivedAgentCall({ call: { call: 3, tool: "page_undo", request: { _tag: "Undo" } } }));
      expect(s.pending[0]!.command.args).toMatchObject({ call: 3, error: "nothing to undo" });
      s.resolve(ReportPage, PageMessage.CompletedReportPage());
    })));
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
