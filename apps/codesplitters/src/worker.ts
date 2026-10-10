// codeSplitters: a code host where each file is a Durable Object and your profile
// is a playlist of code you like. Plain fetch handler: it runs as a Worker on
// Cloudflare and in-process under Bun on the desktop.

import { fromText } from "./lines.ts";
import { fileStub, handleFor, access as artifactAccess, listDir, materialize, pushCatalogue, toFile } from "./archive.ts";
import { code, json, NAME, type Env } from "./env.ts";
import { identityRoutes, identify, isAdmin } from "./identity.ts";
import { levelRoutes } from "./levels.ts";
import { githubRoutes } from "./github.ts";
import { gameRoutes } from "./game.ts";
import { createShare, shareRoutes } from "./shares.ts";
import { createCut, cutRoutes } from "./cuts.ts";
import { branchRoutes, createOn, materializeOn, openBranch } from "./branches.ts";
import { agentRoutes } from "./agent-routes.ts";
import { depRoutes, scheduledDoctor } from "./deps.ts";
import { limit, limitRoutes, ruleFor, RULES, sweepLimits } from "./limits.ts";
import { previewRoutes } from "./preview.ts";
import { deployOnCommit, deployRoutes } from "./deploy.ts";
import { repoFit } from "./fit.ts";
export { FileDurableObject } from "./file-do.ts";
export { GameRoom } from "./game-do.ts";
export { AgentSandbox } from "./sandbox.ts";

async function access(env: Env, owner: string, repo: string, user: string | null) {
  // A visitor's dig that has expired is gone, swept or not.
  const r = await env.DB.prepare("SELECT visibility FROM repos WHERE owner = ? AND name = ? AND (expires_at IS NULL OR expires_at > ?)").bind(owner, repo, Date.now()).first();
  if (!r) return { read: false, write: false, exists: false };
  const collab = user ? await env.DB.prepare("SELECT 1 FROM collaborators WHERE owner = ? AND repo = ? AND name = ?").bind(owner, repo, user).first() : null;
  const write = user === owner || !!collab;
  return { read: r.visibility === "public" || write, write, exists: true };
}

// What a page or agent may ask a file's DO directly; forks and merges go through the branch routes.
const DO_ROUTES = new Set(["file", "ops", "log", "at", "commit", "commits", "ws", "private"]);

// FTS5 treats punctuation as syntax; quote every word so a search is just words.
const ftsQuery = (q: string) => q.split(/\s+/).filter(Boolean).map((w) => `"${w.replace(/"/g, '""')}"`).join(" ");

const app = {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const p = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    if (p[0] !== "api") return new Response("not found", { status: 404 });

    // Rules counted by IP (signing in, signing up, claiming a handle) go before
    // anyone is known; the rest count against the handle.
    const rule = ruleFor(req.method, p), byIp = RULES.find((r) => r.name === rule)?.per === "ip";
    const early = byIp ? await limit(req, env, rule, null, false) : null;
    if (early) return early;
    const ident = await identityRoutes(req, env, p);
    if (ident) return ident;
    const user = await identify(req, env);
    const slow = byIp ? null : await limit(req, env, rule, user, isAdmin(env, user));
    if (slow) return slow;
    const limits = await limitRoutes(req, env, p, isAdmin(env, user));
    if (limits) return limits;
    const body = async <T>() => (await req.json()) as T;

    const levels = await levelRoutes(req, env, p, url, user, isAdmin(env, user));
    if (levels) return levels;
    const github = await githubRoutes(req, env, p, user);
    if (github) return github;
    const game = await gameRoutes(req, env, p, url, user, async (o, r) => (await access(env, o, r, user)).read);
    if (game) return game;
    const share = await shareRoutes(req, env, p, user);
    if (share) return share;
    const cut = await cutRoutes(req, env, p, url, user);
    if (cut) return cut;
    const agents = await agentRoutes(req, env, p, url, user, async (o, r) => (await access(env, o, r, user)).read, (r) => app.fetch(r, env));
    if (agents) return agents;
    const deps = await depRoutes(req, env, p, url, user, (r) => app.fetch(r, env));
    if (deps) return deps;
    const preview = await previewRoutes(req, env, p, user);
    if (preview) return preview;
    const deploy = await deployRoutes(req, env, p, user);
    if (deploy) return deploy;

    // GET|PUT /api/me
    if (p[1] === "me") {
      if (!user) return json({ error: "sign in first" }, 401);
      if (req.method === "PUT") {
        const { bio = "", theme_html = "" } = await body<{ bio?: string; theme_html?: string }>();
        await env.DB.prepare("UPDATE users SET bio = ?, theme_html = ? WHERE name = ?").bind(bio, theme_html, user).run();
      }
      return json(await env.DB.prepare("SELECT * FROM users WHERE name = ?").bind(user).first());
    }

    // GET /api/users/:name  profile, the repos you may see, playlists
    if (p[1] === "users" && p[2]) {
      const u = await env.DB.prepare("SELECT name, bio, theme_html FROM users WHERE name = ?").bind(p[2]).first();
      if (!u) return json({ error: "no such user" }, 404);
      const { results: repos } = await env.DB.prepare(
        "SELECT owner, name, visibility, level, created_at, expires_at FROM repos WHERE owner = ? AND (visibility = 'public' OR owner = ?) AND (expires_at IS NULL OR expires_at > ?) ORDER BY created_at DESC").bind(p[2], user, Date.now()).all();
      const { results: playlists } = await env.DB.prepare("SELECT * FROM playlists WHERE owner = ? ORDER BY id DESC").bind(p[2]).all();
      return json({ user: u, repos, playlists });
    }

    // POST /api/repos {name, visibility}
    if (p[1] === "repos" && !p[2] && req.method === "POST") {
      if (!user) return json({ error: "sign in first" }, 401);
      const { name, visibility = "public" } = await body<{ name: string; visibility?: string }>();
      if (!NAME.test(name ?? "")) return json({ error: "bad repo name" }, 400);
      if (visibility !== "public" && visibility !== "private") return json({ error: "visibility: public or private" }, 400);
      await env.DB.prepare("INSERT INTO repos (owner, name, visibility, created_at, branch) VALUES (?, ?, ?, ?, 'main')").bind(user, name, visibility, Date.now()).run();
      if (env.ARTIFACTS) {
        // One artifact repo per excavation; "--" can't appear in either name, so it can't collide.
        const art = await env.ARTIFACTS.create(`${user}--${name}`, { description: `codeSplitters ${user}/${name}`, setDefaultBranch: "main" });
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
        const r = await env.DB.prepare("SELECT owner, name, visibility, level, branch, upstream, upstream_commit, created_at, expires_at FROM repos WHERE owner = ? AND name = ?").bind(owner, repo).first();
        const { results: collaborators } = await env.DB.prepare("SELECT name FROM collaborators WHERE owner = ? AND repo = ?").bind(owner, repo).all();
        // Anyone who can read the repo can clone its artifact, with an hour-long read token.
        const h = await handleFor(env, owner, repo).catch(() => null);
        const art = h && await artifactAccess(h.handle, h.remote, "read", 3600).catch(() => null);
        const clone = art && `git clone ${art.remote.replace("://", `://x:${art.token.split("?")[0]}@`)} ${repo}`;
        // Where the fork's git lives: a bare repo on this machine, or Cloudflare Artifacts.
        const home = h ? (/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(art?.remote ?? h.remote) ? "local" : "cloud") : null;
        return json({ ...r, collaborators: collaborators.map((c: any) => c.name), canWrite: a.write, clone, home });
      }
      // PUT /api/repos/:o/:r {visibility}  (owner only)
      if (!p[4] && req.method === "PUT") {
        if (user !== owner) return json({ error: "owner only" }, 403);
        const { visibility } = await body<{ visibility: string }>();
        if (visibility !== "public" && visibility !== "private") return json({ error: "visibility: public or private" }, 400);
        await env.DB.prepare("UPDATE repos SET visibility = ? WHERE owner = ? AND name = ?").bind(visibility, owner, repo).run();
        return json({ visibility });
      }
      // POST /api/repos/:o/:r/shares {path, from, to, note}  a live link to some lines
      if (p[4] === "shares" && req.method === "POST") {
        const v = await env.DB.prepare("SELECT visibility FROM repos WHERE owner = ? AND name = ?").bind(owner, repo).first();
        return createShare(env, owner, repo, user, a, v?.visibility === "private", await body());
      }
      // POST /api/repos/:o/:r/cuts {pieces: [{path, from, to}], note}  some lines and their imports, as a branch to run and merge back
      if (p[4] === "cuts" && req.method === "POST") return createCut(env, owner, repo, user, a.write, await body());
      // GET /api/repos/:o/:r/fit[?dir=apps/web]  how easily Rusty Buns could box it, or one app in it
      if (p[4] === "fit" && req.method === "GET") return repoFit(env, (r) => app.fetch(r, env), url.origin, owner, repo, user, url.searchParams.get("dir") ?? "");
      // GET /api/repos/:o/:r/tree?path=dir  the repo's git tree, plus files written here but not catalogued yet
      if (p[4] === "tree") {
        const dir = (url.searchParams.get("path") ?? "").replace(/^\/|\/$/g, "");
        let entries: { name: string; path: string; type: string }[] = [], commit = null;
        try {
          const h = await handleFor(env, owner, repo);
          if (h) {
            const listing = await listDir(env, h.handle, h.branch, dir);
            if (listing.entries) entries = listing.entries;
            commit = listing.commit && { hash: listing.commit.hash, message: listing.commit.message.split("\n")[0] };
          }
        } catch (e) {
          if (code(e) === "FORK_IN_PROGRESS" || code(e) === "IMPORT_IN_PROGRESS") return json({ forking: true, entries: [] }, 202);
          if (code(e) === "NOT_FOUND") return json({ lost: true, entries: [] });   // a clone that never landed
          throw e;
        }
        const { results } = await env.DB.prepare("SELECT path FROM files WHERE owner = ? AND repo = ? AND path LIKE ? ESCAPE '\\'")
          .bind(owner, repo, (dir ? dir.replace(/[%_\\]/g, "\\$&") + "/" : "") + "%").all();
        const seen = new Set(entries.map((e) => e.name));
        for (const { path } of results as { path: string }[]) {
          const rest = dir ? path.slice(dir.length + 1) : path, name = rest.split("/")[0]!;
          if (seen.has(name)) continue;
          seen.add(name);
          entries.push({ name, path: dir ? `${dir}/${name}` : name, type: rest.includes("/") ? "dir" : "file" });
        }
        return json({ commit, entries });
      }
      const branches = await branchRoutes(req, env, p, owner, repo, user, a);
      if (branches) return branches;
      // POST /api/repos/:o/:r/collaborators {name}  (owner only; this is how agents get in)
      if (p[4] === "collaborators" && req.method === "POST") {
        if (user !== owner) return json({ error: "owner only" }, 403);
        const { name } = await body<{ name: string }>();
        if (!NAME.test(name ?? "")) return json({ error: "bad name" }, 400);
        await env.DB.prepare("INSERT OR IGNORE INTO users (name) VALUES (?)").bind(name).run();
        await env.DB.prepare("INSERT OR IGNORE INTO collaborators (owner, repo, name) VALUES (?, ?, ?)").bind(owner, repo, name).run();
        return json({ ok: true });
      }
      // POST /api/repos/:o/:r/files {path, content, branch?}
      if (p[4] === "files" && req.method === "POST") {
        if (!a.write) return json({ error: "no write access" }, 403);
        const { path, content = "", branch } = await body<{ path: string; content?: string; branch?: string }>();
        if (!path || path.length > 200 || path.includes("..") || path.startsWith("/")) return json({ error: "bad path" }, 400);
        if (branch) {
          if (!(await openBranch(env, owner, repo, branch))) return json({ error: "no open branch " + branch }, 404);
          return createOn(env, owner, repo, branch, path, content, user!);
        }
        const r = await env.DB.prepare("INSERT OR IGNORE INTO files (owner, repo, path) VALUES (?, ?, ?)").bind(owner, repo, path).run();
        if (!r.meta?.changes) return json({ error: "file exists" }, 409);
        await toFile(env, owner, repo, path, user!, "ops", { method: "POST", body: JSON.stringify({ ops: fromText(content) }) });
        return json({ path }, 201);
      }
      // /api/repos/:o/:r/do/(file|ops|log|at|commit|commits|ws)?path=...&branch=...  -> the file's DO, or its copy on a branch
      if (p[4] === "do" && DO_ROUTES.has(p[5] ?? "")) {
        const path = url.searchParams.get("path") ?? "", branch = url.searchParams.get("branch") || undefined;
        if (branch && !(await openBranch(env, owner, repo, branch))) return json({ error: "no open branch " + branch }, 404);
        // A branch catalogues when it merges into main, not before.
        if (branch && p[5] === "commit") return json({ error: "merge the branch, then commit main" }, 400);
        if (branch && p[5] === "private") return json({ error: "mark lines private on main" }, 400);
        const m = branch ? await materializeOn(env, owner, repo, branch, path) : await materialize(env, owner, repo, path);
        if ("error" in m) return json({ error: m.error }, m.status);
        const writes = p[5] === "ops" || p[5] === "commit" || (p[5] === "private" && req.method === "POST");
        if (writes && !a.write) return json({ error: "no write access" }, 403);
        if (p[5] === "ws") {
          // The DO learns who this socket is, and whether it may write, from us.
          const h = new Headers(req.headers);
          h.set("x-codesplitters-user", user ?? "anon");
          h.set("x-codesplitters-write", a.write ? "1" : "0");
          h.set("x-codesplitters-crew", a.write ? "1" : "0");
          return fileStub(env, owner, repo, path, branch).fetch(new Request(req.url, { headers: h }));
        }
        // Only the crew reads private lines; everyone else gets placeholders.
        const sent = writes ? await req.text() : undefined;
        const res = await toFile(env, owner, repo, path, user ?? "anon", p[5]!, { method: req.method, body: sent, headers: { "x-codesplitters-crew": a.write ? "1" : "0" } },
          url.searchParams.has("rev") ? `?rev=${url.searchParams.get("rev")}` : url.searchParams.has("since") ? `?since=${url.searchParams.get("since")}` : "", branch);
        if (p[5] === "private" && req.method === "POST" && res.ok) {
          // Open branches' copies of the file hide the same lines.
          const { results } = await env.DB.prepare("SELECT b.name FROM branch_files f JOIN branches b ON b.owner = f.owner AND b.repo = f.repo AND b.name = f.branch WHERE f.owner = ? AND f.repo = ? AND f.path = ? AND b.status = 'open'").bind(owner, repo, path).all();
          for (const { name } of results as { name: string }[]) await toFile(env, owner, repo, path, user!, "private", { method: "POST", body: sent }, "", name);
          return res;
        }
        if (p[5] === "commit" && res.ok) {
          // Index what was committed, not every keystroke; git and search get private lines blank.
          const { commit, published } = (await res.json()) as { commit: { message: string }; published: string };
          await env.DB.batch([
            env.DB.prepare("DELETE FROM file_search WHERE owner = ? AND repo = ? AND path = ?").bind(owner, repo, path),
            env.DB.prepare("INSERT INTO file_search (owner, repo, path, content) VALUES (?, ?, ?, ?)").bind(owner, repo, path, published),
          ]);
          // The catalogue entry stands even if the push fails; the next one carries it.
          const git = await pushCatalogue(env, owner, repo, path, published, user!, commit.message).catch((e: Error) => ({ error: e.message }));
          // The owner's own commit ships, when they turned that on (deploy.ts).
          if (git && !("error" in git)) await deployOnCommit(env, owner, repo, user);
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
        WHERE file_search MATCH ? AND (r.expires_at IS NULL OR r.expires_at > ?) AND (r.visibility = 'public' OR r.owner = ?
          OR EXISTS (SELECT 1 FROM collaborators c WHERE c.owner = r.owner AND c.repo = r.name AND c.name = ?))
        ORDER BY rank LIMIT 20`).bind(q, Date.now(), user, user).all();
      return json(results);
    }

    // POST /api/playlists {title}
    if (p[1] === "playlists" && !p[2] && req.method === "POST") {
      if (!user) return json({ error: "sign in first" }, 401);
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
      const m = await materialize(env, t.owner, t.repo, t.path);
      if ("error" in m) return json({ error: m.error }, m.status);
      const from = Math.max(1, Math.floor(t.from)), to = Math.max(from, Math.floor(t.to));
      const doc = await (await toFile(env, t.owner, t.repo, t.path, user!, "file")).json() as { lines?: { id: string }[] };
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
        // A track pointing into a repo that went private just disappears for you; private lines are placeholders unless you're crew.
        const can = await access(env, t.owner, t.repo, user);
        if (!can.read) return null;
        const doc = await (await toFile(env, t.owner, t.repo, t.path, user ?? "anon", "file", { headers: { "x-codesplitters-crew": can.write ? "1" : "0" } })).json() as { lines: { id: string; text: string; by: string }[] };
        // Follow the lines by id; if either end was deleted, fall back to the numbers.
        const i = doc.lines.findIndex((l) => l.id === t.from_id), j = doc.lines.findIndex((l) => l.id === t.to_id);
        const [a, b] = i >= 0 && j >= i ? [i, j + 1] : [t.from_line - 1, t.to_line];
        return { ...t, from_line: a + 1, to_line: b, lines: doc.lines.slice(a, b) };
      }));
      return json({ ...pl, tracks: tracks.filter(Boolean) });
    }

    return json({ error: "not found" }, 404);
  },

  // Cron Triggers (rustybuns.config.ts crons): hourly, each repo's dependency doctor runs when it's due,
  // and rate-limit windows that have ended are cleared out.
  async scheduled(_c: unknown, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }) {
    ctx.waitUntil(scheduledDoctor(env, (r) => app.fetch(r, env)));
    ctx.waitUntil(sweepLimits(env));
  },
};

export default app;
