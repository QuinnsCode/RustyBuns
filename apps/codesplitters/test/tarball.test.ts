import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { local as boot } from "../src/local.ts";

setDefaultTimeout(20_000);

const opened: { close(): void }[] = [];
const dirs: string[] = [];
afterAll(() => { for (const o of opened) o.close(); for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const local = async (extra?: Record<string, unknown>) => { const c = await boot(extra); opened.push(c); return c; };

const git = (cwd: string, ...args: string[]) => {
  const r = Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd });
  if (!r.success) throw new Error(r.stderr.toString());
  return r.stdout.toString().trim();
};

/** A repo with the awkward bits (an exec bit, a symlink, binary, a path past tar's 100 chars, twin files), and GitHub's tarball of it. */
function upstream() {
  const dir = mkdtempSync(join(tmpdir(), "cs-tar-"));
  dirs.push(dir);
  const long = "packages/" + "very-long-directory-name/".repeat(5) + "and-a-file-name-that-goes-on.ts";
  for (const [p, c] of Object.entries({ "README.md": "big\n", "src/a.ts": "export const a = 1\n", "src/twin.ts": "export const a = 1\n", [long]: "deep\n", "empty": "" })) {
    mkdirSync(join(dir, p, ".."), { recursive: true });
    writeFileSync(join(dir, p), c);
  }
  writeFileSync(join(dir, "run.sh"), "#!/bin/sh\necho hi\n", { mode: 0o755 });
  writeFileSync(join(dir, "logo.bin"), Uint8Array.from({ length: 3000 }, (_, i) => (i * 7) % 256));
  symlinkSync("src/a.ts", join(dir, "link.ts"));
  git(dir, "init", "-q", "-b", "main");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "the tip");
  const sha = git(dir, "rev-parse", "HEAD");
  const tgz = join(dir, "..", `${sha}.tgz`);
  dirs.push(tgz);
  git(dir, "archive", "--format=tar.gz", `--prefix=o-big-${sha.slice(0, 7)}/`, "-o", tgz, "HEAD");
  return { sha, tree: git(dir, "rev-parse", "HEAD^{tree}"), tgz, dir };
}

/** Wait for a level's dig (it runs off the LEVEL_DIGS queue) to stop digging. */
async function settled(call: (u: string | null, p: string) => Promise<Response>, slug: string) {
  for (let i = 0; i < 200; i++) {
    const l = ((await (await call(null, "/api/levels")).json()) as any[]).find((l) => l.slug === slug);
    if (l.status !== "importing") return l;
    await Bun.sleep(25);
  }
  throw new Error(`${slug} is still digging`);
}

/**
 * GitHub, faked: the repo, its tip, its tarball and any submodules (path to commit), and,
 * given its folder, its tree listing and raw files (each path fetched goes in `seen`).
 */
function fakeGitHub(sha: string, tgz: string, o: { subs?: Record<string, string>; dir?: string; seen?: string[] } = {}) {
  const { subs = {}, dir, seen = [] } = o;
  const real = globalThis.fetch;
  globalThis.fetch = (async (u: string | Request, init?: RequestInit) => {
    const url = new URL(typeof u === "string" ? u : u.url);
    if (dir && url.hostname === "raw.githubusercontent.com" && url.pathname.startsWith(`/o/big/${sha}/`)) {
      const path = decodeURIComponent(url.pathname.slice(`/o/big/${sha}/`.length));
      seen.push(path);
      return new Response(new Uint8Array(Bun.spawnSync(["git", "cat-file", "blob", `HEAD:${path}`], { cwd: dir }).stdout));
    }
    if (url.hostname !== "api.github.com") return real(u, init);
    if (dir && url.pathname === `/repos/o/big/git/trees/${sha}`) {
      const tree = git(dir, "ls-tree", "-r", "-l", "--full-tree", "HEAD").split("\n").map((line) => {
        const [meta, path] = line.split("\t") as [string, string];
        const [mode, type, , size] = meta.split(/\s+/);
        return { path, mode, type, size: Number(size) };
      });
      for (const [path, commit] of Object.entries(subs)) tree.push({ path, mode: "160000", type: "commit", sha: commit } as any);
      return Response.json({ sha, truncated: false, tree });
    }
    if (url.pathname === "/repos/o/big") return Response.json({ full_name: "o/big", private: false, default_branch: "main" });
    if (url.pathname === "/repos/o/big/commits/main") return Response.json({ sha, commit: { message: "the tip", author: { name: "Up Stream", email: "up@stream.dev", date: "2026-10-01T00:00:00Z" } } });
    if (url.pathname === `/repos/o/big/tarball/${sha}`) return new Response(Bun.file(tgz));
    if (url.pathname === "/repos/o/big/contents/.gitmodules" && Object.keys(subs).length)
      return Response.json({ content: btoa(Object.keys(subs).map((p) => `[submodule "${p}"]\n\tpath = ${p}\n\turl = https://github.com/o/${p}\n`).join("")) });
    const sub = Object.entries(subs).find(([p]) => url.pathname === `/repos/o/big/contents/${p}`);
    if (sub) return Response.json({ type: "submodule", sha: sub[1] });
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
  return () => { globalThis.fetch = real; };
}

/**
 * As on Cloudflare: the refused import leaves its half-made target behind, and deleting it answers
 * true but frees the name a moment later (#348).
 */
const tooBig = (ns: { create(name: string): Promise<unknown>; delete?(name: string): Promise<boolean> }) => async (o: { target: { name: string } }) => {
  await ns.create(o.target.name).catch(() => {});
  const del = ns.delete!.bind(ns);
  ns.delete = async (name) => {
    if (name !== o.target.name) return del(name);
    ns.delete = del;
    setTimeout(() => void del(name), 1500);
    return true;
  };
  return tooBigNow();
};
const tooBigNow = () => { throw Object.assign(new Error(`413 {"code":10402,"message":"Repository exceeded the 40MB import limit. Current depth is 1."}`), { code: "MEMORY_LIMIT" }); };

describe("past the Artifacts import cap", () => {
  test("a dig comes in from GitHub's tarball, the same tree git has", async () => {
    const { sha, tree, tgz } = upstream();
    const call = await local({ GH_CLI: "off" });
    call.artifacts.import = tooBig(call.artifacts) as any;
    const restore = fakeGitHub(sha, tgz);
    try {
      await call("ana", "/api/login", { method: "POST", body: JSON.stringify({ name: "ana" }) });
      await call.artifacts.create("ana--big");   // an orphan from a dig cut off halfway: no row owns it
      const res = await call("ana", "/api/github/dig", { method: "POST", body: JSON.stringify({ repo: "o/big" }) });
      expect(res.status).toBe(201);
      expect(((await res.json()) as any).commit).toBe(sha);
      const [tip] = await (await call.artifacts.get("ana--big")).log();
      expect(tip!.treeHash).toBe(tree);
      expect(tip!.message).toStartWith("the tip");
      expect(tip!.author).toEqual({ name: "Up Stream", email: "up@stream.dev" });
      const repo = await call.artifacts.get("ana--big");
      expect(await (await repo.readFile({ ref: "main", path: "link.ts" }))!.text()).toBe("src/a.ts");
    } finally { restore(); }
  });

  test("a level does too, and stays read-only", async () => {
    const { sha, tree, tgz } = upstream();
    const call = await local({ GH_CLI: "off", ADMINS: "boss" });
    call.artifacts.import = tooBig(call.artifacts) as any;
    const restore = fakeGitHub(sha, tgz);
    // The level's repo, pointed at the fake.
    const { LEVELS } = await import("../src/levels.ts");
    const alchemy = LEVELS.find((l) => l.slug === "alchemy")!, was = alchemy.repo;
    alchemy.repo = "o/big";
    try {
      await call("boss", "/api/login", { method: "POST", body: JSON.stringify({ name: "boss" }) });
      expect((await call("boss", "/api/levels/alchemy/import", { method: "POST", body: "{}" })).status).toBe(202);
      expect((await settled(call, "alchemy")).status).toBe("ready");
      const handle = await call.artifacts.get("level-alchemy");
      expect((await handle.info()).readOnly).toBe(true);
      expect((await handle.log())[0]!.treeHash).toBe(tree);
      expect(await call.artifacts.get("level-alchemy-tip").then(() => "kept", () => "gone")).toBe("gone");
    } finally { restore(); alchemy.repo = was; }
  });

  test("a level too big for Artifacts at all is kept in R2 as chunks: browse it, read it, play it, but no fork", async () => {
    const { sha, tgz, dir } = upstream();
    const { R2Bucket } = await import("@rustybuns/shell-bun");
    const bucketDir = mkdtempSync(join(tmpdir(), "cs-r2-"));
    dirs.push(bucketDir);
    const bucket = new R2Bucket(bucketDir);
    const call = await local({ GH_CLI: "off", ADMINS: "boss", LEVEL_CHUNKS: bucket });
    call.artifacts.import = (async () => { throw new Error("The repository exceeds the size limit."); }) as any;
    const restore = fakeGitHub(sha, tgz, { subs: { "vendor/zig": "a".repeat(40) }, dir });
    const { LEVELS } = await import("../src/levels.ts");
    const bun = LEVELS.find((l) => l.slug === "bun")!, was = bun.repo;
    bun.repo = "o/big";
    const get = async (path: string, user: string | null = null) => { const r = await call(user, path); return { status: r.status, body: (await r.json()) as any }; };
    try {
      await call("boss", "/api/login", { method: "POST", body: JSON.stringify({ name: "boss" }) });
      const imp = await call("boss", "/api/levels/bun/import", { method: "POST", body: "{}" });
      expect(imp.status).toBe(202);
      expect(await settled(call, "bun")).toMatchObject({ status: "ready", store: "r2", commit: sha });

      const root = (await get("/api/levels/bun/tree")).body;
      expect(root.commit).toEqual({ hash: sha, message: "the tip" });
      expect(root.entries.map((e: any) => [e.path, e.type])).toEqual([["packages", "dir"], ["src", "dir"], ["vendor", "dir"], ["empty", "file"], ["link.ts", "symlink"], ["logo.bin", "file"], ["README.md", "file"], ["run.sh", "file"]]);
      // A submodule is a gitlink to its commit, from GitHub's tree listing.
      expect((await get("/api/levels/bun/tree?path=vendor")).body.entries).toEqual([{ name: "zig", path: "vendor/zig", type: "gitlink" }]);
      expect((await get("/api/levels/bun/file?path=src/twin.ts")).body.text).toBe("export const a = 1\n");
      expect((await get("/api/levels/bun/file?path=run.sh")).body.text).toBe("#!/bin/sh\necho hi\n");
      expect((await get("/api/levels/bun/file?path=empty")).body.text).toBe("");
      expect((await get(`/api/levels/bun/file?path=packages/${"very-long-directory-name/".repeat(5)}and-a-file-name-that-goes-on.ts`)).body.text).toBe("deep\n");
      expect((await get("/api/levels/bun/file?path=logo.bin")).status).toBe(415);   // listed, not stored
      expect((await get("/api/levels/bun/file?path=src/nope.ts")).status).toBe(404);
      expect((await get("/api/game/l/bun/walls?path=src")).body.files.map((f: any) => [f.name, f.lines])).toEqual([["a.ts", ["export const a = 1", ""]], ["twin.ts", ["export const a = 1", ""]]]);
      const fork = await call("boss", "/api/levels/bun/fork", { method: "POST", body: JSON.stringify({ name: "my-bun" }) });
      expect(fork.status).toBe(409);
      expect(((await fork.json()) as any).error).toContain("too big for Artifacts");

      // Again: the old chunks go, the new ones come, and so do an old commit's folders. Other levels' stay.
      const rows = async () => ((await call.env.DB.prepare("SELECT hash FROM tree_cache WHERE hash LIKE 'r2:%' ORDER BY hash").all()).results as { hash: string }[]).map((r) => r.hash);
      const ours = await rows();
      await call.env.DB.batch(["r2:bun:old:", "r2:bun:old:src", "r2:bunny:old:"].map((h) => call.env.DB.prepare("INSERT INTO tree_cache (hash, entries) VALUES (?, '[]')").bind(h)));
      expect((await call("boss", "/api/levels/bun/import", { method: "POST", body: "{}" })).status).toBe(202);
      await settled(call, "bun");
      expect((await bucket.list({ prefix: "levels/bun/" })).objects.map((o: any) => o.key)).toEqual([`levels/bun/${sha}/0`]);
      expect(await rows()).toEqual([...ours, "r2:bunny:old:"].sort());
    } finally { restore(); bun.repo = was; }
  });

  test("a big level digs in parts, side by side, and reads the same as one dug from the tarball", async () => {
    const { sha, tgz, dir } = upstream();
    const { R2Bucket } = await import("@rustybuns/shell-bun");
    const bucketDir = mkdtempSync(join(tmpdir(), "cs-r2-"));
    dirs.push(bucketDir);
    const bucket = new R2Bucket(bucketDir);
    const call = await local({ GH_CLI: "off", ADMINS: "boss", LEVEL_CHUNKS: bucket });
    call.artifacts.import = (async () => { throw new Error("The repository exceeds the size limit."); }) as any;
    const seen: string[] = [];
    const restore = fakeGitHub(sha, tgz, { dir, seen });
    const { LEVELS } = await import("../src/levels.ts");
    const { PART } = await import("../src/swarm.ts");
    const bun = LEVELS.find((l) => l.slug === "bun")!, was = bun.repo, files = PART.files;
    bun.repo = "o/big";
    PART.files = 2;
    try {
      await call("boss", "/api/login", { method: "POST", body: JSON.stringify({ name: "boss" }) });
      expect((await call("boss", "/api/levels/bun/import", { method: "POST", body: "{}" })).status).toBe(202);
      expect(await settled(call, "bun")).toMatchObject({ status: "ready", store: "r2", commit: sha });
      // Eight files, two a part: four parts, each its own chunk, every file fetched once and none from the tarball.
      expect((await bucket.list({ prefix: `levels/bun/${sha}/` })).objects).toHaveLength(4);
      expect(seen.toSorted()).toEqual(["README.md", "empty", "link.ts", "logo.bin", `packages/${"very-long-directory-name/".repeat(5)}and-a-file-name-that-goes-on.ts`, "run.sh", "src/a.ts", "src/twin.ts"].toSorted());
      const get = async (path: string) => { const r = await call(null, path); return { status: r.status, body: (await r.json()) as any }; };
      expect((await get("/api/levels/bun/tree")).body.entries.map((e: any) => [e.path, e.type])).toEqual([["packages", "dir"], ["src", "dir"], ["empty", "file"], ["link.ts", "symlink"], ["logo.bin", "file"], ["README.md", "file"], ["run.sh", "file"]]);
      expect((await get("/api/levels/bun/file?path=src/twin.ts")).body.text).toBe("export const a = 1\n");
      expect((await get("/api/levels/bun/file?path=run.sh")).body.text).toBe("#!/bin/sh\necho hi\n");
      expect((await get("/api/levels/bun/file?path=link.ts")).body.text).toBe("src/a.ts");
      expect((await get("/api/levels/bun/file?path=logo.bin")).status).toBe(415);
    } finally { restore(); bun.repo = was; PART.files = files; }
  });

  test("a repo too big for one pack goes in several, and lands as one commit", async () => {
    const { sha, tree, tgz } = upstream();
    const call = await local({ GH_CLI: "off" });
    const { importTarball } = await import("../src/tarball.ts");
    // A pack per file or so: as many as a big repo (Bun) could need.
    await importTarball(call.artifacts as any, {
      tarball: async () => new Response(Bun.file(tgz)), repo: "o/big", sha, branch: "main", message: "the tip", author: "Up Stream", packBytes: 1, target: { name: "split" },
    });
    const log = await (await call.artifacts.get("split")).log();
    expect(log).toHaveLength(1);
    expect(log[0]!.treeHash).toBe(tree);
    // The parts went up on main itself (HEAD is the first branch pushed, #355); the last is left dangling and nothing is missing.
    const bare = call.artifacts.path("split");
    expect(git(bare, "for-each-ref", "--format=%(refname)")).toBe("refs/heads/main");
    expect(git(bare, "symbolic-ref", "HEAD")).toBe("refs/heads/main");
    expect(git(bare, "fsck", "--connectivity-only")).toMatch(/^dangling commit [0-9a-f]{40}$/);
  });

  test("any other import error is still an error", async () => {
    const { tarFiles } = await import("../src/tarball.ts");
    const { tooBigToImport } = await import("../src/tarball.ts");
    expect(tooBigToImport(new Error("ALREADY_EXISTS: nope"))).toBe(false);
    expect(tooBigToImport({ code: "MEMORY_LIMIT" })).toBe(true);
    // A tarball cut off mid-file says so.
    const { tgz } = upstream();
    const raw = new Uint8Array(await new Response(Bun.file(tgz).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer());
    const cut = new Blob([raw.subarray(0, 1100)]).stream();
    await expect((async () => { for await (const _ of tarFiles(cut)) { /* read on */ } })()).rejects.toThrow("tar: cut short");
  });
});
