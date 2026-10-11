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
async function upstreamRewrite(files: Record<string, string>, message: string, work?: string) {
  if (!work) { work = mkdtempSync(join(root, "work-")); await sh(`git init -q -b main .`, work); }
  await sh(`git config user.name Bo && git config user.email bo@example.com`, work);
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

  test("where git truth lives settles clashes and rewrites without asking, and keeps what it drops", async () => {
    const call = await mirrored("truth");
    const truth = (git_truth: string) => call("ana", "/api/me", { method: "PUT", body: JSON.stringify({ git_truth }) });
    expect((await truth("gitlab")).status).toBe(400);
    expect(await sync(call)).toMatchObject({ truth: "ask" });

    // GitHub: upstream's lines win a clash.
    expect((await (await truth("github")).json()).git_truth).toBe("github");
    await upstreamCommit({ "README": "hello from bo\nworld\n" }, "bo");
    await editHere(call, "README", 1, "hello from ana");
    expect(await sync(call)).toMatchObject({ state: "ok", truth: "github", ahead: 0, behind: 0 });
    expect(await upShow("README")).toBe("hello from bo\nworld");

    // codeSplitters: the edits here win, even ones not committed yet.
    await truth("codesplitters");
    await upstreamCommit({ "src/a.ts": "export const a = 2\n" }, "bo's a");
    await editHere(call, "src/a.ts", 1, "export const a = 99", false);
    expect(await sync(call)).toMatchObject({ state: "ok" });
    expect((await file(call, "src/a.ts")).lines.map((l: any) => l.text)).toEqual(["export const a = 99"]);
    expect((await post(call, `/api/repos/ana/up/do/commit?path=${encodeURIComponent("src/a.ts")}`, { message: "a" })).status).toBe(200);
    expect(await sync(call)).toMatchObject({ state: "ok", ahead: 0 });
    expect(await upShow("src/a.ts")).toBe("export const a = 99");

    // The artifact: commits win, but an edit not committed yet still asks.
    await truth("artifact");
    await upstreamCommit({ "src/a.ts": "export const a = 3\n" }, "bo's a again");
    await editHere(call, "src/a.ts", 1, "export const a = 100", false);
    expect(await sync(call)).toMatchObject({ state: "clash", clash: ["src/a.ts"] });
    expect(await sync(call, { resolve: "mine" })).toMatchObject({ state: "ok" });

    // GitHub again, and upstream rewrites its history: upstream's is taken, and this copy's commit is kept under refs/kept.
    await truth("github");
    await upstreamRewrite({ "README": "brand\nnew\n" }, "start over");
    await editHere(call, "README", 1, "mine, unpushed");
    const mine = await sh(`git --git-dir ${call.artifacts.path("ana--up")} rev-parse main`);
    expect(await sync(call)).toMatchObject({ state: "ok", ahead: 0, behind: 0 });
    expect(await sh(`git --git-dir ${up} log --format=%s main`)).toBe("start over");
    expect(await sh(`git --git-dir ${call.artifacts.path("ana--up")} for-each-ref --format='%(objectname)' refs/kept`)).toBe(mine);
  });

  test("a force-pushed upstream is fetched only as far back as the last commit both sides agreed on", async () => {
    const call = await mirrored("shallow");
    // Upstream starts over with a long-ago past: a dozen old commits under a new tip.
    const work = mkdtempSync(join(root, "work-"));
    await sh(`git init -q -b main . && for i in $(seq 1 12); do echo $i > old; git add old; GIT_COMMITTER_DATE="2001-01-$i 12:00" git commit -qm "old $i"; done`, work);
    await upstreamRewrite({ "README": "brand\nnew\n" }, "start over", work);
    expect(await sync(call)).toMatchObject({ state: "rewritten" });
    const { artifact } = await call.env.DB.prepare("SELECT artifact FROM repos WHERE owner = 'ana' AND name = 'up'").first() as { artifact: string };
    expect(await sh(`git --git-dir ${call.artifacts.path(artifact)} rev-list --count refs/upstream/main`)).toBe("1");

    expect(await sync(call, { resolve: "upstream" })).toMatchObject({ state: "ok", ahead: 0, behind: 0 });
    expect((await file(call, "README")).lines.map((l: any) => l.text)).toEqual(["brand", "new"]);
    // Upstream winds back to one of those old commits: nothing newer to fetch, so it's fetched the plain way.
    await sh(`git push -qf ${up} HEAD~1:main`, work);
    expect(await sync(call, { resolve: "upstream" })).toMatchObject({ state: "ok", ahead: 0, behind: 0 });
    expect((await get(call, "/api/repos/ana/up/tree")).entries.map((e: any) => e.name)).toEqual(["old"]);
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

    // And back to held: upstream has the secret's real text, the repo's own git has it blank. That's no clash:
    // nothing goes up while held, so the private-lined README keeps the repo's own copy.
    expect(await sync(call, { pushCrew: false })).toMatchObject({ state: "ok", pushCrew: false, clash: [] });
    expect(await sh(`git --git-dir ${pub} show main:README`)).toBe("hello from here");
    expect(await sh(`git --git-dir ${pub} show main:src/a.ts`)).toBe("export const a = 2");
    expect((await file(call, "README")).lines.map((l: any) => l.text)).toEqual(["hello from here", "token=s3cret", "more"]);
    expect(await upShow("README")).toBe("hello from here\ntoken=s3cret\nmore");
    // Upstream moves on while held: its other files still come in.
    await upstreamCommit({ "src/a.ts": "export const a = 3\n" }, "bo's next change");
    expect(await sync(call)).toMatchObject({ state: "ok", clash: [] });
    expect(await sh(`git --git-dir ${pub} show main:src/a.ts`)).toBe("export const a = 3");
    expect(await sh(`git --git-dir ${pub} show main:README`)).toBe("hello from here");
    expect(await sh(`git --git-dir ${pub} cat-file -e ${await upLog("%H")} 2>&1 || echo missing`)).toBe("missing");
    // A commit here while held stays here.
    await editHere(call, "src/a.ts", 1, "export const a = 4");
    expect(await sync(call)).toMatchObject({ state: "held", ahead: 1, clash: [] });
    expect(await upShow("src/a.ts")).toBe("export const a = 3");
  });

  test("branches: push one upstream as a git branch, open upstream's here", async () => {
    const call = await mirrored("branches");
    const q = (path: string, b: string) => `?path=${encodeURIComponent(path)}&branch=${encodeURIComponent(b)}`;
    // An agent's branch: an edit to README and a new file.
    expect((await post(call, "/api/repos/ana/up/collaborators", { name: "agent-a" })).status).toBe(200);
    expect((await call("agent-a", "/api/repos/ana/up/branches", { method: "POST", body: JSON.stringify({ name: "tidy" }) })).status).toBe(201);
    const line = (await get(call, `/api/repos/ana/up/do/file${q("README", "tidy")}`)).lines[1];
    expect((await call("agent-a", `/api/repos/ana/up/do/ops${q("README", "tidy")}`, { method: "POST", body: JSON.stringify({ ops: [{ kind: "set", line: line.id, base: line.rev, text: "world, tidied" }] }) })).status).toBe(200);
    expect((await call("agent-a", "/api/repos/ana/up/files", { method: "POST", body: JSON.stringify({ path: "src/c.ts", content: "export const c = 1", branch: "tidy" }) })).status).toBe(201);

    // Only the owner pushes; it lands upstream as a branch on main's tip, main untouched.
    expect((await call("agent-a", "/api/repos/ana/up/mirror/branches/tidy/push", { method: "POST" })).status).toBe(403);
    const mainTip = await upLog("%H");
    const pushed = await (await post(call, "/api/repos/ana/up/mirror/branches/tidy/push")).json() as any;
    expect(pushed).toMatchObject({ ref: "tidy", pushed: true });
    expect(await sh(`git --git-dir ${up} show tidy:README`)).toBe("hello\nworld, tidied");
    expect(await sh(`git --git-dir ${up} show tidy:src/c.ts`)).toBe("export const c = 1");
    expect(await sh(`git --git-dir ${up} log -1 --format=%P%n%an%n%B tidy`)).toBe(`${mainTip}\nAna Real\ntidy, from codeSplitters\n\nCo-authored-by: agent-a <agent-a@codesplitters.local>`);
    expect(await upLog("%H")).toBe(mainTip);
    // Nothing new: nothing pushed. Main moves on: the next push merges it in, a fast-forward upstream.
    expect(await (await post(call, "/api/repos/ana/up/mirror/branches/tidy/push")).json()).toMatchObject({ pushed: false, commit: pushed.commit });
    await upstreamCommit({ "src/a.ts": "export const a = 2\n" }, "bo's change");
    expect(await sync(call)).toMatchObject({ state: "ok" });
    const again = await (await post(call, "/api/repos/ana/up/mirror/branches/tidy/push")).json() as any;
    expect(again).toMatchObject({ pushed: true });
    expect(await sh(`git --git-dir ${up} log -1 --format=%P tidy`)).toBe(`${pushed.commit} ${await upLog("%H")}`);
    expect(await sh(`git --git-dir ${up} show tidy:src/a.ts`)).toBe("export const a = 2");

    // Somebody's branch upstream: listed, then opened here with what it changed, under its own name (#701).
    const work = mkdtempSync(join(root, "work-"));
    await sh(`git clone -q ${up} . && git config user.name Bo && git config user.email bo@example.com && git checkout -qb Feature/Shiny && printf 'hello\\nworld\\nshiny\\n' > README && printf 'new\\n' > NEW && git add -A && git commit -qm shiny && git push -q origin Feature/Shiny`, work);
    const list = await get(call, "/api/repos/ana/up/mirror/branches");
    expect(list.map((b: any) => [b.ref, b.branch])).toEqual([["Feature/Shiny", null], ["tidy", "tidy"]]);
    expect(list.every((b: any) => b.at > 0)).toBe(true);
    expect((await post(call, "/api/repos/ana/up/mirror/branches", { ref: "nope" })).status).toBe(404);
    const made = await post(call, "/api/repos/ana/up/mirror/branches", { ref: "Feature/Shiny" });
    expect(made.status).toBe(201);
    expect(await made.json()).toMatchObject({ name: "Feature/Shiny", files: ["NEW", "README"], skipped: [] });
    expect((await post(call, "/api/repos/ana/up/mirror/branches", { ref: "Feature/Shiny" })).status).toBe(409);
    const review = await get(call, "/api/repos/ana/up/branches/Feature%2FShiny");
    expect(review.files.map((f: any) => [f.path, f.ops.length, f.conflicts.length])).toEqual([["NEW", 1, 0], ["README", 1, 0]]);
    expect((await get(call, "/api/repos/ana/up/mirror/branches")).find((b: any) => b.ref === "Feature/Shiny")).toMatchObject({ branch: "Feature/Shiny", status: "open" });

    // Bo carries on upstream: the next sync brings it here. Pull says there's nothing more.
    const text = async (path: string, b: string) => (await get(call, `/api/repos/ana/up/do/file${q(path, b)}`)).lines.map((l: any) => l.text).join("\n");
    await sh(`printf 'new\\nnewer\\n' > NEW && git commit -qam newer && git push -q origin Feature/Shiny`, work);
    expect(await sync(call)).toMatchObject({ state: "ok" });
    expect(await text("NEW", "Feature/Shiny")).toBe("new\nnewer");
    expect(await (await post(call, "/api/repos/ana/up/mirror/branches/Feature%2FShiny/pull")).json()).toMatchObject({ ref: "Feature/Shiny", files: [] });
    expect((await post(call, "/api/repos/ana/up/mirror/branches/Feature%2FShiny/nope")).status).toBe(404);

    // Edited here, it goes back to the branch it came from, on top of Bo's commit.
    const shiny = (await get(call, `/api/repos/ana/up/do/file${q("README", "Feature/Shiny")}`)).lines[2];
    expect((await post(call, `/api/repos/ana/up/do/ops${q("README", "Feature/Shiny")}`, { ops: [{ kind: "set", line: shiny.id, base: shiny.rev, text: "shinier" }] })).status).toBe(200);
    const bo = await sh(`git --git-dir ${up} rev-parse Feature/Shiny`);
    expect(await (await post(call, "/api/repos/ana/up/mirror/branches/Feature%2FShiny/push")).json()).toMatchObject({ ref: "Feature/Shiny", pushed: true, took: [] });
    expect(await sh(`git --git-dir ${up} log -1 --format=%P Feature/Shiny`)).toBe(bo);
    expect(await sh(`git --git-dir ${up} show Feature/Shiny:README`)).toBe("hello\nworld\nshinier");

    // Bo again, before any sync: a push takes it in first rather than writing over it.
    await sh(`git pull -q origin Feature/Shiny && printf 'new\\nnewer\\nnewest\\n' > NEW && git commit -qam newest && git push -q origin Feature/Shiny`, work);
    expect(await (await post(call, "/api/repos/ana/up/mirror/branches/Feature%2FShiny/push")).json()).toMatchObject({ pushed: false, took: ["NEW"] });
    expect(await text("NEW", "Feature/Shiny")).toBe("new\nnewer\nnewest");
    expect(await sh(`git --git-dir ${up} show Feature/Shiny:README`)).toBe("hello\nworld\nshinier");

    // Merged here, its upstream branch stays until main's commit holds all of it, then goes.
    expect((await post(call, "/api/repos/ana/up/branches/Feature%2FShiny/merge")).status).toBe(200);
    const shinyUp = () => sh(`git --git-dir ${up} rev-parse --verify --quiet refs/heads/Feature/Shiny || echo gone`);
    expect(await sync(call)).toMatchObject({ state: "ok" });
    expect(await shinyUp()).not.toBe("gone");
    for (const path of ["README", "NEW"]) expect((await post(call, `/api/repos/ana/up/do/commit?path=${path}`, { message: "shiny" })).status).toBe(200);
    expect(await sync(call)).toMatchObject({ state: "ok" });
    expect(await upShow("NEW")).toBe("new\nnewer\nnewest");
    expect(await shinyUp()).toBe("gone");
    expect((await get(call, "/api/repos/ana/up/mirror/branches")).map((b: any) => b.ref)).toEqual(["tidy"]);
  });

  test("branches carry deletions and binary files both ways, and merging one deletes upstream too (#440, #446)", async () => {
    const call = await mirrored("deletes");
    const q = (path: string, b: string) => `?path=${encodeURIComponent(path)}&branch=${encodeURIComponent(b)}`;
    // Upstream's branch deletes src/a.ts and adds a binary file.
    const work = mkdtempSync(join(root, "work-"));
    await sh(`git clone -q ${up} . && git config user.name Bo && git config user.email bo@example.com && git checkout -qb prune && git rm -q src/a.ts && printf 'a\\000b' > logo.bin && git add -A && git commit -qm prune && git push -q origin prune`, work);
    const made = await post(call, "/api/repos/ana/up/mirror/branches", { ref: "prune" });
    expect(await made.json()).toMatchObject({ name: "prune", files: ["logo.bin"], deleted: ["src/a.ts"], skipped: [] });
    const blob = await sh(`git --git-dir ${up} rev-parse prune:logo.bin`);
    expect((await get(call, "/api/repos/ana/up/branches/prune")).files).toEqual([
      { path: "logo.bin", merged: false, build: false, binary: true, blob, ops: [], conflicts: [] },
      { path: "src/a.ts", merged: false, build: false, deleted: true, ops: [], conflicts: [] },
    ]);
    // It has no lines to open.
    expect((await call("ana", `/api/repos/ana/up/do/file${q("logo.bin", "prune")}`)).status).toBe(415);
    expect((await call("ana", `/api/repos/ana/up/do/file${q("src/a.ts", "prune")}`)).status).toBe(404);

    // Here, the branch deletes README too: pushed, upstream's branch loses it, logo.bin and all else as Bo left it.
    expect((await call("ana", "/api/repos/ana/up/branches/prune/files?path=README", { method: "DELETE" })).status).toBe(200);
    expect(await (await post(call, "/api/repos/ana/up/mirror/branches/prune/push")).json()).toMatchObject({ pushed: true });
    expect(await sh(`git --git-dir ${up} ls-tree -r --name-only prune`)).toBe("logo.bin");

    // Bo brings src/a.ts back upstream and changes logo.bin: the branch takes both in, a.ts no longer a deletion.
    await sh(`git pull -q origin prune && mkdir -p src && printf 'export const a = 3\\n' > src/a.ts && printf 'a\\000c' > logo.bin && git add -A && git commit -qm back && git push -q origin prune`, work);
    expect(await (await post(call, "/api/repos/ana/up/mirror/branches/prune/pull")).json()).toMatchObject({ files: ["logo.bin", "src/a.ts"], deleted: [] });
    expect((await get(call, `/api/repos/ana/up/do/file${q("src/a.ts", "prune")}`)).lines.map((l: any) => l.text)).toEqual(["export const a = 3"]);

    // Merged: README goes from main here, from its git, and upstream with the next sync; logo.bin, as Bo last left it, comes in.
    expect(await (await post(call, "/api/repos/ana/up/branches/prune/merge")).json()).toMatchObject({ status: "merged", merged: expect.arrayContaining([{ path: "logo.bin", rev: 0, ops: 0, binary: true }]) });
    expect((await call("ana", "/api/repos/ana/up/do/file?path=README")).status).toBe(404);
    expect(await sync(call)).toMatchObject({ state: "ok" });
    expect(await sh(`git --git-dir ${up} ls-tree -r --name-only main`)).toBe("logo.bin\nsrc/a.ts");
    expect(await sh(`git --git-dir ${up} rev-parse main:logo.bin`)).toBe(await sh(`git --git-dir ${up} rev-parse prune:logo.bin`));
  });

  test("pushing the crew's copy right after upstream moved still tells a force-push from its own commits", async () => {
    const call = await mirrored("crewlate");
    await editHere(call, "README", 2, "token=s3cret", false);
    const secret = (await file(call, "README")).lines[1];
    expect((await post(call, "/api/repos/ana/up/do/private?path=README", { lines: [secret.id], private: true })).status).toBe(200);
    await editHere(call, "README", 1, "hello from here");
    // Upstream moves while held: only the repo's own git hears of it, so the crew's copy lacks the commit both sides agreed on.
    await upstreamCommit({ "src/b.ts": "export const b = 1\n" }, "bo's change");
    expect(await sync(call)).toMatchObject({ state: "held" });
    const agreed = await upLog("%H");
    expect(await sh(`git --git-dir ${call.artifacts.path("ana--up")} cat-file -t ${agreed}`)).toBe("commit");

    // Then upstream force-pushes, and the owner turns on Push the crew's copy.
    await upstreamRewrite({ "README": "hello\nworld\n", "src/a.ts": "export const a = 10\n" }, "start over");
    expect(await sync(call, { pushCrew: true })).toMatchObject({ state: "rewritten" });
    // Re-base knows which commits are this copy's own: just the one, on upstream's new history.
    expect(await sync(call, { resolve: "rebase" })).toMatchObject({ state: "ok", ahead: 0, behind: 0 });
    expect(await sh(`git --git-dir ${up} log --format=%s main`)).toBe("edit README\nstart over");
    expect(await upShow("README")).toBe("hello from here\ntoken=s3cret");
    expect(await upShow("src/a.ts")).toBe("export const a = 10");
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
