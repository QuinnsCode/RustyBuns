// Code city: every person gets a city instead of a contributions chart. Their
// public repos are districts and the files are buildings: height is line count,
// light is how recently lines landed there, and a building agents mostly wrote
// is another material from one people wrote. Whoever landed lines in the last
// few minutes walks its streets. play.html#c/:name renders it, as a mode of the game.
//   GET /api/users/:name/city       the city, laid out
//   GET /api/users/:name/city.png   its postcard (card.ts)
//   WS  /api/users/:name/city/ws    walk it with others: its owner and their followers (a GameRoom, "c/:name")
//   PUT /api/me/city {public}       switch your public city off, or back on
// Private repos are never in it, nor a visitor's dig that has expired.

import { handleFor, MAX_BYTES, readTree, toFile } from "./archive.ts";
import { renderCity } from "./card.ts";
import { json, type Env } from "./env.ts";

/** Districts and buildings a city holds at most, and how many files of a repo's git it looks through. */
const DISTRICTS = 9, BUILDINGS = 36, WALK = 400;
/** Who landed lines this recently is in town. */
export const PRESENT_MS = 15 * 60_000;
/** Lit fades by half about every five days without new lines. */
const FADE_MS = 7 * 86_400_000;
/** The street grid: a building's cell and footprint, and the street between districts. */
const CELL = 3, FOOT = 2.2, STREET = 6;

export interface Building { path: string; lines: number; agent: number; last: number | null; glow: number; x: number; z: number; w: number; h: number }
export interface District { repo: string; x: number; z: number; size: number; buildings: Building[] }
export interface City { name: string; public: boolean; districts: District[]; present: { who: string; repo: string; path: string; at: number }[]; files: number; lines: number }

/** A building's height for its line count: a one-liner is a kiosk, a 5000-line file a tower. */
export const heightOf = (lines: number) => Math.min(36, Math.round((1 + Math.sqrt(lines) * 0.5) * 10) / 10);

/** Lines in each file of the repo's git at the tip of its branch (up to WALK files), by path; blobs are counted once and kept. */
async function gitLines(env: Env, owner: string, repo: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const h = await handleFor(env, owner, repo).catch(() => null);
  if (!h) return out;
  try {
    const [tip] = await h.handle.log({ ref: h.branch, limit: 1 });
    if (!tip) return out;
    const blobs: { path: string; hash: string }[] = [];
    for (const dirs = [{ dir: "", hash: tip.treeHash }]; dirs.length && blobs.length < WALK;) {
      const { dir, hash } = dirs.shift()!;
      for (const e of (await readTree(env, h.handle, hash)) ?? []) {
        if (e.name.startsWith(".") || e.name === "node_modules") continue;
        const path = dir ? `${dir}/${e.name}` : e.name;
        if (e.type === "tree") dirs.push({ dir: path, hash: e.hash });
        else if ((e.type === "blob" || e.type === "exec") && blobs.length < WALK) blobs.push({ path, hash: e.hash });
      }
    }
    const known = new Map<string, number>();
    for (let i = 0; i < blobs.length; i += 50) {
      const hashes = blobs.slice(i, i + 50).map((b) => b.hash);
      const { results } = await env.DB.prepare(`SELECT hash, lines FROM blob_lines WHERE hash IN (${hashes.map(() => "?").join(",")})`).bind(...hashes).all();
      for (const r of results as { hash: string; lines: number }[]) known.set(r.hash, r.lines);
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
  return out;
}

/** One repo's buildings, before they're laid out: live files (their DO knows each line's author) first, then git's. */
async function buildings(env: Env, owner: string, repo: string, now: number) {
  const { results: live } = await env.DB.prepare("SELECT path FROM files WHERE owner = ? AND repo = ? ORDER BY path LIMIT ?").bind(owner, repo, BUILDINGS).all();
  const { results: events } = await env.DB.prepare(
    "SELECT path, MAX(last_at) AS last, SUM(lines) AS lines, SUM(CASE WHEN who LIKE 'agent-%' THEN lines ELSE 0 END) AS agent FROM line_events WHERE owner = ? AND repo = ? GROUP BY path")
    .bind(owner, repo).all();
  const landed = new Map((events as { path: string; last: number; lines: number; agent: number }[]).map((e) => [e.path, e]));
  const git = await gitLines(env, owner, repo);
  const paths = [...new Set([...(live as { path: string }[]).map((r) => r.path), ...git.keys()])].slice(0, BUILDINGS).sort();
  const out = await Promise.all(paths.map(async (path) => {
    let lines = git.get(path) ?? 0, agent = 0;
    if ((live as { path: string }[]).some((r) => r.path === path)) {
      // As a stranger reads it: a private line still counts, but nothing of it shows.
      const doc = await (await toFile(env, owner, repo, path, "codesplitters", "file", { headers: { "x-codesplitters-crew": "0" } })).json().catch(() => null) as { lines: { by: string }[] } | null;
      if (doc) { lines = doc.lines.length; agent = lines ? doc.lines.filter((l) => l.by.startsWith("agent-")).length / lines : 0; }
    } else {
      const e = landed.get(path);
      if (e?.lines) agent = e.agent / e.lines;
    }
    const last = landed.get(path)?.last ?? null;
    return { path, lines, agent: Math.round(agent * 100) / 100, last, glow: last ? Math.round(Math.exp(-(now - last) / FADE_MS) * 100) / 100 : 0 };
  }));
  return out.filter((b) => b.lines > 0);
}

/** Lay the districts out on a square grid of blocks, each its buildings on a square grid of cells, centred on the origin. */
export function layout(repos: { repo: string; buildings: Omit<Building, "x" | "z" | "w" | "h">[] }[]): District[] {
  const cols = Math.ceil(Math.sqrt(repos.length)), rows = Math.ceil(repos.length / cols);
  const size = Math.max(1, ...repos.map((r) => Math.ceil(Math.sqrt(r.buildings.length)))) * CELL, pitch = size + STREET;
  const ox = ((cols - 1) * pitch + size) / 2, oz = ((rows - 1) * pitch + size) / 2;
  return repos.map((r, i) => {
    const x = (i % cols) * pitch - ox, z = Math.floor(i / cols) * pitch - oz, k = Math.max(1, Math.ceil(Math.sqrt(r.buildings.length)));
    // A smaller district sits in the middle of its block.
    const pad = (size - k * CELL) / 2;
    return { repo: r.repo, x, z, size, buildings: r.buildings.map((b, j) => ({
      ...b, x: x + pad + (j % k) * CELL + CELL / 2, z: z + pad + Math.floor(j / k) * CELL + CELL / 2, w: FOOT, h: heightOf(b.lines),
    })) };
  });
}

/** `name`'s city as `viewer` may see it, or null when there's no such person or their public city is off (to anyone but them). */
export async function cityOf(env: Env, name: string, viewer: string | null): Promise<City | null> {
  const u = await env.DB.prepare("SELECT name, city_public FROM users WHERE name = ?").bind(name).first();
  if (!u || (!u.city_public && viewer !== name)) return null;
  const now = Date.now();
  const { results } = await env.DB.prepare(
    "SELECT name FROM repos WHERE owner = ? AND visibility = 'public' AND (expires_at IS NULL OR expires_at > ?) ORDER BY created_at DESC LIMIT ?").bind(name, now, DISTRICTS).all();
  const repos = (results as { name: string }[]).map((r) => r.name);
  const built = await Promise.all(repos.map(async (repo) => ({ repo, buildings: await buildings(env, name, repo, now) })));
  const districts = layout(built.filter((d) => d.buildings.length));
  // Who's in town: anyone who landed lines here lately, at the last place they did.
  const present = repos.length ? ((await env.DB.prepare(
    `SELECT who, repo, path, last_at AS at FROM line_events WHERE owner = ? AND repo IN (${repos.map(() => "?").join(",")}) AND last_at > ? ORDER BY last_at DESC`)
    .bind(name, ...repos, now - PRESENT_MS).all()).results as City["present"]).filter((e, i, all) => all.findIndex((o) => o.who === e.who) === i) : [];
  const all = districts.flatMap((d) => d.buildings);
  return { name, public: !!u.city_public, districts, present, files: all.length, lines: all.reduce((n, b) => n + b.lines, 0) };
}

/** Whether `viewer` may walk `name`'s city: it's theirs, or they follow its owner. */
const mayVisit = async (env: Env, name: string, viewer: string | null) =>
  !!viewer && (viewer === name || !!(await env.DB.prepare("SELECT 1 FROM follows WHERE follower = ? AND kind = 'user' AND target = ?").bind(viewer, name).first()));

export async function cityRoutes(req: Request, env: Env, p: string[], user: string | null): Promise<Response | null> {
  if (p[1] === "me" && p[2] === "city" && !p[3] && req.method === "PUT") {
    if (!user) return json({ error: "sign in first" }, 401);
    const body = (await req.json().catch(() => null)) as { public?: unknown } | null;
    if (typeof body?.public !== "boolean") return json({ error: "public: true or false" }, 400);
    await env.DB.prepare("UPDATE users SET city_public = ? WHERE name = ?").bind(body.public ? 1 : 0, user).run();
    return json({ public: body.public });
  }
  if (p[1] !== "users" || !p[2] || (p[3] !== "city" && p[3] !== "city.png") || req.method !== "GET") return null;
  const name = p[2];
  if (p[3] === "city" && p[4] === "ws") {
    if (!(await cityOf(env, name, user)) || !(await mayVisit(env, name, user))) return json({ error: "follow them to walk their city" }, 403);
    if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") return json({ error: "a WebSocket" }, 426);
    const h = new Headers(req.headers);
    h.set("x-codesplitters-user", user!);
    return env.GAMES.get(env.GAMES.idFromName(`c/${name}`)).fetch(new Request(req.url, { headers: h }));
  }
  if (p[4]) return null;
  const city = await cityOf(env, name, user);
  if (!city) return json({ error: "no public city here" }, 404);
  if (p[3] === "city") return json({ ...city, visit: await mayVisit(env, name, user) });
  // The postcard is the public city, whoever asks: a link to it unfurls the same for everyone.
  if (!city.public) return json({ error: "no public city here" }, 404);
  const png = await renderCity(city);
  return new Response(png, { headers: { "content-type": "image/png", "cache-control": "public, max-age=600" } });
}
