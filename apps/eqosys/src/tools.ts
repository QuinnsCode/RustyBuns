// eqosys's functions, defined once and called three ways: as WebMCP tools in the page (app/WebMcp.ts), as `POST /api/tools/<name>`
// from a script or the CLI (scripts/eq.ts), and by the `eq_batch` tool, which runs several of them in one round trip and keeps only
// the fields asked for. The agent's cheapest path is one batch with `pick`, not a screenshot and not a call per fact (GET /agents says so).
// A tool is a plain function of (who is asking, checked arguments); the guard is the type. Add one here and every door has it.
import { arr, bool, Bad, check, int, obj, oneOf, opt, raw, str, type Guard } from "@rustybuns/util/guard";
import { privateJson as json } from "@rustybuns/util/http";
import { APPS, GENRES, MATURITY } from "./apps.ts";
import { ACHIEVEMENTS, shownFor, TOTAL, unlocksOf } from "./achievements.ts";
import { hubAsk, Who } from "./hub.ts";
import { edge, execute, MAX_BACK, MAX_CALLS as MAX_PROGRAM_CALLS, RUN_MS, type ToolAnswer } from "./codemode.ts";
import { members } from "./members.ts";
import { slotsOf } from "./saves.ts";
import type { Env } from "./env.ts";

/** Who is asking: a signed-in page (a session cookie; `email` and maybe `admin`) or an app's token (just who). */
export interface Ctx { conf: Env; who: Who; email?: string; admin: boolean }

interface Hints { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean }
export interface Tool {
  name: string;
  title: string;
  /** What an agent reads: what it does and what it answers with. */
  description: string;
  inputSchema: { type: "object"; properties: Record<string, object>; required?: string[]; additionalProperties: false };
  annotations: Hints;
  /** Only the super admin may call it (a token never is). */
  admin?: boolean;
  run(c: Ctx, args: unknown): Promise<unknown>;
}

class Refused extends Error { constructor(msg: string, readonly status = 400) { super(msg); } }

/** A tool whose arguments are read through `guard` before `run` sees them. */
type Spec = Omit<Tool, "run" | "inputSchema"> & { input?: Record<string, object>; required?: string[] };
const tool = <A>(guard: Guard<A>, t: Spec & { run(c: Ctx, a: A): Promise<unknown> }): Tool => ({
  name: t.name, title: t.title, description: t.description, annotations: t.annotations, ...(t.admin ? { admin: true } : {}),
  inputSchema: { type: "object", properties: t.input ?? {}, ...(t.required ? { required: t.required } : {}), additionalProperties: false },
  run: (c, raw) => t.run(c, guard(raw ?? {})),
});
const READ: Hints = { readOnlyHint: true, openWorldHint: false };

const unlocked = (list: { at: number | null }[]) => list.filter((a) => a.at !== null).length;
const knownApp = (id: string) => APPS.some((a) => a.id === id) ? id : (() => { throw new Refused(`no app "${id}": ${APPS.map((a) => a.id).join(", ")}`); })();

export const TOOLS: Tool[] = [
  tool(obj({}), {
    name: "eq_whoami", title: "Who am I", annotations: READ,
    description: "The signed-in person: id, name, and whether they are the super admin. Email only when signed in on the page.",
    run: async (c) => ({ id: c.who.id, name: c.who.name, ...(c.email ? { email: c.email } : {}), admin: c.admin, via: c.who.app === "eqosys" ? "page" : `token for ${c.who.app}` }),
  }),
  tool(obj({ genre: opt(oneOf(GENRES)), maturity: opt(oneOf(MATURITY)), q: opt(str(60)) }), {
    name: "eq_apps", title: "List apps", annotations: READ,
    description: "Every app that signs in through eqosys: id, name, kind, genre, maturity, featured, and `mine` (what this person may do there; null if they never opened it). Filter by genre, maturity or text.",
    input: { genre: { enum: [...GENRES] }, maturity: { enum: [...MATURITY] }, q: { type: "string", description: "Matches the id or name." } },
    run: async (c, a) => {
      const mine = new Map((await members(c.conf, c.who.id))[0]?.apps.map((x) => [x.app, x.access]) ?? []);
      const q = a.q?.toLowerCase();
      return { apps: APPS.filter((x) => (!a.genre || x.genre === a.genre) && (!a.maturity || (x.maturity ?? "alpha") === a.maturity) && (!q || x.id.includes(q) || x.name.toLowerCase().includes(q)))
        .map((x) => ({ id: x.id, name: x.name, kind: x.kind, genre: x.genre, maturity: x.maturity ?? "alpha", featured: !!x.featured, url: x.origins[0] ?? null, mine: mine.get(x.id) ?? null })) };
    },
  }),
  tool(obj({ app: opt(str(64)) }), {
    name: "eq_achievements", title: "Achievements", annotations: READ,
    description: "With `app`: that game's whole catalog for this person (unlocked first, secrets hidden until earned). Without: one line per game, `unlocked` of `total`.",
    input: { app: { type: "string", description: "An app id from eq_apps." } },
    run: async (c, a) => {
      const got = await unlocksOf(c.conf, c.who.id);
      if (a.app) { const id = knownApp(a.app); const list = shownFor(id, got.get(id)); return { app: id, unlocked: unlocked(list), total: list.length, achievements: list }; }
      return { total: TOTAL, games: Object.entries(ACHIEVEMENTS).map(([id, list]) => ({ app: id, unlocked: got.get(id)?.size ?? 0, total: list.length })) };
    },
  }),
  tool(obj({}), {
    name: "eq_friends", title: "Friends", annotations: READ,
    description: "Friends with where each is playing now, plus how many requests are waiting in and out.",
    run: async (c) => {
      if (!c.conf.HUB) throw new Refused("friends are not running here", 503);
      const s = await hubAsk(c.conf.HUB, c.who, { op: "state" });
      if ("error" in s) throw new Refused(s.error, 502);
      return { friends: s.friends.map((f) => ({ id: f.id, name: f.name, playing: f.presence.map((p) => p.app) })), incoming: s.incoming.length, outgoing: s.outgoing.length };
    },
  }),
  tool(obj({ app: opt(str(64)) }), {
    name: "eq_saves", title: "Cloud saves", annotations: READ,
    description: "This person's cloud saves: per app and slot, how many versions are kept, bytes, and when last written. The save data itself is not returned.",
    input: { app: { type: "string" } },
    run: async (c, a) => ({ saves: await slotsOf(c.conf, c.who.id, a.app) }),
  }),
  tool(obj({ q: opt(str(100)), limit: int(1, 200, 50) }), {
    name: "eq_members", title: "Members (admin)", annotations: READ, admin: true,
    description: "Super admin only. Everyone who has signed up: name, email, where they came from, apps and access. Filter by `q` on name or email.",
    input: { q: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 200 } },
    run: async (c, a) => {
      const q = a.q?.toLowerCase();
      const all = (await members(c.conf)).filter((m) => !q || m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q));
      return { total: all.length, members: all.slice(0, a.limit).map((m) => ({ id: m.id, name: m.name, email: m.email, source: m.source, apps: m.apps.map((x) => ({ app: x.app, access: x.access })) })) };
    },
  }),
];

const byName = (name: string) => TOOLS.find((t) => t.name === name);
const isRead = (t: Tool) => t.annotations.readOnlyHint === true;

/** Keep only the fields named by dotted paths, through arrays: `["apps.id", "apps.name"]` turns `{apps:[{id,name,url,..}]}` into `{apps:[{id,name}]}`. */
export function pick(v: unknown, paths: string[][]): unknown {
  if (Array.isArray(v)) return v.map((x) => pick(x, paths));
  if (typeof v !== "object" || v === null) return v;
  const row = v as Record<string, unknown>, by = new Map<string, string[][]>(), out: Record<string, unknown> = {};
  for (const p of paths) if (p[0] !== undefined && p[0] in row) by.set(p[0], [...(by.get(p[0]) ?? []), p.slice(1)]);
  for (const [k, rest] of by) out[k] = rest.some((r) => !r.length) ? row[k] : pick(row[k], rest);
  return out;
}

const Call = obj({ tool: str(40), args: opt(raw), pick: opt(arr(str(80), 20)) });
const MAX_CALLS = 12;

async function runOne(c: Ctx, t: Tool, args: unknown) {
  if (t.admin && !c.admin) throw new Refused(`${t.name} is for the super admin`, 403);
  return t.run(c, args);
}

/** Several read-only tools in one round trip. Each call may `pick` the fields to keep, so a program's worth of lookups comes back as the few facts wanted. */
const batch: Tool = {
  name: "eq_batch", title: "Run several tools at once",
  description: `The cheap way to answer anything that needs more than one fact: up to ${MAX_CALLS} read-only eq_ tools in ONE call, each with an optional \`pick\` ` +
    `(dotted field paths, through arrays, e.g. ["apps.id","apps.mine"]) so only those fields come back. Answers an array in order: {tool, ok, result|error}. ` +
    "One bad call does not stop the rest. Prefer this to calling tools one at a time, and to screenshots.",
  inputSchema: { type: "object", additionalProperties: false, required: ["calls"], properties: { calls: { type: "array", maxItems: MAX_CALLS, items: { type: "object", required: ["tool"], properties: {
    tool: { type: "string", description: "An eq_ tool's name (not eq_batch)." }, args: { type: "object" }, pick: { type: "array", items: { type: "string" } } } } } } },
  annotations: READ,
  async run(c, raw) {
    const body = check(obj({ calls: arr(Call, MAX_CALLS, { min: 1 }) }), raw);
    if (!body) throw new Refused(`send { calls: [{ tool, args?, pick? }] }, 1 to ${MAX_CALLS} calls`);
    return Promise.all(body.calls.map(async (call) => {
      const t = byName(call.tool);
      if (!t || t === batch || t === execTool) return { tool: call.tool, ok: false, error: `no tool "${call.tool}": ${TOOLS.map((x) => x.name).join(", ")}` };
      if (!isRead(t)) return { tool: call.tool, ok: false, error: `${t.name} changes things, so it is not batched: call it by itself` };
      try {
        const out = await runOne(c, t, call.args);
        return { tool: call.tool, ok: true, result: call.pick?.length ? pick(out, call.pick.map((p) => p.split("."))) : out };
      } catch (e) { return { tool: call.tool, ok: false, error: e instanceof Error ? e.message : String(e) }; }
    }));
  },
};

/** `eq_apps({ genre?, maturity?, q? })`: how a program calls a tool. */
const signature = (t: Tool) => `${t.name}({ ${Object.keys(t.inputSchema.properties).map((k) => k + (t.inputSchema.required?.includes(k) ? "" : "?")).join(", ")} })`;
const programTools = TOOLS.filter(isRead);

/** One tool's answer to a program's call, as the caller: the status an HTTP call would have had, and the JSON. Admin and read-only rules hold here too. */
export async function answer(c: Ctx, name: string, json: string): Promise<ToolAnswer> {
  const fail = (status: number, error: string): ToolAnswer => ({ status, text: JSON.stringify({ error }) });
  const t = programTools.find((x) => x.name === name);
  if (!t) return fail(404, `no tool ${name}; the tools are ${programTools.map((x) => x.name).join(", ")}`);
  let args: unknown;
  try { args = JSON.parse(json); } catch { return fail(400, "arguments must be JSON"); }
  try { return { status: 200, text: JSON.stringify(await runOne(c, t, args) ?? null) }; }
  catch (e) {
    if (e instanceof Refused) return fail(e.status, e.message);
    if (e instanceof Bad) return fail(400, e.message);
    return fail(500, "the tool failed");
  }
}

/** The caller a program's bridge answers as. These cross a process boundary, so they are read through a guard. */
const Props = obj({ who: Who, email: opt(str(320)), admin: bool() });
const propsOf = (c: Ctx) => ({ who: c.who, ...(c.email ? { email: c.email } : {}), admin: c.admin });
/** The bridge entrypoint's call (worker.tsx): rebuild the caller from its props, run the tool. */
export function bridgeCall(conf: Env, props: unknown, name: string, json: string): Promise<ToolAnswer> {
  const p = check(Props, props);
  if (!p) throw new Error("EQBridge needs the caller's who");
  return answer({ conf, who: p.who, email: p.email, admin: p.admin }, name, json);
}

const execTool: Tool = {
  name: "eq_execute", title: "Run a program over the tools",
  description: "Run JavaScript over the read-only eq_ tools and get back only what it returns. For a job with a loop, a filter or two lists to join, write one program instead of calling tools one at a time. " +
    "The program is the body of an async function. Each tool is `await tools.<name>({...})`; its answer comes back parsed, an error throws with its status first, and console.log lines come back too. " +
    `\`return\` a small answer: counts, ids, a few fields. At most ${MAX_PROGRAM_CALLS} tool calls, ${RUN_MS / 1000} s, ${MAX_BACK.toLocaleString("en")} characters back; no network but the tools; you act as the person asking. ` +
    `\`input\` is any JSON your program reads as \`input\`. Tools: ${programTools.map(signature).join("; ")}. ` +
    "Example: `const { apps } = await tools.eq_apps({}); const out = []; for (const a of apps) { const r = await tools.eq_achievements({ app: a.id }); if (r.unlocked) out.push([a.id, r.unlocked]); } return out;`",
  inputSchema: { type: "object", additionalProperties: false, required: ["code"], properties: { code: { type: "string", description: "the body of an async function; use `return` for the answer" }, input: { description: "any JSON; the program reads it as `input`" } } },
  annotations: { readOnlyHint: true, openWorldHint: false },
  async run(c, rawArgs) {
    const a = check(obj({ code: str(32_000), input: opt(raw) }), rawArgs);
    if (!a) throw new Refused("send { code: the body of an async function, input? }");
    if (!c.conf.LOADER) throw new Refused("code mode is not running here: use eq_batch", 503);
    const r = await execute(c.conf.LOADER, a.code, programTools.map((x) => x.name), (name, json) => answer(c, name, json), a.input, edge.stub?.(propsOf(c)));
    return { ok: !r.isError, calls: r.calls, ...JSON.parse(r.text.length < MAX_BACK ? r.text : JSON.stringify({ error: r.text })) };
  },
};

/** Every tool, `eq_batch` and `eq_execute` last. */
export const ALL: Tool[] = [...TOOLS, batch, execTool];

/** What GET /api/tools and the page's WebMCP script see: every tool without its function (an admin one is listed; the call says who may). */
export const catalog = () => ALL.map(({ run: _run, ...t }) => t);

/** Run one tool for `c`: the reply, or the status and words an agent can act on. */
export async function callTool(c: Ctx, name: string, args: unknown): Promise<Response> {
  const t = ALL.find((x) => x.name === name);
  if (!t) return json({ error: `no tool "${name}"`, tools: ALL.map((x) => x.name) }, 404);
  try { return json({ result: await runOne(c, t, args) }); }
  catch (e) {
    if (e instanceof Refused) return json({ error: e.message }, e.status);
    if (e instanceof Bad) return json({ error: e.message, input: t.inputSchema }, 400);
    throw e;
  }
}

/** GET /agents: the page an agent reads once, as plain text. */
export const AGENTS_TEXT = `# eqosys for agents

eqosys is one account for every Q app. Everything a person can look up here is a tool, and the same tool is reachable three ways:

- WebMCP: signed in on a page, the browser's agent sees the eq_ tools (document.modelContext). The agent never holds a token.
- HTTP: GET /api/tools lists them with schemas (no sign-in needed); POST /api/tools/<name> with a JSON body calls one. Sign in with the session cookie, or send an app's token as Authorization: Bearer.
- CLI: \`bun apps/eqosys/scripts/eq.ts <tool> '{"json":"args"}' --url <origin> --token <token>\` (no tool name lists them).

## Spend few tokens

- Do not take screenshots to read this site. Every list on screen is a tool's answer.
- Need more than one fact? Call **eq_batch** once: { calls: [{ tool: "eq_apps", pick: ["apps.id","apps.mine"] }, { tool: "eq_achievements" }] }.
  \`pick\` keeps only the dotted field paths you name (through arrays), so a catalog comes back as the three columns you wanted.
- A job with loops or many steps (clear every X, compare two lists) is a program, not a chain of calls: send it to **eq_execute**
  ({ code: "..." }), where each tool is \`await tools.eq_apps({...})\` and only what the program returns reaches your context.
- Reads are safe: try the cheaper path without asking. Anything that changes or deletes needs the owner's yes first.

## Compare, then tell the owner

After a task done with these tools, say in one or two lines what it cost against the way you would otherwise have done it
(calls made, roughly how many tokens of replies, versus screenshots or one call per fact). If a tool was missing or clumsy, say which,
so it can be added in apps/eqosys/src/tools.ts. Ask the owner before filing anything; they decide.
`;
