// eqosys's functions, defined once and called three ways: as WebMCP tools and Cmd/Ctrl+K commands in the page (app/commands.client.ts), as `POST /api/tools/<name>`
// from a script or the CLI (scripts/eq.ts), and by the `eq_batch` tool, which runs several of them in one round trip and keeps only
// the fields asked for. The agent's cheapest path is one batch with `pick`, not a screenshot and not a call per fact (GET /agents says so).
// A tool is a plain function of (who is asking, checked arguments); the guard is the type. Add one here and every door has it.
import { arr, bool, Bad, check, int, obj, oneOf, opt, raw, str, type Guard } from "@rustybuns/util/guard";
import { privateJson as json } from "@rustybuns/util/http";
import { APPS, GENRES, HOME, MATURITY, playOf } from "./apps.ts";
import { appOf, appsOf, Draft, isListing, listings, pull, review, save, send, type Done } from "./listings.ts";
import { ACHIEVEMENTS, shownFor, TOTAL, unlocksOf } from "./achievements.ts";
import { hubAsk, Who } from "./qollab/hub.ts";
import { edge, execute, MAX_BACK, MAX_CALLS as MAX_PROGRAM_CALLS, RUN_MS, type ToolAnswer } from "./codemode.ts";
import { members } from "./members.ts";
import { slotsOf } from "./qollab/saves.ts";
import { visitorsOf } from "./visitors.ts";
import { addMember, house, Kind, makeStudio, Role, STUDIO_NAME, studiosOf, KINDS, ROLES } from "./studios.ts";
import { studioRemove } from "./qollab/space.ts";
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

/** A listing step's answer, or its refusal. */
const done = (r: Done) => { if (!r.ok) throw new Refused(r.error, r.status); return r.listing; };
/** A studio's games change from the signed-in page, not from one app's token. */
const onPage = (c: Ctx) => { if (!c.email) throw new Refused("a studio's games change from the signed-in page, not an app's token", 403); };
const unlocked =(list: { at: number | null }[]) => list.filter((a) => a.at !== null).length;
const knownApp = async (c: Ctx, id: string) => (await appOf(c.conf, id)) ?? (() => { throw new Refused(`no app "${id}": ${APPS.map((a) => a.id).join(", ")}`); })();
/** The one app an app's token may read the person's data for (its own), or null on eqosys's page, which reads them all. */
const tokenApp = (c: Ctx) => c.who.app === HOME ? null : c.who.app;
/** The app asked about, held to the token's own: another app's saves or unlocks are that app's business, not this one's. */
const ownApp = (c: Ctx, asked: string | undefined) => {
  const own = tokenApp(c);
  if (own && asked && asked !== own) throw new Refused(`a token for ${own} reads ${own}'s data only`, 403);
  return asked ?? own ?? undefined;
};

export const TOOLS: Tool[] = [
  tool(obj({}), {
    name: "eq_whoami", title: "Who am I", annotations: READ,
    description: "The signed-in person: id, name, and whether they are the super admin. Email only when signed in on the page.",
    run: async (c) => ({ id: c.who.id, name: c.who.name, ...(c.email ? { email: c.email } : {}), admin: c.admin, via: c.who.app === "eqosys" ? "page" : `token for ${c.who.app}` }),
  }),
  tool(obj({ genre: opt(oneOf(GENRES)), maturity: opt(oneOf(MATURITY)), q: opt(str(60)) }), {
    name: "eq_apps", title: "List apps", annotations: READ,
    description: "Every app that signs in through eqosys: id, name, kind, genre, maturity, featured, and `mine` (what this person may do there; null if they never opened it, and for every other app when asked with an app's token). Filter by genre, maturity or text.",
    input: { genre: { enum: [...GENRES] }, maturity: { enum: [...MATURITY] }, q: { type: "string", description: "Matches the id or name." } },
    run: async (c, a) => {
      const own = tokenApp(c);
      const mine = new Map((await members(c.conf, c.who.id))[0]?.apps.filter((x) => !own || x.app === own).map((x) => [x.app, x.access]) ?? []);
      const q = a.q?.toLowerCase();
      return { apps: (await appsOf(c.conf)).filter((x) => (!a.genre || x.genre === a.genre) && (!a.maturity || (x.maturity ?? "alpha") === a.maturity) && (!q || x.id.includes(q) || x.name.toLowerCase().includes(q)))
        .map((x) => ({ id: x.id, name: x.name, kind: x.kind, genre: x.genre, maturity: x.maturity ?? "alpha", featured: !!x.featured, url: playOf(x), mine: mine.get(x.id) ?? null, ...(isListing(x) ? { studio: x.studio.name } : {}) })) };
    },
  }),
  tool(obj({ app: opt(str(64)) }), {
    name: "eq_achievements", title: "Achievements", annotations: READ,
    description: "With `app`: that game's whole catalog for this person (unlocked first, secrets hidden until earned). Without: one line per game, `unlocked` of `total`. An app's token reads its own game only.",
    input: { app: { type: "string", description: "An app id from eq_apps." } },
    run: async (c, a) => {
      const app = ownApp(c, a.app), got = await unlocksOf(c.conf, c.who.id, app);
      if (app) { const q = await knownApp(c, app), list = shownFor(q, got.get(q.id)); return { app: q.id, unlocked: unlocked(list), total: list.length, achievements: list }; }
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
    description: "This person's cloud saves: per app and slot, how many versions are kept, bytes, and when last written. The save data itself is not returned. An app's token reads its own saves only.",
    input: { app: { type: "string" } },
    run: async (c, a) => ({ saves: await slotsOf(c.conf, c.who.id, ownApp(c, a.app)) }),
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
  tool(obj({ days: int(1, 30, 7) }), {
    name: "eq_visitors", title: "Visitors (admin)", annotations: READ, admin: true,
    description: "Super admin only. Who came to eqosys, the Playground and the apps that call eqosys, over the last `days` (1-30): real people (a browser that tapped, typed or scrolled), every browser, agents and bots, by site and by day; where real people came from; the last day's callers; sign-ups and health.",
    input: { days: { type: "integer", minimum: 1, maximum: 30 } },
    run: (c, a) => visitorsOf(c.conf, a.days),
  }),
  tool(obj({}), {
    name: "eq_studios", title: "Studios", annotations: READ,
    description: "The studios this person is in (an account that makes apps: solo, team or business), with their role, its members (name, email, role) and how many, and each app on the shelf: " +
      "`play` (its site), `make` (its codeSplitter repo, null until linked), `ship` (live or not deployed) and `shipped` (the last deploy it reported: stage, version, at; null until one does). The super admin's QNTBR studio is made the first time they ask.",
    run: async (c) => {
      if (c.admin) await house(c.conf, c.who.id);
      return { studios: await studiosOf(c.conf, c.who.id) };
    },
  }),
  tool(obj({ name: STUDIO_NAME, kind: Kind }), {
    name: "eq_studio_make", title: "Make a studio", annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
    description: "Make a studio with this person as its owner: `name` (1-60 characters) and `kind` (solo, team or business). Answers { id }. Three a person.",
    input: { name: { type: "string" }, kind: { enum: [...KINDS] } }, required: ["name", "kind"],
    run: async (c, a) => {
      const r = await makeStudio(c.conf, c.who.id, a.name, a.kind);
      if (!r.ok) throw new Refused(r.error, r.status);
      return { id: r.id };
    },
  }),
  tool(obj({ studio: str(64), email: str(320), role: Role }), {
    name: "eq_studio_add", title: "Add someone to a studio", annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false },
    description: "Signed in on the page only. Put someone who has an eqosys account in a studio by their email, as owner, admin or maker (or change their role). The studio's owner or admin asks; only an owner makes another owner.",
    input: { studio: { type: "string" }, email: { type: "string" }, role: { enum: [...ROLES] } }, required: ["studio", "email", "role"],
    run: async (c, a) => {
      if (!c.email) throw new Refused("adding people by email is for the signed-in page, not an app's token", 403);
      const r = await addMember(c.conf, a.studio, c.who.id, a.email, a.role);
      if (!r.ok) throw new Refused(r.error, r.status);
      return { ok: true };
    },
  }),
  tool(obj({ studio: str(64), email: str(320) }), {
    name: "eq_studio_remove", title: "Take someone out of a studio", annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    description: "Signed in on the page only. Take someone out of a studio by their email, or leave it with your own. The studio's owner or admin asks; only an owner takes out another owner, and a studio keeps one owner. They are out of the studio's space at once.",
    input: { studio: { type: "string" }, email: { type: "string" } }, required: ["studio", "email"],
    run: async (c, a) => {
      if (!c.email) throw new Refused("taking people out by email is for the signed-in page, not an app's token", 403);
      const r = await studioRemove(c.conf, a.studio, c.who.id, a.email);
      if (!r.ok) throw new Refused(r.error, r.status);
      return { ok: true };
    },
  }),
  tool(Draft, {
    name: "eq_listing_save", title: "Save a studio's game", annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false },
    description: "A studio's owner or admin puts its own game in the Library as a draft, or changes it: `studio` (its id from eq_studios), `id` (a slug, 3-40 characters, unique across the Library), `name`, `genre`, " +
      "`origins` (1-4 https origins its pages run on), and optionally `kind` (game or suite), `returns` (exact URLs a sign-in comes back to; left out, each origin's /), `erase` (a URL eqosys POSTs to when an account is deleted) and `blurb` (the card's line). " +
      "A draft signs in only the studio's own members. It starts experimental, with play. Changing origins, returns or erase on a game in review or listed makes it a draft again. Answers { listing }.",
    input: { studio: { type: "string" }, id: { type: "string" }, name: { type: "string" }, genre: { enum: [...GENRES] }, kind: { enum: ["game", "suite"] },
      origins: { type: "array", items: { type: "string" } }, returns: { type: "array", items: { type: "string" } }, erase: { type: "string" }, blurb: { type: "string" } },
    required: ["studio", "id", "name", "genre", "origins"],
    run: async (c, a) => { onPage(c); return { listing: done(await save(c.conf, c.who.id, a)) }; },
  }),
  tool(obj({ id: str(40) }), {
    name: "eq_listing_send", title: "Send a game to review", annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
    description: "A studio's owner or admin sends its draft (or a refused game, fixed) to the review queue. Answers { listing }.",
    input: { id: { type: "string" } }, required: ["id"],
    run: async (c, a) => { onPage(c); return { listing: done(await send(c.conf, c.who.id, a.id)) }; },
  }),
  tool(obj({ id: opt(str(40)), verdict: opt(oneOf(["list", "refuse"])), note: str(500, { min: 0, dflt: "" }) }), {
    name: "eq_listing_review", title: "Review studios' games (admin)", annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false }, admin: true,
    description: "Super admin only. With no `id`: the review queue (every game in review, oldest first). With `id` and `verdict`: `list` puts it on everyone's shelf, `refuse` sends it back to its studio with `note` (required) saying why. Answers { queue } or { listing }.",
    input: { id: { type: "string" }, verdict: { enum: ["list", "refuse"] }, note: { type: "string" } },
    run: async (c, a) => {
      if (!a.id) return { queue: await listings(c.conf, { states: ["in review"] }) };
      if (!a.verdict) throw new Refused("say `verdict`: list or refuse");
      return { listing: done(await review(c.conf, a.id, a.verdict, a.note)) };
    },
  }),
  tool(obj({ id: str(40) }), {
    name: "eq_listing_pull", title: "Pull a studio's game", annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    description: "Take a studio's game out of the Library: the super admin, or its own studio's owner or admin. Its tile goes and its sign-ins and tokens stop; players' saves in it are kept 30 days, then erased. Answers { listing }.",
    input: { id: { type: "string" } }, required: ["id"],
    run: async (c, a) => { onPage(c); return { listing: done(await pull(c.conf, c.who.id, c.admin, a.id)) }; },
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
