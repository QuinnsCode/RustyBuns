import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, renameSync } from "node:fs";
import { join } from "node:path";
import { local as boot } from "../src/local.ts";
import { root, up, opened, sh, post, get, sync, file, editHere, upstreamRewrite, mirrored, upstreamCommit, upLog, upShow } from "./mirror-kit.ts";

setDefaultTimeout(30_000);

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
    expect(await get(call, "/api/repos/ana/up")).toMatchObject({ mirror: true, pullOnly: false, branch: "main" });
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

    // codeSplitter: the edits here win, even ones not committed yet.
    // Its name from before the rename (#805) is refused now (#837).
    expect((await truth("codesplitters")).status).toBe(400);
    expect((await (await truth("codesplitter")).json()).git_truth).toBe("codesplitter");
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

  test("checks running here run on main commits taken from upstream, not again on ones it pushed (#1008)", async () => {
    const call = await mirrored("checks");
    const runs = async () => (await get(call, "/api/repos/ana/up/checks?ref=main")).runs as any[];
    expect((await call("ana", "/api/repos/ana/up/checks/settings", { method: "PUT", body: JSON.stringify({ where: "here" }) })).status).toBe(200);

    // Upstream's commit comes in: main here is at it, and our check queues on it.
    await upstreamCommit({ "src/a.ts": "export const a = 2\n" }, "bo's change");
    expect(await sync(call)).toMatchObject({ state: "ok", ahead: 0, behind: 0 });
    const tip = await upLog("%H");
    expect(await runs()).toMatchObject([{ name: "test", ref: "main", sha: tip, status: "queued" }]);

    // A commit here queues its own check when it's made; handing it upstream doesn't queue another.
    await editHere(call, "README", 1, "hello from here");
    const mine = await sh(`git --git-dir ${call.artifacts.path("ana--up")} rev-parse main`);
    expect(await sync(call)).toMatchObject({ state: "ok", ahead: 0 });
    expect(await upLog("%H")).toBe(mine);
    expect((await runs()).filter((r) => r.sha === mine)).toHaveLength(1);
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
