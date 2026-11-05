// Layout: @mentions in agent threads: who a message names, kept in their inbox till they open the thread
// Someone in a thread (#3711) writes `@sam`, or the agent asks sam for a decision there: sam, if they are on the
// repo's crew, gets it in their inbox (#3720). A crew member asking the agent to go again after its run ended puts
// that in the owner's inbox (#3728). Opening the thread marks its mentions seen.
//
//   GET  /api/me/mentions            {mentions: [{id, owner, repo, thread, n, by, kind, text, at, seen}], unread}, newest first
//   POST /api/me/mentions/seen {ids?}   mark them seen (none: all of them): {unread}
//
// Only the crew is named: a handle outside it, the speaker and the agents themselves are left out. A mention
// of a repo you've left since stays in the table but no longer shows.
import { arr, int, obj, opt } from "@rustybuns/util/guard";
import { json, need, readBody, type Env } from "./env.ts";
import { liveRepo } from "./repos.ts";
import type { Message } from "./thread-do.ts";

/** Handles named in one message at most, and mentions an inbox keeps. */
const NAMED = 10, KEPT = 200, PAGE = 50;

/** The handles `text` @mentions, each once, in order: `@sam`, not an email's `a@b` or `@agent`. */
export function mentioned(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/(?:^|[^\w@./-])@([a-z0-9]+(?:-[a-z0-9]+)*)/gi)) {
    const h = m[1]!.toLowerCase();
    if (h !== "agent" && !h.startsWith("agent-")) out.add(h);
  }
  return [...out].slice(0, NAMED);
}

/** Puts `message` in the inbox of everyone on the crew it names, but whoever said it. */
export async function mentionsIn(env: Env, owner: string, repo: string, thread: number, message: Message): Promise<string[]> {
  const named = mentioned(message.text).filter((h) => h !== message.who);
  if (!named.length) return [];
  const { results } = await env.DB.prepare(`SELECT name FROM collaborators WHERE owner = ? AND repo = ? AND name IN (${named.map(() => "?").join(", ")})`)
    .bind(owner, repo, ...named).all<{ name: string }>();
  const crew = new Set([owner, ...results.map((r) => r.name)]);
  const to = named.filter((h) => crew.has(h));
  if (to.length) await deliver(env, to, owner, repo, thread, message, message.text);
  return to;
}

/**
 * A crew member asked a thread's agent to go again (#3728): only the owner starts it, so the owner hears of it in their
 * inbox, under the asker's message, and their Go starts it.
 */
export const askOwner = (env: Env, owner: string, repo: string, thread: number, message: Message) =>
  deliver(env, [owner], owner, repo, thread, message, `wants the agent to pick this up again: ${message.text}`.slice(0, 4000));

/** Puts `message` in each of `to`'s inbox, saying `text`: once per message, the newest KEPT each. */
async function deliver(env: Env, to: string[], owner: string, repo: string, thread: number, message: Message, text: string) {
  const at = Date.now();
  await env.DB.batch(to.flatMap((h) => [
    env.DB.prepare("INSERT OR IGNORE INTO mentions (to_user, owner, repo, thread, n, by, kind, text, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(h, owner, repo, thread, message.n, message.who, message.kind, text, at),
    env.DB.prepare("DELETE FROM mentions WHERE to_user = ? AND id NOT IN (SELECT id FROM mentions WHERE to_user = ? ORDER BY id DESC LIMIT ?)").bind(h, h, KEPT),
  ]));
}

/** `user` opened thread `thread`: what named them there is seen. */
export const seeThread = (env: Env, user: string, owner: string, repo: string, thread: number) =>
  env.DB.prepare("UPDATE mentions SET seen_at = ? WHERE to_user = ? AND owner = ? AND repo = ? AND thread = ? AND seen_at IS NULL").bind(Date.now(), user, owner, repo, thread).run();

/** Still on the crew of a live repo: the only mentions that show. */
const SHOWN = `${liveRepo("m")} WHERE m.to_user = ? AND (m.owner = m.to_user OR EXISTS (SELECT 1 FROM collaborators c WHERE c.owner = m.owner AND c.repo = m.repo AND c.name = m.to_user))`;
const unread = async (env: Env, user: string) =>
  (await env.DB.prepare(`SELECT COUNT(*) AS n FROM mentions m ${SHOWN} AND m.seen_at IS NULL`).bind(Date.now(), user).first<number>("n")) ?? 0;

interface Row { id: number; owner: string; repo: string; thread: number; n: number; by: string; kind: string; text: string; at: number; seen_at: number | null }

const Seen = obj({ ids: opt(arr(int(1, 1e12), 500)) });

export async function mentionRoutes(req: Request, env: Env, p: string[], user: string | null): Promise<Response | null> {
  if (!(p[1] === "me" && p[2] === "mentions" && (!p[3] || (p[3] === "seen" && !p[4])))) return null;
  if (!user) return json({ error: "sign in first" }, 401);
  if (p[3] === "seen") {
    if (req.method !== "POST") return json({ error: "POST" }, 405);
    const b = need(await readBody(req), Seen);
    if (b instanceof Response) return b;
    const ids = b.ids ?? [];
    await env.DB.prepare(`UPDATE mentions SET seen_at = ? WHERE to_user = ? AND seen_at IS NULL${ids.length ? ` AND id IN (${ids.map(() => "?").join(", ")})` : ""}`)
      .bind(Date.now(), user, ...ids).run();
    return json({ unread: await unread(env, user) });
  }
  if (req.method !== "GET") return json({ error: "GET" }, 405);
  const { results } = await env.DB.prepare(`SELECT m.id, m.owner, m.repo, m.thread, m.n, m.by, m.kind, m.text, m.at, m.seen_at FROM mentions m ${SHOWN} ORDER BY m.id DESC LIMIT ${PAGE}`)
    .bind(Date.now(), user).all<Row>();
  const mentions = results.map(({ seen_at, ...m }) => ({ ...m, seen: seen_at !== null }));
  return json({ mentions, unread: await unread(env, user) });
}
