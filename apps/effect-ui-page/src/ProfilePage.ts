// The page as one Effect UI component: a Model (the page, what it was before each change, the agent's last calls),
// messages for what happened (an agent called a tool, a person clicked undo or start over), and a view of both.
// Every change, the agent's or a person's, goes through `update` and ends by reporting the page (ReportPage), which
// answers the agent's waiting tool call and keeps page_read current. The dock beside the page says how to connect
// an agent: a prompt to paste into any agent that can run curl, or one `mcp add` line for each terminal agent.
import { Command, Component, Subscription, UiSchema } from "@effect/ui";
import { Html } from "@effect/ui/html";
import { Effect, Schema, Stream } from "effect";
import { Agent, Call, type Request } from "./agent.ts";
import { apply, type Block, Page } from "./page.ts";
import { linksFor, prompt } from "./relay.ts";
import { READ, TOOLS } from "./tools.ts";

export const PageMessage = UiSchema.TaggedEnum({
  ReceivedAgentCall: { call: Call },
  ClickedUndo: {},
  ClickedReset: {},
  CompletedReportPage: {},
  ChangedRelay: { online: Schema.Boolean },
  ClickedCopy: { what: Schema.String, text: Schema.String },
  CompletedCopy: { what: Schema.String },
  FailedCopy: { what: Schema.String },
});

/** Put text on the clipboard. */
export const CopyText = Command.make("effect-ui-page/CopyText", { args: { what: Schema.String, text: Schema.String } }, ({ what, text }) =>
  Effect.tryPromise(() => navigator.clipboard.writeText(text)).pipe(Effect.match({
    onSuccess: () => PageMessage.CompletedCopy({ what }),
    onFailure: () => PageMessage.FailedCopy({ what }),
  })));

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

const Model = Schema.Struct({
  page: Page, past: Schema.Array(Page), log: Schema.Array(Logged),
  /** The relay is connected: agents in a terminal can reach the page. */
  online: Schema.Boolean,
  /** What the last copy button put on the clipboard ("failed: ..." when it couldn't). */
  copied: Schema.NullOr(Schema.String),
});
type Model = typeof Model.Type;

const Props = Schema.Struct({ room: Schema.String, origin: Schema.String, initial: Page });

const Def = Html.component({ name: "ProfilePage", props: Props, model: Model, message: PageMessage });

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
    default: return null;
  }
};

/** The connect lines, one per agent: what each copy button copies. */
export const connectLines = (origin: string, room: string) => {
  const l = linksFor(origin, room);
  return [
    { what: "Claude Code", text: `claude mcp add --transport http agent-page ${l.mcp}` },
    { what: "Codex", text: `codex mcp add agent-page --url ${l.mcp}` },
    { what: "opencode", text: `opencode mcp add agent-page --url ${l.mcp}` },
  ];
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

/** The picture at the top of the dock: agent, relay, this page, in a row. Each agent call sends a dot down the wires
 *  (keyed by the call, so a new call starts it again), green when the page took it and red when it said no. */
const how = Def.fragment((h, online: boolean, last: typeof Logged.Type | undefined) => {
  const dot = (n: number) => last && h.i.class("pulse", `w${n}`, last.error !== null && "bad").key(`p${last.call}-${n}`).attr("aria-hidden", "true");
  const node = (lit: unknown, name: string, does: string) => h.div.class("node", Boolean(lit) && "lit").children(h.b(name), h.span(does));
  return h.section.class("how").attr("aria-label", "How it works").children(
    h.div.class("flow", online && "on").children(
      node(last, "Agent", "asks"),
      h.div.class("wire").children(dot(1)),
      node(online, "Relay", "carries"),
      h.div.class("wire").children(dot(2)),
      node(true, "Page", "checks"),
    ),
    h.ol.class("steps").children(
      h.li("You ask agent."),
      h.li("Agent sends change."),
      h.li("Page checks. Page shows."),
    ),
    h.p.class("safe").children(
      h.b("Safe? "),
      "Agent can only change this page. ",
      h.b("Link is key. "),
      "Keep it secret.",
    ),
  );
});

const initials =(name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";

export const ProfilePageNoDeps = Def.make({
  init: ($) => ({ page: $.props.initial, past: [], log: [], online: false, copied: null }),
  update: ($, message) => {
    switch (message._tag) {
      case "ChangedRelay": return $.evolve({ online: message.online });
      case "ClickedCopy": return $.run(CopyText.make({ what: message.what, text: message.text }));
      case "CompletedCopy": return $.evolve({ copied: message.what });
      case "FailedCopy": return $.evolve({ copied: `failed: ${message.what}` });
    }
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
    Subscription.make("relay", Stream.unwrap(Effect.gen(function* () { return (yield* Agent).online; })).pipe(
      Stream.changes, Stream.map((online) => PageMessage.ChangedRelay({ online })))),
  ],
  view: (h, { page, past, log, online, copied }) => {
    const t = page.theme;
    const { room, origin } = h.props;
    // A button with its own label says it; the short "Copy" ones beside each line name their agent for a screen reader.
    const copy = (what: string, text: string, label?: string) => h.button.attr("type", "button").class("copy")
      .attr("aria-label", label ? undefined : `${copied === what ? "Copied" : "Copy"} the ${what} line`)
      .on("click", PageMessage.ClickedCopy({ what, text })).children(copied === what ? "Copied" : label ?? "Copy");
    return h.div.class("shell").children(
      h.main.class("page").attr("style", `--accent:${t.accent};--paper:${t.paper};--ink:${t.ink};--font:${FONTS[t.font]}`).children(
        h.header(h.div.class("avatar").children(initials(page.name)), h.div(h.h1(page.name), h.p.class("tagline").children(page.tagline))),
        ...page.blocks.map((b) => blockView(h, b)),
      ),
      h.aside.class("dock").children(
        how(h, online, log.find((l) => l.call > 0)),
        h.h3("Connect your agent"),
        h.p.class("status", online && "on").attr("role", "status").children(online ? "Ready: any agent can reach this page now." : "Connecting to the relay…"),
        h.div.class("door").children(
          h.b("Paste into any agent"),
          h.p.class("muted").children("Claude Code, Codex, opencode, T3 Code: anything that can run curl. Nothing to install."),
          copy("prompt", prompt(linksFor(origin, room)), "Copy the prompt"),
        ),
        h.div.class("door").children(
          h.b("Or add it as an MCP server"),
          h.p.class("muted").children("Its tools then show up as the agent's own. T3 Code: add it to the Claude Code or Codex it runs."),
          ...connectLines(origin, room).map((c) => h.div.class("line").key(c.what).children(h.span(c.what), h.code(c.text), copy(c.what, c.text))),
        ),
        copied?.startsWith("failed") && h.p.attr("role", "alert").children("The clipboard said no: select the line and copy it by hand."),
        h.details.children(
          h.summary("In this browser, and the tools"),
          h.p.class("muted").children("A browser agent with WebMCP (document.modelContext) sees these tools on this page. Without it, window.__commands.run(name, args) does the same."),
          h.ul.class("tools").children(h.li.attr("title", READ.description).children(h.code(READ.name)), ...TOOLS.map((t) => h.li.attr("title", t.description).children(h.code(t.name)))),
        ),
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
