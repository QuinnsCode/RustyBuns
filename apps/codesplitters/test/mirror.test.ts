import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { local as boot, type Call } from "../src/local.ts";

setDefaultTimeout(30_000);
// Upstream: a bare repo on disk, so "GitHub goes down" is a rename. Commits go up as this identity.
const root = mkdtempSync(join(tmpdir(), "codesplitters-mirror-"));
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
const post = (call: Call, path: string, body: unknown = {}) => call("ana", path, { method: "POST", body: JSON.stringify(body) });
const get = async (call: Call, path: string) => (await call("ana", path)).json() as Promise<any>;
const sync = async (call: Call, body: unknown = {}) => (await post(call, "/api/repos/ana/up/mirror", body)).json() as Promise<any>;
const file = async (call: Call, path: string) => get(call, `/api/repos/ana/up/do/file?path=${encodeURIComponent(path)}`);
/** Set line `n` (from 1) of a file here, then commit it. */
async function editHere(call: Call, path: string, n: number, text: string, commit = true) {
  const line = (await file(call, path)).lines[n - 1];
  const r = await post(call, `/api/repos/ana/up/do/ops?path=${encodeURIComponent(path)}`, { ops: [{ kind: "set", line: line.id, base: line.rev, text }] });
  expect(r.status).toBe(200);
  if (commit) expect((await post(call, `/api/repos/ana/up/do/commit?path=${encodeURIComponent(path)}`, { message: `edit ${path}` })).status).toBe(200);
}
/** Upstream starts over: one new commit of `files`, force-pushed over its history. */
async function upstreamRewrite(files: Record<string, string>, message: string) {
  const work = mkdtempSync(join(root, "work-"));
  await sh(`git init -q -b main . && git config user.name Bo && git config user.email bo@example.com`, work);
  for (const [p, c] of Object.entries(files)) { await sh(`mkdir -p "$(dirname ${p})"`, work); writeFileSync(join(work, p), c); }
  await sh(`git add -A && git commit -qm "${message}" && git push -qf ${up} main`, work);
}
/** A fresh upstream with a couple of files, and a signed-in desktop with a mirror of it. */
async function mirrored(name: string) {
  up = join(root, `${name}.git`);
  const seed = mkdtempSync(join(root, "seed-"));
  await sh(`git init -q --bare ${up} && git clone -q ${up} . 2>/dev/null; mkdir src && printf 'hello\\nworld\\n' > README && printf 'export const a = 1\\n' > src/a.ts && git add -A && git commit -qm init && git push -q origin main`, seed);
  const call = await boot();
  opened.push(call);
  await post(call, "/api/login", { name: "ana" });
  expect((await post(call, "/api/mirrors", { url: `file://${up}`, name: "up" })).status).toBe(201);
  return call;
}
/** Somebody else pushes to upstream. */
async function upstreamCommit(files: Record<string, string>, message: string) {
  const work = mkdtempSync(join(root, "work-"));
  await sh(`git clone -q ${up} . && git config user.name Bo && git config user.email bo@example.com`, work);
  for (const [p, c] of Object.entries(files)) { await sh(`mkdir -p "$(dirname ${p})"`, work); writeFileSync(join(work, p), c); }
  await sh(`git add -A && git commit -qm "${message}" && git push -q origin main`, work);
}
const upLog = (fmt: string) => sh(`git --git-dir ${up} log -1 --format=${fmt} main`);
const upShow = (path: string) => sh(`git --git-dir ${up} show main:${path}`);

let up = join(root, "up.git");

describe("mirrors", () => {
  test("keep in step with upstream, ride out an outage, and stop at a clash", async () => {
    // Upstream, with a couple of files.
    const seed = mkdtempSync(join(root, "seed-"));
    await sh(`git init -q --bare ${up} && git clone -q ${up} . 2>/dev/null; mkdir src && printf 'hello\\nworld\\n' > README && printf 'export const a = 1\\n' > src/a.ts && git add -A && git commit -qm init && git push -q origin main`, seed);

    const call = await boot();
    opened.push(call);
    await post(call, "/api/login", { name: "ana" });
    // file:// so the clone is shallow, as it is from GitHub.
    const made = await post(call, "/api/mirrors", { url: `file://${up}` });
    expect(made.status).toBe(201);
    expect(await made.json()).toMatchObject({ owner: "ana", name: "up", mirror: true, upstream: `file://${up}` });
    expect(await sh(`git --git-dir ${call.artifacts.path("ana--up")} rev-parse --is-shallow-repository`)).toBe("true");
    expect(await get(call, "/api/repos/ana/up")).toMatchObject({ mirror: true, branch: "main" });
    expect(await sync(call)).toMatchObject({ state: "ok", ahead: 0, behind: 0, identity: { name: "Ana Real", email: "ana@example.com" } });

    // A commit here goes upstream, as this machine's git identity.
    await editHere(call, "README", 1, "hello from here");
    expect(await sync(call)).toMatchObject({ state: "ok", ahead: 0 });
    expect(await upShow("README")).toBe("hello from here\nworld");
    expect(await upLog("%an/%ae/%s")).toBe("Ana Real/ana@example.com/edit README");

    // Upstream's commits come here: an open file gets them as line edits, a new file shows in the tree.
    await file(call, "src/a.ts");
    await upstreamCommit({ "src/a.ts": "export const a = 2\n", "src/b.ts": "export const b = 1\n" }, "bo's change");
    expect(await sync(call)).toMatchObject({ state: "ok", ahead: 0, behind: 0 });
    const a = await file(call, "src/a.ts");
    expect(a.lines.map((l: any) => [l.text, l.by])).toEqual([["export const a = 2", "upstream"]]);
    expect((await get(call, "/api/repos/ana/up/tree?path=src")).entries.map((e: any) => e.name)).toEqual(["a.ts", "b.ts"]);

    // Upstream goes away. Work carries on here, and the mirror says so.
    renameSync(up, up + ".away");
    await editHere(call, "README", 2, "world, offline");
    const down = await sync(call);
    expect(down).toMatchObject({ state: "down", ahead: 1 });
    expect(down.downSince).toBeGreaterThan(0);
    expect(down.nextAt).toBeGreaterThan(Date.now());
    await editHere(call, "src/a.ts", 1, "export const a = 3");
    expect(await sync(call)).toMatchObject({ state: "down", ahead: 2, downSince: down.downSince });

    // It's back: everything made meanwhile goes up.
    renameSync(up + ".away", up);
    expect(await sync(call)).toMatchObject({ state: "ok", ahead: 0, downSince: null, error: null });
    expect(await upShow("README")).toBe("hello from here\nworld, offline");
    expect(await upShow("src/a.ts")).toBe("export const a = 3");

    // Both sides change the same line: it stops, nothing moves, until the owner picks.
    await upstreamCommit({ "README": "hello from bo\nworld, offline\n", "src/b.ts": "export const b = 2\n" }, "bo again");
    await editHere(call, "README", 1, "hello from ana");
    const clash = await sync(call);
    expect(clash).toMatchObject({ state: "clash", clash: ["README"] });
    expect(await upShow("README")).toBe("hello from bo\nworld, offline");
    expect((await post(call, "/api/repos/ana/up/mirror", { resolve: "sideways" })).status).toBe(400);
    expect((await call("bob", "/api/repos/ana/up/mirror", { method: "POST", body: "{}" })).status).toBe(403);

    // Keep mine: our README wins, upstream's other change still comes in, and it all goes up.
    expect(await sync(call, { resolve: "mine" })).toMatchObject({ state: "ok", ahead: 0, clash: [] });
    expect(await upShow("README")).toBe("hello from ana\nworld, offline");
    expect(await upShow("src/b.ts")).toBe("export const b = 2");
    expect(await sh(`git --git-dir ${up} log -1 --format=%p main`)).toContain(" ");   // a merge commit

    // A live edit, not committed, against an upstream change to the same line: a clash, then take upstream's.
    await upstreamCommit({ "src/a.ts": "export const a = 4\n" }, "bo's a");
    await editHere(call, "src/a.ts", 1, "export const a = 99", false);
    expect(await sync(call)).toMatchObject({ state: "clash", clash: ["src/a.ts"] });
    expect(await sync(call, { resolve: "upstream" })).toMatchObject({ state: "ok" });
    expect((await file(call, "src/a.ts")).lines.map((l: any) => l.text)).toEqual(["export const a = 4"]);
  });

  test("upstream rewrites its history: re-base this copy's commits on it, or take upstream's", async () => {
    const call = await mirrored("rewritten");
    await editHere(call, "README", 1, "hello from here");
    expect(await sync(call)).toMatchObject({ state: "ok", ahead: 0 });

    // Upstream squashes its history into one commit and force-pushes it, and a commit lands here meanwhile.
    await upstreamRewrite({ "README": "hello from here\nworld\n", "src/a.ts": "export const a = 10\n" }, "start over");
    const theirs = await upLog("%H");
    await editHere(call, "README", 2, "world, from here");
    const stuck = await sync(call);
    expect(stuck).toMatchObject({ state: "rewritten" });
    expect(stuck.error).toMatch(/rewritten/);
    expect(await upLog("%H")).toBe(theirs);   // nothing pushed, nothing forced

    // Re-base: this copy's commits go on top of upstream's new history, and up as a fast-forward.
    expect(await sync(call, { resolve: "rebase" })).toMatchObject({ state: "ok", ahead: 0, behind: 0 });
    expect(await upShow("README")).toBe("hello from here\nworld, from here");
    expect(await upShow("src/a.ts")).toBe("export const a = 10");
    expect(await sh(`git --git-dir ${up} log --format=%s main`)).toBe("edit README\nstart over");
    expect(await sh(`git --git-dir ${up} log -1 --format=%an main`)).toBe("Ana Real");

    // Again, but this time take upstream's: this copy's commit is dropped, its open file follows.
    await upstreamRewrite({ "README": "brand\nnew\n" }, "start over again");
    await editHere(call, "README", 1, "mine, unpushed");
    expect(await sync(call)).toMatchObject({ state: "rewritten" });
    expect(await sync(call, { resolve: "upstream" })).toMatchObject({ state: "ok", ahead: 0, behind: 0 });
    expect(await sh(`git --git-dir ${up} log --format=%s main`)).toBe("start over again");
    expect((await file(call, "README")).lines.map((l: any) => l.text)).toEqual(["brand", "new"]);
    expect((await get(call, "/api/repos/ana/up/tree")).entries.map((e: any) => e.name)).toEqual(["README"]);
  });

  test("private lines: held, until the owner pushes the crew's copy", async () => {
    const call = await mirrored("crew");
    // A secret on line 2, made private, then committed: the repo's git has it blank.
    await editHere(call, "README", 2, "token=s3cret", false);
    const secret = (await file(call, "README")).lines[1];
    expect((await post(call, "/api/repos/ana/up/do/private?path=README", { lines: [secret.id], private: true })).status).toBe(200);
    await editHere(call, "README", 1, "hello from here");
    const pub = call.artifacts.path("ana--up");
    expect(await sh(`git --git-dir ${pub} show main:README`)).toBe("hello from here");
    expect(await sync(call)).toMatchObject({ state: "held", private: true, pushCrew: false });
    expect(await upShow("README")).toBe("hello\nworld");
    expect((await post(call, "/api/repos/ana/up/mirror", { pushCrew: "yes" })).status).toBe(400);

    // The owner says push the crew's copy: the real text goes up.
    expect(await sync(call, { pushCrew: true })).toMatchObject({ state: "ok", ahead: 0, pushCrew: true });
    expect(await upShow("README")).toBe("hello from here\ntoken=s3cret");
    expect(await upLog("%an")).toBe("Ana Real");

    // Upstream's next change reaches the repo's own git too, file by file: none of upstream's commits, the secret still blank.
    await upstreamCommit({ "src/a.ts": "export const a = 2\n", "README": "hello from here\ntoken=s3cret\nmore\n" }, "bo's change");
    expect(await sync(call)).toMatchObject({ state: "ok", ahead: 0, behind: 0 });
    expect(await sh(`git --git-dir ${pub} show main:src/a.ts`)).toBe("export const a = 2");
    expect(await sh(`git --git-dir ${pub} show main:README`)).toBe("hello from here");
    expect(await sh(`git --git-dir ${pub} cat-file -e ${await upLog("%H")} 2>&1 || echo missing`)).toBe("missing");
    expect((await file(call, "README")).lines.map((l: any) => l.text)).toEqual(["hello from here", "token=s3cret", "more"]);

    // And back to held.
    expect(await sync(call, { pushCrew: false })).toMatchObject({ pushCrew: false });
  });

  test("takes any git URL on the desktop, and says what's wrong with a bad one", async () => {
    const call = await boot();
    opened.push(call);
    await post(call, "/api/login", { name: "ana" });
    expect((await post(call, "/api/mirrors", { url: "not a remote" })).status).toBe(400);
    const gone = await post(call, "/api/mirrors", { url: join(root, "nothing-here.git") });
    expect(gone.status).toBe(502);
    expect((await gone.json() as any).error).toMatch(/couldn't clone/);
    expect((await get(call, "/api/repos/ana/up")).error).toBe("not found");
    expect((await call(null, "/api/mirrors", { method: "POST", body: JSON.stringify({ url: up }) })).status).toBe(401);
  });
});
