import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addWorktree, finished, removeWorktree, RUN_TTL, worktreeRoot } from "../src/worktrees.ts";
import { local as boot } from "../src/local.ts";

setDefaultTimeout(30_000);
const root = mkdtempSync(join(tmpdir(), "codesplitter-worktrees-"));
writeFileSync(join(root, "gitconfig"), "[user]\n\tname = Ana Real\n\temail = ana@example.com\n[init]\n\tdefaultBranch = main\n");
process.env.GIT_CONFIG_GLOBAL = join(root, "gitconfig");
const opened: { close(): void }[] = [];
afterAll(() => { for (const o of opened) o.close(); rmSync(root, { recursive: true, force: true }); });

const sh = async (cmd: string, cwd = root) => {
  const p = Bun.spawn(["sh", "-c", cmd], { cwd, stdout: "pipe", stderr: "pipe", env: process.env });
  const [code, out, err] = await Promise.all([p.exited, new Response(p.stdout).text(), new Response(p.stderr).text()]);
  if (code) throw new Error(`${cmd}: ${err}`);
  return out.trim();
};

test("a worktree per branch or per run, off a bare repo, and cleaned up once it's done with", async () => {
  const bare = join(root, "ana--wt.git"), seed = mkdtempSync(join(root, "seed-"));
  await sh(`git init -q --bare ${bare} && git clone -q ${bare} . 2>/dev/null; printf 'hi\\n' > a.txt && git add -A && git commit -qm init && git push -q origin main`, seed);
  const main = await sh(`git --git-dir ${bare} rev-parse main`);

  // A branch: made off main, checked out in a directory beside the bare repos, not among them.
  const b = await addWorktree(bare, { branch: "feat/x", from: "main" });
  expect(b).toMatchObject({ name: "feat--x", branch: "feat/x", sha: main, base: main, path: join(worktreeRoot(bare), "feat--x") });
  expect(worktreeRoot(bare)).toBe(join(root, ".worktrees", "ana--wt"));
  expect(await Bun.file(join(b.path, "a.txt")).text()).toBe("hi\n");
  const w = { ...b, created_at: Date.now() };
  // Fresh, nothing of its own yet: not merged, just new.
  expect(await finished(bare, w, "main")).toBe(false);

  // A commit in it lands on the bare repo's branch.
  await sh(`printf 'more\\n' >> a.txt && git commit -qam more`, b.path);
  const tip = await sh(`git --git-dir ${bare} rev-parse feat/x`);
  expect(tip).not.toBe(main);
  expect(await finished(bare, w, "main")).toBe(false);
  // Changes nobody committed keep it, merged or not.
  await sh(`git --git-dir ${bare} update-ref refs/heads/main ${tip}`);
  writeFileSync(join(b.path, "wip.txt"), "wip\n");
  expect(await finished(bare, w, "main")).toBe(false);
  rmSync(join(b.path, "wip.txt"));
  // Main holds all of it: done.
  expect(await finished(bare, w, "main")).toBe(true);
  await removeWorktree(bare, b.path);
  expect(existsSync(b.path)).toBe(false);
  expect(await sh(`git --git-dir ${bare} rev-parse feat/x`)).toBe(tip);   // the branch stays
  expect(await sh(`git --git-dir ${bare} worktree list --porcelain`)).not.toContain("feat--x");

  // A run: detached at its commit, gone after a day.
  const r = await addWorktree(bare, { sha: main });
  expect(r).toMatchObject({ name: `run-${main.slice(0, 12)}`, branch: null, sha: main });
  expect(await sh(`git rev-parse HEAD`, r.path)).toBe(main);
  await expect(addWorktree(bare, { sha: main })).rejects.toThrow("already");
  const now = Date.now();
  expect(await finished(bare, { ...r, created_at: now }, "main", now + 1000)).toBe(false);
  expect(await finished(bare, { ...r, created_at: now }, "main", now + RUN_TTL + 1)).toBe(true);
  // A directory deleted by hand is done with too.
  rmSync(r.path, { recursive: true, force: true });
  expect(await finished(bare, { ...r, created_at: now }, "main")).toBe(true);
});

test("the worktrees route: owner only, never main itself, and a run's goes when it's removed", async () => {
  const call = await boot();
  opened.push(call);
  const post = (user: string, path: string, body: unknown) => call(user, path, { method: "POST", body: JSON.stringify(body) });
  await post("ana", "/api/login", { name: "ana" });
  expect((await post("ana", "/api/repos", { name: "wt" })).status).toBe(201);
  // No git until something's committed.
  expect((await post("ana", "/api/repos/ana/wt/worktrees", { branch: "x" })).status).toBe(409);
  expect((await post("ana", "/api/repos/ana/wt/files", { path: "a.txt", content: "hi" })).status).toBeLessThan(300);
  expect((await post("ana", "/api/repos/ana/wt/do/commit?path=a.txt", { message: "first" })).status).toBe(200);
  const bare = call.artifacts.path("ana--wt"), main = await sh(`git --git-dir ${bare} rev-parse main`);

  expect((await post("bo", "/api/repos/ana/wt/worktrees", { branch: "x" })).status).toBe(403);   // not the owner
  expect((await post("ana", "/api/repos/ana/wt/worktrees", { branch: "main" })).status).toBe(409);
  expect((await post("ana", "/api/repos/ana/wt/worktrees", { branch: "x", sha: main })).status).toBe(400);
  expect((await post("ana", "/api/repos/ana/wt/worktrees", { sha: "0".repeat(40) })).status).toBe(404);

  const b = await post("ana", "/api/repos/ana/wt/worktrees", { branch: "x" });
  expect(b.status).toBe(201);
  const made = await b.json() as any;
  expect(made).toMatchObject({ name: "x", branch: "x", sha: main });
  expect(await Bun.file(join(made.path, "a.txt")).text()).toBe("hi\n");
  expect((await post("ana", "/api/repos/ana/wt/worktrees", { branch: "x" })).status).toBe(409);
  const run = await (await post("ana", "/api/repos/ana/wt/worktrees", { sha: main })).json() as any;
  expect((await (await call("ana", "/api/repos/ana/wt/worktrees")).json() as any[]).map((w) => w.name)).toEqual(["x", run.name]);

  // The run ends: its worktree goes, the branch's stays.
  expect((await call("ana", `/api/repos/ana/wt/worktrees/${run.name}`, { method: "DELETE" })).status).toBe(200);
  expect(existsSync(run.path)).toBe(false);
  expect((await (await call("ana", "/api/repos/ana/wt/worktrees")).json() as any[]).map((w) => w.name)).toEqual(["x"]);
  // Deleting the repo takes its worktrees with it.
  expect((await call("ana", "/api/repos/ana/wt?confirm=wt", { method: "DELETE" })).status).toBeLessThan(300);
  expect(existsSync(made.path)).toBe(false);
});
