// The page as one Effect UI component: a Model (the page, what it was before each change, the agent's last calls),
// messages for what happened (an agent called a tool, a person clicked undo or start over), and a view of both.
// Every change, the agent's or a person's, goes through `update` and ends by reporting the page (ReportPage), which
// answers the agent's waiting tool call and keeps page_read current.
import { Command, Component, Subscription, UiSchema } from "@effect/ui";
import { Html } from "@effect/ui/html";
import { Effect, Schema, Stream } from "effect";
import { Agent, Call, TOOLS, type Request } from "./agent.ts";
import { apply, type Block, Page, starter } from "./page.ts";

export const PageMessage = UiSchema.TaggedEnum({
  ReceivedAgentCall: { call: Call },
  ClickedUndo: {},
  ClickedReset: {},
  CompletedReportPage: {},
});

const Logged = Schema.Struct({ call: Schema.Number, tool: Schema.String, error: Schema.NullOr(Schema.String) });

/** Tell the agent (and page_read) what the page is now. */
export class ReportPage extends Command.Service<ReportPage>()("effect-ui-page/ReportPage", {
  args: { call: Schema.Number, error: Schema.NullOr(Schema.String), page: Page },
  success: PageMessage,
  mode: "queue",
}) {
  static readonly layer = this.toLayer(Effect.gen(function* () {
    const agent = yield* Agent;
    return (r) => Effect.as(agent.report(r), PageMessage.CompletedReportPage());
  }));
}

const Model = Schema.Struct({ page: Page, past: Schema.Array(Page), log: Schema.Array(Logged) });
type Model = typeof Model.Type;

const Def = Html.component({ name: "ProfilePage", model: Model, message: PageMessage });

const HISTORY = 50, LOG = 8;

/** One request on the Model: the next Model and the error to report, if it couldn't be done. */
function step(m: Model, r: Request): { model: Model; error: string | null } {
  if (r._tag === "Undo") {
    const [page, ...past] = m.past;
    return page ? { model: { ...m, page, past }, error: null } : { model: m, error: "nothing to undo" };
  }
  const out = apply(m.page, r);
  if ("error" in out) return { model: m, error: out.error };
  return { model: { ...m, page: out.page, past: [m.page, ...m.past].slice(0, HISTORY) }, error: null };
}

/** Who asked for what: the agent's call, or a person's click (call 0, which no tool call waits on). */
const asked = (m: typeof PageMessage.Type): [number, string, Request] | null => {
  switch (m._tag) {
    case "ReceivedAgentCall": return [m.call.call, m.call.tool, m.call.request];
    case "ClickedUndo": return [0, "undo (you)", { _tag: "Undo" }];
    case "ClickedReset": return [0, "start over (you)", { _tag: "Reset" }];
    case "CompletedReportPage": return null;
  }
};

const FONTS = { sans: "system-ui, sans-serif", serif: "Georgia, 'Times New Roman', serif", mono: "ui-monospace, Menlo, monospace", rounded: "ui-rounded, 'SF Pro Rounded', system-ui, sans-serif" };

const blockView = Def.fragment((h, b: Block) => {
  const card = h.section.class("block", `k-${b.kind}`).key(b.id);
  const title = h.h2.attr("title", b.id).children(b.title);
  switch (b.kind) {
    case "text": return card.children(title, b.body && h.p(b.body));
    case "quote": return card.children(h.blockquote(b.body || b.title), b.body && h.p.class("who").children(`- ${b.title}`));
    case "links": return card.children(title, h.ul(...b.items.map((i) =>
      h.li(i.url ? h.a.attrs({ href: i.url, rel: "noopener noreferrer", target: "_blank" }).children(i.label) : i.label))));
    case "stats": return card.children(title, h.div.class("stats").children(...b.items.map((i) => h.div.class("stat").children(h.b(i.value ?? ""), h.span(i.label)))));
    case "tags": return card.children(title, h.div.class("tags").children(...b.items.map((i) => h.span.class("tag").children(i.label))));
  }
});

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";

export const ProfilePageNoDeps = Def.make({
  init: () => ({ page: starter, past: [], log: [] }),
  update: ($, message) => {
    const a = asked(message);
    if (!a) return $.model;
    const [call, tool, r] = a;
    const { model, error } = step($.model, r);
    return $.set({ ...model, log: [{ call, tool, error }, ...model.log].slice(0, LOG) })
      .run(ReportPage.make({ call, error, page: model.page }));
  },
  subscriptions: () => [
    Subscription.make("agent", Stream.unwrap(Effect.gen(function* () { return (yield* Agent).calls; })).pipe(
      Stream.map((call) => PageMessage.ReceivedAgentCall({ call })))),
  ],
  view: (h, { page, past, log }) => {
    const t = page.theme;
    return h.div.class("shell").children(
      h.main.class("page").attr("style", `--accent:${t.accent};--paper:${t.paper};--ink:${t.ink};--font:${FONTS[t.font]}`).children(
        h.header(h.div.class("avatar").children(initials(page.name)), h.div(h.h1(page.name), h.p.class("tagline").children(page.tagline))),
        ...page.blocks.map((b) => blockView(h, b)),
      ),
      h.aside.class("dock").children(
        h.h3("Connect your agent"),
        h.p.class("muted").children("Open this page in a browser with WebMCP (document.modelContext) and your agent sees these tools. Without it, window.__commands.run(name, args) does the same."),
        h.ul.class("tools").children(h.li(h.code("page_read")), ...TOOLS.map((t) => h.li.attr("title", t.description).children(h.code(t.name)))),
        h.div.class("row").children(
          h.button.attr("type", "button").disabled(past.length === 0).on("click", PageMessage.ClickedUndo()).children("Undo"),
          h.button.attr("type", "button").on("click", PageMessage.ClickedReset()).children("Start over"),
        ),
        h.h3("Last calls"),
        log.length === 0
          ? h.p.class("muted").children("Nothing yet.")
          : h.ol.class("log").children(...log.map((l, i) => h.li.key(`${l.call}-${i}`).class(l.error !== null && "bad").children(h.code(l.tool), l.error ?? "ok"))),
      ),
    );
  },
});

export const ProfilePage = ProfilePageNoDeps.pipe(Component.provide(ReportPage.layer));
