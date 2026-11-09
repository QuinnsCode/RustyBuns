// Layout: one Durable Object per agent thread: its messages, its runs, who is here, and the live sockets
// An agent thread (#3711) is a chat room the crew shares with a coding agent: a run, and the runs
// that follow it on the same task. People talk here, to the agent or to each other; the agent's
// words and what its run does come in here too. Nobody reaches this object but the Worker
// (agent-routes.ts threadRoute), which checks the crew and turns a message into a note for a
// running agent. Its name is `<owner>/<repo>/<thread>`, the thread being its first run's id.
//
//   GET  /?after=n                  {messages after n (the last PAGE of them), here}
//   GET  /last                      {last: the newest thing said (an event when nothing was said lately) or null, here}: a repo's list of threads reads it
//   POST /say {who, kind, text, run?}   keep a message and send it to every socket: {message}
//   POST /run {id, agent, status, …}    a run of the thread changed: kept, and sent to every socket
//   GET  /ws?after=n  (upgrade, x-codesplitter-user)   a socket: {t:"hello", messages after n, runs, here},
//        then {t:"msg", message}, {t:"run", run} and {t:"here", here} as they happen
//   POST /files?who&name&text (the file's bytes)   keep a file and say it: {message} (#3723)
//   GET  /files                     the files kept: [{id, name, type, size, path}]
//   GET  /files/<id>                one file's bytes
//   GET  /session                   {session}: its hosted claude's session log, or null (#3715)
//   PUT  /session {id, log, cwd}    keeps it, in place of the last
//
// A page keeps what it has read and asks only for what came after (`after`), so a reconnect or
// a return to the thread carries just what it missed, and a run's status comes pushed, not polled.
// Messages are kept one key each (`m:<n>`, n from 1, padded), the newest KEEP of them; files
// likewise (`f:<id>`), the newest FILES of them, in the object's own storage rather than R2; runs as `r:<id>`.
// The session log is `s:<i>`, PART characters each (a key holds 2 MB), under `session` ({id, cwd, parts}).
import { arr, bool, check, int, obj, oneOf, opt, str, type Of } from "@rustybuns/util/guard";
import { Sockets, type RoomCtx } from "@rustybuns/util/room";
import { fail, need, json, type Env } from "./env.ts";
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
/** A run as the thread shows it: which agent, how it stands, and whether its batch waits to land. */
export const RunCard = obj({ id: int(1, 1e12), agent: str(200, { min: 1 }), status: oneOf(["running", "done", "failed", "stopped"]), pending: opt(bool()), started: int(0, 1e15) });
export type RunCard = Of<typeof RunCard>;
/**
 * A hosted claude's session (#3715): claude's own log of it (`log`, the JSONL it keeps under its config dir), its
 * id, and the directory it worked in (`cwd`), so the next container puts it back for `claude --resume`. Nothing
 * runs while a thread is quiet: its container went when its turn ended, and this is all that's left of it.
 */
export const SESSION_CHARS = 8_000_000;
export const Session = obj({ id: str(100, { min: 1 }), log: str(SESSION_CHARS, { min: 1 }), cwd: str(4096, { min: 1 }) });
export type Session = Of<typeof Session>;
/** Characters per stored part: 4 bytes each at worst, inside a key's 2 MB. */
const PART = 500_000;
const SessionMeta = obj({ id: str(100), cwd: str(4096), parts: int(1, 100) });
const partKey = (i: number) => `s:${String(i).padStart(3, "0")}`;
/** How many messages a hello or a read carries, how many a thread keeps, and how many runs it lists. */
export const PAGE = 200, KEEP = 2000, RUNS = 100;
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

/** A watcher (`?watch=1`) is a run card on a file or repo page (#3737): it hears runs and messages but isn't someone in the thread. */
type Who = { user: string; watch?: true };
type Out = { t: "hello"; messages: Message[]; runs: RunCard[]; here: string[]; last: number }
  | { t: "msg"; message: Message } | { t: "run"; run: RunCard } | { t: "here"; here: string[] };

interface Storage {
  get<T>(k: string): Promise<T | undefined>;
  list<T>(o: { prefix?: string; start?: string; end?: string; limit?: number }): Promise<Map<string, T>>;
  put(k: string, v: unknown): Promise<void>;
  delete(k: string): Promise<boolean>;
}

/** A message's key, and a run's: padded, so a range of them lists in order. */
const key = (n: number) => `m:${String(n).padStart(12, "0")}`;
const runKey = (id: number) => `r:${String(id).padStart(12, "0")}`;
/** `after` from a query: the last message the page already has (0: none). */
const afterOf = (url: URL) => Math.max(0, Math.floor(Number(url.searchParams.get("after"))) || 0);

export class AgentThread {
  private sockets: Sockets<Who, Out>;
  constructor(private ctx: RoomCtx & { storage: Storage }, _env: unknown) {
    // A page only listens; it says things over HTTP, so the Worker can check the crew and tell the agent.
    this.sockets = new Sockets<Who, Out>(ctx, { maxBytes: 512, rate: 2, burst: 10 });
  }

  /** Who has the thread open, each once. */
  here(): string[] {
    return [...new Set(this.sockets.open().map((ws) => this.sockets.who(ws)).filter((w) => !w?.watch).map((w) => w?.user).filter((u): u is string => !!u))].sort();
  }

  /** The number of the newest message (0 before any). */
  last(): Promise<number> { return this.ctx.storage.get<number>("n").then((n) => n ?? 0); }

  /** The messages after `after`, the last PAGE of them, oldest first. */
  async read(after = 0): Promise<Message[]> {
    const last = await this.last();
    const from = Math.max(after + 1, last - PAGE + 1, 1);
    if (from > last) return [];
    return [...(await this.ctx.storage.list<Message>({ start: key(from), end: key(last + 1) })).values()];
  }

  /** Its runs, oldest first. */
  async runs(): Promise<RunCard[]> {
    return [...(await this.ctx.storage.list<RunCard>({ prefix: "r:", limit: RUNS })).values()];
  }

  async say(s: Of<typeof Say> & { file?: Sent }): Promise<Message> {
    const n = (await this.last()) + 1;
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

  async session(): Promise<Session | null> {
    const meta = check(SessionMeta, await this.ctx.storage.get("session"));
    if (!meta) return null;
    const parts = await this.ctx.storage.list<string>({ prefix: "s:" });
    const log = Array.from({ length: meta.parts }, (_, i) => parts.get(partKey(i)) ?? "").join("");
    return log ? { id: meta.id, cwd: meta.cwd, log } : null;
  }

  async keepSession(s: Session) {
    const parts = Math.ceil(s.log.length / PART), was = check(SessionMeta, await this.ctx.storage.get("session"));
    for (let i = 0; i < parts; i++) await this.ctx.storage.put(partKey(i), s.log.slice(i * PART, (i + 1) * PART));
    for (let i = parts; i < (was?.parts ?? 0); i++) await this.ctx.storage.delete(partKey(i));
    await this.ctx.storage.put("session", { id: s.id, cwd: s.cwd, parts });
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/session") {
      if (req.method === "GET") return json({ session: await this.session() });
      const s = need(await req.json().catch(() => null), Session);
      if (s instanceof Response) return s;
      await this.keepSession(s);
      return json({ kept: true });
    }
    if (url.pathname === "/files" && req.method === "POST") {
      const who = url.searchParams.get("who"), name = url.searchParams.get("name");
      if (!who || !name) return fail("BadInput", "who and name");
      const bytes = new Uint8Array(await req.arrayBuffer());
      if (!bytes.length || bytes.length > FILE_MAX) return fail("TooBig", `a file of up to ${FILE_MAX / 1e6} MB`);
      return json({ message: await this.keep(who, name, req.headers.get("content-type") ?? "", bytes, url.searchParams.get("text") ?? "") });
    }
    if (url.pathname === "/files" && req.method === "GET") {
      const kept = await this.ctx.storage.list<Kept>({ start: "f:", end: "f;" });
      return json([...kept.values()].map(({ bytes: _, ...f }) => f));
    }
    const one = /^\/files\/(\d+)$/.exec(url.pathname);
    if (one && req.method === "GET") {
      const f = await this.ctx.storage.get<Kept>(`f:${one[1]!.padStart(12, "0")}`);
      return f ? new Response(f.bytes, { headers: { "content-type": f.type || "application/octet-stream", "x-name": f.name } }) : fail("NoSuchFile", "no such file");
    }
    if (url.pathname === "/ws") {
      if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") return fail("SocketOnly", "a socket only");
      const user = req.headers.get("x-codesplitter-user");
      if (!user) return fail("SignInFirst", "who?");
      const watch = url.searchParams.get("watch") === "1";
      const { server, response } = this.sockets.upgrade(watch ? { user, watch } : { user });
      // A watcher has the card already: it wants what comes next, not the thread so far.
      const [messages, runs, last] = await Promise.all([watch ? [] : this.read(afterOf(url)), this.runs(), this.last()]);
      this.sockets.send(server, { t: "hello", messages, runs, here: this.here(), last });
      if (!watch) this.sockets.broadcast({ t: "here", here: this.here() }, server);
      return response;
    }
    if (url.pathname === "/say" && req.method === "POST") {
      const s = need(await req.json().catch(() => null), Say);
      return s instanceof Response ? s : json({ message: await this.say(s) });
    }
    if (url.pathname === "/run" && req.method === "POST") {
      const run = need(await req.json().catch(() => null), RunCard);
      if (run instanceof Response) return run;
      await this.ctx.storage.put(runKey(run.id), run);
      this.sockets.broadcast({ t: "run", run });
      return json({ run });
    }
    if (url.pathname === "/last" && req.method === "GET") {
      // What someone said, over the run's own events after it (a question to the crew is followed by "done").
      const n = (await this.ctx.storage.get<number>("n")) ?? 0;
      const recent = n ? [...(await this.ctx.storage.list<Message>({ start: key(Math.max(1, n - LAST_LOOK + 1)), end: key(n + 1) })).values()] : [];
      return json({ last: recent.findLast((m) => m.kind !== "event") ?? recent.at(-1) ?? null, here: this.here() });
    }
    if (req.method === "GET") return json({ messages: await this.read(afterOf(url)), here: this.here(), last: await this.last() });
    return fail("NoSuchRoute", "not found");
  }

  // Listening only: what a page sends is a keep-alive at most.
  webSocketMessage() {}
  webSocketClose() { this.sockets.broadcast({ t: "here", here: this.here() }); }
  webSocketError() { this.sockets.broadcast({ t: "here", here: this.here() }); }
}

const stub = (env: Env, owner: string, repo: string, thread: number) => env.THREADS.get(env.THREADS.idFromName(`${owner}/${repo}/${thread}`));

/** The room of thread `thread` as the Worker reaches it: `path` is /, /say, /run or /ws (with its query). */
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

/** Tells thread `thread` how one of its runs stands now, for every page on it (never failing the caller). */
export const threadRun = (env: Env, owner: string, repo: string, thread: number, run: RunCard) =>
  threadFetch(env, owner, repo, thread, "/run", { method: "POST", body: JSON.stringify(run) }).then(() => {}, () => {});

/** The files thread `thread` keeps, oldest first ([] when its room can't be read). */
export async function threadFiles(env: Env, owner: string, repo: string, thread: number): Promise<Sent[]> {
  const res = await threadFetch(env, owner, repo, thread, "/files").catch(() => null);
  return check(arr(Sent, FILES * 2, { drop: true }), res?.ok ? await res.json().catch(() => null) : null) ?? [];
}

/** The thread's messages after `after`, oldest first, and the newest one's number ([] when its room can't be read). */
export async function threadMessages(env: Env, owner: string, repo: string, thread: number, after = 0): Promise<{ messages: Message[]; here: string[]; last: number }> {
  const res = await threadFetch(env, owner, repo, thread, `/?after=${after}`).catch(() => null);
  const body = res?.ok ? await res.json().catch(() => null) : null;
  const read = obj({ messages: arr(Said, PAGE, { drop: true }), here: arr(str(200), 500, { drop: true }), last: int(0, 1e12, 0) });
  return check(read, body) ?? { messages: [], here: [], last: 0 };
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
/**
 * What was said in the thread, as a run it starts reads it: people's and the agent's words, not what its runs did.
 * With `after` (a run that resumes the last one's session, which heard everything up to there), just what came since, from people.
 */
export async function transcript(env: Env, owner: string, repo: string, thread: number, after = 0): Promise<{ lines: string[]; last: number }> {
  const { messages, last } = await threadMessages(env, owner, repo, thread, after);
  const said = messages.filter((m) => after ? m.kind === "person" : m.kind !== "event");
  return { lines: said.slice(-TRANSCRIPT).map((m) => `${m.kind === "agent" ? "you" : `@${m.who}`}: ${m.text}`), last };
}

/** The thread's kept claude session log (#3715), or null: none yet, or its room can't be read. */
export async function threadSession(env: Env, owner: string, repo: string, thread: number): Promise<Session | null> {
  const res = await threadFetch(env, owner, repo, thread, "/session").catch(() => null);
  const body = res?.ok ? await res.json().catch(() => null) : null;
  return check(obj({ session: Session }), body)?.session ?? null;
}

/** Keeps the session log a hosted claude run in the thread left; never fails the run that left it. */
export const keepSession = (env: Env, owner: string, repo: string, thread: number, s: Session) =>
  threadFetch(env, owner, repo, thread, "/session", { method: "PUT", body: JSON.stringify(s) }).then((r) => r.ok, () => false);
