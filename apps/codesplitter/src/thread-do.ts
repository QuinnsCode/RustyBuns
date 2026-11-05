// Layout: one Durable Object per agent thread: its messages, its runs, who is here, and the live sockets
// An agent thread (#3711) is a chat room the crew shares with a coding agent: a run, and the runs
// that follow it on the same task. People talk here, to the agent or to each other; the agent's
// words and what its run does come in here too. Nobody reaches this object but the Worker
// (agent-routes.ts threadRoute), which checks the crew and turns a message into a note for a
// running agent. Its name is `<owner>/<repo>/<thread>`, the thread being its first run's id.
//
//   GET  /?after=n                  {messages after n (the last PAGE of them), here}
//   POST /say {who, kind, text, run?}   keep a message and send it to every socket: {message}
//   POST /run {id, agent, status, …}    a run of the thread changed: kept, and sent to every socket
//   GET  /ws?after=n  (upgrade, x-codesplitter-user)   a socket: {t:"hello", messages after n, runs, here},
//        then {t:"msg", message}, {t:"run", run} and {t:"here", here} as they happen
//
// A page keeps what it has read and asks only for what came after (`after`), so a reconnect or
// a return to the thread carries just what it missed, and a run's status comes pushed, not polled.
// Messages are kept one key each (`m:<n>`, n from 1, padded), the newest KEEP of them; runs as `r:<id>`.
import { arr, bool, check, int, obj, oneOf, opt, str, type Of } from "@rustybuns/util/guard";
import { Sockets, type RoomCtx } from "@rustybuns/util/room";
import { need, json, type Env } from "./env.ts";

/** Who said it: a person (`who` their handle), the agent (`who` its name), or what a run did. */
export const KINDS = ["person", "agent", "event"] as const;
export const SAY_CHARS = 4000;
export const Say = obj({ who: str(200, { min: 1 }), kind: oneOf(KINDS), text: str(SAY_CHARS, { min: 1 }), run: opt(int(1, 1e12)) });
/** A kept message: what was said, its number in the thread and when. */
const Said = obj({ who: str(200, { min: 1 }), kind: oneOf(KINDS), text: str(SAY_CHARS, { min: 1 }), run: opt(int(1, 1e12)), n: int(1, 1e12), at: int(0, 1e15) });
export type Message = Of<typeof Said>;
/** A run as the thread shows it: which agent, how it stands, and whether its batch waits to land. */
export const RunCard = obj({ id: int(1, 1e12), agent: str(200, { min: 1 }), status: oneOf(["running", "done", "failed", "stopped"]), pending: opt(bool()), started: int(0, 1e15) });
export type RunCard = Of<typeof RunCard>;
/** How many messages a hello or a read carries, how many a thread keeps, and how many runs it lists. */
export const PAGE = 200, KEEP = 2000, RUNS = 100;

type Who = { user: string };
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
    return [...new Set(this.sockets.open().map((ws) => this.sockets.who(ws)?.user).filter((u): u is string => !!u))].sort();
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

  async say(s: Of<typeof Say>): Promise<Message> {
    const n = (await this.last()) + 1;
    const message: Message = { ...s, n, at: Date.now() };
    await this.ctx.storage.put(key(n), message);
    await this.ctx.storage.put("n", n);
    if (n > KEEP) await this.ctx.storage.delete(key(n - KEEP));
    this.sockets.broadcast({ t: "msg", message });
    return message;
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/ws") {
      if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") return json({ error: "a socket only" }, 426);
      const user = req.headers.get("x-codesplitter-user");
      if (!user) return json({ error: "who?" }, 401);
      const { server, response } = this.sockets.upgrade({ user });
      const [messages, runs, last] = await Promise.all([this.read(afterOf(url)), this.runs(), this.last()]);
      this.sockets.send(server, { t: "hello", messages, runs, here: this.here(), last });
      this.sockets.broadcast({ t: "here", here: this.here() }, server);
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
    if (req.method === "GET") return json({ messages: await this.read(afterOf(url)), here: this.here(), last: await this.last() });
    return json({ error: "not found" }, 404);
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
 * Says things in thread `thread`, one after another and never failing the caller: a run talks as it goes,
 * and a room that is down mustn't stop it. Awaiting the answer waits for everything said so far.
 */
export function threadSay(env: Env, owner: string, repo: string, thread: number) {
  let last: Promise<unknown> = Promise.resolve();
  return (s: Of<typeof Say>): Promise<unknown> => {
    const text = s.text.trim().slice(0, SAY_CHARS);
    if (!text) return last;
    return last = last.then(() => threadFetch(env, owner, repo, thread, "/say", { method: "POST", body: JSON.stringify({ ...s, text }) })).catch(() => {});
  };
}

/** Tells thread `thread` how one of its runs stands now, for every page on it (never failing the caller). */
export const threadRun = (env: Env, owner: string, repo: string, thread: number, run: RunCard) =>
  threadFetch(env, owner, repo, thread, "/run", { method: "POST", body: JSON.stringify(run) }).then(() => {}, () => {});

/** The thread's messages after `after`, oldest first, and the newest one's number ([] when its room can't be read). */
export async function threadMessages(env: Env, owner: string, repo: string, thread: number, after = 0): Promise<{ messages: Message[]; here: string[]; last: number }> {
  const res = await threadFetch(env, owner, repo, thread, `/?after=${after}`).catch(() => null);
  const body = res?.ok ? await res.json().catch(() => null) : null;
  const read = obj({ messages: arr(Said, PAGE, { drop: true }), here: arr(str(200), 500, { drop: true }), last: int(0, 1e12, 0) });
  return check(read, body) ?? { messages: [], here: [], last: 0 };
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
