// Invites: a way into a repo's crew for someone who isn't here yet. The owner invites
// a handle, an email (mailed the link, when the site sends mail) or nobody in particular
// (a bare link to pass on). Each is a pending crew row behind a token; whoever opens
// /invite/<token> sees the repo, who invited them and why, signed in or not, and comes
// in through one of two doors:
//   person  sign in or sign up, pick a handle, and join as it
//   agent   a handle (agent-…) and a write API token made there and then, held to this
//           repo and revoked when the agent leaves its crew, plus the line that connects
//           claude, codex, pi or opencode to the MCP server with it.
//           Only a bare link opens this door: a handle or email invite is for a person.
// One claim per invite; pending ones expire, and the owner can revoke them.
// Only the token's SHA-256 is kept (#648), like an API token's: the link is shown
// once, when it's made. After that an invite is its id: the owner revokes it by id,
// and someone invited by handle, signed in as it, opens and claims it by id too.
//
//   POST   /api/repos/:o/:r/invites {handle?|email?, note?, days?}  (owner) a new invite and its link, shown this once
//   GET    /api/repos/:o/:r/invites          (owner) the pending ones, without their links
//   DELETE /api/repos/:o/:r/invites/:id      (owner) revoke one
//   GET    /api/invites                      invites to your handle, still pending
//   GET    /api/invites/:token               anyone with the link (or the invitee, by id): the repo, who invited, the note
//   POST   /api/invites/claim {invite, as: person|agent, name?, harness?}  come in; invite is the link, its token, or (yours by handle) its id
//   GET    /invite/:token  (not under /api) a browser goes to the page; an agent gets these steps as text

import { audit } from "./audit.ts";
import { charge, SITE } from "./limits.ts";
import { json, NAME, type Env, readBody } from "./env.ts";
import { HARNESSES, type Harness } from "./harness.ts";
import { isAdmin, isAgentHandle, mail, mailOn, slug } from "./identity.ts";
import { mint } from "./tokens.ts";
import { turnstile } from "./security.ts";
import { repoRow } from "./repos.ts";
import { b64url, sha256 } from "./util.ts";

export const INVITE_DAYS = 7, MAX_INVITE_DAYS = 30, AGENT_TOKEN_DAYS = 30;
const MAX_PENDING = 50;
const DAY = 86_400_000;

interface Invite {
  id: string; last4: string; owner: string; repo: string; by: string; kind: "handle" | "email" | "link"; target: string | null; note: string;
  created_at: number; expires_at: number; claimed_by: string | null; claimed_at: number | null; door: string | null;
}

const origin = (env: Env, req: Request) => (env.BETTER_AUTH_URL ?? new URL(req.url).origin).replace(/\/$/, "");
export const inviteLink = (base: string, token: string) => `${base}/invite/${token}`;
/** The token in a pasted link, the token itself, or an invite's id. */
const tokenIn = (s: string) => /csi_[A-Za-z0-9_-]+/.exec(s)?.[0] ?? (/^[0-9a-f]{8}$/.test(s.trim()) ? s.trim() : null);

/** What connects each harness to the MCP server as `token`. */
export function mcpLines(base: string, token: string): Record<Harness, string> {
  const url = `${base}/api/mcp`, headers = { Authorization: `Bearer ${token}` };
  return {
    claude: `claude mcp remove --scope user codesplitter 2>/dev/null; claude mcp add --scope user --transport http codesplitter ${url} --header "Authorization: Bearer ${token}"`,
    codex: `export CODESPLITTER_TOKEN=${token} && codex mcp add codesplitter --url ${url} --bearer-token-env-var CODESPLITTER_TOKEN`,
    // pi and opencode take a config file entry, not a command. pi's is its built-in MCP's
    // (0.99+, ~/.pi/agent/mcp.json, https://pi.dev/docs/latest/mcp): a url picks streamable HTTP.
    pi: JSON.stringify({ mcpServers: { codesplitter: { url, headers } } }),
    opencode: JSON.stringify({ mcp: { codesplitter: { type: "remote", url, headers } } }),
  };
}

const pendingWhere = "claimed_by IS NULL AND expires_at > ?";
const shown = (i: Invite) => ({ id: i.id, last4: i.last4, kind: i.kind, target: i.target, note: i.note, by: i.by, created_at: i.created_at, expires_at: i.expires_at });

/** The repo's pending invites, for its owner's repo page. */
export async function pendingInvites(env: Env, owner: string, repo: string) {
  const { results } = await env.DB.prepare(`SELECT * FROM invites WHERE owner = ? AND repo = ? AND ${pendingWhere} ORDER BY created_at DESC`).bind(owner, repo, Date.now()).all();
  return (results as Invite[]).map(shown);
}

/** /api/repos/:o/:r/invites[/:id]: the owner's side. */
export async function repoInviteRoutes(req: Request, env: Env, p: string[], owner: string, repo: string, user: string | null): Promise<Response | null> {
  if (p[4] !== "invites" || p[6]) return null;
  if (user !== owner) return json({ error: "owner only" }, 403);
  if (!p[5] && req.method === "GET") return json(await pendingInvites(env, owner, repo));
  if (p[5] && req.method === "DELETE") {
    const r = await env.DB.prepare("DELETE FROM invites WHERE id = ? AND owner = ? AND repo = ? AND claimed_by IS NULL").bind(p[5], owner, repo).run();
    if (!r.meta?.changes) return json({ error: "no such pending invite" }, 404);
    await audit(env, req, { actor: user, action: "invite.revoke", owner, repo, target: p[5] });
    return json({ ok: true });
  }
  if (p[5] || req.method !== "POST") return null;
  const b = await readBody<"handle" | "email" | "note" | "days">(req);
  const handle = String(b.handle ?? "").trim().replace(/^@/, "").toLowerCase(), email = String(b.email ?? "").trim().toLowerCase();
  if (handle && email) return json({ error: "a handle or an email, not both (neither makes a bare link)" }, 400);
  const days = b.days ?? INVITE_DAYS;
  if (typeof days !== "number" || !Number.isInteger(days) || days < 1 || days > MAX_INVITE_DAYS) return json({ error: `days: 1 to ${MAX_INVITE_DAYS}` }, 400);
  if (handle) {
    if (!NAME.test(handle)) return json({ error: "handle: lowercase letters and digits, single dashes between" }, 400);
    if (handle === owner) return json({ error: "it's your repo" }, 400);
    if (!(await env.DB.prepare("SELECT 1 FROM users WHERE name = ?").bind(handle).first())) return json({ error: `nobody is @${handle} yet: invite them by email, or send a link` }, 404);
    if (await env.DB.prepare("SELECT 1 FROM collaborators WHERE owner = ? AND repo = ? AND name = ?").bind(owner, repo, handle).first()) return json({ error: `@${handle} is already in the crew` }, 409);
  }
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "that doesn't look like an email" }, 400);
  const now = Date.now();
  const n = await env.DB.prepare(`SELECT COUNT(*) AS n FROM invites WHERE owner = ? AND repo = ? AND ${pendingWhere}`).bind(owner, repo, now).first();
  if ((n?.n as number ?? 0) >= MAX_PENDING) return json({ error: `at most ${MAX_PENDING} pending invites: revoke some first` }, 400);
  const token = "csi_" + b64url(crypto.getRandomValues(new Uint8Array(18)));
  const i: Invite = {
    id: crypto.randomUUID().slice(0, 8), last4: token.slice(-4), owner, repo, by: owner,
    kind: handle ? "handle" : email ? "email" : "link", target: handle || email || null, note: String(b.note ?? "").trim().slice(0, 280),
    created_at: now, expires_at: now + days * DAY, claimed_by: null, claimed_at: null, door: null,
  };
  await env.DB.prepare("INSERT INTO invites (id, hash, last4, owner, repo, by, kind, target, note, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(i.id, await sha256(token), i.last4, i.owner, i.repo, i.by, i.kind, i.target, i.note, i.created_at, i.expires_at).run();
  await audit(env, req, { actor: user, action: "invite.create", owner, repo, target: i.id, detail: i.target ? `${i.kind}: ${i.target}` : i.kind });
  // The link is shown this once: only its hash is kept.
  const out = { ...shown(i), token, link: inviteLink(origin(env, req), token) };
  if (i.kind !== "email") return json(out, 201);
  // Through the account mailer; without one, the owner sends the link themselves.
  if (!mailOn(env)) return json({ ...out, mailed: false }, 201);
  await mail(env, email, `@${owner} invited you to ${owner}/${repo} on codeSplitter`, [
    `@${owner} invited you to the crew of ${owner}/${repo} on codeSplitter: you'd edit, commit and share its code with them.`,
    ...(i.note ? [`“${i.note}”`] : []),
    `Have a look, then come in as yourself, or send your coding agent. The link works for ${days} day${days === 1 ? "" : "s"}:`,
  ], out.link, "Not expecting this? Ignore it: nothing happens unless you open the link.");
  return json({ ...out, mailed: true }, 201);
}

/**
 * The invite behind a token, or why it can't be claimed. By id, it's only the one
 * made out to `user`'s handle: anyone else needs the link.
 */
async function live(env: Env, ref: string, user: string | null = null): Promise<Invite | { error: string; status: number }> {
  const repoLive = "JOIN repos r ON r.owner = i.owner AND r.name = i.repo WHERE (r.expires_at IS NULL OR r.expires_at > ?)";
  const i = (ref.startsWith("csi_")
    ? await env.DB.prepare(`SELECT i.* FROM invites i ${repoLive} AND i.hash = ?`).bind(Date.now(), await sha256(ref)).first()
    : user ? await env.DB.prepare(`SELECT i.* FROM invites i ${repoLive} AND i.id = ? AND i.kind = 'handle' AND i.target = ?`).bind(Date.now(), ref, user).first() : null) as Invite | null;
  if (!i) return { error: "this invite was revoked, or never was", status: 404 };
  if (i.claimed_by) return { error: `this invite was already used, by @${i.claimed_by}: ask @${i.by} for another`, status: 410 };
  if (i.expires_at <= Date.now()) return { error: `this invite expired: ask @${i.by} for another`, status: 410 };
  return i;
}

const doors = (i: Invite) => i.kind === "link" ? ["person", "agent"] : ["person"];
const inCrew = async (env: Env, i: Invite, user: string) => user === i.owner
  || !!(await env.DB.prepare("SELECT 1 FROM collaborators WHERE owner = ? AND repo = ? AND name = ?").bind(i.owner, i.repo, user).first());

/** Settle the invite on `name` and put them in the crew; false when someone else got there first. */
async function join(env: Env, i: Invite, name: string, door: string) {
  const r = await env.DB.prepare(`UPDATE invites SET claimed_by = ?, claimed_at = ?, door = ? WHERE id = ? AND ${pendingWhere}`).bind(name, Date.now(), door, i.id, Date.now()).run();
  if (!r.meta?.changes) return false;
  await env.DB.prepare("INSERT OR IGNORE INTO collaborators (owner, repo, name) VALUES (?, ?, ?)").bind(i.owner, i.repo, name).run();
  return true;
}

/** A handle of the agent's own: agent-<name>-xxxx, so it never joins as a hosted agent-<harness>. */
async function newAgent(env: Env, name: string) {
  const base = slug(name).slice(0, 28).replace(/-+$/, "") || "guest";
  for (let n = 0; n < 8; n++) {
    const handle = `agent-${base}-${crypto.getRandomValues(new Uint32Array(1))[0]!.toString(36).padStart(4, "0").slice(-4)}`;
    const r = await env.DB.prepare("INSERT OR IGNORE INTO users (name, created_at) VALUES (?, ?)").bind(handle, Date.now()).run();
    if (r.meta?.changes) return handle;
  }
  throw new Error("couldn't find a free agent handle");
}

/** /api/invites[/:token|/claim]: the invitee's side. */
export async function inviteRoutes(req: Request, env: Env, p: string[], user: string | null): Promise<Response | null> {
  if (p[1] !== "invites" || p[3]) return null;
  if (!p[2] && req.method === "GET") {
    if (!user) return json({ error: "sign in first" }, 401);
    const { results } = await env.DB.prepare(`SELECT * FROM invites WHERE kind = 'handle' AND target = ? AND ${pendingWhere} ORDER BY created_at DESC`).bind(user, Date.now()).all();
    return json((results as Invite[]).map((i) => ({ ...shown(i), owner: i.owner, repo: i.repo })));
  }
  if (p[2] === "claim" && req.method === "POST") return claim(req, env, user);
  if (!p[2] || req.method !== "GET") return null;
  const i = await live(env, p[2], user);
  if ("error" in i) return json({ error: i.error }, i.status);
  const r = await repoRow(env, i.owner, i.repo, "visibility");
  return json({
    owner: i.owner, repo: i.repo, visibility: r?.visibility ?? "public", by: i.by, note: i.note, kind: i.kind,
    // Who it's for: a handle says so; an email only that it went to one.
    for: i.kind === "handle" ? i.target : null, emailed: i.kind === "email", expires_at: i.expires_at, doors: doors(i),
    ...(user ? { you: user, member: await inCrew(env, i, user) } : {}),
  });
}

async function claim(req: Request, env: Env, user: string | null): Promise<Response> {
  const b = await readBody<"invite" | "as" | "name" | "harness">(req);
  const token = tokenIn(String(b.invite ?? ""));
  if (!token) return json({ error: "invite: the link, or its csi_… token" }, 400);
  if (b.as !== "person" && b.as !== "agent") return json({ error: "as: person or agent" }, 400);
  const i = await live(env, token, user);
  if ("error" in i) return json({ error: i.error }, i.status);
  const base = origin(env, req), where = { owner: i.owner, repo: i.repo, url: `${base}/#/r/${i.owner}/${i.repo}` };

  if (b.as === "person") {
    if (!user) return json({ error: "sign in first (and pick your handle), then claim it" }, 401);
    if (isAgentHandle(user)) return json({ error: "agents come in through the agent door: as: agent" }, 400);
    if (i.kind === "handle" && i.target !== user) return json({ error: `this invite is for @${i.target}` }, 403);
    if (await inCrew(env, i, user)) return json({ error: `you're already in the crew of ${i.owner}/${i.repo}` }, 409);
    // A person comes in through the page, so the bot check applies; an agent's door is for code, and the join rule limits it.
    const bot = await turnstile(req, env);
    if (bot) return bot;
    if (!(await join(env, i, user, "person"))) return json({ error: "someone used this invite just now" }, 410);
    await audit(env, req, { actor: user, action: "invite.claim", owner: i.owner, repo: i.repo, target: i.id, detail: "person" });
    return json({ ...where, joined: user, door: "person" }, 201);
  }

  if (!doors(i).includes("agent")) return json({ error: `this invite is for ${i.kind === "handle" ? `@${i.target}` : "a person"}: ask @${i.by} for a link an agent can use` }, 403);
  const harness = HARNESSES.find((x) => x === b.harness);
  if (b.harness !== undefined && !harness) return json({ error: `harness: ${HARNESSES.join(", ")}` }, 400);
  // An agent already here (calling with its own token) joins as itself.
  if (user && isAgentHandle(user)) {
    if (await inCrew(env, i, user)) return json({ error: `you're already in the crew of ${i.owner}/${i.repo}` }, 409);
    if (!(await join(env, i, user, "agent"))) return json({ error: "someone used this invite just now" }, 410);
    // Its token is held to the repo it came in for, so this one gets its own.
    const t = await mint(env, user, `invite to ${i.owner}/${i.repo}`, "write", AGENT_TOKEN_DAYS, `${i.owner}/${i.repo}`);
    await audit(env, req, { actor: user, action: "invite.claim", owner: i.owner, repo: i.repo, target: i.id, detail: `agent, token ${t.id}` });
    return json({ ...where, joined: user, door: "agent", token: t.token, expires_at: t.expires_at, mcp: mcpLines(base, t.token),
      next: `Use this token for ${i.owner}/${i.repo}: each of your tokens reaches the repo it came with.` }, 201);
  }
  // Bots are welcome, but not by the thousand: on the hosted site every handle gets its own per-person limits, so the
  // ones an inviter brings in are held to a share of their own, and the site to a total.
  // A desktop (no cf-connecting-ip) is never counted: its swarm costs the site nothing.
  const over = !req.headers.get("cf-connecting-ip") ? null : ((env.ADMINS && isAdmin(env, i.by) ? null : await charge(env, "brood", `@${i.by}`)) ?? await charge(env, "newagents", SITE));
  if (over) return json({ error: over }, 429);
  const handle = await newAgent(env, String(b.name ?? "") || harness || "guest");
  if (!(await join(env, i, handle, "agent"))) {
    await env.DB.prepare("DELETE FROM users WHERE name = ?").bind(handle).run();
    return json({ error: "someone used this invite just now" }, 410);
  }
  const t = await mint(env, handle, `invite to ${i.owner}/${i.repo}`, "write", AGENT_TOKEN_DAYS, `${i.owner}/${i.repo}`);
  await audit(env, req, { actor: handle, via: "invite", action: "invite.claim", owner: i.owner, repo: i.repo, target: i.id, detail: `new agent, token ${t.id}` });
  return json({
    ...where, joined: handle, door: "agent", token: t.token, expires_at: t.expires_at, mcp: mcpLines(base, t.token),
    next: `You're @${handle}, in the crew of ${i.owner}/${i.repo}. Keep the token: it's shown this once, acts as you in ${i.owner}/${i.repo} only, and lasts ${AGENT_TOKEN_DAYS} days. `
      + `Connect your MCP client with the line for your harness (mcp), or send it as Authorization: Bearer on ${base}/api (spec at ${base}/api/openapi.json).`,
  }, 201);
}

/** GET /invite/:token: a browser goes to the page; anything else (an agent's fetch) gets the steps as text. */
export async function invitePage(req: Request, env: Env, token: string): Promise<Response> {
  if ((req.headers.get("accept") ?? "").includes("text/html")) return new Response(null, { status: 302, headers: { location: `/#/i/${encodeURIComponent(token)}` } });
  const i = await live(env, token);
  const text = (s: string, status = 200) => new Response(s + "\n", { status, headers: { "content-type": "text/plain; charset=utf-8" } });
  if ("error" in i) return text(`codeSplitter: ${i.error}.`, i.status);
  const base = origin(env, req), body = (as: string) => JSON.stringify({ invite: token, as, ...(as === "agent" ? { harness: "claude" } : {}) });
  return text([
    `codeSplitter invite: @${i.by} invited you to the crew of ${i.owner}/${i.repo}.`,
    ...(i.note ? [`Their note: ${i.note}`] : []),
    `It expires ${new Date(i.expires_at).toISOString()}, and works once.`,
    "",
    ...(doors(i).includes("agent") ? [
      "If you're a coding agent, claim it yourself. You get your own handle (agent-…), a write API token and the line that connects your MCP client:",
      `  curl -sX POST ${base}/api/invites/claim -H 'content-type: application/json' -d '${body("agent")}'`,
      "  (harness: claude, codex, pi or opencode; add name to pick your handle's middle part)",
      `Already connected to codeSplitter over MCP? Call claim_invite with {"body": ${body("agent")}}.`,
      "",
    ] : ["This invite is for a person, not an agent.", ""]),
    `If you're a person, open it in a browser: ${inviteLink(base, token)}`,
  ].join("\n"));
}
