// gitcode: a code host where each file is a Durable Object and your profile
// is a playlist of code you like. Plain fetch handler: it runs as a Worker on
// Cloudflare and in-process under Bun on the desktop.
//
// Identity is a name in a cookie. That is a proof of concept, not auth.

import { fromText } from "./lines.ts";
import { push } from "./git.ts";
export { FileDurableObject } from "./file-do.ts";

interface Env {
  DB: any;
  FILES: { idFromName(n: string): unknown; get(id: unknown): { fetch(r: Request): Promise<Response> } };
  /** Cloudflare Artifacts (a bare-repo twin on the desktop). Optional: without it, nothing is pushed. */
  ARTIFACTS?: {
    create(name: string, opts?: { description?: string; setDefaultBranch?: string }): Promise<{ name: string; remote: string }>;
    get(name: string): Promise<{
      info(): Promise<{ remote?: string }>;
      createToken(scope?: "read" | "write", ttl?: number): Promise<{ plaintext: string }>;
    }>;
  };
}

const json = (v: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json", ...headers } });
// Single dashes only, so "owner--repo" names an artifact unambiguously.
const NAME = /^(?=.{1,39}$)[a-z0-9]+(-[a-z0-9]+)*$/;

function who(req: Request) {
  const m = /(?:^|;\s*)gc_user=([a-z0-9-]+)/.exec(req.headers.get("cookie") ?? "");
  return m?.[1] ?? null;
}

async function access(env: Env, owner: string, repo: string, user: string | null) {
  const r = await env.DB.prepare("SELECT visibility FROM repos WHERE owner = ? AND name = ?").bind(owner, repo).first();
  if (!r) return { read: false, write: false, exists: false };
  const collab = user ? await env.DB.prepare("SELECT 1 FROM collaborators WHERE owner = ? AND repo = ? AND name = ?").bind(owner, repo, user).first() : null;
  const write = user === owner || !!collab;
  return { read: r.visibility === "public" || write, write, exists: true };
}

const fileStub = (env: Env, owner: string, repo: string, path: string) =>
  env.FILES.get(env.FILES.idFromName(`${owner}/${repo}/${path}`));

/** Call the file's DO as `user`. */
function toFile(env: Env, owner: string, repo: string, path: string, user: string, op: string, init: RequestInit = {}, search = "") {
  const headers = new Headers(init.headers);
  headers.set("x-gitcode-user", user);
  return fileStub(env, owner, repo, path).fetch(new Request(`https://file/${op}${search}`, { ...init, headers }));
}

/** The artifact repo's remote and a fresh token for it, or null if the repo has none. */
async function artifact(env: Env, owner: string, repo: string, scope: "read" | "write", ttl: number) {
  const r = await env.DB.prepare("SELECT artifact, artifact_remote FROM repos WHERE owner = ? AND name = ?").bind(owner, repo).first();
  if (!env.ARTIFACTS || !r?.artifact) return null;
  const handle = await env.ARTIFACTS.get(r.artifact);
  const [info, token] = await Promise.all([handle.info().catch(() => ({} as { remote?: string })), handle.createToken(scope, ttl)]);
  return { remote: (info.remote ?? r.artifact_remote) as string, token: token.plaintext };
}

/** Push every catalogued file in the repo to its artifact as one commit. */
async function pushArchive(env: Env, owner: string, repo: string, author: string, message: string) {
  const a = await artifact(env, owner, repo, "write", 300);
  if (!a) return null;
  const { results } = await env.DB.prepare("SELECT path, content FROM file_search WHERE owner = ? AND repo = ?").bind(owner, repo).all();
  const files = Object.fromEntries(results.map((f: any) => [f.path, f.content.endsWith("\n") ? f.content : f.content + "\n"]));
  return { remote: a.remote, ...(await push(a.remote, a.token, { files, message, author })) };
}

// FTS5 treats punctuation as syntax; quote every word so a search is just words.
const ftsQuery = (q: string) => q.split(/\s+/).filter(Boolean).map((w) => `"${w.replace(/"/g, '""')}"`).join(" ");

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const p = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    const user = who(req);
    const body = async <T>() => (await req.json()) as T;
    if (p[0] !== "api") return new Response("not found", { status: 404 });

    // POST /api/login {name}
    if (p[1] === "login" && req.method === "POST") {
      const { name } = await body<{ name: string }>();
      if (!NAME.test(name ?? "")) return json({ error: "name: lowercase letters and digits, single dashes between" }, 400);
      await env.DB.prepare("INSERT OR IGNORE INTO users (name) VALUES (?)").bind(name).run();
      return json({ name }, 200, { "set-cookie": `gc_user=${name}; Path=/; SameSite=Lax` });
    }

    // GET|PUT /api/me
    if (p[1] === "me") {
      if (!user) return json({ error: "log in first" }, 401);
      if (req.method === "PUT") {
        const { bio = "", theme_html = "" } = await body<{ bio?: string; theme_html?: string }>();
        await env.DB.prepare("UPDATE users SET bio = ?, theme_html = ? WHERE name = ?").bind(bio, theme_html, user).run();
      }
      return json(await env.DB.prepare("SELECT * FROM users WHERE name = ?").bind(user).first());
    }

    // GET /api/users/:name  profile, the repos you may see, playlists
    if (p[1] === "users" && p[2]) {
      const u = await env.DB.prepare("SELECT * FROM users WHERE name = ?").bind(p[2]).first();
      if (!u) return json({ error: "no such user" }, 404);
      const { results: repos } = await env.DB.prepare(
        "SELECT * FROM repos WHERE owner = ? AND (visibility = 'public' OR owner = ?) ORDER BY created_at DESC").bind(p[2], user).all();
      const { results: playlists } = await env.DB.prepare("SELECT * FROM playlists WHERE owner = ? ORDER BY id DESC").bind(p[2]).all();
      return json({ user: u, repos, playlists });
    }

    // POST /api/repos {name, visibility}
    if (p[1] === "repos" && !p[2] && req.method === "POST") {
      if (!user) return json({ error: "log in first" }, 401);
      const { name, visibility = "public" } = await body<{ name: string; visibility?: string }>();
      if (!NAME.test(name ?? "")) return json({ error: "bad repo name" }, 400);
      if (visibility !== "public" && visibility !== "private") return json({ error: "visibility: public or private" }, 400);
      await env.DB.prepare("INSERT INTO repos (owner, name, visibility, created_at) VALUES (?, ?, ?, ?)").bind(user, name, visibility, Date.now()).run();
      if (env.ARTIFACTS) {
        // One artifact repo per excavation; "--" can't appear in either name, so it can't collide.
        const art = await env.ARTIFACTS.create(`${user}--${name}`, { description: `gitcode ${user}/${name}`, setDefaultBranch: "main" });
        await env.DB.prepare("UPDATE repos SET artifact = ?, artifact_remote = ? WHERE owner = ? AND name = ?").bind(art.name, art.remote, user, name).run();
      }
      return json({ owner: user, name, visibility }, 201);
    }

    if (p[1] === "repos" && p[2] && p[3]) {
      const [owner, repo] = [p[2], p[3]];
      const a = await access(env, owner, repo, user);
      // A private repo you can't see looks the same as one that doesn't exist.
      if (!a.read) return json({ error: "not found" }, 404);

      // GET /api/repos/:o/:r
      if (!p[4] && req.method === "GET") {
        const r = await env.DB.prepare("SELECT * FROM repos WHERE owner = ? AND name = ?").bind(owner, repo).first();
        const { results: files } = await env.DB.prepare("SELECT path FROM files WHERE owner = ? AND repo = ? ORDER BY path").bind(owner, repo).all();
        const { results: collaborators } = await env.DB.prepare("SELECT name FROM collaborators WHERE owner = ? AND repo = ?").bind(owner, repo).all();
        // Anyone who can read the repo can clone its artifact, with an hour-long read token.
        const art = await artifact(env, owner, repo, "read", 3600).catch(() => null);
        const clone = art && `git clone ${art.remote.replace("://", `://x:${art.token.split("?")[0]}@`)} ${repo}`;
        const { artifact: _, artifact_remote: __, ...pub } = r;
        return json({ ...pub, files: files.map((f: any) => f.path), collaborators: collaborators.map((c: any) => c.name), canWrite: a.write, clone });
      }
      // POST /api/repos/:o/:r/collaborators {name}  (owner only; this is how agents get in)
      if (p[4] === "collaborators" && req.method === "POST") {
        if (user !== owner) return json({ error: "owner only" }, 403);
        const { name } = await body<{ name: string }>();
        if (!NAME.test(name ?? "")) return json({ error: "bad name" }, 400);
        await env.DB.prepare("INSERT OR IGNORE INTO users (name) VALUES (?)").bind(name).run();
        await env.DB.prepare("INSERT OR IGNORE INTO collaborators (owner, repo, name) VALUES (?, ?, ?)").bind(owner, repo, name).run();
        return json({ ok: true });
      }
      // POST /api/repos/:o/:r/files {path, content}
      if (p[4] === "files" && req.method === "POST") {
        if (!a.write) return json({ error: "no write access" }, 403);
        const { path, content = "" } = await body<{ path: string; content?: string }>();
        if (!path || path.length > 200 || path.includes("..")) return json({ error: "bad path" }, 400);
        const r = await env.DB.prepare("INSERT OR IGNORE INTO files (owner, repo, path) VALUES (?, ?, ?)").bind(owner, repo, path).run();
        if (!r.meta?.changes) return json({ error: "file exists" }, 409);
        await toFile(env, owner, repo, path, user!, "ops", { method: "POST", body: JSON.stringify({ ops: fromText(content) }) });
        return json({ path }, 201);
      }
      // /api/repos/:o/:r/do/(file|ops|log|at|commit|commits|ws)?path=...  -> the file's DO
      if (p[4] === "do" && p[5]) {
        const path = url.searchParams.get("path") ?? "";
        if (!(await env.DB.prepare("SELECT 1 FROM files WHERE owner = ? AND repo = ? AND path = ?").bind(owner, repo, path).first()))
          return json({ error: "no such file" }, 404);
        const writes = p[5] === "ops" || p[5] === "commit";
        if (writes && !a.write) return json({ error: "no write access" }, 403);
        if (p[5] === "ws") return fileStub(env, owner, repo, path).fetch(req);
        const res = await toFile(env, owner, repo, path, user ?? "anon", p[5], { method: req.method, body: writes ? await req.text() : undefined },
          url.searchParams.has("rev") ? `?rev=${url.searchParams.get("rev")}` : url.searchParams.has("since") ? `?since=${url.searchParams.get("since")}` : "");
        if (p[5] === "commit" && res.ok) {
          // Index what was committed, not every keystroke.
          const { commit, content } = (await res.json()) as { commit: { message: string }; content: string };
          await env.DB.batch([
            env.DB.prepare("DELETE FROM file_search WHERE owner = ? AND repo = ? AND path = ?").bind(owner, repo, path),
            env.DB.prepare("INSERT INTO file_search (owner, repo, path, content) VALUES (?, ?, ?, ?)").bind(owner, repo, path, content),
          ]);
          // The catalogue entry stands even if the push fails; the next one carries it.
          const git = await pushArchive(env, owner, repo, user!, commit.message).catch((e: Error) => ({ error: e.message }));
          return json({ ...commit, git });
        }
        return res;
      }
    }

    // GET /api/search?q=  committed code you are allowed to see
    if (p[1] === "search") {
      const q = ftsQuery(url.searchParams.get("q") ?? "");
      if (!q) return json([]);
      const { results } = await env.DB.prepare(`
        SELECT s.owner, s.repo, s.path, snippet(file_search, 3, '«', '»', '…', 16) AS snippet
        FROM file_search s JOIN repos r ON r.owner = s.owner AND r.name = s.repo
        WHERE file_search MATCH ? AND (r.visibility = 'public' OR r.owner = ?
          OR EXISTS (SELECT 1 FROM collaborators c WHERE c.owner = r.owner AND c.repo = r.name AND c.name = ?))
        ORDER BY rank LIMIT 20`).bind(q, user, user).all();
      return json(results);
    }

    // POST /api/playlists {title}
    if (p[1] === "playlists" && !p[2] && req.method === "POST") {
      if (!user) return json({ error: "log in first" }, 401);
      const { title } = await body<{ title: string }>();
      if (!title?.trim()) return json({ error: "title required" }, 400);
      const r = await env.DB.prepare("INSERT INTO playlists (owner, title) VALUES (?, ?) RETURNING id").bind(user, title.trim().slice(0, 80)).first();
      return json({ id: r.id, owner: user, title }, 201);
    }
    // POST /api/playlists/:id/tracks {owner, repo, path, from, to, note}
    if (p[1] === "playlists" && p[2] && p[3] === "tracks" && req.method === "POST") {
      const pl = await env.DB.prepare("SELECT * FROM playlists WHERE id = ?").bind(Number(p[2])).first();
      if (!pl || pl.owner !== user) return json({ error: "not your playlist" }, 403);
      const t = await body<{ owner: string; repo: string; path: string; from: number; to: number; note?: string }>();
      if (!(await access(env, t.owner, t.repo, user)).read) return json({ error: "not found" }, 404);
      const from = Math.max(1, Math.floor(t.from)), to = Math.max(from, Math.floor(t.to));
      const doc = await (await toFile(env, t.owner, t.repo, t.path, user, "file")).json() as { lines?: { id: string }[] };
      const first = doc.lines?.[from - 1], last = doc.lines?.[Math.min(to, doc.lines.length) - 1];
      if (!first || !last) return json({ error: "no such lines" }, 400);
      await env.DB.prepare("INSERT INTO tracks (playlist, owner, repo, path, from_line, to_line, from_id, to_id, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(pl.id, t.owner, t.repo, t.path, from, to, first.id, last.id, (t.note ?? "").slice(0, 280)).run();
      return json({ ok: true }, 201);
    }
    // GET /api/playlists/:id  each track with its lines as they are now
    if (p[1] === "playlists" && p[2] && req.method === "GET") {
      const pl = await env.DB.prepare("SELECT * FROM playlists WHERE id = ?").bind(Number(p[2])).first();
      if (!pl) return json({ error: "not found" }, 404);
      const { results } = await env.DB.prepare("SELECT * FROM tracks WHERE playlist = ? ORDER BY id").bind(pl.id).all();
      const tracks = await Promise.all(results.map(async (t: any) => {
        // A track pointing into a repo that went private just disappears for you.
        if (!(await access(env, t.owner, t.repo, user)).read) return null;
        const doc = await (await toFile(env, t.owner, t.repo, t.path, user ?? "anon", "file")).json() as { lines: { id: string; text: string; by: string }[] };
        // Follow the lines by id; if either end was deleted, fall back to the numbers.
        const i = doc.lines.findIndex((l) => l.id === t.from_id), j = doc.lines.findIndex((l) => l.id === t.to_id);
        const [a, b] = i >= 0 && j >= i ? [i, j + 1] : [t.from_line - 1, t.to_line];
        return { ...t, from_line: a + 1, to_line: b, lines: doc.lines.slice(a, b) };
      }));
      return json({ ...pl, tracks: tracks.filter(Boolean) });
    }

    return json({ error: "not found" }, 404);
  },
};
