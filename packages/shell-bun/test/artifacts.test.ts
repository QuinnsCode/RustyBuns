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

test("a real git client pushes to and clones from a local Artifacts repo, behind its token", async () => {
  const { remote, token, defaultBranch } = await ns.create("starter", { description: "hi" });
  expect(defaultBranch).toBe("main");
  expect(remote).toBe(`http://127.0.0.1:${srv.port}/__rb/git/default/starter.git`);

  const work = join(dir, "work");
  await sh(["git", "init", "-q", "-b", "main", work], dir);
  await Bun.write(join(work, "a.txt"), "hello\n");
  await sh(["git", "add", "."], work);
  await sh(["git", "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "first"], work);
  expect((await sh(["git", "push", "-q", remote, "main"], work)).ok).toBe(false);           // no token
  expect((await sh(["git", "push", "-q", withToken(remote, token), "main"], work)).ok).toBe(true);

  const repo = await ns.get("starter");
  const read = (await repo.createToken("read", 60)).plaintext;
  expect((await sh(["git", "push", "-q", withToken(remote, read), "main"], work)).ok).toBe(false); // read token can't push
  expect((await sh(["git", "clone", "-q", withToken(remote, read), join(dir, "clone")], dir)).ok).toBe(true);
  expect(await Bun.file(join(dir, "clone", "a.txt")).text()).toBe("hello\n");

  const log = await repo.log();
  expect(log.map((c) => c.message)).toEqual(["first"]);
  expect(await (await repo.readFile({ ref: "main", path: "a.txt" }))!.text()).toBe("hello\n");
  expect(await repo.readFile({ ref: "main", path: "nope" })).toBeNull();
  expect((await ns.list()).repos.map((r) => r.name)).toEqual(["starter"]);
  expect(await ns.delete("starter")).toBe(true);
  await expect(ns.get("starter")).rejects.toThrow("NOT_FOUND");
});

test("tokens are per repo", async () => {
  const a = await ns.create("a1");
  await ns.create("b1");
  expect(ns.check("a1", a.token.split("?")[0]!, true)).toBe(true);
  expect(ns.check("b1", a.token.split("?")[0]!, false)).toBe(false);
});
