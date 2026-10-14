import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dirs, local, git, upstream, settled, fakeGitHub } from "./tarball-kit.ts";

describe("past the Artifacts import cap", () => {
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
