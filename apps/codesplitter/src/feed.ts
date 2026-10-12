// The home feed: line events from everything you follow (follows.ts), grouped
// per person or agent run, like the file page's activity rail but across every
// file: "@ry rewrote 40 lines in hono/router.ts, 3 agents touched it after".
//
// Every line carries who wrote it and when, so main's copy of each file (file-do.ts)
// writes a row to line_events as edits land, folding one writer's burst into one
// row. No line text goes in. Read access is checked when the feed is read, so a
// private repo's events reach only its crew, however they were followed.
//
// Bring your own summarizer: one of the coding agents (harness.ts) reads your feed
// and writes the digest, which is what the home page shows first; the events sit
// one click behind each group. The agent gets the feed as you may read it, nothing more.
// On the hosted site the agent bills the site's keys, so only ADMINS may ask for a
// digest (#575); everyone still gets the raw feed.
//
//   GET  /api/me/feed?since=           {since, through, groups, stamps, digest}; since is ms, a week ago by default
//   GET  /api/me/feed/digest           your latest digest: {harness, status, since, through, text?, error?, at} or null
//   POST /api/me/feed/digest {harness, model?}  an agent digests what's new since the last one (202)

import { json, type Env } from "./env.ts";
import { listFollows, type Follow } from "./follows.ts";
import { HARNESSES, harnessCommand, type Harness } from "./harness.ts";
import { localSandbox, type Exec, type Sandbox } from "./agent-run.ts";
import { KEEP_MS } from "./line-events.ts";
import { containerSandbox } from "./sandbox.ts";
import { ADMINS_ONLY, adminsOnly, agentsUnavailable, hostedBudget, installedHarnesses } from "./agent-routes.ts";

const WEEK = 7 * 24 * 3600_000;
/** Events one feed read looks at. */
const EVENTS = 500;
/** Stamps one feed read shows. */
const STAMPS = 50;

/** A stamp on a line (stamps.ts): `by` stamped `author`'s line. */
export interface FeedStamp { owner: string; repo: string; path: string; line: string; stamp: string; by: string; author: string; created_at: number }

export interface LineEvent {
  id: number; owner: string; repo: string; path: string;
  who: string; run: string | null;
  sets: number; inserts: number; deletes: number; lines: number;
  first_at: number; last_at: number;
}

export interface FileTouch {
  owner: string; repo: string; path: string; lines: number;
  /** Who edited it after this group was done with it: people and agent runs, by name. */
  after: { people: string[]; agents: number };
}

export interface Group {
  /** The agent run (run-<id>) or the person (or harness, for an agent with no run). */
  key: string;
  who: string; run: string | null; bot: boolean;
  lines: number; sets: number; inserts: number; deletes: number;
  first_at: number; last_at: number;
  files: FileTouch[];
  /** One line, the way the rail says it. */
  summary: string;
  /** The raw events behind it, newest first. */
  events: LineEvent[];
}

/** A follow's match on an event. A line follow needs one of its lines to be among the event's. */
function followed(e: LineEvent & { ids: string }, f: Follow) {
  if (f.kind === "repo") return e.owner === f.owner && e.repo === f.repo;
  if (f.kind !== "lines") return e.who === f.name;
  if (e.owner !== f.owner || e.repo !== f.repo || e.path !== f.path) return false;
  const want = new Set(f.ids);
  return (JSON.parse(e.ids) as string[]).some((id) => want.has(id));
}

const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;

function summarize(g: Omit<Group, "summary">) {
  const name = g.bot ? `${g.who.replace(/^agent-/, "")}${g.run ? " #" + g.run.replace(/^run-/, "") : ""}` : "@" + g.who;
  const verb = !g.sets && !g.inserts ? "removed" : !g.deletes && !g.sets ? "landed" : "rewrote";
  const [top] = g.files;
  const more = g.files.length > 1 ? ` and ${plural(g.files.length - 1, "more file")}` : "";
  const after = top!.after, them = [...after.people.map((p) => "@" + p), ...(after.agents ? [plural(after.agents, "agent")] : [])];
  return `${name} ${verb} ${plural(g.lines, "line")} in ${top!.repo}/${top!.path}${more}${them.length ? `, ${them.join(" and ")} touched it after` : ""}`;
}

/** `handle`'s feed since `since`: the events they follow and may read, grouped per person or agent run, newest first. */
export async function feedFor(env: Env, handle: string, since: number, follows?: Follow[]) {
  const now = Date.now();
  follows ??= await listFollows(env.DB, handle);
  if (!follows.length) return { since, through: now, follows: 0, groups: [] as Group[], stamps: [] as FeedStamp[] };
  const names = follows.flatMap((f) => f.kind === "user" || f.kind === "agent" ? [f.name] : []);
  const repos = follows.flatMap((f) => f.kind === "repo" ? [`${f.owner}/${f.repo}`] : []);
  const files = follows.flatMap((f) => f.kind === "lines" ? [`${f.owner}/${f.repo}/${f.path}`] : []);
  // Readable is checked here, against the repo as it is now: a repo gone private drops out of feeds that aren't its crew's.
  const readable = `JOIN repos r ON r.owner = e.owner AND r.name = e.repo AND (r.expires_at IS NULL OR r.expires_at > ?1)
    AND (r.visibility = 'public' OR r.owner = ?2 OR EXISTS (SELECT 1 FROM collaborators c WHERE c.owner = e.owner AND c.repo = e.repo AND c.name = ?2))`;
  // Stamps (stamps.ts): given by, or on lines written by, who you follow; in the repos you follow; on the lines you follow.
  const { results: stamped } = await env.DB.prepare(`SELECT e.owner, e.repo, e.path, e.line, e.stamp, e.by, e.author, e.created_at FROM stamps e ${readable}
    WHERE e.created_at > ?3 AND e.by != ?2 AND (e.by IN (SELECT value FROM json_each(?4)) OR e.author IN (SELECT value FROM json_each(?4))
      OR (e.owner || '/' || e.repo) IN (SELECT value FROM json_each(?5)) OR (e.owner || '/' || e.repo || '/' || e.path) IN (SELECT value FROM json_each(?6)))
    ORDER BY e.created_at DESC LIMIT ${STAMPS}`).bind(now, handle, since, JSON.stringify(names), JSON.stringify(repos), JSON.stringify(files)).all();
  const stamps = (stamped as FeedStamp[]).filter((s) => names.includes(s.by) || names.includes(s.author) || repos.includes(`${s.owner}/${s.repo}`)
    || follows!.some((f) => f.kind === "lines" && f.owner === s.owner && f.repo === s.repo && f.path === s.path && f.ids.includes(s.line)));
  const empty = { since, through: now, follows: follows.length, groups: [] as Group[], stamps };
  const { results } = await env.DB.prepare(`SELECT e.* FROM line_events e ${readable}
    WHERE e.last_at > ?3 AND e.who != ?2 AND (e.who IN (SELECT value FROM json_each(?4)) OR (e.owner || '/' || e.repo) IN (SELECT value FROM json_each(?5))
      OR (e.owner || '/' || e.repo || '/' || e.path) IN (SELECT value FROM json_each(?6)))
    ORDER BY e.last_at DESC LIMIT ${EVENTS}`).bind(now, handle, since, JSON.stringify(names), JSON.stringify(repos), JSON.stringify(files)).all();
  const events = (results as (LineEvent & { ids: string })[]).filter((e) => follows!.some((f) => followed(e, f)));
  if (!events.length) return empty;

  // Who came along after, on the same files: anyone, followed or not (the files are readable already).
  const touched = [...new Set(events.map((e) => `${e.owner}/${e.repo}/${e.path}`))];
  const { results: later } = await env.DB.prepare(`SELECT owner, repo, path, who, run, first_at FROM line_events
    WHERE last_at > ? AND (owner || '/' || repo || '/' || path) IN (SELECT value FROM json_each(?))`).bind(since, JSON.stringify(touched)).all();

  const groups = new Map<string, Omit<Group, "summary">>();
  for (const e of events) {
    const bot = e.who.startsWith("agent-"), key = e.run ?? e.who;
    let g = groups.get(key);
    if (!g) groups.set(key, g = { key, who: e.who, run: e.run, bot, lines: 0, sets: 0, inserts: 0, deletes: 0, first_at: e.first_at, last_at: e.last_at, files: [], events: [] });
    const { ids: _, ...raw } = e;
    g.events.push(raw);
    g.lines += e.lines; g.sets += e.sets; g.inserts += e.inserts; g.deletes += e.deletes;
    g.first_at = Math.min(g.first_at, e.first_at); g.last_at = Math.max(g.last_at, e.last_at);
    let f = g.files.find((x) => x.owner === e.owner && x.repo === e.repo && x.path === e.path);
    if (!f) g.files.push(f = { owner: e.owner, repo: e.repo, path: e.path, lines: 0, after: { people: [], agents: 0 } });
    f.lines += e.lines;
  }
  for (const g of groups.values()) {
    for (const f of g.files) {
      const done = Math.max(...g.events.filter((e) => e.owner === f.owner && e.repo === f.repo && e.path === f.path).map((e) => e.last_at));
      const next = (later as { owner: string; repo: string; path: string; who: string; run: string | null; first_at: number }[])
        .filter((x) => x.owner === f.owner && x.repo === f.repo && x.path === f.path && x.first_at >= done && (x.run ?? x.who) !== g.key);
      f.after = {
        people: [...new Set(next.filter((x) => !x.who.startsWith("agent-")).map((x) => x.who))],
        agents: new Set(next.filter((x) => x.who.startsWith("agent-")).map((x) => x.run ?? x.who)).size,
      };
    }
    g.files.sort((a, b) => b.lines - a.lines);
  }
  return { ...empty, groups: [...groups.values()].map((g) => ({ ...g, summary: summarize(g) })).sort((a, b) => b.last_at - a.last_at) };
}

/** The feed as the digest agent reads it: one line per group, its files and raw events under it. */
export function feedText(feed: Awaited<ReturnType<typeof feedFor>>) {
  const at = (t: number) => new Date(t).toISOString().slice(0, 16).replace("T", " ");
  return [
    `# Feed, ${at(feed.since)} to ${at(feed.through)} UTC`,
    "",
    ...feed.groups.flatMap((g) => [
      `## ${g.summary}`,
      ...g.files.map((f) => `- ${f.owner}/${f.repo}/${f.path}: ${plural(f.lines, "line")}`),
      ...g.events.map((e) => `  - ${at(e.first_at)}–${at(e.last_at).slice(11)} ${e.owner}/${e.repo}/${e.path}: ${e.sets} edited, ${e.inserts} added, ${e.deletes} removed`),
      "",
    ]),
    ...(feed.stamps.length ? ["## Stamps", ...feed.stamps.map((s) => `- ${at(s.created_at)} @${s.by} stamped ${s.stamp} on @${s.author}'s line in ${s.owner}/${s.repo}/${s.path}`), ""] : []),
  ].join("\n");
}

/** What the digest agent is told. It edits FEED.md in place, as every harness edits a file. */
export const digestPrompt = (handle: string) => [
  `FEED.md in the current directory is @${handle}'s code feed: who changed which files on codeSplitter, and when, grouped per person or agent run.`,
  `Rewrite FEED.md in place as a short digest for @${handle}: a few plain sentences, then at most eight bullets, the most interesting first.`,
  `Say who did what where, name agents as agents, and point out files many hands touched. Don't invent anything that isn't in the feed.`,
  `Keep it under 200 words. Do not add files, and do not run git commands.`,
].join("\n");

/** A JOBS message that runs `digest`'s agent on Cloudflare. */
export interface DigestMessage { digest: string }

type Row = { name: string; harness: Harness; status: string; since: number; through: number; text: string | null; error: string | null; at: number };
const digestOf = (env: Env, handle: string) => env.DB.prepare("SELECT name, harness, status, since, through, text, error, at FROM feed_digests WHERE name = ?").bind(handle).first() as Promise<Row | null>;

export async function feedRoutes(req: Request, env: Env, p: string[], url: URL, user: string | null): Promise<Response | null> {
  if (!(p[1] === "me" && p[2] === "feed")) return null;
  if (!user) return json({ error: "sign in first" }, 401);
  if (!p[3] && req.method === "GET") {
    const now = Date.now(), raw = url.searchParams.get("since");
    const since = raw === null ? now - WEEK : Number(raw);
    if (!Number.isFinite(since)) return json({ error: "since: ms since the epoch" }, 400);
    return json({ ...(await feedFor(env, user, Math.max(since, now - KEEP_MS))), digest: await digestOf(env, user) });
  }
  if (p[3] !== "digest" || p[4]) return null;
  if (req.method === "GET") return json(await digestOf(env, user));
  if (req.method !== "POST") return null;
  const why = agentsUnavailable(env);
  if (why) return json({ error: why }, 501);
  // Hosted digests bill the site's own keys: admins only, as with coding agents.
  if (adminsOnly(env, user)) return json({ error: ADMINS_ONLY }, 403);
  const { harness, model } = (await req.json().catch(() => ({}))) as { harness?: Harness; model?: string };
  if (!harness || !HARNESSES.includes(harness)) return json({ error: `harness: ${HARNESSES.join(", ")}` }, 400);
  if (!installedHarnesses(env).includes(harness)) return json({ error: `${harness} isn't installed on this machine` }, 400);
  const now = Date.now(), last = await digestOf(env, user);
  if (last?.status === "running" && now - last.at < 15 * 60_000) return json({ error: "a digest is already being written" }, 409);
  const spent = await hostedBudget(env);
  if (spent) return spent;
  // What's new since the last digest that worked; a week the first time.
  const since = Math.max(last?.status === "done" ? last.through : now - WEEK, now - KEEP_MS);
  await env.DB.prepare(`INSERT INTO feed_digests (name, harness, status, since, through, text, error, at) VALUES (?, ?, 'running', ?, ?, NULL, NULL, ?)
    ON CONFLICT (name) DO UPDATE SET harness = excluded.harness, status = 'running', since = excluded.since, through = excluded.through, error = NULL, at = excluded.at`)
    .bind(user, harness, since, now, now).run();
  const job = { handle: user, harness, model: model?.trim() || undefined };
  if (env.AGENT_SANDBOX) await env.JOBS.send({ digest: JSON.stringify(job) } satisfies DigestMessage);
  else void writeDigest(env, job);
  return json(await digestOf(env, user), 202);
}

/** The JOBS queue's digest messages (worker.ts). */
export async function runQueuedDigests(messages: readonly { body: DigestMessage; ack(): void }[], env: Env) {
  await Promise.all(messages.map(async (m) => { await writeDigest(env, JSON.parse(m.body.digest)).catch(() => {}); m.ack(); }));
}

/** Runs the agent on `handle`'s feed and keeps what it wrote. A digest of nothing needs no agent. */
export async function writeDigest(env: Env, job: { handle: string; harness: Harness; model?: string }, sandbox?: Sandbox) {
  const row = await digestOf(env, job.handle);
  if (!row || row.status !== "running") return;
  const end = (status: "done" | "failed", text: string | null, error: string | null) =>
    env.DB.prepare("UPDATE feed_digests SET status = ?, text = ?, error = ? WHERE name = ? AND at = ?").bind(status, text, error, job.handle, row.at).run();
  try {
    const feed = await feedFor(env, job.handle, row.since);
    if (!feed.groups.length) return void await end("done", feed.follows ? "Nothing new from who and what you follow." : "You don't follow anyone or anything yet.", null);
    const box = sandbox ?? (env.AGENT_SANDBOX ? containerSandbox(env.AGENT_SANDBOX) : localSandbox(env.AGENT_EXEC as Exec | undefined));
    const run = await box(harnessCommand(job.harness, digestPrompt(job.handle), { model: job.model }), { path: "FEED.md", text: feedText(feed) + "\n" });
    if (run.code !== 0) throw new Error(`${job.harness} exited ${run.code}: ${run.out.trim().slice(-1000)}`);
    const text = (run.text ?? "").trim();
    if (!text || text === feedText(feed).trim()) throw new Error(`${job.harness} left the feed as it was`);
    await end("done", text.slice(0, 8000), null);
  } catch (e) {
    await end("failed", null, String((e as Error)?.message ?? e).slice(-2000));
  }
}
