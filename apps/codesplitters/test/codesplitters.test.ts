import { afterAll, describe, expect, test } from "bun:test";
import { apply, empty, fromText, replay, text, type Applied } from "../src/lines.ts";
import { local as boot, type Call } from "../src/local.ts";
import { run } from "../agents.ts";
import { GameRoom } from "../src/game-do.ts";

// Every app instance makes a temp dir of git repos; remove them all at the end.
const opened: { close(): void }[] = [];
afterAll(() => { for (const o of opened) o.close(); });
const local = async (extra?: Record<string, string>) => { const c = await boot(extra); opened.push(c); return c; };

const post = (call: Call, user: string | null, path: string, body: unknown) =>
  call(user, path, { method: "POST", body: JSON.stringify(body) });

describe("lines", () => {
  test("ops address lines by id, so edits elsewhere don't shift them", () => {
    const doc = empty();
    apply(doc, fromText("a\nb\nc"), "me");
    expect(apply(doc, [{ kind: "insert", after: null, text: "top" }], "x").ok).toBe(true);
    // L2 is still "b" even though everything moved down one.
    expect(apply(doc, [{ kind: "set", line: "L2", base: 2, text: "B" }], "y").ok).toBe(true);
    expect(text(doc)).toBe("top\na\nB\nc");
  });

  test("ifRev pins a batch to the whole file", () => {
    const doc = empty();
    apply(doc, fromText("a\nb"), "me");
    apply(doc, [{ kind: "set", line: "L2", base: 2, text: "B" }], "x");
    expect(apply(doc, [{ kind: "set", line: "L1", base: 1, text: "A" }], "y", 0, 2).ok).toBe(false);
    expect(apply(doc, [{ kind: "set", line: "L1", base: 1, text: "A" }], "y", 0, 3).ok).toBe(true);
  });

  test("a stale base is a conflict and the batch is all-or-nothing", () => {
    const doc = empty();
    apply(doc, fromText("a\nb"), "me");
    apply(doc, [{ kind: "set", line: "L1", base: 1, text: "A" }], "x");
    const r = apply(doc, [{ kind: "set", line: "L2", base: 2, text: "B" }, { kind: "set", line: "L1", base: 1, text: "nope" }], "y");
    expect(r.ok).toBe(false);
    expect(text(doc)).toBe("A\nb");
  });

  test("replaying the log rebuilds any past rev, blame included", () => {
    const doc = empty(), log: Applied[] = [];
    const go = (r: ReturnType<typeof apply>) => { if (r.ok) log.push(...r.applied); };
    go(apply(doc, fromText("one\ntwo"), "me"));
    go(apply(doc, [{ kind: "set", line: "L1", base: 1, text: "ONE" }], "x"));
    go(apply(doc, [{ kind: "delete", line: "L2", base: 2 }], "y"));
    expect(text(replay(log, 2))).toBe("one\ntwo");
    expect(replay(log, 3).lines[0]).toEqual({ id: "L1", text: "ONE", by: "x", rev: 3 });
    expect(replay(log)).toEqual(doc);
  });
});

describe("app", () => {
  test("private repos are invisible to everyone else, in search too", async () => {
    const call = await local();
    await post(call, "ana", "/api/login", { name: "ana" });
    await post(call, "ana", "/api/repos", { name: "secret", visibility: "private" });
    await post(call, "ana", "/api/repos/ana/secret/files", { path: "x.ts", content: "const hidden_tuba = 1" });
    await post(call, "ana", "/api/repos/ana/secret/do/commit?path=x.ts", {});

    expect((await call("bo", "/api/repos/ana/secret")).status).toBe(404);
    expect((await call(null, "/api/repos/ana/secret/do/file?path=x.ts")).status).toBe(404);
    expect(await (await call("bo", "/api/search?q=hidden_tuba")).json()).toEqual([]);
    expect(await (await call("ana", "/api/search?q=hidden_tuba")).json()).toHaveLength(1);
    expect((await call("bo", "/api/users/ana").then((r) => r.json()) as any).repos).toEqual([]);
  });

  test("only owners and collaborators write", async () => {
    const call = await local();
    await post(call, "ana", "/api/login", { name: "ana" });
    await post(call, "ana", "/api/repos", { name: "r" });
    await post(call, "ana", "/api/repos/ana/r/files", { path: "a", content: "x" });
    const op = { ops: [{ kind: "insert", after: null, text: "hi" }] };
    expect((await post(call, "bo", "/api/repos/ana/r/do/ops?path=a", op)).status).toBe(403);
    await post(call, "ana", "/api/repos/ana/r/collaborators", { name: "bo" });
    expect((await post(call, "bo", "/api/repos/ana/r/do/ops?path=a", op)).status).toBe(200);
  });

  test("a playlist track is a line range, read live from the file", async () => {
    const call = await local();
    await post(call, "ana", "/api/login", { name: "ana" });
    await post(call, "ana", "/api/repos", { name: "r" });
    await post(call, "ana", "/api/repos/ana/r/files", { path: "a.js", content: "1\n2\n3\n4" });
    const pl = await (await post(call, "bo", "/api/playlists", { title: "tasty" })).json() as any;
    expect((await post(call, "bo", `/api/playlists/${pl.id}/tracks`, { owner: "ana", repo: "r", path: "a.js", from: 2, to: 3, note: "nice" })).status).toBe(201);
    const got = await (await call(null, `/api/playlists/${pl.id}`)).json() as any;
    expect(got.tracks[0].lines.map((l: any) => l.text)).toEqual(["2", "3"]);
    // Two lines land above it: the track follows its lines, not the numbers.
    await post(call, "ana", "/api/repos/ana/r/do/ops?path=a.js", { ops: [{ kind: "insert", after: null, text: "new" }, { kind: "insert", after: null, text: "newer" }] });
    const moved = await (await call(null, `/api/playlists/${pl.id}`)).json() as any;
    expect(moved.tracks[0].lines.map((l: any) => l.text)).toEqual(["2", "3"]);
    expect([moved.tracks[0].from_line, moved.tracks[0].to_line]).toEqual([4, 5]);
  });

  test("three agents editing one file at once converge, and the commit indexes it", async () => {
    const { doc, stats, commit } = await run(await local(), { log: () => {} });
    const t = doc.lines.map((l: any) => l.text).join("\n");
    expect(t).not.toMatch(/\bfoo\b|^var /m);
    // The linter's const-or-let needs the whole file to hold still (ifRev), so it's right.
    expect(t).toContain("let total = 0");
    expect(t).toContain('const label = "sum is"');
    expect(t.match(/^\/\*\*/gm)).toHaveLength(3);
    expect(commit.rev).toBe(doc.rev);
    expect(Object.values(stats).every((s) => s.edits > 0)).toBe(true);
  });
});

describe("artifacts", () => {
  test("cataloguing pushes the repo's catalogued files as a git commit you can clone", async () => {
    const call = await local();
    await post(call, "ana", "/api/login", { name: "ana" });
    await post(call, "ana", "/api/repos", { name: "dig" });
    await post(call, "ana", "/api/repos/ana/dig/files", { path: "src/a.ts", content: "export const a = 1" });
    await post(call, "ana", "/api/repos/ana/dig/files", { path: "README", content: "found it" });
    const c1 = await (await post(call, "ana", "/api/repos/ana/dig/do/commit?path=src%2Fa.ts", { message: "first find" })).json() as any;
    expect(c1.git.commit).toMatch(/^[0-9a-f]{40}$/);
    const c2 = await (await post(call, "ana", "/api/repos/ana/dig/do/commit?path=README", { message: "second" })).json() as any;
    expect(c2.git.parent).toBe(c1.git.commit);

    const repo = await call.artifacts.get("ana--dig");
    expect((await repo.log()).map((c) => c.message)).toEqual(["second", "first find"]);
    expect(await (await repo.readFile({ ref: "main", path: "src/a.ts" }))!.text()).toBe("export const a = 1\n");

    // The clone command on the repo page works with a stock git client.
    const { clone } = await (await call(null, "/api/repos/ana/dig")).json() as any;
    const dir = (await import("node:fs")).mkdtempSync((await import("node:path")).join((await import("node:os")).tmpdir(), "cs-clone-"));
    const p = Bun.spawn(["sh", "-c", clone], { cwd: dir, stdout: "pipe", stderr: "pipe" });
    expect(await p.exited).toBe(0);
    expect(await Bun.file(`${dir}/dig/README`).text()).toBe("found it\n");
    (await import("node:fs")).rmSync(dir, { recursive: true, force: true });
  });
});

describe("levels", () => {
  test("browse a level, fork it, open a deep file, catalogue it: the push keeps every other file", async () => {
    const call = await local();
    // Stand in for an import (which needs the network): a repo with a few files, marked ready.
    const ns = call.artifacts, { push } = await import("../src/git.ts");
    const made = await ns.create("level-hono");
    await push(made.remote, made.token, { changes: { "README.md": "hono\n", "src/a.ts": "export const a = 1\n", "src/deep/b.ts": "b\n" }, message: "upstream", author: "upstream" });
    await call.env.DB.prepare("INSERT INTO levels (slug, status) VALUES ('hono', 'ready')").run();

    const levels = await (await call(null, "/api/levels")).json() as any[];
    expect(levels.map((l) => l.slug)).toEqual(["mitt", "clsx", "ky", "zustand", "hono", "express", "preact"]);
    expect(levels[4].status).toBe("ready");
    expect(levels[6].status).toBe("buried");
    const root = await (await call(null, "/api/levels/hono/tree")).json() as any;
    expect(root.entries.map((e: any) => [e.name, e.type])).toEqual([["src", "dir"], ["README.md", "file"]]);
    expect((await (await call(null, "/api/levels/hono/tree?path=src")).json() as any).entries.map((e: any) => e.path)).toEqual(["src/deep", "src/a.ts"]);
    expect((await (await call(null, "/api/levels/hono/file?path=src/a.ts")).json() as any).text).toBe("export const a = 1\n");
    expect((await call(null, "/api/levels/preact/tree")).status).toBe(409);             // not excavated yet
    expect((await post(call, null, "/api/levels/preact/import", {})).status).toBe(403);   // and not by strangers

    await post(call, "ana", "/api/login", { name: "ana" });
    expect((await post(call, "ana", "/api/levels/hono/fork", { name: "my-hono" })).status).toBe(201);
    // The fork says where it came from and that its git is local.
    const meta = await (await call("ana", "/api/repos/ana/my-hono")).json() as any;
    expect([meta.upstream, meta.upstream_commit?.length, meta.home]).toEqual(["github:honojs/hono", 40, "local"]);
    const tree = await (await call("ana", "/api/repos/ana/my-hono/tree?path=src/deep")).json() as any;
    expect(tree.entries.map((e: any) => e.path)).toEqual(["src/deep/b.ts"]);

    // Opening a file from history makes it a live DO, attributed to upstream.
    const f = "/api/repos/ana/my-hono/do", q = "?path=" + encodeURIComponent("src/deep/b.ts");
    const doc = await (await call("ana", `${f}/file${q}`)).json() as any;
    expect(doc.lines.map((l: any) => [l.text, l.by])).toEqual([["b", "upstream"]]);
    await post(call, "ana", `${f}/ops${q}`, { ops: [{ kind: "set", line: doc.lines[0].id, base: doc.lines[0].rev, text: "B, dug up" }] });
    const c = await (await post(call, "ana", `${f}/commit${q}`, { message: "dig" })).json() as any;
    expect(c.git.commit).toMatch(/^[0-9a-f]{40}$/);

    const repo = await ns.get("ana--my-hono");
    expect((await repo.log()).map((x) => x.message)).toEqual(["dig", "upstream"]);
    expect(await (await repo.readFile({ ref: "main", path: "src/deep/b.ts" }))!.text()).toBe("B, dug up\n");
    expect(await (await repo.readFile({ ref: "main", path: "src/a.ts" }))!.text()).toBe("export const a = 1\n");
    expect(await (await repo.readFile({ ref: "main", path: "README.md" }))!.text()).toBe("hono\n");
    // The level itself is untouched.
    expect((await (await ns.get("level-hono")).log()).length).toBe(1);
  });
});

describe("accounts", () => {
  test("with a secret set, Better Auth signs people up and the app sees a handle", async () => {
    const origin = "http://codesplitters.local";
    const call = await local({ BETTER_AUTH_SECRET: "test-secret-".padEnd(40, "x"), BETTER_AUTH_URL: origin });
    const session = async (cookie = "") => (await (await call(null, "/api/session", { headers: { cookie } })).json()) as any;
    expect(await session()).toEqual({ mode: "accounts", user: null, providers: ["email"] });
    expect((await post(call, null, "/api/login", { name: "ana" })).status).toBe(404);   // no aliases now

    const res = await call(null, "/api/auth/sign-up/email", { method: "POST", headers: { "content-type": "application/json", origin },
      body: JSON.stringify({ email: "ana@example.com", password: "correct horse battery", name: "Ana Lyst" }) });
    expect(res.status).toBe(200);
    const cookie = (res.headers.getSetCookie?.() ?? [res.headers.get("set-cookie")!]).map((c) => c.split(";")[0]).join("; ");
    expect((await session(cookie)).user).toBe("ana-lyst");
    expect((await session(cookie)).user).toBe("ana-lyst");                              // same handle every time
    const me = await (await call(null, "/api/me", { headers: { cookie } })).json() as any;
    expect(me.name).toBe("ana-lyst");
    expect((await call(null, "/api/repos", { method: "POST", headers: { cookie }, body: JSON.stringify({ name: "dig" }) })).status).toBe(201);
  });
});

describe("github", () => {
  test("dig up a GitHub repo: a fork you own, with where it came from", async () => {
    const call = await local({ GH_CLI: "off", GITHUB_TOKEN: "t0k" });
    // GitHub's API, faked; and the import, made local (a real one clones over the network).
    const real = globalThis.fetch, seen: string[] = [];
    globalThis.fetch = (async (u: string, init?: RequestInit) => {
      seen.push(`${u} ${new Headers(init?.headers).get("authorization")}`);
      const path = new URL(u).pathname;
      if (path === "/user") return Response.json({ login: "ana-gh" });
      if (path === "/user/repos") return Response.json([{ full_name: "ana-gh/Tiny.JS", private: false, default_branch: "trunk" }, { full_name: "ana-gh/secret", private: true, default_branch: "main" }]);
      if (path === "/repos/ana-gh/Tiny.JS") return Response.json({ full_name: "ana-gh/Tiny.JS", private: false, default_branch: "trunk" });
      if (path === "/repos/ana-gh/secret") return Response.json({ full_name: "ana-gh/secret", private: true, default_branch: "main" });
      if (path === "/repos/ana-gh/Tiny.JS/commits/trunk") return Response.json({ sha: "a".repeat(40) });
      if (path === "/repos/ana-gh/secret/commits/main") return Response.json({ sha: "b".repeat(40) });
      return new Response("{}", { status: 404 });
    }) as any;
    const imports: any[] = [];
    call.artifacts.import = (async (params: any) => { imports.push(params); return call.artifacts.create(params.target.name, { setDefaultBranch: params.source.branch }); }) as any;
    try {
      await post(call, "ana", "/api/login", { name: "ana" });
      const list = await (await call("ana", "/api/github/repos")).json() as any;
      expect([list.via, list.login, list.privateOk, list.repos.map((r: any) => [r.repo, r.private])]).toEqual(["secret", "ana-gh", true, [["ana-gh/Tiny.JS", false], ["ana-gh/secret", true]]]);
      expect(seen[0]).toEndWith("Bearer t0k");

      expect((await post(call, null, "/api/github/dig", { repo: "ana-gh/Tiny.JS" })).status).toBe(401);
      expect((await post(call, "ana", "/api/github/dig", { repo: "not a repo" })).status).toBe(400);
      expect((await post(call, "ana", "/api/github/dig", { repo: "ana-gh/nope" })).status).toBe(404);
      const dug = await post(call, "ana", "/api/github/dig", { repo: "https://github.com/ana-gh/Tiny.JS.git" });
      expect(dug.status).toBe(201);
      expect(await dug.json()).toEqual({ owner: "ana", name: "tiny-js", upstream: "github:ana-gh/Tiny.JS", commit: "a".repeat(40) });
      expect(imports[0].source).toEqual({ url: "https://github.com/ana-gh/Tiny.JS.git", branch: "trunk", depth: 1 });
      expect(imports[0].target.opts.readOnly).toBeUndefined();   // writable: it's ana's now
      const meta = await (await call("ana", "/api/repos/ana/tiny-js")).json() as any;
      expect([meta.upstream, meta.branch, meta.home, meta.canWrite]).toEqual(["github:ana-gh/Tiny.JS", "trunk", "local", true]);
      expect((await post(call, "ana", "/api/github/dig", { repo: "ana-gh/Tiny.JS" })).status).toBe(409);

      // Private: local git clones it with the token; the public import never sees one.
      expect(imports[0].source.token).toBeUndefined();
      expect((await post(call, "ana", "/api/github/dig", { repo: "ana-gh/secret" })).status).toBe(201);
      expect(imports[1].source).toEqual({ url: "https://github.com/ana-gh/secret.git", branch: "main", depth: 1, token: "t0k" });
      // Cloudflare Artifacts imports public repos only: say so instead of failing later.
      Object.defineProperty(call.artifacts, "privateImports", { value: false });
      expect((await (await call("ana", "/api/github/repos")).json() as any).privateOk).toBe(false);
      const edge = await post(call, "ana", "/api/github/dig", { repo: "ana-gh/secret", name: "secret-2" });
      expect([edge.status, ((await edge.json()) as any).error]).toEqual([422, expect.stringContaining("desktop app")]);
    } finally { globalThis.fetch = real; }
  });
});

describe("game", () => {
  test("a level's backrooms: folders are doors, files are walls, cached by commit", async () => {
    const call = await local();
    const ns = call.artifacts, { push } = await import("../src/git.ts");
    const made = await ns.create("level-mitt");
    await push(made.remote, made.token, { changes: { "README.md": "mitt\n\ttabbed\n", "src/index.ts": "export default 1\n", "logo.png": "\u0000png" }, message: "upstream", author: "upstream" });
    const tip = (await (await ns.get("level-mitt")).log())[0]!.hash;
    await call.env.DB.prepare("INSERT INTO levels (slug, status, commit_hash) VALUES ('mitt', 'ready', ?)").bind(tip).run();

    const root = await (await call(null, "/api/game/l/mitt/walls")).json() as any;
    expect(root.doors).toEqual([{ name: "src", path: "src" }]);
    expect(root.files.map((f: any) => [f.name, f.lines])).toEqual([["logo.png", []], ["README.md", ["mitt", "  tabbed", ""]]]);
    expect((await (await call(null, "/api/game/l/mitt/walls?path=src")).json() as any).files[0].lines[0]).toBe("export default 1");
    expect((await call(null, "/api/game/l/mitt/walls?path=nope")).status).toBe(404);
    expect((await call(null, "/api/game/l/clsx/walls")).status).toBe(409);       // not imported
    // A second visit reads D1, not Artifacts.
    expect((await call.env.DB.prepare("SELECT key FROM walls_cache ORDER BY key").all()).results.map((r: any) => r.key)).toEqual([`${tip}:`, `${tip}:src`]);
    // Private repos stay private in the game too.
    await post(call, "ana", "/api/repos", { name: "secret", visibility: "private" });
    expect((await call("bo", "/api/game/r/ana/secret")).status).toBe(404);
    expect((await call("ana", "/api/game/r/ana/secret")).status).toBe(200);
  });

  test("the room on a level's page: lobby, start, relay, clubbing, round over", async () => {
    const call = await local();
    const join = async (user: string) => {
      const res = await call(user, "/api/game/l/mitt/ws", { headers: { upgrade: "websocket" } }) as any;
      expect(res.status).toBe(101);
      const ws = res.webSocket, got: any[] = [];
      ws.toBrowser = (d: string) => got.push(JSON.parse(d));
      for (const d of ws.queue.splice(0)) got.push(JSON.parse(d));
      const say = async (m: unknown) => { ws.onMessage(JSON.stringify(m)); await Bun.sleep(5); };
      return { got, say, last: (t: string) => got.filter((m) => m.t === t).at(-1) };
    };
    const ana = await join("ana"), bo = await join("bo");
    await Bun.sleep(5);
    expect(ana.last("lobby").players.map((p: any) => p.user)).toEqual(["ana", "bo"]);
    expect(await (await call(null, "/api/game/l/mitt")).json()).toEqual({ state: "waiting", players: ["ana", "bo"] });

    // Both ready: the round starts for both with one seed.
    await ana.say({ t: "ready" });
    expect(ana.last("start")).toBeUndefined();
    await bo.say({ t: "ready" });
    expect(ana.last("start").seed).toBe(bo.last("start").seed);

    const boId = bo.last("lobby").you;
    await ana.say({ t: "pos", p: [1, 0, 2], yaw: 0.5, room: "src", swing: true });
    expect(bo.last("pos")).toMatchObject({ user: "ana", p: [1, 0, 2], room: "src", swing: true });
    expect(ana.last("pos")).toBeUndefined();                                   // not echoed back
    await ana.say({ t: "hit", target: boId, dir: [1, 0] });
    expect(bo.last("clubbed")).toEqual({ t: "clubbed", by: "ana", dir: [1, 0] });

    await ana.say({ t: "dead", score: 700 });
    expect(ana.last("over")).toBeUndefined();                                  // bo is still up
    await bo.say({ t: "dead", score: 300 });
    expect(ana.last("over").players.map((p: any) => [p.user, p.score])).toEqual([["ana", 700], ["bo", 300]]);
    expect(ana.last("lobby").state).toBe("waiting");

    // Next round: ana goes out, bo's tab goes quiet. Start says why it can't, until bo counts as idle.
    await ana.say({ t: "start" });
    const seed = ana.last("start").seed;
    await ana.say({ t: "dead", score: 50 });
    await ana.say({ t: "start" });
    expect(ana.last("note").text).toContain("bo");
    expect(ana.last("start").seed).toBe(seed);
    const idle = GameRoom.IDLE_MS;
    GameRoom.IDLE_MS = -1;
    try { await ana.say({ t: "start" }); } finally { GameRoom.IDLE_MS = idle; }
    expect(ana.last("start").seed).not.toBe(seed);
    expect(bo.last("start").seed).toBe(ana.last("start").seed);
  });
});

describe("shares", () => {
  test("share a few lines of a private repo: live, following the lines, nothing else leaks", async () => {
    const call = await local();
    await post(call, "ana", "/api/repos", { name: "vault", visibility: "private" });
    await post(call, "ana", "/api/repos/ana/vault/files", { path: "a.ts", content: "one\ntwo\nthree\nfour" });
    const made = await post(call, "ana", "/api/repos/ana/vault/shares", { path: "a.ts", from: 2, to: 3, note: "the good bit" });
    expect(made.status).toBe(201);
    const { id } = await made.json() as any;
    const look = async (who: string | null) => (await (await call(who, `/api/shares/${id}`)).json()) as any;
    expect((await look(null)).lines.map((l: any) => [l.n, l.text])).toEqual([[2, "two"], [3, "three"]]);
    expect((await call("bo", "/api/repos/ana/vault/do/file?path=a.ts")).status).toBe(404);     // the rest stays sealed
    expect((await post(call, "bo", "/api/repos/ana/vault/shares", { path: "a.ts", from: 1, to: 4 })).status).toBe(404);

    // Edits around and inside the range: it follows the lines.
    const doc = await (await call("ana", "/api/repos/ana/vault/do/file?path=a.ts")).json() as any;
    const two = doc.lines[1];
    await post(call, "ana", "/api/repos/ana/vault/do/ops?path=a.ts", { ops: [{ kind: "insert", after: null, text: "zero" }, { kind: "insert", after: two.id, text: "two and a half" }, { kind: "set", line: two.id, base: two.rev, text: "TWO" }] });
    expect((await look("bo")).lines.map((l: any) => [l.n, l.text])).toEqual([[3, "TWO"], [4, "two and a half"], [5, "three"]]);

    expect((await call("bo", `/api/shares/${id}`, { method: "DELETE" })).status).toBe(403);
    expect((await call("ana", `/api/shares/${id}`, { method: "DELETE" })).status).toBe(200);
    expect((await call(null, `/api/shares/${id}`)).status).toBe(404);
  });

  test("the owner flips a repo public or private", async () => {
    const call = await local();
    await post(call, "ana", "/api/repos", { name: "dig", visibility: "private" });
    const put = (who: string, v: string) => call(who, "/api/repos/ana/dig", { method: "PUT", body: JSON.stringify({ visibility: v }) });
    expect((await call("bo", "/api/repos/ana/dig")).status).toBe(404);
    expect((await put("bo", "public")).status).toBe(404);
    expect((await put("ana", "public")).status).toBe(200);
    expect((await call("bo", "/api/repos/ana/dig")).status).toBe(200);
  });
});
