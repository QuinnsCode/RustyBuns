import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalArtifacts, gitHttp } from "../src/bindings/artifacts.ts";

const dir = mkdtempSync(join(tmpdir(), "rb-artifacts-"));
const ns = new LocalArtifacts(join(dir, "repos"), "default");
const srv = Bun.serve({ port: 0, fetch: (req) => gitHttp(req, [ns]) });
ns.remoteBase = `http://127.0.0.1:${srv.port}`;
afterAll(() => { srv.stop(true); rmSync(dir, { recursive: true, force: true }); });

// Async: the git client talks to a server on this same event loop.
const sh = async (args: string[], cwd: string) => {
  const p = Bun.spawn(args, { cwd, stdout: "pipe", stderr: "pipe", env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
  return { ok: (await p.exited) === 0, out: (await new Response(p.stdout).text()) + (await new Response(p.stderr).text()) };
};
const withToken = (remote: string, token: string) => remote.replace("http://", `http://x:${token.split("?")[0]}@`);
const git = ["git", "-c", "user.name=t", "-c", "user.email=t@t"];

/** A local repo with one commit, pushed to a new artifact. */
async function seeded(name: string, files: Record<string, string>) {
  const { remote, token } = await ns.create(name);
  const work = join(dir, "w-" + name);
  await sh(["git", "init", "-q", "-b", "main", work], dir);
  for (const [p, c] of Object.entries(files)) await Bun.write(join(work, p), c);
  await sh(["git", "add", "."], work);
  await sh([...git, "commit", "-qm", "first"], work);
  expect((await sh(["git", "push", "-q", withToken(remote, token), "main"], work)).ok).toBe(true);
  return { remote, work };
}

test("a real git client pushes to and clones from a local Artifacts repo, behind its token", async () => {
  const { remote, token, defaultBranch } = await ns.create("starter", { description: "hi" });
  expect(defaultBranch).toBe("main");
  expect(remote).toBe(`http://127.0.0.1:${srv.port}/__rb/git/default/starter.git`);
  const work = join(dir, "work");
  await sh(["git", "init", "-q", "-b", "main", work], dir);
  await Bun.write(join(work, "a.txt"), "hello\n");
  await sh(["git", "add", "."], work);
  await sh([...git, "commit", "-qm", "first"], work);
  expect((await sh(["git", "push", "-q", remote, "main"], work)).ok).toBe(false);           // no token
  expect((await sh(["git", "push", "-q", withToken(remote, token), "main"], work)).ok).toBe(true);

  const repo = await ns.get("starter");
  const read = (await repo.createToken("read", 60)).plaintext;
  expect((await sh(["git", "push", "-q", withToken(remote, read), "main"], work)).ok).toBe(false); // read token can't push
  expect((await sh(["git", "clone", "-q", withToken(remote, read), join(dir, "clone")], dir)).ok).toBe(true);
  expect(await Bun.file(join(dir, "clone", "a.txt")).text()).toBe("hello\n");
  expect(await (await repo.readFile({ ref: "main", path: "a.txt" }))!.text()).toBe("hello\n");
  expect(await repo.readFile({ ref: "main", path: "nope" })).toBeNull();
  const info = await repo.info();
  expect([info.name, info.description, info.defaultBranch, info.readOnly, info.source]).toEqual(["starter", "hi", "main", false, null]);
  expect(await ns.delete("starter")).toBe(true);
  await expect(ns.get("starter")).rejects.toThrow("NOT_FOUND");
});

test("log, readCommit, readTree and readBlob have Cloudflare's shapes", async () => {
  await seeded("shapes", { "a.txt": "A\n", "src/b.ts": "export {}\n" });
  const repo = await ns.get("shapes");
  const [c] = await repo.log({ limit: 1 });
  expect(c!.hash).toMatch(/^[0-9a-f]{40}$/);
  expect(c!.treeHash).toMatch(/^[0-9a-f]{40}$/);
  expect([c!.message, c!.parents, c!.author.name, typeof c!.authoredAt]).toEqual(["first", [], "t", "number"]);
  expect(await repo.readCommit(c!.hash)).toEqual(c!);
  expect(await repo.readCommit(c!.treeHash)).toBeNull();                 // a tree is not a commit
  const root = (await repo.readTree(c!.treeHash))!;
  expect(root.map((e) => [e.name, e.mode, e.type])).toEqual([["a.txt", "100644", "blob"], ["src", "40000", "tree"]]);
  const src = (await repo.readTree(root[1]!.hash))!;
  expect(await (await repo.readBlob(src[0]!.hash))!.text()).toBe("export {}\n");
  await expect(repo.readTree("nope")).rejects.toThrow("INVALID_INPUT");
  expect(await repo.readFile({ ref: "main", path: "src" })).toBeNull();      // a folder is not a file
});

test("import is shallow and in progress until it lands; forks are writable copies", async () => {
  const { work } = await seeded("upstream", { "x.txt": "1\n" });
  await Bun.write(join(work, "x.txt"), "2\n");
  await sh([...git, "commit", "-qam", "second"], work);
  await sh(["git", "push", "-q", withToken(ns.remote("upstream"), (await (await ns.get("upstream")).createToken()).plaintext), "main"], work);

  // A real import needs the network (checked by hand, not in CI); here, only the URL rule.
  await expect(ns.import({ source: { url: "http://example.com/x.git" }, target: { name: "bad" } })).rejects.toThrow("INVALID_INPUT");

  const lvl = await ns.create("level", { readOnly: true });
  expect((await ns.get("level")).infoSync().readOnly).toBe(true);
  expect(ns.check("level", lvl.token.split("?")[0]!, true)).toBe(false);  // read-only: no pushes

  const up = await ns.get("upstream");
  const f = await up.fork("mine", { description: "my dig" });
  expect(f.remote).toBe(ns.remote("mine"));
  const mine = await ns.get("mine");
  expect((await mine.info()).source).toBe("artifacts:default/upstream");
  expect((await mine.log()).map((c) => c.message)).toEqual(["second", "first"]);
  expect(ns.check("mine", f.token.split("?")[0]!, true)).toBe(true);
  expect((await ns.list({ limit: 2 })).total).toBeGreaterThanOrEqual(4);
});

test("tokens are per repo", async () => {
  const a = await ns.create("a1");
  await ns.create("b1");
  expect(ns.check("a1", a.token.split("?")[0]!, true)).toBe(true);
  expect(ns.check("b1", a.token.split("?")[0]!, false)).toBe(false);
});
