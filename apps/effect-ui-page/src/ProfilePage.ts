// The page as one Effect UI component: a Model (the page, what it was before each change, the agent's last calls),
// messages for what happened (an agent called a tool, a person clicked undo or start over), and a view of both.
// Every change, the agent's or a person's, goes through `update` and ends by reporting the page (ReportPage), which
// answers the agent's waiting tool call and keeps page_read current. The dock beside the page says how to connect
// an agent: a prompt to paste into any agent that can run curl, or one `mcp add` line for each terminal agent.
import { Command, Component, Subscription, UiSchema } from "@effect/ui";
import { Html } from "@effect/ui/html";
import { Effect, Schema, Stream } from "effect";
import { Agent, Call, type Request } from "./agent.ts";
import { apply, backdropUrl, type Block, Page } from "./page.ts";
import { linksFor, prompt } from "./relay.ts";
import { READ, TOOLS } from "./tools.ts";

export const PageMessage = UiSchema.TaggedEnum({
  ReceivedAgentCall: { call: Call },
  ClickedUndo: {},
  ClickedReset: {},
  ClickedFull: {},
  ClickedLeaveLanding: {},
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
  /** The page alone, filling the window: the dock is put away (agents still reach it). */
  full: Schema.Boolean,
  /** The landing: a fresh room shows it until the agent's first change, or until the person skips it. */
  landing: Schema.Boolean,
});
type Model = typeof Model.Type;

const Props = Schema.Struct({ room: Schema.String, origin: Schema.String, initial: Page, full: Schema.Boolean, landing: Schema.Boolean });

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

// The landing: one screen over the night city (city.ts). The sign, the four parts it's made of, one line to copy,
// and four pictures of what that line does, in words a middle schooler reads at a glance.
const ICONS = {
  layers: ["m12 2 9 5-9 5-9-5 9-5Z", "m3 12 9 5 9-5", "m3 17 9 5 9-5"],
  plug: ["M12 22v-5", "M9 8V2", "M15 8V2", "M18 8v5a6 6 0 0 1-12 0V8Z"],
  box: ["M21 8 12 3 3 8v8l9 5 9-5Z", "m3 8 9 5 9-5", "M12 13v8"],
  zap: ["M13 2 3 14h9l-1 8 10-12h-9l1-8Z"],
  chat: ["M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z"],
  bot: ["M6 8h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2Z", "M12 8V4", "M9 13v2", "M15 13v2"],
  wrench: ["M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9Z"],
  screen: ["M4 3h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z", "M8 21h8", "M12 17v4"],
} as const;
type Icon = keyof typeof ICONS;

const SIGNS: readonly (readonly [string, Icon, string])[] = [
  ["Effect UI", "layers", "cyan"], ["WebMCP", "plug", "pink"], ["Cloudflare Artifacts", "box", "amber"], ["Effect", "zap", "violet"],
];

/** How it's built, for whoever scrolls past the landing: one card per piece, its words and a small picture of the idea. */
type Show =
  | { kind: "keys"; items: readonly string[] }
  | { kind: "door"; rows: readonly (readonly [boolean, string, string])[] }
  | { kind: "flow"; items: readonly (readonly [string, string])[]; loop?: boolean }
  | { kind: "data"; rows: readonly (readonly [string, string])[] }
  | { kind: "shelf"; items: readonly string[] };
const PIECES: readonly { c: string; tag: string; title: string; says: string; show: Show; soon?: boolean }[] = [
  { c: "pink", tag: "WebMCP · MCP", title: "The buttons",
    says: "Your page has a set of buttons, like a TV remote. Your AI can see them and press them. An AI in your browser finds them right on the page (WebMCP). An AI in your terminal reaches the same buttons through the line you copied (MCP).",
    show: { kind: "keys", items: ["Set the name", "Pick colors", "Add a card", "Edit a card", "Move a card", "Remove a card", "Set the backdrop", "Undo", "Start over", "Read the page"] } },
  { c: "violet", tag: "Effect · Schema", title: "The bouncer",
    says: "Every press gets checked at the door before it touches your page. A color has to look like a color. A link has to start with https. If your AI gets it wrong, the press bounces and your AI is told exactly why, so it can fix it and try again.",
    show: { kind: "door", rows: [[true, 'accent: "#ff3d8b"', "let in"], [false, 'accent: "red"', "bounced: a color looks like #rrggbb"], [false, 'url: "javascript:…"', "bounced: a link starts with https://"]] } },
  { c: "cyan", tag: "Effect UI", title: "The screen",
    says: "The whole page is one loop. It holds what the page is right now. A press arrives as a message. The page works out what it becomes next, then redraws. A click on Undo goes around the same loop, so your AI and you can never get out of sync.",
    show: { kind: "flow", loop: true, items: [["Your page", ""], ["A press arrives", ""], ["Work out what's next", ""], ["Redraw", ""]] } },
  { c: "amber", tag: "Your page is a list", title: "No code, just a list",
    says: "Your AI never writes code for your page. Your page is a short list of things: a name, a line under it, a few colors, and some cards. Your AI only changes that list, and the page draws it. That's why it can't break anything.",
    show: { kind: "data", rows: [["name", '"Night Rider"'], ["tagline", '"Skating the city after dark."'], ["colors", "accent #ff3d8b · paper #0a0918 · ink #e9ecf8"], ["font", "mono"], ["cards", "About · My boards · Spots I skate"]] } },
  { c: "green", tag: "Cloudflare", title: "Your room",
    says: "Each page gets its own room on Cloudflare, with a secret link. The room passes presses from your AI to your open page and sends back what happened. The link is the key, so only share it with AIs you trust.",
    show: { kind: "flow", items: [["Your AI", ""], ["Your room", "Cloudflare Worker"], ["Your page", "this tab"]] } },
  { c: "amber", tag: "Cloudflare Artifacts · coming", title: "Your stuff, kept", soon: true,
    says: "Today your page lives in this browser. Next, it's saved in Cloudflare Artifacts, so it opens anywhere. Then your AI can make a 3D model of you, any way it likes (with code, with Blender, or with a model-making service), and keep it in your room too.",
    show: { kind: "shelf", items: ["your page", "your 3D character", "your pictures"] } },
];

const showView = Def.fragment((h, s: Show) => {
  switch (s.kind) {
    case "keys": return h.div.class("l-show", "l-keycaps").children(...s.items.map((k) => h.span.key(k).children(k)));
    case "door": return h.div.class("l-show", "l-door").children(...s.rows.map(([ok, code, said]) => h.div.key(code).class(ok ? "in" : "out").children(h.code(code), h.b(said))));
    case "flow": return h.div.class("l-show", "l-flow").children(
      ...s.items.flatMap(([name, small], i) => [i > 0 && h.i.key(`a${i}`).attr("aria-hidden", "true"), h.span.key(name).children(name, small && h.small(small))]),
      s.loop === true && h.i.class("back").key("back").attr("aria-hidden", "true"));
    case "data": return h.pre.class("l-show", "l-data").children(h.code(s.rows.map(([k, v]) => `${k.padEnd(9)}${v}`).join("\n")));
    case "shelf": return h.div.class("l-show", "l-shelf").children(...s.items.map((k) => h.span.key(k).children(k)));
  }
});

const deepView = Def.fragment((h) => h.section.class("l-deep").attrs({ id: "how", "aria-label": "How it's built" }).children(
  h.header.class("l-deep-head").children(
    h.p.class("l-eyebrow").children("For the curious"),
    h.h2("How it's built"),
    h.p("Five pieces, each doing one job. Here's what happens when your AI hears ", h.q("make it about my skateboarding"), "."),
  ),
  ...PIECES.map((p) => h.article.class("l-piece", `c-${p.c}`, p.soon === true && "soon").key(p.title).children(
    h.div.class("l-tell").children(h.span.class("l-ptag").children(p.tag), h.h3(p.title), h.p(p.says)),
    showView(h, p.show),
  )),
));
const STEPS: readonly (readonly [Icon, string, string, string, string])[] = [
  ["chat", "amber", "1. You ask", "\"make it about my skateboarding\"", ""],
  ["bot", "violet", "2. Your AI thinks", "Claude, Codex, any AI", ""],
  ["wrench", "pink", "3. It presses buttons", "set title · add a card · pick colors", "WebMCP"],
  ["screen", "cyan", "4. Your page changes", "right in front of you", "Effect UI · Effect"],
];

/** An icon as a CSS mask over its color (the view has no SVG elements): the paths drawn as a stroked SVG data URL. */
const maskOf = (name: Icon) => `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name].map((d) => `<path d="${d}"/>`).join("")}</svg>`)}")`;
const icon = Def.fragment((h, name: Icon) => h.i.class("l-i").attrs({ "aria-hidden": "true", style: `--icon:${maskOf(name)}` }));

const landingView = Def.fragment((h, room: string, origin: string, online: boolean, copied: string | null) => {
  const claude = connectLines(origin, room)[0]!;
  return h.div.class("l-wrap").children(h.section.class("landing").attr("aria-label", "Agent Page").children(
    h.div.class("l-sign").attr("aria-hidden", "true").children("エージェント"),
    h.div.class("l-stage").children(
      h.h1.class("l-word").children("Agent Page"),
      h.p.class("l-line").children("Your AI builds your page. You watch it light up."),
      h.div.class("l-signs").children(...SIGNS.map(([name, i, c]) => h.span.class("l-chip", `c-${c}`).key(name).children(icon(h, i), name))),
      h.div.class("l-bar").children(
        h.code(claude.text),
        h.button.attr("type", "button").class("l-go").on("click", PageMessage.ClickedCopy({ what: claude.what, text: claude.text }))
          .children(copied === claude.what ? "Copied" : "Copy"),
      ),
      h.p.class("l-alt").children(
        "Codex, opencode, T3 Code? ",
        h.button.attr("type", "button").on("click", PageMessage.ClickedCopy({ what: "prompt", text: prompt(linksFor(origin, room)) }))
          .children(copied === "prompt" ? "Copied the prompt" : "Copy the prompt"),
        " and paste it in.",
      ),
      h.p.class("l-wait", online && "on").attr("role", "status").children(
        h.i.class("l-blink").attr("aria-hidden", "true"),
        online ? "Your room is open. Waiting for your AI." : "Opening your room…",
        h.button.attr("type", "button").class("l-skip").on("click", PageMessage.ClickedLeaveLanding()).children("Skip to the page"),
        h.span.class("l-keys").children(h.kbd("Cmd"), h.kbd("K"), " every command"),
      ),
      copied?.startsWith("failed") && h.p.class("l-alt").attr("role", "alert").children("The clipboard said no: select the line and copy it by hand."),
    ),
    h.section.class("l-how").attr("aria-label", "How it works").children(
      h.h2(h.b("How it works"), " · you give your AI the remote for this page"),
      h.div.class("l-steps").children(
        h.div.class("l-wire").attr("aria-hidden", "true").children(h.i.class("l-spark")),
        ...STEPS.map(([i, c, title, says, tag]) => h.div.class("l-step", `c-${c}`).key(title).children(
          h.div.class("l-dot").children(icon(h, i)), h.b(title), h.span(says), tag && h.span.class("l-tag").children(tag)))),
      h.p.class("l-say").children("Your AI can only press ", h.em("this page's"), " buttons. It can't touch anything else on your computer. ",
        h.a.class("l-more").attr("href", "#how").children("How does that work?")),
    ),
  ), deepView(h));
});

const initials =(name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";

export const ProfilePageNoDeps = Def.make({
  init: ($) => ({ page: $.props.initial, past: [], log: [], online: false, copied: null, full: $.props.full, landing: $.props.landing }),
  update: ($, message) => {
    switch (message._tag) {
      case "ChangedRelay": return $.evolve({ online: message.online });
      case "ClickedCopy": return $.run(CopyText.make({ what: message.what, text: message.text }));
      case "CompletedCopy": return $.evolve({ copied: message.what });
      case "FailedCopy": return $.evolve({ copied: `failed: ${message.what}` });
      case "ClickedFull": return $.evolve({ full: !$.model.full });
      case "ClickedLeaveLanding": return $.evolve({ landing: false });
    }
    const a = asked(message);
    if (!a) return $.model;
    const [call, tool, r] = a;
    const { model, error } = step($.model, r);
    // The agent's first change that lands takes the landing down: the page it is building comes up.
    const landing = model.landing && !(call > 0 && error === null);
    return $.set({ ...model, landing, log: [{ call, tool, error }, ...model.log].slice(0, LOG) })
      .run(ReportPage.make({ call, error, page: model.page }));
  },
  subscriptions: () => [
    Subscription.make("agent", Stream.unwrap(Effect.gen(function* () { return (yield* Agent).calls; })).pipe(
      Stream.map((call) => PageMessage.ReceivedAgentCall({ call })))),
    Subscription.make("relay", Stream.unwrap(Effect.gen(function* () { return (yield* Agent).online; })).pipe(
      Stream.changes, Stream.map((online) => PageMessage.ChangedRelay({ online })))),
  ],
  view: (h, { page, past, log, online, copied, full, landing }) => {
    const t = page.theme;
    const { room, origin } = h.props;
    if (landing) return landingView(h, room, origin, online, copied);
    // A button with its own label says it; the short "Copy" ones beside each line name their agent for a screen reader.
    const copy = (what: string, text: string, label?: string) => h.button.attr("type", "button").class("copy")
      .attr("aria-label", label ? undefined : `${copied === what ? "Copied" : "Copy"} the ${what} line`)
      .on("click", PageMessage.ClickedCopy({ what, text })).children(copied === what ? "Copied" : label ?? "Copy");
    return h.div.class("shell", full && "full").children(
      // Someone's codeSplitter page behind everything: its own sandbox (opaque origin, scripts only), no referrer.
      page.backdrop && h.iframe.class("backdrop").key(`bd-${page.backdrop}`).attrs({
        src: backdropUrl(page.backdrop), sandbox: "allow-scripts", referrerpolicy: "no-referrer", title: `@${page.backdrop}'s codeSplitter page`, style: `background:${t.paper}`, "aria-hidden": "true", tabindex: "-1",
      }),
      h.main.class("page", page.backdrop && "over").attr("style", `--accent:${t.accent};--paper:${t.paper};--ink:${t.ink};--font:${FONTS[t.font]}`).children(
        h.button.attr("type", "button").class("full-toggle").attr("title", full ? "Show the dock (Connect, tools, last calls)" : "Full screen: the page alone")
          .attr("aria-pressed", full ? "true" : "false").on("click", PageMessage.ClickedFull()).children(full ? "Show dock" : "Full screen"),
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
