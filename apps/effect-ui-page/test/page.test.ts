import { HtmlLocator, HtmlScene } from "@effect/ui/html/testing";
import { Locator, Story } from "@effect/ui/testing";
import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { decode, inputSchema, TOOLS } from "../src/agent.ts";
import { apply, starter } from "../src/page.ts";
import { PageMessage, ProfilePageNoDeps, ReportPage } from "../src/ProfilePage.ts";

const tool = (name: string) => TOOLS.find((t) => t.name === name)!;
const run = <A>(e: Effect.Effect<A, never, import("effect").Scope.Scope>) => Effect.runPromise(Effect.scoped(e));

describe("an agent's tool call", () => {
  test("is checked against the Schema before it reaches the page", () => {
    expect(decode(tool("page_set_theme"), { accent: "#112233", font: "serif" })).toEqual({ _tag: "SetTheme", accent: "#112233", font: "serif" });
    for (const [name, args] of [
      ["page_set_theme", { accent: "red" }],
      ["page_set_theme", { font: "comic" }],
      ["page_add_block", { kind: "links", title: "Me", items: [{ label: "x", url: "javascript:alert(1)" }] }],
      ["page_add_block", { title: "no kind" }],
    ] as const) expect(() => decode(tool(name), args)).toThrow();
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
      const s = yield* Story.make(ProfilePageNoDeps, {});
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
    const s = yield* HtmlScene.make(ProfilePageNoDeps, {});
    s.click(HtmlLocator.role("button", { name: "Start over" }))
      .expectExact(ReportPage)
      .resolve(ReportPage, PageMessage.CompletedReportPage())
      .expect(Locator.text("start over (you)")).toExist();
  })));
