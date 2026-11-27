// The door between agents and the page, in the page. Its Layer, for as long as the page is mounted:
// - puts the page's tools up (`@rustybuns/util/commands`): WebMCP when the browser has document.modelContext, and
//   window.__commands always;
// - keeps a socket to the page's room on the relay (relay.ts), so an agent in a terminal reaches the same tools:
//   each call that comes down the socket runs through the same registry, and its answer goes back up.
// A call is checked against its Schema, goes into the page as a message (`calls`) and waits for the page to say
// what came of it (`report`): the page after it, or why it couldn't.
import { addCommands, type Command, runCommand } from "@rustybuns/util/commands";
import { check, field } from "@rustybuns/util/guard";
import { connectSocket } from "@rustybuns/util/socket";
import { Context, Effect, Layer, Queue, Schema, Stream } from "effect";
import { changed, fileRead, looked } from "./answers.ts";
import type { Page } from "./page.ts";
import { decode, type FromPage, inputSchema, READ, READ_FILE, ReadFile, Request, ToPage, type Tool, TOOLS } from "./tools.ts";
import { SAID_KEY } from "./world.ts";

export { Request };
export const Call = Schema.Struct({ call: Schema.Number, tool: Schema.String, request: Request });
export type Call = typeof Call.Type;

export interface Report { readonly call: number; readonly error: string | null; readonly page: Page }

export class Agent extends Context.Service<Agent, {
  /** The agent's calls, in the order they came. */
  readonly calls: Stream.Stream<Call>;
  /** Whether the room's relay is connected: agents in a terminal can reach the page while it is. */
  readonly online: Stream.Stream<boolean>;
  /** What came of a call (0 for a person's click): answers the agent waiting on it. */
  readonly report: (r: Report) => Effect.Effect<void>;
}>()("effect-ui-page/Agent") {}

/** Where the page is kept between visits, per room: this browser only. */
export const savedKey = (room: string) => `agent-page:${room}`;

/** Whoever else needs the world as it stands (Agent Galaxy, which shows it and saves it to the server): told after
 *  each change that lands. */
const watchers = new Set<(p: Page) => void>();
let current: Page | null = null;
export const watchPage = (fn: (p: Page) => void) => { watchers.add(fn); return () => { watchers.delete(fn); }; };
/** The world as it stands, once the page is mounted. */
export const currentPage = () => current;

/** The relay's socket for this room, on the server the page came from. */
const socketUrl = (room: string) => `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/r/${room}/socket`;

/** A command's answer as a reply frame: a write that the page refused (`{ ok: false, error }`) is a refusal. */
const replyOf = (id: number, r: unknown): FromPage =>
  field(r, "ok") === false ? { t: "reply", id, ok: false, result: r, error: String(field(r, "error") ?? "refused") } : { t: "reply", id, ok: true, result: r };

/** The tools a person reaches in the Cmd+K palette too, with the one line it asks for first (when it takes one). */
const PALETTE: Readonly<Record<string, { ask?: string }>> = {
  page_set_backdrop: { ask: "A codeSplitter handle (empty takes it away)" },
  page_undo: {},
  page_reset: {},
};

export const layer = (room: string, initial: Page) => Layer.effect(Agent, Effect.gen(function* () {
  const queue = yield* Queue.unbounded<Call>();
  const online = yield* Queue.unbounded<boolean>();
  const waiting = new Map<number, (r: Report) => void>();
  let page = initial, next = 1;
  current = initial;
  // What the world's frame said since it last loaded (world.ts's reporter): its errors and blocked loads, newest last.
  let said: string[] = [];
  const heard = (e: MessageEvent) => {
    const frame = document.querySelector("iframe.world");
    if (!(frame instanceof HTMLIFrameElement) || e.source !== frame.contentWindow || field(e.data, SAID_KEY) !== true) return;
    const kind = field(e.data, "kind"), text = String(field(e.data, "text") ?? "");
    if (kind === "start") said = [];
    // The camera's pictures and frames (pictures.ts) are nothing the agent hears about.
    else if ((kind === "error" || kind === "blocked") && said.length < 20) said.push(`${kind === "blocked" ? "blocked" : "error"}: ${text}`);
  };
  addEventListener("message", heard);
  // A write's answer is the world's files (path and size), not their text: the agent asks for a file when it needs it.
  const call = (tool: Tool, args: unknown) => {
    const request = decode(tool, args);
    const id = next++;
    return new Promise<ReturnType<typeof changed>>((done) => {
      waiting.set(id, (r) => done(changed(r.error, r.page)));
      Queue.offerUnsafe(queue, { call: id, tool: tool.name, request });
    });
  };
  const off = addCommands([
    { ...READ, group: "Page", palette: false, execute: () => looked(page, said) },
    { ...READ_FILE, group: "Page", palette: false, execute: (args) => fileRead(page, Schema.decodeUnknownSync(ReadFile)(args).path) },
    ...TOOLS.map((t): Command => ({ name: t.name, title: t.title, group: "Page", description: t.description, inputSchema: inputSchema(t.schema),
      annotations: t.hints, palette: t.name in PALETTE, ask: PALETTE[t.name]?.ask, execute: (args) => call(t, args) })),
  ]);
  const link = connectSocket<ToPage, FromPage>(() => socketUrl(room), {
    decode: (v) => check(ToPage, v),
    onMessage: (m) => {
      runCommand(m.name, m.args, "agent").then((r) => replyOf(m.id, r), (e: unknown) => ({ t: "reply" as const, id: m.id, ok: false, result: null, error: e instanceof Error ? e.message : String(e) }))
        .then((frame) => link.send(frame));
    },
    onOpen: () => Queue.offerUnsafe(online, true),
    onClose: ({ tries }) => { Queue.offerUnsafe(online, false); return Math.min(10_000, 500 * 2 ** tries); },
  });
  yield* Effect.addFinalizer(() => Effect.sync(() => { off(); link.close(); removeEventListener("message", heard); }));
  return Agent.of({
    calls: Stream.fromQueue(queue),
    online: Stream.fromQueue(online),
    report: (r) => Effect.sync(() => {
      page = r.page;
      if (r.error === null && current !== r.page) { current = r.page; for (const w of watchers) w(r.page); }
      try { localStorage.setItem(savedKey(room), JSON.stringify(r.page)); } catch { /* private window: kept for this visit only */ }
      waiting.get(r.call)?.(r);
      waiting.delete(r.call);
    }),
  });
}));
