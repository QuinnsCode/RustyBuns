// The page as one Effect UI component: a Model (the world's files, what they were before each change, the agent's
// last calls), messages for what happened (an agent called a tool, a person clicked undo or start over), and a view:
// the world in its sealed frame (world.ts) with the console over it, and the landing before it.
// Every change, the agent's or a person's, goes through `update` and ends by reporting the page (ReportPage), which
// answers the agent's waiting tool call and keeps page_read current. The console says where the agent is (the step
// strip) and how to connect one: a prompt to paste into any agent that can run curl, or one `mcp add` line for each
// terminal agent.
import { Command, Component, Subscription, UiSchema } from "@effect/ui";
import { Html } from "@effect/ui/html";
import { Effect, Queue, Schema, Stream } from "effect";
import { runCommand } from "@rustybuns/util/commands";
import { Agent, Call, type Request, Seen } from "./agent.ts";
import { NOTE_MAX } from "./answers.ts";
import { apply, backdropUrl, Page, starter } from "./page.ts";
import { exportGif, type GifState, watchGif } from "./pictures.ts";
import { linksFor, prompt } from "./relay.ts";
import { copyright, FOOT_LINKS, MAKER, TAGLINE } from "./foot.ts";
import { listTools } from "./tools.ts";
import { WorldFrame } from "./world-frame.ts";
import { worldDoc } from "./world.ts";
import { LANDS } from "./lands.ts";
import { READY } from "./worlds.ts";
import cityShot from "./levels/city.jpg";
import fishShot from "./levels/fish.jpg";
import spaceShot from "./levels/space.jpg";
import { galaxyAsks, preloadGalaxy } from "./galaxyView.ts";
import { galaxyLock, lockLine, SIGN_IN_FIRST } from "./lock.ts";

export const PageMessage = UiSchema.TaggedEnum({
  ReceivedAgentCall: { call: Call },
  ClickedTry: { name: Schema.String },
  /** A new person's one tap: which land their world starts as, or "" to keep the desert. */
  ClickedLand: { name: Schema.String },
  ClickedUndo: {},
  ClickedReset: {},
  ClickedFull: {},
  ClickedLeaveLanding: {},
  CompletedReportPage: {},
  ChangedRelay: { online: Schema.Boolean },
  TypedNote: { value: Schema.String },
  SubmittedNote: {},
  CompletedSendNote: {},
  /** What is waiting for the agent, and what a reply to it just took (agent.ts). */
  ChangedNote: { waiting: Schema.String, sent: Schema.String },
  ClickedCopy: { what: Schema.String, text: Schema.String },
  CompletedCopy: { what: Schema.String },
  FailedCopy: { what: Schema.String },
  /** An agent read the page, or the world's frame started, loaded or went wrong (agent.ts): the step strip moves. */
  Saw: { what: Seen },
  ClickedExplain: {},
  ClickedCreate: {},
  CreatedWorld: { went: Schema.Literals(["here", "away", "off"]) },
  ClickedExportGif: {},
  ChangedGif: { busy: Schema.Boolean, says: Schema.String },
  CompletedExportGif: {},
  ClickedGalaxy: {},
  ClickedBack: {},
  /** The world was saved as made (MarkMade), or the server said no: the galaxy opens to a signed-in person. */
  MadeWorld: { made: Schema.Boolean },
});

/** "Create your world": sign in with eqosys, or open your world (account.ts). */
export const CreateWorld = Command.make("agentworld/CreateWorld", { args: { room: Schema.String } }, ({ room }) =>
  Effect.promise(() => import("./account.ts").then((a) => a.createWorld(room))).pipe(Effect.map((went) => PageMessage.CreatedWorld({ went }))));

/** Your AI's world loaded clean: save it on the server as made (POST /api/r/<room>/made, saved.ts), which opens the
 *  galaxy to a signed-in person (lock.ts) and lets the server hand it a plot. */
export const MarkMade = Command.make("agentworld/MarkMade", { args: { room: Schema.String, page: Page, signedIn: Schema.Boolean } }, ({ room, page, signedIn }) =>
  Effect.promise(() => fetch(`/api/r/${room}/made`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(page) }).then((r) => r.ok, () => false))
    .pipe(Effect.map((made) => {
      if (made) galaxyLock.why = lockLine(signedIn, true);
      if (made) void import("./account.ts").then((a) => a.worldBuilder());
      // Open now: claim the plot and build the galaxy hidden, a moment later, when the browser is idle.
      if (made && signedIn) setTimeout(() => void preloadGalaxy(), 600);
      return PageMessage.MadeWorld({ made });
    })));

/** Record the world as a GIF (pictures.ts); how it goes comes back as ChangedGif. */
export const ExportGif = Command.make("agentworld/ExportGif", { args: { room: Schema.String } }, ({ room }) =>
  Effect.promise(() => exportGif(room)).pipe(Effect.as(PageMessage.CompletedExportGif())));

/** Leave a note for the agent, by the same command Cmd+K runs. */
export const SendNote = Command.make("agentworld/SendNote", { args: { text: Schema.String } }, ({ text }) =>
  Effect.promise(() => runCommand("page_send_note", { text }, "palette")).pipe(Effect.as(PageMessage.CompletedSendNote())));

/** Put text on the clipboard. */
export const CopyText = Command.make("agentworld/CopyText", { args: { what: Schema.String, text: Schema.String } }, ({ what, text }) =>
  Effect.tryPromise(() => navigator.clipboard.writeText(text)).pipe(Effect.match({
    onSuccess: () => PageMessage.CompletedCopy({ what }),
    onFailure: () => PageMessage.FailedCopy({ what }),
  })));

const Logged = Schema.Struct({ call: Schema.Number, tool: Schema.String, error: Schema.NullOr(Schema.String) });

/** Tell the agent (and page_read) what the page is now. */
export class ReportPage extends Command.Service<ReportPage>()("agentworld/ReportPage", {
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
  /** The note box: what is typed, and what waits for the agent's next call. */
  draft: Schema.String, waiting: Schema.String,
  /** What the last copy button put on the clipboard ("failed: ..." when it couldn't). */
  copied: Schema.NullOr(Schema.String),
  /** Export GIF: running or not, and what it last said. */
  gif: Schema.Struct({ busy: Schema.Boolean, says: Schema.String }),
  /** The page alone, filling the window: the dock is put away (agents still reach it). */
  full: Schema.Boolean,
  /** The landing: a fresh room shows it until the agent's first change, or until the person skips it. */
  landing: Schema.Boolean,
  /** The landing's "How it's built" is open under it. */
  explain: Schema.Boolean,
  /** "Create your world" found no eqosys to sign in with (local dev). */
  noSignIn: Schema.Boolean,
  /** A new person said to keep the desert, so the land picker stays away. */
  picked: Schema.Boolean,
  /** How far the agent has got, for the step strip: it is here, it asked, it wrote, the frame since its last load. */
  steps: Schema.Struct({ here: Schema.Boolean, asked: Schema.Boolean, wrote: Schema.Boolean, clean: Schema.Boolean, up: Schema.Boolean }),
  /** The agent's last page_status. */
  status: Schema.NullOr(Schema.String),
  /** Agent Galaxy: the dock drops away and the map takes the window (galaxyView.ts draws it). */
  galaxy: Schema.Boolean,
  /** The world is made (its AI's write loaded clean and the server keeps it): with a sign-in, the galaxy opens. */
  made: Schema.Boolean,
});
type Model = typeof Model.Type;

/** `who`: the eqosys name this browser is signed in as (account.ts), or null. `made`: the server says this room's world is. */
const Props = Schema.Struct({ room: Schema.String, origin: Schema.String, initial: Page, full: Schema.Boolean, landing: Schema.Boolean, who: Schema.NullOr(Schema.String), made: Schema.Boolean });

const Def = Html.component({ name: "ProfilePage", props: Props, model: Model, message: PageMessage });

// A world is up to 400 KB of text, so its history keeps the last 20, not more.
const HISTORY = 20, LOG = 8;

/** A tool's request, or a person loading a ready-made world (worlds.ts), which no tool does. */
type Asked = Request | { readonly _tag: "Load"; readonly files: Page["files"] };

/** One request on the Model: the next Model and the error to report, if it couldn't be done. */
export function step<M extends Pick<Model, "page" | "past">>(m: M, r: Asked): { model: M; error: string | null } {
  if (r._tag === "Undo") {
    const [page, ...past] = m.past;
    return page ? { model: { ...m, page, past }, error: null } : { model: m, error: "nothing to undo" };
  }
  if (r._tag === "Status") return { model: { ...m, status: r.text }, error: null };
  const out = r._tag === "Load" ? { page: { ...m.page, files: r.files } } : apply(m.page, r);
  if ("error" in out) return { model: m, error: out.error };
  return { model: { ...m, page: out.page, past: [m.page, ...m.past].slice(0, HISTORY) }, error: null };
}

/** Who asked for what: the agent's call, or a person's click (call 0, which no tool call waits on). */
const asked = (m: typeof PageMessage.Type): [number, string, Asked] | null => {
  switch (m._tag) {
    case "ClickedTry": {
      const w = READY.find((r) => r.name === m.name);
      return w ? [0, `${w.name} (you)`, { _tag: "Load", files: w.files }] : null;
    }
    case "ClickedLand": {
      const l = LANDS.find((r) => r.name === m.name);
      return l ? [0, `${l.name} (you)`, { _tag: "Load", files: l.files }] : null;
    }
    // A status shows its words in the terminal.
    case "ReceivedAgentCall": return [m.call.call, m.call.request._tag === "Status" ? `${m.call.tool} "${m.call.request.text}"` : m.call.tool, m.call.request];
    case "ClickedUndo": return [0, "undo (you)", { _tag: "Undo" }];
    case "ClickedReset": return [0, "start over (you)", { _tag: "Reset" }];
    default: return null;
  }
};

/** The connect lines, one per agent: what each copy button copies. */
export const connectLines = (origin: string, room: string) => {
  const l = linksFor(origin, room);
  return [
    { what: "Claude Code", text: `claude mcp add --transport http agentworld ${l.mcp}` },
    { what: "Codex", text: `codex mcp add agentworld --url ${l.mcp}` },
    { what: "opencode", text: `opencode mcp add agentworld --url ${l.mcp}` },
  ];
};

/** The console's terminal: what happened, as a command line shows it, oldest first. `$` a command, `..` waiting,
 *  `ok` done, `>` a call (the agent's or yours), `!!` something went wrong, `->` your turn (always the last line). */
type Line = readonly ["cmd" | "dim" | "ok" | "call" | "bad" | "you", string];

/** What the person has to do in their own agent (a note typed here waits for its next call), or null while it is busy. */
const yourTurn = (online: boolean, s: Model["steps"]): string | null =>
  !online ? null : s.up ? "to change it, type what you want into your agent" : !s.here ? "waiting for you: paste the prompt into your agent"
    : !s.wrote ? "waiting for you: type what you want into your agent" : null;
export const termLines = (room: string, online: boolean, steps: Model["steps"], log: Model["log"]): Line[] => {
  const turn = yourTurn(online, steps);
  return [
  ["cmd", `agentworld open ${room}`],
  online ? ["ok", "connected to the relay: your AI can reach this page"] : ["dim", "connecting to the relay…"],
  ...(steps.here ? [["ok", "connected: your agent is here"] as const] : []),
  ...[...log].reverse().flatMap((l): Line[] => l.error === null ? [["call", `${l.tool}  ok`]] : [["call", l.tool], ["bad", l.error]]),
  ...(steps.up ? [["ok", "your world is up"] as const] : steps.wrote && !steps.clean ? [["bad", "the frame reported an error: page_read says what"] as const] : []),
  ...(turn ? [["you", turn] as const] : []),
  ];
};
const MARK = { cmd: "$", dim: "..", ok: "ok", call: ">", bad: "!!", you: "->" } as const;
const termView = Def.fragment((h, lines: Line[]) => h.div.class("term-out").attrs({ role: "log", "aria-label": "What happened" }).children(
  ...lines.map(([k, text], i) => h.p.key(`${i}-${text}`).class(`t-${k}`).children(h.span.class("t-mark").attr("aria-hidden", "true").children(MARK[k]), text)),
));

/** One button per ready-made world; the one on screen is pressed. */
const tryView = Def.fragment((h, on: string | undefined) => h.div.class("tries").attrs({ role: "group", "aria-label": "Try a world" }).children(
  ...READY.map((w) => h.button.key(w.name).attrs({ type: "button", "data-try": w.name, "aria-pressed": w.name === on ? "true" : "false" })
    .on("click", PageMessage.ClickedTry({ name: w.name })).children(w.name))));

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
  hourglass: ["M5 22h14", "M5 2h14", "M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22", "M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"],
  ask: ["M7.9 20A9 9 0 1 0 4 16.1L2 22Z", "M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3", "M12 17h.01"],
  code: ["m16 18 6-6-6-6", "m8 6-6 6 6 6"],
  info: ["M12 2a10 10 0 1 0 0 20 10 10 0 1 0 0-20Z", "M12 16v-4", "M12 8h.01"],
  sparkles: ["M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0Z"],
  download: ["M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4", "m7 10 5 5 5-5", "M12 15V3"],
  copy: ["M10 8h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2Z", "M4 16a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2"],
  check: ["M20 6 9 17l-5-5"],
  x: ["M18 6 6 18", "m6 6 12 12"],
  key: ["m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4", "m21 2-9.6 9.6", "M7.5 10a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11Z"],
  undo: ["M3 7v6h6", "M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"],
  reset: ["M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8", "M3 3v5h5"],
  hill: ["m3 20 5-9 4 6 3-4 6 7Z", "M17 4a2 2 0 1 0 0 4 2 2 0 1 0 0-4Z"],
  city: ["M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z", "M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2", "M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2", "M10 6h4", "M10 10h4", "M10 14h4", "M10 18h4"],
  orbit: ["M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z", "M19 3a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z", "M5 17a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z", "M10.4 21.9a10 10 0 0 0 9.94-15.42", "M13.5 2.1a10 10 0 0 0-9.84 15.42"],
  fish: ["M6.5 12c.94-3.46 4.94-6 8.5-6 3.56 0 6.06 2.54 7 6-.94 3.47-3.44 6-7 6s-7.56-2.53-8.5-6Z", "M18 12v.5", "M16 17.93a9.77 9.77 0 0 1 0-11.86", "M7 10.67C7 8 5.58 5.97 2.73 5.5c-1 1.5-1 5 .23 6.5-1.24 1.5-1.24 5-.23 6.5C5.58 18.03 7 16 7 13.33"],
  globe: ["M2 12a10 10 0 1 0 20 0a10 10 0 1 0-20 0", "M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20", "M2 12h20"],
  back: ["m12 19-7-7 7-7", "M19 12H5"],
  lock: ["M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Z", "M7 11V7a5 5 0 0 1 10 0v4"],
} as const;
type Icon = keyof typeof ICONS;

const SIGNS: readonly (readonly [string, Icon, string])[] = [
  ["Effect UI", "layers", "cyan"], ["WebMCP", "plug", "pink"], ["Cloudflare Artifacts", "box", "amber"], ["Effect", "zap", "violet"],
];

/** How it's built, for whoever scrolls past the landing: one card per piece, its words and a small picture of the idea. */
type Show =
  | { kind: "door"; rows: readonly (readonly [boolean, string, string])[] }
  | { kind: "flow"; items: readonly (readonly [string, string])[]; loop?: boolean }
  | { kind: "data"; rows: readonly (readonly [string, string])[] }
  | { kind: "shelf"; items: readonly string[] };
const PIECES: readonly { c: string; tag: string; title: string; says: string; show: Show }[] = [
  { c: "pink", tag: "WebMCP · MCP", title: "The tools",
    says: `Your AI gets ${listTools().length} tools and uses them for you. There is nothing here for you to press.`,
    show: { kind: "data", rows: [["write", "puts a file in your world"], ["read", "reads a file back"], ["look", "checks for errors"], ["undo", "takes a change back"], ["reset", "starts over"], ["backdrop", "puts a page behind it"]] } },
  { c: "green", tag: "Sandbox", title: "The sealed frame",
    says: "The code your AI writes runs in a locked box. It can't use the network, read cookies or reach your computer.",
    show: { kind: "flow", items: [["index.html", "your AI wrote it"], ["Sealed frame", "scripts only"], ["Your world", "this tab"]] } },
  { c: "violet", tag: "Effect · Schema", title: "The bouncer",
    says: "The page checks every file before it lands. If one is wrong, your AI is told why and can fix it.",
    show: { kind: "door", rows: [[true, 'path: "world.js"', "let in"], [false, 'path: "../secrets"', "bounced: a file name like world.js"], [false, "text: 3 MB", "bounced: a file is 100,000 characters at most"]] } },
  { c: "cyan", tag: "Effect UI", title: "The screen",
    says: "Each change reloads your world right away, so you watch it being built. Undo takes a change back.",
    show: { kind: "flow", loop: true, items: [["Your files", ""], ["A write arrives", ""], ["Work out what's next", ""], ["Reload the frame", ""]] } },
  { c: "amber", tag: "Cloudflare", title: "Your room",
    says: "Your AI reaches this tab through a secret link. Anyone with the link can change your world, so keep it private.",
    show: { kind: "flow", items: [["Your AI", ""], ["Your room", "Cloudflare Worker"], ["Your world", "this tab"]] } },
  { c: "amber", tag: "Cloudflare Artifacts", title: "Kept for good",
    says: "Every change is kept in your room's own git repo, so it opens on any browser.",
    show: { kind: "shelf", items: ["your world", "your 3D character", "every version"] } },
];

const showView = Def.fragment((h, s: Show) => {
  switch (s.kind) {
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
    h.p("You say ", h.q("make me a rainy city"), ". Here is what happens next, piece by piece."),
  ),
  ...PIECES.map((p) => h.article.class("l-piece", `c-${p.c}`).key(p.title).children(
    h.div.class("l-tell").children(h.span.class("l-ptag").children(p.tag), h.h3(p.title), h.p(p.says)),
    showView(h, p.show),
  )),
));
/** The links at the very bottom, under How it's built. */
const footView = Def.fragment((h) => h.footer.class("site-foot").children(
  h.p(TAGLINE),
  h.nav.children(...FOOT_LINKS.map(([text, href]) => h.a.key(href).attr("href", href).children(text))),
  h.span.children("created by ", h.a.attr("href", MAKER.href).children(MAKER.name), ` · ${copyright()}`),
));
/** The three things you do, the landing's pictures: five words or less each (owner, 2026-11-28). */
const STEPS: readonly (readonly [Icon, string, string])[] = [
  ["plug", "cyan", "Connect your agent"], ["chat", "amber", "Ask for your world"], ["globe", "pink", "Walk the galaxy"],
];

/** An icon as a CSS mask over its color (the view has no SVG elements): the paths drawn as a stroked SVG data URL. */
const maskOf = (name: Icon) => `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name].map((d) => `<path d="${d}"/>`).join("")}</svg>`)}")`;
const icon = Def.fragment((h, name: Icon) => h.i.class("l-i").attrs({ "aria-hidden": "true", style: `--icon:${maskOf(name)}` }));

/** The step strip's five steps, and which one the agent is on. */
const STRIP: readonly (readonly [Icon, string])[] = [
  ["hourglass", "Waiting for your AI"], ["bot", "Your AI is here"], ["ask", "Asking you about your world"], ["code", "Writing the code"], ["globe", "Your world is up"],
];
const stepOf = (s: Model["steps"]) => (s.up ? 4 : s.wrote ? 3 : s.asked ? 2 : s.here ? 1 : 0);
/** The console's one thing to do now: connect your agent, then say what you want, then (your world made) the galaxy. */
export const stageOf = (s: Model["steps"], made: boolean): "connect" | "ask" | "made" => (s.up || made ? "made" : s.here ? "ask" : "connect");
const EXAMPLE_ASK = "make me a rainy city with neon signs and a river";
/** What happens next, under the strip, in a few words: picking your land while the picker is up, then one per step,
 *  and the galaxy's once the world is up. */
export const nextLine = (steps: Model["steps"], locked: string | null, choose = false): string => choose ? "Next: pick your land" : [
  "Next: copy the prompt and paste it into your agent",
  "Next: type what you want into your agent",
  "Next: answer in your agent's chat, then it writes",
  steps.clean ? "Next: your world loads" : "Next: your AI fixes the error",
  locked === null ? "Next: open the galaxy" : locked === SIGN_IN_FIRST ? "Next: press Galaxy to sign in" : "Saving your world…",
][stepOf(steps)]!;
const stripView = Def.fragment((h, steps: Model["steps"], status: string | null, locked: string | null, choose: boolean) => {
  const now = stepOf(steps);
  return h.section.class("strip").attr("aria-label", "Where your AI is").children(
    h.ol.children(...STRIP.map(([i, says], n) => h.li.key(says).class(n < now && "done", n === now && "now").attr("aria-current", n === now ? "step" : undefined)
      .children(icon(h, i), h.span(says)))),
    h.p.class("next").attr("role", "status").children(nextLine(steps, locked, choose)),
    status !== null && h.p.class("said").children(h.b("Your AI: "), status),
  );
});

// The dock is pictures and buttons: what to do (copy, paste, watch), then one button for each thing.

/** What to do, as three pictures: copy, paste into your AI, watch. Done steps turn dark; each call from the AI sends a
 *  dot down the wires (keyed by the call, so a new call starts it again), green when the page took it, red when not. */
const stepsView = Def.fragment((h, copied: boolean, here: boolean, up: boolean, last: typeof Logged.Type | undefined) => {
  const done = [copied || here, here, up];
  const now = done.indexOf(false);
  const step = (n: number, name: Icon, says: string) => h.div.class("step", done[n] && "done", n === now && "now").key(says).attr("aria-current", n === now ? "step" : undefined)
    .children(h.span.class("dot").children(icon(h, name)), h.b(`${n + 1}. ${says}`));
  const wire = (n: number) => h.div.class("wire").key(`wire${n}`).attr("aria-hidden", "true").children(
    last && h.i.class("pulse", `w${n}`, last.error !== null && "bad").key(`p${last.call}-${n}`));
  return h.div.class("go").attrs({ role: "group", "aria-label": "Copy, paste into your agent, then watch" }).children(
    step(0, "copy", "Copy the prompt"), wire(1), step(1, "chat", "Paste into your agent"), wire(2), step(2, "screen", "Watch it build"));
});

/** The ready-made worlds as levels to look at: a photo of each (src/levels, shot from the world itself) and its name. */
const LEVELS: Readonly<Record<string, readonly [string, string]>> = { "Rainy city": [cityShot, "City"], "Solar system": [spaceShot, "Space"], "Fish tank": [fishShot, "Fish"] };
const levelCards = Def.fragment((h, on: string | undefined) => h.div.class("levels").attrs({ role: "group", "aria-label": "Choose a level to see" }).children(
  ...READY.map((w) => {
    const [shot, says] = LEVELS[w.name] ?? ["", w.name];
    return h.button.key(w.name).class("level").attrs({ type: "button", "data-try": w.name, "aria-label": w.name, title: w.name, "aria-pressed": w.name === on ? "true" : "false" })
      .on("click", PageMessage.ClickedTry({ name: w.name })).children(h.img.attrs({ src: shot, alt: "", width: "320", height: "200" }), h.b(says));
  })));

/** "Pick your land": two big buttons for a new person, and a small way to keep the desert. */
const PICTURES: Readonly<Record<string, Icon>> = { "Hill village": "hill", "Neon city": "city" };
const landPicker = Def.fragment((h) => h.div.class("pick").attrs({ role: "group", "aria-label": "Pick your land" }).children(
  h.b("Pick your land"),
  ...LANDS.map((l) => h.button.key(l.name).class("pick-land", l.name === "Neon city" ? "neon" : "hill").attrs({ type: "button", "data-land": l.name })
    .on("click", PageMessage.ClickedLand({ name: l.name })).children(icon(h, PICTURES[l.name] ?? "city"), l.name)),
  h.button.attr("type", "button").class("pick-keep").on("click", PageMessage.ClickedLand({ name: "" })).children("Keep the desert"),
));

/** Export GIF: its own button, which shows how far along it is. */
const exportButton = Def.fragment((h, gif: GifState) => h.button.attr("type", "button").class("tile", "export").disabled(gif.busy)
  .attrs({ "aria-label": gif.busy ? gif.says : "Export GIF", title: "Export GIF: three seconds of your world" })
  .on("click", PageMessage.ClickedExportGif()).children(icon(h, "download"), gif.busy ? gif.says.match(/\d+%/)?.[0] ?? "…" : "Save a GIF"));

// The landing: one screen over the night city (city.ts), no scrolling. The sign, the pitch, the three things you do
// as pictures, one bright button (Create your world), the ready-made worlds, and a small row: Skip to the page, How
// it's built (opens under it), Cmd+K. Connecting your AI waits in the console, where it is the next step.
const landingView = Def.fragment((h, explain: boolean, noSignIn: boolean, who: string | null) => h.div.class("l-wrap").children(
  h.section.class("landing").attr("aria-label", "Agent World").children(
    h.div.class("l-sign").attr("aria-hidden", "true").children("エージェント"),
    h.div.class("l-stage").children(
      h.h1.class("l-word").children("Agent World"),
      h.p.class("l-line").children("Your agent builds your world. Then you walk the galaxy everyone built."),
      h.div.class("l-signs").children(...SIGNS.map(([name, i, c]) => h.span.class("l-chip", `c-${c}`).key(name).children(icon(h, i), name))),
      h.ol.class("l-steps").attr("aria-label", "How it works").children(
        h.li.class("l-wire").key("wire").attr("aria-hidden", "true").children(h.i.class("l-spark")),
        ...STEPS.map(([i, c, says]) => h.li.class("l-step", `c-${c}`).key(says).children(h.span.class("l-dot").children(icon(h, i)), h.b(says)))),
      h.div.class("l-go-row").children(
        h.button.attr("type", "button").class("l-create", "bright").on("click", PageMessage.ClickedCreate())
          .children(icon(h, "sparkles"), "Create your world"),
        h.span.class("l-who").children(who ? `Signed in as ${who}` : "Free, with an eqosys sign-in"),
      ),
      h.div.class("l-try").children(h.span.class("l-alt").children("Or try one:"), tryView(h, undefined)),
      noSignIn && h.p.class("l-alt").attr("role", "alert").children("Sign-in isn't reachable here. Skip to the page to build in this browser."),
      h.p.class("l-foot").children(
        h.button.attr("type", "button").class("l-skip").on("click", PageMessage.ClickedLeaveLanding()).children("Skip to the page"),
        h.button.attr("type", "button").class("l-skip").attrs({ "aria-expanded": explain ? "true" : "false", "aria-controls": "how" })
          .on("click", PageMessage.ClickedExplain()).children("How it's built"),
        h.a.class("l-skip").attr("href", "/about").children("About"),
        h.span.class("l-keys").children(h.kbd("Cmd"), h.kbd("K")),
      ),
    ),
  ),
  explain && deepView(h), explain && footView(h)));

export const ProfilePageNoDeps = Def.make({
  init: ($) => ({ page: $.props.initial, past: [], log: [], online: false, draft: "", waiting: "", copied: null, gif: { busy: false, says: "" }, full: $.props.full, landing: $.props.landing, galaxy: false, made: $.props.made,
    explain: false, noSignIn: false, picked: false, steps: { here: false, asked: false, wrote: false, clean: true, up: false }, status: null }),
  update: ($, message) => {
    switch (message._tag) {
      case "ChangedRelay": return $.evolve({ online: message.online });
      case "TypedNote": return $.evolve({ draft: message.value });
      case "SubmittedNote": return $.model.draft.trim() ? $.set({ ...$.model, draft: "" }).run(SendNote.make({ text: $.model.draft })) : $.model;
      case "CompletedSendNote": return $.model;
      case "ChangedNote": return $.evolve({ waiting: message.waiting,
        log: message.sent ? [{ call: 0, tool: `your agent got your note "${message.sent}"`, error: null }, ...$.model.log].slice(0, LOG) : $.model.log });
      case "ClickedCopy": return $.run(CopyText.make({ what: message.what, text: message.text }));
      case "CompletedCopy": return $.evolve({ copied: message.what });
      case "FailedCopy": return $.evolve({ copied: `failed: ${message.what}` });
      case "ClickedFull": return $.evolve({ full: !$.model.full });
      case "ClickedLeaveLanding": return $.evolve({ landing: false });
      case "ClickedExplain": return $.evolve({ explain: !$.model.explain });
      case "ClickedCreate": return $.run(CreateWorld.make({ room: $.props.room }));
      case "ClickedLand": {
        if (message.name === "") return $.evolve({ picked: true });
        break;
      }
      case "CreatedWorld": return message.went === "here" ? $.evolve({ landing: false }) : $.evolve({ noSignIn: message.went === "off" });
      case "Saw": {
        // The frame's word on its last load: up once it loaded with no error after the agent's write.
        const s = $.model.steps;
        switch (message.what) {
          case "read": return $.evolve({ landing: false, steps: { ...s, here: true } });
          case "start": return $.evolve({ steps: { ...s, clean: true, up: false } });
          case "error": return $.evolve({ steps: { ...s, clean: false, up: false } });
          case "loaded": {
            const steps = { ...s, up: s.wrote && s.clean };
            return steps.up && !$.model.made
              ? $.set({ ...$.model, steps }).run(MarkMade.make({ room: $.props.room, page: $.model.page, signedIn: $.props.who !== null }))
              : $.evolve({ steps });
          }
        }
      }
      case "ClickedExportGif": return $.run(ExportGif.make({ room: $.props.room }));
      case "ChangedGif": return $.evolve({ gif: { busy: message.busy, says: message.says } });
      case "CompletedExportGif": return $.model;
      // Shut until the world is made: the tile's line says why (and Cmd+K and window.agentGalaxy say it too).
      case "ClickedGalaxy": {
        const why = lockLine($.props.who !== null, $.model.made);
        // Signed out, the locked tile is the way to sign in: the next step.
        if (why === SIGN_IN_FIRST) return $.run(CreateWorld.make({ room: $.props.room }));
        return why ? $.model : $.evolve({ galaxy: true, landing: false });
      }
      case "MadeWorld": return $.evolve({ made: message.made });
      case "ClickedBack": return $.evolve({ galaxy: false });
    }
    const a = asked(message);
    if (!a) return $.model;
    const [call, tool, r] = a;
    const { model, error } = step($.model, r);
    // The agent's first change that lands, or a world the person picks, takes the landing down.
    const landing = model.landing && !((call > 0 || r._tag === "Load") && error === null);
    // An agent's call says it is here; its page_status that it is asking; its first write or edit that lands that it is writing.
    const s = model.steps;
    const steps = call > 0 ? { ...s, here: true, asked: s.asked || r._tag === "Status", wrote: s.wrote || (["WriteFile", "EditFile", "Build", "EditWorld"].includes(r._tag) && error === null) } : s;
    return $.set({ ...model, landing, steps, log: [{ call, tool, error }, ...model.log].slice(0, LOG) })
      .run(ReportPage.make({ call, error, page: model.page }));
  },
  subscriptions: () => [
    Subscription.make("agent", Stream.unwrap(Effect.gen(function* () { return (yield* Agent).calls; })).pipe(
      Stream.map((call) => PageMessage.ReceivedAgentCall({ call })))),
    Subscription.make("relay", Stream.unwrap(Effect.gen(function* () { return (yield* Agent).online; })).pipe(
      Stream.changes, Stream.map((online) => PageMessage.ChangedRelay({ online })))),
    Subscription.make("notes", Stream.unwrap(Effect.gen(function* () { return (yield* Agent).notes; })).pipe(
      Stream.map((note) => PageMessage.ChangedNote(note)))),
    Subscription.make("seen", Stream.unwrap(Effect.gen(function* () { return (yield* Agent).seen; })).pipe(
      Stream.map((what) => PageMessage.Saw({ what })))),
    Subscription.make("gif", Stream.callback<GifState>((queue) => Effect.acquireRelease(
      Effect.sync(() => watchGif((s) => Queue.offerUnsafe(queue, s))), (off) => Effect.sync(off))).pipe(
      Stream.map((s) => PageMessage.ChangedGif(s)))),
    // Cmd+K and window.agentGalaxy ask for the galaxy here, so every door goes through the same two messages.
    Subscription.make("galaxy", Stream.fromQueue(galaxyAsks).pipe(Stream.map((on) => (on ? PageMessage.ClickedGalaxy() : PageMessage.ClickedBack())))),
  ],
  view: (h, { page, past, log, online, draft, waiting, copied, gif, full, landing, galaxy, explain, noSignIn, steps, status, made, picked }) => {
    const { room, origin, who } = h.props;
    const locked = lockLine(who !== null, made);
    // The map is drawn by galaxyView.ts in its own layer over the page; here only the way back.
    if (galaxy) return h.div.class("galaxy-mode").attr("data-galaxy", "on").children(
      h.button.attr("type", "button").class("galaxy-back").on("click", PageMessage.ClickedBack()).children(icon(h, "back"), "Back to my world"));
    if (landing) return landingView(h, explain, noSignIn, who);
    const on = READY.find((w) => Object.entries(w.files).every(([path, text]) => page.files[path] === text));
    const promptText = prompt(linksFor(origin, room));
    const lines = connectLines(origin, room).map((c) => [c, c.what === "Claude Code" ? "Claude" : c.what] as const);
    const failed = [{ what: "prompt", text: promptText }, { what: "ask", text: on?.ask ?? "" }, ...connectLines(origin, room)]
      .find((c) => copied === `failed: ${c.what}`)?.text;
    const doc = worldDoc(page);
    // A signed-in person whose world is still the untouched starter: one tap says what it starts as.
    const choose = who !== null && !picked && !made && Object.keys(page.files).length === Object.keys(starter.files).length && Object.entries(starter.files).every(([path, text]) => page.files[path] === text);
    const stage = stageOf(steps, made);
    const copyPrompt = (quiet: boolean) => h.button.attr("type", "button").class("big", quiet && "quiet").on("click", PageMessage.ClickedCopy({ what: "prompt", text: promptText }))
      .attr("title", "Paste it into Claude Code, Codex, opencode or T3 Code")
      .children(icon(h, copied === "prompt" ? "check" : "copy"), copied === "prompt" ? "Copied" : "Copy prompt");
    const chips = h.div.class("chips").attrs({ role: "group", "aria-label": "Or add it as an MCP server" }).children(
      ...lines.map(([c, short]) => h.button.attr("type", "button").key(c.what).attrs({ "aria-label": `${copied === c.what ? "Copied" : "Copy"} the ${c.what} line`, title: c.text })
        .on("click", PageMessage.ClickedCopy({ what: c.what, text: c.text })).children(icon(h, copied === c.what ? "check" : "plug"), short)));
    // Only when the clipboard says no is there a line to read: the one to select by hand.
    const byHand = failed !== undefined && h.p.class("by-hand").attr("role", "alert").children("Select and copy:", h.code(failed));
    const askButton = (ask: string) => h.button.attr("type", "button").class("say").attrs({ "aria-label": "Copy the ask", title: "Then ask your AI this" })
      .on("click", PageMessage.ClickedCopy({ what: "ask", text: ask }))
      .children(icon(h, "chat"), h.span(h.b("Tell your agent: "), ask), icon(h, copied === "ask" ? "check" : "copy"));
    const galaxyTile = (extra?: string) => h.button.attr("type", "button").class("tile", extra, locked ? "locked" : "next").attrs({ "data-galaxy-tile": "", "aria-label": locked ? `Agent Galaxy: ${locked}` : "Agent Galaxy", title: locked ?? "Walk the galaxy: your land next to everyone's" }).attr("aria-disabled", locked ? "true" : undefined)
      .on("click", PageMessage.ClickedGalaxy()).children(icon(h, locked ? "lock" : "globe"), "Walk galaxy");
    const lockView = h.p.class("lock-line").attr("data-galaxy-lock", locked ?? "").children(icon(h, "lock"), locked ?? "");
    return h.div.class("shell", full && "full").children(
      // Someone's codeSplitter page behind everything: its own sandbox (opaque origin, scripts only), no referrer.
      page.backdrop && h.iframe.class("backdrop").key(`bd-${page.backdrop}`).attrs({
        src: backdropUrl(page.backdrop), sandbox: "allow-scripts", referrerpolicy: "no-referrer", title: `@${page.backdrop}'s codeSplitter page`, "aria-hidden": "true", tabindex: "-1",
      }),
      h.main.class("page", page.backdrop && "over").children(
        // The world the agent wrote, sealed: scripts run in an opaque origin, with no reach into this page.
        WorldFrame(h).doc(doc),
        // Put away (Hide, or ?full on the link), the console leaves one small button to bring it back.
        full && h.button.attr("type", "button").class("full-toggle").attr("title", "Show the console").on("click", PageMessage.ClickedFull()).children("Show"),
      ),
      choose && landPicker(h),
      // The console: a terminal window in the middle, over the world, until Hide puts it away. Its title bar, the
      // step strip, then what happened as a command line shows it (left) beside the buttons (right).
      !full && h.aside.class("dock").attr("aria-label", "Console").children(
        h.div.class("dock-head").children(
          h.h2.children(h.span.class("t-dot", online && "on").attr("aria-hidden", "true"), "agentworld", h.span.class("t-path").children(` ~/r/${room}`)),
          h.button.attr("type", "button").class("hide").attr("title", "Put the console away to see your world").on("click", PageMessage.ClickedFull()).children("Hide"),
        ),
        stripView(h, steps, status, locked, choose),
        h.div.class("term-body").children(
          termView(h, termLines(room, online, steps, log)),
          h.div.class("term-side").children(
            // Are we connected? Said here, and by your agent in its own chat (relay.ts asks it to).
            h.p.class("conn", steps.here && "on").attr("role", "status").children(
              h.span.class("live", online && "on").children(!online ? "Connecting" : steps.here ? "Connected: your agent is here" : "Ready for your agent"),
              h.span.class("secret").attr("title", "Anyone with this page's link can change your world").children(icon(h, "key"), "Link is secret"),
            ),
            // The flow first: copy, paste, watch.
            stepsView(h, copied !== null && copied !== "ask" && !copied.startsWith("failed"), steps.here, steps.up, log.find((l) => l.call > 0)),
            // Then one thing to do now, and only that (owner, 2026-11-27): connect your agent; connected, say what
            // you want; your world made, the achievement and the galaxy we all build together.
            stage === "connect" && h.section.class("now-card").attrs({ "data-stage": "connect", "aria-label": "Connect your agent" }).children(
              h.h3.children(icon(h, "plug"), "Connect your agent"),
              h.p("Copy the prompt and paste it into your agent's chat. It connects over MCP and says so."),
              copyPrompt(choose),
              chips,
              byHand,
              // What's possible, once, at the start: a yes opens the levels.
              h.details.class("see").children(
                h.summary.children(icon(h, "sparkles"), "Want to see what is possible first?"),
                h.p.class("warn").children(icon(h, "info"), "A level replaces your world. Undo brings it back until you reload."),
                levelCards(h, on?.name),
                on && askButton(on.ask),
              ),
            ),
            stage === "ask" && h.section.class("now-card", "on").attrs({ "data-stage": "ask", "aria-label": "Tell your agent what you want" }).children(
              h.h3.children(icon(h, "check"), "Connected! Now explain what you want"),
              h.p("Type it into your agent's chat, in your own words. Like this:"),
              askButton(on?.ask ?? EXAMPLE_ASK),
            ),
            stage === "made" && h.section.class("now-card", "won").attrs({ "data-stage": "made", "aria-label": "Achievement" }).children(
              h.p.class("badge").children(icon(h, "sparkles"), "Achievement unlocked: World builder"),
              h.h3("Now let's build our galaxy, as a group!"),
              h.p("Your land goes next to everyone else's. Walk over, see what they made, and keep changing yours."),
              galaxyTile("big-tile"),
              locked && lockView,
            ),
            // Once your agent is here: a note it picks up with the reply to its next call.
            steps.here && h.form.class("note").key("note").on("submit", PageMessage.SubmittedNote()).children(
              h.input.attrs({ "aria-label": "A note to your agent", placeholder: "Send your agent a note", maxlength: String(NOTE_MAX), autocomplete: "off" })
                .value(draft).on("input", ({ value }) => PageMessage.TypedNote({ value })),
              h.button.attr("type", "submit").children("Send"),
            ),
            steps.here && h.p.class("note-says").key("note-says").attr("role", "status").children(
              waiting ? `Waiting for its next step: "${waiting}". If it has stopped, say anything in its chat.` : "It reads this with its next step."),
            h.h3.class("or").children("Your world"),
            h.div.class("tiles", "acts", stage === "made" && "three").children(
              h.button.attr("type", "button").class("tile").attr("aria-label", "Undo").disabled(past.length === 0).on("click", PageMessage.ClickedUndo()).children(icon(h, "undo"), "Undo"),
              h.button.attr("type", "button").class("tile").attrs({ "aria-label": "Start over", title: "Start over" }).on("click", PageMessage.ClickedReset()).children(icon(h, "reset"), "Reset"),
              exportButton(h, gif),
              stage !== "made" && galaxyTile(),
            ),
            stage !== "made" && locked && lockView,
            !gif.busy && gif.says !== "" && h.p.class("muted").attr("role", "status").children(gif.says),
            // Connected, the prompt stays at hand, small, for a second agent or a new chat.
            stage !== "connect" && h.details.class("again").children(
              h.summary.children(icon(h, "plug"), "Connect another agent"),
              copyPrompt(true),
              chips,
              byHand,
            ),
          ),
        ),
      ),
    );
  },
});

export const ProfilePage = ProfilePageNoDeps.pipe(Component.provide(ReportPage.layer));
