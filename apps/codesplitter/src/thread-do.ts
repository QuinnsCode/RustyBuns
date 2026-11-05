// Layout: one Durable Object per agent thread: its messages, who is here, and the live sockets
// An agent thread (#3711) is a chat room the crew shares with a coding agent: a run, and the runs
// that follow it on the same task. People talk here, to the agent or to each other; the agent's
// words and what its run does come in here too. Nobody reaches this object but the Worker
// (agent-routes.ts threadRoutes), which checks the crew and turns a message into a note for a
// running agent. Its name is `<owner>/<repo>/<thread>`, the thread being its first run's id.
//
//   GET  /?after=n                  {messages after n (the last PAGE of them), here}
//   GET  /last                      {last: the newest thing said (an event when nothing was said lately) or null, here}: a repo's list of threads reads it
//   POST /say {who, kind, text, run?}   keep a message and send it to every socket: {message}
//   GET  /ws  (upgrade, x-codesplitter-user)   a socket: {t:"hello", messages, here}, then
//        {t:"msg", message} for each message and {t:"here", here} as people come and go
//   POST /files?who&name&text (the file's bytes)   keep a file and say it: {message} (#3723)
//   GET  /files                     the files kept: [{id, name, type, size, path}]
//   GET  /files/<id>                one file's bytes
//
// Messages are kept one key each (`m:<n>`, n from 1, padded), the newest KEEP of them; files
// likewise (`f:<id>`), the newest FILES of them, in the object's own storage rather than R2.
import { arr, check, int, obj, oneOf, opt, str, type Of } from "@rustybuns/util/guard";
import { Sockets, type RoomCtx } from "@rustybuns/util/room";
import { need, json, type Env } from "./env.ts";
import { mentionsIn } from "./mentions.ts";

/** Who said it: a person (`who` their handle), the agent (`who` its name), or what a run did. */
export const KINDS = ["person", "agent", "event"] as const;
export const SAY_CHARS = 4000;
export const Say = obj({ who: str(200, { min: 1 }), kind: oneOf(KINDS), text: str(SAY_CHARS, { min: 1 }), run: opt(int(1, 1e12)) });
/** A file someone dropped into a thread (#3723): `path` is where a running agent finds it, in its working folder. */
const Sent = obj({ id: int(1, 1e12), name: str(120, { min: 1 }), type: str(120), size: int(0, 1e9), path: str(200, { min: 1 }) });
export type Sent = Of<typeof Sent>;
/** A kept message: what was said, its number in the thread and when, and the file it brought. */
export const Said = obj({ who: str(200, { min: 1 }), kind: oneOf(KINDS), text: str(SAY_CHARS, { min: 1 }), run: opt(int(1, 1e12)), n: int(1, 1e12), at: int(0, 1e15), file: opt(Sent) });
export type Message = Of<typeof Said>;
/** How many messages a hello or a read carries, and how many a thread keeps. */
export const PAGE = 200, KEEP = 2000;
/** How far back a thread's /last looks for something a person or the agent said. */
const LAST_LOOK = 20;
/**
 * A file's size at most, and how many a thread keeps (the oldest goes). A Durable Object's value holds 2 MiB, and the
 * files cost no bucket: a screenshot or a log fits, a video doesn't.
 */
export const FILE_MAX = 1_500_000, FILES = 20;
/** Where a running agent finds file `id`: a folder of its own beside the files it edits, so nothing it holds gets mistaken for an edit. */
export const sentPath = (id: number, name: string) => `.thread/${id}-${name}`;
/** A dropped file's name, safe on any disk: letters, digits, . _ -; never a dotfile. */
export const fileName = (s: string) => s.replace(/^.*[\\/]/, "").replace(/[^\w.-]+/g, "_").replace(/\.\.+/g, ".").replace(/^[.]+/, "").slice(-80) || "file";
interface Kept extends Sent { bytes: Uint8Array<ArrayBuffer> }

type Who = { user: string };
type Out = { t: "hello"; messages: Message[]; here: string[] } | { t: "msg"; message: Message } | { t: "here"; here: string[] };

interface Storage {
  get<T>(k: string): Promise<T | undefined>;
  list<T>(o: { start?: string; end?: string; limit?: number }): Promise<Map<string, T>>;
  put(k: string, v: unknown): Promise<void>;
  delete(k: string): Promise<boolean>;
}

/** A message's key: padded, so a range of them lists in order. */
const key = (n: number) => `m:${String(n).padStart(12, "0")}`;

export class AgentThread {
  private sockets: Sockets<Who, Out>;
  constructor(private ctx: RoomCtx & { storage: Storage }, _env: unknown) {
    // A page only listens; it says things over HTTP, so the Worker can check the crew and tell the agent.
    this.sockets = new Sockets<Who, Out>(ctx, { maxBytes: 512, rate: 2, burst: 10 });
  }

  /** Who has the thread open, each once. */
  here(): string[] {
    return [...new Set(this.sockets.open().map((ws) => this.sockets.who(ws)?.user).filter((u): u is string => !!u))].sort();
  }

  /** The messages after `after`, the last PAGE of them, oldest first. */
  async read(after = 0): Promise<Message[]> {
    const last = (await this.ctx.storage.get<number>("n")) ?? 0;
    const from = Math.max(after + 1, last - PAGE + 1, 1);
    if (from > last) return [];
    return [...(await this.ctx.storage.list<Message>({ start: key(from), end: key(last + 1) })).values()];
  }

  async say(s: Of<typeof Say> & { file?: Sent }): Promise<Message> {
    const n = ((await this.ctx.storage.get<number>("n")) ?? 0) + 1;
    const message: Message = { ...s, n, at: Date.now() };
    await this.ctx.storage.put(key(n), message);
    await this.ctx.storage.put("n", n);
    if (n > KEEP) await this.ctx.storage.delete(key(n - KEEP));
    this.sockets.broadcast({ t: "msg", message });
    return message;
  }

  /** Keeps a file and says it, from `who` with `text` (else its name): the newest FILES are kept. */
  async keep(who: string, name: string, type: string, bytes: Uint8Array<ArrayBuffer>, text: string): Promise<Message> {
    const id = ((await this.ctx.storage.get<number>("f")) ?? 0) + 1, safe = fileName(name);
    const file: Sent = { id, name: safe, type: type.slice(0, 120), size: bytes.length, path: sentPath(id, safe) };
    await this.ctx.storage.put(`f:${String(id).padStart(12, "0")}`, { ...file, bytes } satisfies Kept);
    await this.ctx.storage.put("f", id);
    if (id > FILES) await this.ctx.storage.delete(`f:${String(id - FILES).padStart(12, "0")}`);
    return this.say({ who, kind: "person", text: text.trim().slice(0, SAY_CHARS) || safe, file });
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/files" && req.method === "POST") {
      const who = url.searchParams.get("who"), name = url.searchParams.get("name");
      if (!who || !name) return json({ error: "who and name" }, 400);
      const bytes = new Uint8Array(await req.arrayBuffer());
      if (!bytes.length || bytes.length > FILE_MAX) return json({ error: `a file of up to ${FILE_MAX / 1e6} MB` }, 413);
      return json({ message: await this.keep(who, name, req.headers.get("content-type") ?? "", bytes, url.searchParams.get("text") ?? "") });
    }
    if (url.pathname === "/files" && req.method === "GET") {
      const kept = await this.ctx.storage.list<Kept>({ start: "f:", end: "f;" });
      return json([...kept.values()].map(({ bytes: _, ...f }) => f));
    }
    const one = /^\/files\/(\d+)$/.exec(url.pathname);
    if (one && req.method === "GET") {
      const f = await this.ctx.storage.get<Kept>(`f:${one[1]!.padStart(12, "0")}`);
      return f ? new Response(f.bytes, { headers: { "content-type": f.type || "application/octet-stream", "x-name": f.name } }) : json({ error: "no such file" }, 404);
    }
    if (url.pathname === "/ws") {
      if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") return json({ error: "a socket only" }, 426);
      const user = req.headers.get("x-codesplitter-user");
      if (!user) return json({ error: "who?" }, 401);
      const { server, response } = this.sockets.upgrade({ user });
      this.sockets.send(server, { t: "hello", messages: await this.read(), here: this.here() });
      this.sockets.broadcast({ t: "here", here: this.here() }, server);
      return response;
    }
    if (url.pathname === "/say" && req.method === "POST") {
      const s = need(await req.json().catch(() => null), Say);
      return s instanceof Response ? s : json({ message: await this.say(s) });
    }
    if (url.pathname === "/last" && req.method === "GET") {
      // What someone said, over the run's own events after it (a question to the crew is followed by "done").
      const n = (await this.ctx.storage.get<number>("n")) ?? 0;
      const recent = n ? [...(await this.ctx.storage.list<Message>({ start: key(Math.max(1, n - LAST_LOOK + 1)), end: key(n + 1) })).values()] : [];
      return json({ last: recent.findLast((m) => m.kind !== "event") ?? recent.at(-1) ?? null, here: this.here() });
    }
    if (req.method === "GET") return json({ messages: await this.read(Number(url.searchParams.get("after")) || 0), here: this.here() });
    return json({ error: "not found" }, 404);
  }

  // Listening only: what a page sends is a keep-alive at most.
  webSocketMessage() {}
  webSocketClose() { this.sockets.broadcast({ t: "here", here: this.here() }); }
  webSocketError() { this.sockets.broadcast({ t: "here", here: this.here() }); }
}

const stub = (env: Env, owner: string, repo: string, thread: number) => env.THREADS.get(env.THREADS.idFromName(`${owner}/${repo}/${thread}`));

/** The room of thread `thread` as the Worker reaches it: `path` is /, /say or /ws. */
export const threadFetch = (env: Env, owner: string, repo: string, thread: number, path: string, init?: RequestInit) =>
  stub(env, owner, repo, thread).fetch(new Request(`http://thread${path}`, init));

/**
 * Says `s` in thread `thread`, and anyone on the crew it @mentions hears of it (mentions.ts): a person's words or the agent's.
 * The kept message, or null when the room didn't take it.
 */
export async function sayIn(env: Env, owner: string, repo: string, thread: number, s: Of<typeof Say>): Promise<Message | null> {
  const res = await threadFetch(env, owner, repo, thread, "/say", { method: "POST", body: JSON.stringify(s) }).catch(() => null);
  const message = res?.ok ? check(obj({ message: Said }), await res.json().catch(() => null))?.message ?? null : null;
  if (message && message.kind !== "event") await mentionsIn(env, owner, repo, thread, message).catch(() => {});
  return message;
}

/** Keeps a file `who` dropped into thread `thread` (#3723) and says it, `text` its caption: anyone the caption @mentions hears of it too. */
export async function keepIn(env: Env, owner: string, repo: string, thread: number, who: string, name: string, type: string, bytes: ArrayBuffer, text: string): Promise<Message | null> {
  const res = await threadFetch(env, owner, repo, thread, `/files?${new URLSearchParams({ who, name, text })}`, { method: "POST", body: bytes, headers: { "content-type": type } }).catch(() => null);
  const message = res?.ok ? check(obj({ message: Said }), await res.json().catch(() => null))?.message ?? null : null;
  if (message && text) await mentionsIn(env, owner, repo, thread, message).catch(() => {});
  return message;
}

/**
 * Says things in thread `thread`, one after another and never failing the caller: a run talks as it goes,
 * and a room that is down mustn't stop it. Awaiting the answer waits for everything said so far.
 */
export function threadSay(env: Env, owner: string, repo: string, thread: number) {
  let last: Promise<unknown> = Promise.resolve();
  return (s: Of<typeof Say>): Promise<unknown> => {
    const text = s.text.trim().slice(0, SAY_CHARS);
    if (!text) return last;
    return last = last.then(() => sayIn(env, owner, repo, thread, { ...s, text })).catch(() => {});
  };
}

/** The files thread `thread` keeps, oldest first ([] when its room can't be read). */
export async function threadFiles(env: Env, owner: string, repo: string, thread: number): Promise<Sent[]> {
  const res = await threadFetch(env, owner, repo, thread, "/files").catch(() => null);
  return check(arr(Sent, FILES * 2, { drop: true }), res?.ok ? await res.json().catch(() => null) : null) ?? [];
}

/** The thread's messages, oldest first ([] when its room can't be read). */
export async function threadMessages(env: Env, owner: string, repo: string, thread: number): Promise<{ messages: Message[]; here: string[] }> {
  const res = await threadFetch(env, owner, repo, thread, "/").catch(() => null);
  const body = res?.ok ? await res.json().catch(() => null) : null;
  const read = obj({ messages: arr(Said, PAGE, { drop: true }), here: arr(str(200), 500, { drop: true }) });
  return check(read, body) ?? { messages: [], here: [] };
}

/** Each thread's newest message and who has it open, read side by side (null for a room that can't be read). */
export async function threadLasts(env: Env, owner: string, repo: string, threads: number[]): Promise<({ last: Message | null; here: string[] } | null)[]> {
  const read = obj({ last: opt(Said), here: arr(str(200), 500, { drop: true }) });
  return Promise.all(threads.map(async (t) => {
    const res = await threadFetch(env, owner, repo, t, "/last").catch(() => null);
    const got = res?.ok ? check(read, await res.json().catch(() => null)) : null;
    return got && { last: got.last ?? null, here: got.here };
  }));
}

/** How many of the latest things people and the agent said a run the thread starts reads. */
export const TRANSCRIPT = 40;
/** What was said in the thread, as a run it starts reads it: people's and the agent's words, not what its runs did. */
export async function transcript(env: Env, owner: string, repo: string, thread: number): Promise<string[]> {
  const { messages } = await threadMessages(env, owner, repo, thread);
  return messages.filter((m) => m.kind !== "event").slice(-TRANSCRIPT).map((m) => `${m.kind === "agent" ? "you" : `@${m.who}`}: ${m.text}`);
}
