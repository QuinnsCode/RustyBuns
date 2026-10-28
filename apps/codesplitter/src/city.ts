// Code city: every person gets a city instead of a contributions chart. Their
// public repos are districts and the files are buildings: height is line count,
// light is how recently lines landed there, and a building agents mostly wrote
// is another material from one people wrote. Whoever has one of its files open
// right now walks its streets. play.html#c/:name renders it, as a mode of the game.
//   GET /api/users/:name/city       the city, laid out
//   GET /api/users/:name/city.png   its postcard (card.ts)
//   GET /api/users/:name/city/share a page for link previews (og:image is the postcard), sending people on to the city
//   WS  /api/users/:name/city/ws    walk it with others: its owner and their followers (a GameRoom, "c/:name")
//   PUT /api/me/city {public}       switch your public city off, or back on
// Private repos are never in it, nor a visitor's dig that has expired.
// Each district's pulse sets its streets going: a week of commits and edits fills
// its sidewalks, crosswalks and bike lanes, and failing checks put chaos in its traffic.

import { handleFor, MAX_BYTES, readTree, toFile } from "./archive.ts";
import { cleanAvatar, type Avatar } from "./avatar.ts";
import { renderCity } from "./card.ts";
import { json, readBody, type Env } from "./env.ts";
import { esc, plural } from "./util.ts";

/** Districts and buildings a city holds at most, and how many files of a repo's git it looks through. */
const DISTRICTS = 9, BUILDINGS = 36, WALK = 400;
/** Lit fades by half about every five days without new lines. */
const FADE_MS = 7 * 86_400_000;
/** The street grid: a building's cell and footprint (the gap is an alley), and the street between districts: two lanes and their sidewalks. city.js draws to these. */
const CELL = 4.2, FOOT = 2.6, STREET = 10;
/** A district's pulse looks back a week. */
const WEEK = 7 * 86_400_000;

export interface Building { path: string; lines: number; agent: number; last: number | null; glow: number; x: number; z: number; w: number; h: number }
/**
 * How a district's streets move. bustle (0-1) is how busy its sidewalks are, from a week of
 * commits and edits; chaos (0-1) is how wild its traffic is, from the checks failing now and the week's failure rate.
 */
export interface Pulse { commits: number; edits: number; passed: number; failed: number; failing: number; bustle: number; chaos: number }
export interface District { repo: string; x: number; z: number; size: number; buildings: Building[]; pulse: Pulse }
export interface City { name: string; public: boolean; districts: District[]; present: { who: string; repo: string; path: string; at: number; avatar?: Avatar }[]; files: number; lines: number }

/** A building's height for its line count: a one-liner is a kiosk, a 5000-line file a tower. */
export const heightOf = (lines: number) => Math.min(36, Math.round((1 + Math.sqrt(lines) * 0.5) * 10) / 10);

/** Lines in each file of the repo's git at the tip of its branch (up to WALK files), by path, and its commits this week (of its last 100); blobs are counted once and kept. */
async function gitLines(env: Env, owner: string, repo: string, now: number): Promise<{ lines: Map<string, number>; commits: number }> {
  const out = new Map<string, number>(), git = { lines: out, commits: 0 };
  const h = await handleFor(env, owner, repo).catch(() => null);
  if (!h) return git;
  try {
    const log = await h.handle.log({ ref: h.branch, limit: 100 });
    const tip = log[0];
    if (!tip) return git;
    git.commits = log.filter((c) => now - (c.authoredAt < 1e12 ? c.authoredAt * 1000 : c.authoredAt) < WEEK).length;
    const blobs: { path: string; hash: string }[] = [];
    // A level of directories at a time: their trees are read together.
    for (let dirs = [{ dir: "", hash: tip.treeHash }]; dirs.length && blobs.length < WALK;) {
      const level = await Promise.all(dirs.map(async (d) => ({ d, tree: (await readTree(env, h.handle, d.hash)) ?? [] })));
      dirs = [];
      for (const { d, tree } of level) for (const e of tree) {
        if (e.name.startsWith(".") || e.name === "node_modules") continue;
        const path = d.dir ? `${d.dir}/${e.name}` : e.name;
        if (e.type === "tree") dirs.push({ dir: path, hash: e.hash });
        else if ((e.type === "blob" || e.type === "exec") && blobs.length < WALK) blobs.push({ path, hash: e.hash });
      }
    }
    const known = new Map<string, number>();
    for (let i = 0; i < blobs.length; i += 50) {
      const hashes = blobs.slice(i, i + 50).map((b) => b.hash);
      const { results } = await env.DB.prepare(`SELECT hash, lines FROM blob_lines WHERE hash IN (${hashes.map(() => "?").join(",")})`).bind(...hashes).all<{ hash: string; lines: number }>();
      for (const r of results) known.set(r.hash, r.lines);
    }
    const count = async (hash: string) => {
      const blob = await h.handle.readBlob(hash).catch(() => null);
      if (!blob) return 0;
      // Too big to read: about forty bytes a line.
      if (blob.size > MAX_BYTES) return Math.round(blob.size / 40);
      const text = await blob.text();
      return text.includes("\u0000") ? 0 : text.replace(/\n$/, "").split("\n").length;
    };
    const todo = [...new Set(blobs.map((b) => b.hash).filter((x) => !known.has(x)))];
    for (let i = 0; i < todo.length; i += 16) await Promise.all(todo.slice(i, i + 16).map(async (hash) => {
      const n = await count(hash);
      known.set(hash, n);
      await env.DB.prepare("INSERT OR IGNORE INTO blob_lines (hash, lines) VALUES (?, ?)").bind(hash, n).run();
    }));
    // Binary files (no lines) aren't buildings.
    for (const b of blobs) if (known.get(b.hash)) out.set(b.path, known.get(b.hash)!);
  } catch {}
  return git;
}

/** A district's pulse: its week of commits and edits, and its checks (a check is failing when its latest finish this week failed). */
export function pulseOf(commits: number, edits: number, runs: { name: string; status: string }[]): Pulse {
  const passed = runs.filter((r) => r.status === "passed").length, failed = runs.length - passed;
  // runs come newest first: each check's first is its latest.
  const latest = new Map<string, string>();
  for (const r of runs) if (!latest.has(r.name)) latest.set(r.name, r.status);
  const failing = [...latest.values()].filter((s) => s === "failed").length;
  const round = (x: number) => Math.round(x * 100) / 100;
  return {
    commits, edits, passed, failed, failing,
    bustle: round(1 - Math.exp(-(commits + edits / 3) / 12)),
    chaos: round(Math.min(1, failing * 0.35 + (runs.length ? failed / runs.length : 0) * 0.5)),
  };
}

async function pulseIn(env: Env, owner: string, repo: string, commits: number, now: number): Promise<Pulse> {
  const since = now - WEEK;
  const edits = await env.DB.prepare("SELECT COUNT(*) AS n FROM line_events WHERE owner = ? AND repo = ? AND last_at > ?").bind(owner, repo, since).first<{ n: number }>();
  const { results } = await env.DB.prepare(
    "SELECT name, status FROM check_runs WHERE owner = ? AND repo = ? AND finished_at > ? AND status IN ('passed', 'failed') ORDER BY finished_at DESC LIMIT 200").bind(owner, repo, since).all<{ name: string; status: string }>();
  return pulseOf(commits, edits?.n ?? 0, results);
}

/** One repo's buildings, before they're laid out (live files first: their DO knows each line's author; then git's), and its pulse. */
async function buildings(env: Env, owner: string, repo: string, now: number) {
  const { results: live } = await env.DB.prepare("SELECT path FROM files WHERE owner = ? AND repo = ? ORDER BY path LIMIT ?").bind(owner, repo, BUILDINGS).all();
  const { results: events } = await env.DB.prepare(
    "SELECT path, MAX(last_at) AS last, SUM(lines) AS lines, SUM(CASE WHEN who LIKE 'agent-%' THEN lines ELSE 0 END) AS agent FROM line_events WHERE owner = ? AND repo = ? GROUP BY path")
    .bind(owner, repo).all();
  const landed = new Map((events as { path: string; last: number; lines: number; agent: number }[]).map((e) => [e.path, e]));
  const { lines: git, commits } = await gitLines(env, owner, repo, now);
  const paths = [...new Set([...(live as { path: string }[]).map((r) => r.path), ...git.keys()])].slice(0, BUILDINGS).sort();
  const out = await Promise.all(paths.map(async (path) => {
    let lines = git.get(path) ?? 0, agent = 0;
    if ((live as { path: string }[]).some((r) => r.path === path)) {
      // As a stranger reads it: a private line still counts, but nothing of it shows.
      const doc = await (await toFile(env, owner, repo, path, "codesplitters", "file", { headers: { "x-codesplitter-crew": "0" } })).json().catch(() => null) as { lines: { by: string }[] } | null;
      if (doc) { lines = doc.lines.length; agent = lines ? doc.lines.filter((l) => l.by.startsWith("agent-")).length / lines : 0; }
    } else {
      const e = landed.get(path);
      if (e?.lines) agent = e.agent / e.lines;
    }
    const last = landed.get(path)?.last ?? null;
    return { path, lines, agent: Math.round(agent * 100) / 100, last, glow: last ? Math.round(Math.exp(-(now - last) / FADE_MS) * 100) / 100 : 0 };
  }));
  return { buildings: out.filter((b) => b.lines > 0), pulse: await pulseIn(env, owner, repo, commits, now) };
}

/**
 * Who's in town: whoever has a file of these repos open now (file-do.ts keeps
 * the presence rows), at the file they opened last. Each file's DO says who is
 * really there, so a row a dropped socket left behind is cleared, not walked.
 */
async function presentIn(env: Env, owner: string, repos: string[]): Promise<City["present"]> {
  if (!repos.length) return [];
  const { results } = await env.DB.prepare(
    `SELECT who, repo, path, at FROM presence WHERE owner = ? AND repo IN (${repos.map(() => "?").join(",")}) ORDER BY at DESC`).bind(owner, ...repos).all();
  const rows = results as City["present"], files = new Map<string, Promise<string[] | null>>();
  for (const r of rows) {
    const key = `${r.repo}\n${r.path}`;
    if (!files.has(key)) files.set(key, toFile(env, owner, r.repo, r.path, "codesplitters", "here").then((res) => res.ok ? res.json() as Promise<string[]> : null).catch(() => null));
  }
  const out: City["present"] = [];
  for (const r of rows) {
    const here = await files.get(`${r.repo}\n${r.path}`)!;
    if (here && !here.includes(r.who)) {
      await env.DB.prepare("DELETE FROM presence WHERE owner = ? AND repo = ? AND path = ? AND who = ?").bind(owner, r.repo, r.path, r.who).run();
      continue;
    }
    if (!out.some((o) => o.who === r.who)) out.push(r);
  }
  // Each one wears the avatar they made (a person who made none is dressed from their name at the other end).
  if (out.length) {
    const { results: faces } = await env.DB.prepare(`SELECT name, avatar FROM users WHERE name IN (${out.map(() => "?").join(",")}) AND avatar != ''`).bind(...out.map((o) => o.who)).all();
    for (const f of faces as { name: string; avatar: string }[]) { const o = out.find((x) => x.who === f.name), a = cleanAvatar(JSON.parse(f.avatar)); if (o && a) o.avatar = a; }
  }
  return out;
}

/** Lay the districts out on a square grid of blocks, each its buildings on a square grid of cells, centred on the origin. */
export function layout(repos: { repo: string; buildings: Omit<Building, "x" | "z" | "w" | "h">[]; pulse?: Pulse }[]): District[] {
  const cols = Math.ceil(Math.sqrt(repos.length)), rows = Math.ceil(repos.length / cols);
  const size = Math.max(1, ...repos.map((r) => Math.ceil(Math.sqrt(r.buildings.length)))) * CELL, pitch = size + STREET;
  const ox = ((cols - 1) * pitch + size) / 2, oz = ((rows - 1) * pitch + size) / 2;
  return repos.map((r, i) => {
    const x = (i % cols) * pitch - ox, z = Math.floor(i / cols) * pitch - oz, k = Math.max(1, Math.ceil(Math.sqrt(r.buildings.length)));
    // A smaller district sits in the middle of its block.
    const pad = (size - k * CELL) / 2;
    return { repo: r.repo, x, z, size, pulse: r.pulse ?? pulseOf(0, 0, []), buildings: r.buildings.map((b, j) => ({
      ...b, x: x + pad + (j % k) * CELL + CELL / 2, z: z + pad + Math.floor(j / k) * CELL + CELL / 2, w: FOOT, h: heightOf(b.lines),
    })) };
  });
}

/** How long a built city is kept: its git walks and file DOs are the cost of a visit, and a minute-old skyline reads the same. */
const KEEP_MS = 60_000;

/** The person `name`, if `viewer` may see their city (it's public, or it's theirs). */
async function visible(env: Env, name: string, viewer: string | null) {
  const u = await env.DB.prepare("SELECT name, city_public FROM users WHERE name = ?").bind(name).first();
  return !u || (!u.city_public && viewer !== name) ? null : { public: !!u.city_public };
}

/** `name`'s districts, built at most once a KEEP_MS (public repos only, so every viewer shares them). */
async function districtsOf(env: Env, name: string, now: number): Promise<District[]> {
  const kept = await env.DB.prepare("SELECT body FROM city_cache WHERE name = ? AND built_at > ?").bind(name, now - KEEP_MS).first<{ body: string }>();
  if (kept) try { return JSON.parse(kept.body) as District[]; } catch {}
  const { results } = await env.DB.prepare(
    "SELECT name FROM repos WHERE owner = ? AND visibility = 'public' AND (expires_at IS NULL OR expires_at > ?) ORDER BY created_at DESC LIMIT ?").bind(name, now, DISTRICTS).all<{ name: string }>();
  const built = await Promise.all(results.map(async ({ name: repo }) => ({ repo, ...await buildings(env, name, repo, now) })));
  const districts = layout(built.filter((d) => d.buildings.length));
  await env.DB.prepare("INSERT OR REPLACE INTO city_cache (name, built_at, body) VALUES (?, ?, ?)").bind(name, now, JSON.stringify(districts)).run().catch(() => {});
  return districts;
}

/** `name`'s city as `viewer` may see it, or null when there's no such person or their public city is off (to anyone but them). */
export async function cityOf(env: Env, name: string, viewer: string | null): Promise<City | null> {
  const v = await visible(env, name, viewer);
  if (!v) return null;
  const districts = await districtsOf(env, name, Date.now());
  const present = await presentIn(env, name, districts.map((d) => d.repo));
  const all = districts.flatMap((d) => d.buildings);
  return { name, public: v.public, districts, present, files: all.length, lines: all.reduce((n, b) => n + b.lines, 0) };
}

/** Whether `viewer` may walk `name`'s city: it's theirs, or they follow its owner. */
const mayVisit = async (env: Env, name: string, viewer: string | null) =>
  !!viewer && (viewer === name || !!(await env.DB.prepare("SELECT 1 FROM follows WHERE follower = ? AND kind = 'user' AND target = ?").bind(viewer, name).first()));

export async function cityRoutes(req: Request, env: Env, p: string[], user: string | null): Promise<Response | null> {
  if (p[1] === "me" && p[2] === "city" && !p[3] && req.method === "PUT") {
    if (!user) return json({ error: "sign in first" }, 401);
    const body = await readBody<"public">(req);
    if (typeof body.public !== "boolean") return json({ error: "public: true or false" }, 400);
    await env.DB.prepare("UPDATE users SET city_public = ? WHERE name = ?").bind(body.public ? 1 : 0, user).run();
    return json({ public: body.public });
  }
  if (p[1] !== "users" || !p[2] || (p[3] !== "city" && p[3] !== "city.png") || req.method !== "GET") return null;
  const sharing = p[3] === "city" && p[4] === "share";
  const name = p[2];
  if (p[3] === "city" && p[4] === "ws") {
    if (!(await visible(env, name, user)) || !(await mayVisit(env, name, user))) return json({ error: "follow them to walk their city" }, 403);
    if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") return json({ error: "a WebSocket" }, 426);
    const h = new Headers(req.headers);
    h.set("x-codesplitter-user", user!);
    return env.GAMES.get(env.GAMES.idFromName(`c/${name}`)).fetch(new Request(req.url, { headers: h }));
  }
  if (p[4] && !sharing) return null;
  const city = await cityOf(env, name, user);
  if (!city) return json({ error: "no public city here" }, 404);
  if (sharing) {
    if (!city.public) return json({ error: "no public city here" }, 404);
    const url = new URL(req.url), title = `@${name}'s code city`, to = `/play.html#c/${encodeURIComponent(name)}`;
    const desc = `${plural(city.districts.length, "district")}, ${plural(city.files, "building")}, ${plural(city.lines, "line")}: a rainy night in miniature. Walk in on codeSplitter.`;
    const image = `${url.origin}/api/users/${encodeURIComponent(name)}/city.png?at=${Math.floor(Date.now() / 86_400_000)}`;
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}"><meta property="og:type" content="website"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${esc(image)}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:url" content="${esc(url.href)}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(title)}"><meta name="twitter:description" content="${esc(desc)}"><meta name="twitter:image" content="${esc(image)}">
<meta http-equiv="refresh" content="0; url=${to}"></head><body><a href="${to}">${esc(title)}</a></body></html>`;
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
  }
  if (p[3] === "city") return json({ ...city, visit: await mayVisit(env, name, user) });
  // The postcard is the public city, whoever asks: a link to it unfurls the same for everyone.
  if (!city.public) return json({ error: "no public city here" }, 404);
  const png = await renderCity(city);
  return new Response(png, { headers: { "content-type": "image/png", "cache-control": "public, max-age=600" } });
}
