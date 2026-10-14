// What the tarball tests share: a fake GitHub, an upstream on disk and the Artifacts cap. Split across
// two files so bun test --parallel can run them side by side; each file gets its own copy.
import { afterAll, setDefaultTimeout } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { local as boot } from "../src/local.ts";

setDefaultTimeout(20_000);

const opened: { close(): void }[] = [];
export const dirs: string[] = [];
afterAll(() => { for (const o of opened) o.close(); for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
export const local = async (extra?: Record<string, unknown>) => { const c = await boot(extra); opened.push(c); return c; };

export const git = (cwd: string, ...args: string[]) => {
  const r = Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd });
  if (!r.success) throw new Error(r.stderr.toString());
  return r.stdout.toString().trim();
};

/**
 * A repo with the awkward bits (an exec bit, a symlink, binary, a path past tar's 100 chars, twin files), and GitHub's
 * tarball of it. `subs` (path to commit) go in as gitlinks, with a .gitmodules.
 */
export function upstream(subs: Record<string, string> = {}) {
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
  if (Object.keys(subs).length) writeFileSync(join(dir, ".gitmodules"), Object.keys(subs).map((p) => `[submodule "${p}"]\n\tpath = ${p}\n\turl = https://github.com/o/${p}\n`).join(""));
  git(dir, "add", "-A");
  for (const [p, commit] of Object.entries(subs)) git(dir, "update-index", "--add", "--cacheinfo", `160000,${commit},${p}`);
  git(dir, "commit", "-q", "-m", "the tip");
  const sha = git(dir, "rev-parse", "HEAD");
  const tgz = join(dir, "..", `${sha}.tgz`);
  dirs.push(tgz);
  git(dir, "archive", "--format=tar.gz", `--prefix=o-big-${sha.slice(0, 7)}/`, "-o", tgz, "HEAD");
  return { sha, tree: git(dir, "rev-parse", "HEAD^{tree}"), tgz, dir };
}

/** Wait for a level's dig (it runs off the LEVEL_DIGS queue) to stop digging. */
export async function settled(call: (u: string | null, p: string) => Promise<Response>, slug: string) {
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
 * `limited` is the API without a token on a shared IP: every call 403s. Given its folder, github.com's git hands out its
 * objects one to a pack, as it does for a fetch that wants one with `filter tree:0`.
 */
export function fakeGitHub(sha: string, tgz: string, o: { subs?: Record<string, string>; dir?: string; seen?: string[]; limited?: boolean } = {}) {
  const { subs = {}, dir, seen = [], limited } = o;
  const real = globalThis.fetch;
  globalThis.fetch = (async (u: string | Request, init?: RequestInit) => {
    const url = new URL(typeof u === "string" ? u : u.url);
    if (dir && url.hostname === "raw.githubusercontent.com" && url.pathname.startsWith(`/o/big/${sha}/`)) {
      const path = decodeURIComponent(url.pathname.slice(`/o/big/${sha}/`.length));
      seen.push(path);
      return new Response(new Uint8Array(Bun.spawnSync(["git", "cat-file", "blob", `HEAD:${path}`], { cwd: dir }).stdout));
    }
    if (url.hostname === "github.com" && url.pathname === "/o/big.git/info/refs")
      return new Response(`001e# service=git-upload-pack\n0000${sha} HEAD\0side-band symref=HEAD:refs/heads/main\n003f${sha} refs/heads/main\n0000`);
    if (url.hostname === "github.com" && url.pathname === `/o/big/commit/${sha}.patch`)
      return new Response(`From ${sha} Mon Sep 17 00:00:00 2001\nFrom: Up Stream <up@stream.dev>\nDate: Thu, 1 Oct 2026 00:00:00 +0000\nSubject: [PATCH] the tip\n\n---\n README.md | 1 +\n`);
    if (dir && url.hostname === "github.com" && url.pathname === "/o/big.git/git-upload-pack") {
      const want = /want ([0-9a-f]{40})/.exec(String(init?.body))![1]!;
      const type = git(dir, "cat-file", "-t", want), raw = Bun.spawnSync(["git", "cat-file", type, want], { cwd: dir }).stdout;
      const head = [((type === "commit" ? 1 : 2) << 4) | (raw.length & 15) | (raw.length > 15 ? 0x80 : 0)];
      for (let n = raw.length >> 4; n; n >>= 7) head.push((n & 0x7f) | (n > 0x7f ? 0x80 : 0));
      const pack = Buffer.concat([Buffer.from("PACK\0\0\0\x02\0\0\0\x01", "latin1"), Buffer.from(head), deflateSync(raw)]);
      const body = Buffer.concat([pack, new Bun.CryptoHasher("sha1").update(pack).digest()]);
      const line = (b: Buffer) => Buffer.concat([Buffer.from((b.length + 4).toString(16).padStart(4, "0")), b]);
      return new Response(Buffer.concat([line(Buffer.from("packfile\n")), line(Buffer.concat([Buffer.from([1]), body])), Buffer.from("0000")]));
    }
    if (url.hostname === "codeload.github.com" && url.pathname === `/o/big/tar.gz/${sha}`) return new Response(Bun.file(tgz));
    if (url.hostname !== "api.github.com") return real(u, init);
    if (limited && !new Headers(init?.headers).has("authorization")) return Response.json({ message: "API rate limit exceeded" }, { status: 403 });
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
    if (["/repos/o/big/commits/HEAD", "/repos/o/big/commits/main"].includes(url.pathname)) return Response.json({ sha, commit: { message: "the tip", author: { name: "Up Stream", email: "up@stream.dev", date: "2026-10-01T00:00:00Z" } } });
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
export const tooBig = (ns: { create(name: string): Promise<unknown>; delete?(name: string): Promise<boolean> }) => async (o: { target: { name: string } }) => {
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
export const tooBigNow = () => { throw Object.assign(new Error(`413 {"code":10402,"message":"Repository exceeded the 40MB import limit. Current depth is 1."}`), { code: "MEMORY_LIMIT" }); };
