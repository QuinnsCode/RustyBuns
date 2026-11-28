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
import { changed, checked, fileRead, looked } from "./answers.ts";
import type { Page } from "./page.ts";
import { BUILD_TOOLS, decode, type FromPage, inputSchema, READ, READ_FILE, ReadFile, Request, ToPage, type Tool, TOOLS } from "./tools.ts";
import { SAID_KEY, worldDoc } from "./world.ts";

export { Request };
export const Call = Schema.Struct({ call: Schema.Number, tool: Schema.String, request: Request });
export type Call = typeof Call.Type;

export interface Report { readonly call: number; readonly error: string | null; readonly page: Page }
/** An agent's page_read, and what the world's frame said (world.ts), for the page's step strip. */
export const Seen = Schema.Literals(["read", "start", "loaded", "error"]);
export type Seen = typeof Seen.Type;

export class Agent extends Context.Service<Agent, {
  /** The agent's calls, in the order they came. */
  readonly calls: Stream.Stream<Call>;
  /** What the page saw besides calls: an agent read it (page_read), and its frame started, loaded or went wrong. */
  readonly seen: Stream.Stream<Seen>;
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

/** How long world_build waits for the frame to load, and then for its first frames' errors. */
const LOAD_MS = 5000, SETTLE_MS = 400;
const SLOW = "not loaded after 5 s: send it again to check";

/** A command's answer as a reply frame: a write that the page refused (`{ ok: false, error }`) is a refusal.
 *  world_build's `{ ok: false, errors }` is its answer. */
const replyOf = (id: number, r: unknown): FromPage =>
  field(r, "ok") === false && !Array.isArray(field(r, "errors")) ? { t: "reply", id, ok: false, result: r, error: String(field(r, "error") ?? "refused") } : { t: "reply", id, ok: true, result: r };

/** The tools a person reaches in the Cmd+K palette too, with the one line it asks for first (when it takes one). */
const PALETTE: Readonly<Record<string, { ask?: string }>> = {
  page_set_backdrop: { ask: "A codeSplitter handle (empty takes it away)" },
  page_undo: {},
  page_reset: {},
};

export const layer = (room: string, initial: Page) => Layer.effect(Agent, Effect.gen(function* () {
  const queue = yield* Queue.unbounded<Call>();
  const online = yield* Queue.unbounded<boolean>();
  const seen = yield* Queue.unbounded<Seen>();
  const waiting = new Map<number, (r: Report) => void>();
  let page = initial, next = 1;
  current = initial;
  // What the world's frame said since it last loaded (world.ts's reporter): its errors and blocked loads, newest last.
  let said: string[] = [];
  let up = false;
  const frameWatch = new Set<(kind: unknown) => void>();
  /** The frame's next load: true once it has started again and loaded, false when it takes too long. */
  const nextLoad = () => {
    let end: (loaded: boolean) => void = () => {};
    const done = new Promise<boolean>((resolve) => {
      let started = false;
      const watch = (kind: unknown) => {
        if (kind === "start") started = true;
        else if (kind === "loaded" && started) setTimeout(() => end(true), SETTLE_MS);
      };
      const late = setTimeout(() => end(false), LOAD_MS);
      end = (loaded) => { clearTimeout(late); frameWatch.delete(watch); resolve(loaded); };
      frameWatch.add(watch);
    });
    return { done, cancel: () => end(false) };
  };
  const heard = (e: MessageEvent) => {
    const frame = document.querySelector("iframe.world");
    if (!(frame instanceof HTMLIFrameElement) || e.source !== frame.contentWindow || field(e.data, SAID_KEY) !== true) return;
    const kind = field(e.data, "kind"), text = String(field(e.data, "text") ?? "");
    if (kind === "start" || kind === "loaded") Queue.offerUnsafe(seen, kind);
    else if (kind === "error" || kind === "blocked") Queue.offerUnsafe(seen, "error");
    if (kind === "start") { said = []; up = false; }
    if (kind === "loaded") up = true;
    for (const w of frameWatch) w(kind);
    // The camera's pictures and frames (pictures.ts) are nothing the agent hears about.
    if ((kind === "error" || kind === "blocked") && said.length < 20) said.push(`${kind === "blocked" ? "blocked" : "error"}: ${text}`);
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
  // world_build and world_edit: the same change, then what the frame said once it has loaded it, in one answer.
  const built = async (tool: Tool, args: unknown) => {
    const before = worldDoc(page);
    const load = nextLoad();
    const r = await call(tool, args);
    if (!r.ok) { load.cancel(); return checked([r.error ?? "refused"]); }
    // The same document doesn't reload: what the frame already said stands.
    const same = worldDoc(page) === before;
    if (same) load.cancel();
    const loaded = same ? up : await load.done;
    return checked(loaded ? said : [...said, SLOW]);
  };
  const off = addCommands([
    { ...READ, group: "Page", palette: false, execute: (_args, from) => {
      if (from === "agent") Queue.offerUnsafe(seen, "read");
      return looked(page, said);
    } },
    { ...READ_FILE, group: "Page", palette: false, execute: (args) => fileRead(page, Schema.decodeUnknownSync(ReadFile)(args).path) },
    ...TOOLS.map((t): Command => ({ name: t.name, title: t.title, group: "Page", description: t.description, inputSchema: inputSchema(t.schema),
      annotations: t.hints, palette: t.name in PALETTE, ask: PALETTE[t.name]?.ask, execute: (args) => call(t, args) })),
    ...BUILD_TOOLS.map((t): Command => ({ name: t.name, title: t.title, group: "Page", description: t.description, inputSchema: inputSchema(t.schema),
      palette: false, execute: (args) => built(t, args) })),
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
    seen: Stream.fromQueue(seen),
    report: (r) => Effect.sync(() => {
      page = r.page;
      if (r.error === null && current !== r.page) { current = r.page; for (const w of watchers) w(r.page); }
      try { localStorage.setItem(savedKey(room), JSON.stringify(r.page)); } catch { /* private window: kept for this visit only */ }
      waiting.get(r.call)?.(r);
      waiting.delete(r.call);
    }),
  });
}));
