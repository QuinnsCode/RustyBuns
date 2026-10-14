import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { git, pushBranch, upstreamMessages } from "../src/mirror.ts";
import type { Exec } from "../src/agent-run.ts";
import { root, up, sh, post, get, sync, file, editHere, upstreamRewrite, mirrored, upstreamCommit, upLog, commit, pushClash, upShow } from "./mirror-kit.ts";

setDefaultTimeout(30_000);

describe("mirrors: primary, pull-only, pushes and tags", () => {
  test("primary here: this copy leads, commits made here or pushed to its git reach upstream on the next sync (#464)", async () => {
    const call = await mirrored("lead");
    expect(await sync(call)).toMatchObject({ state: "ok", primary: "upstream" });
    expect((await post(call, "/api/repos/ana/up/mirror", { primary: "sideways" })).status).toBe(400);
    expect(await sync(call, { primary: "here" })).toMatchObject({ state: "ok", primary: "here", ahead: 0 });

    // A commit here goes up first thing.
    await editHere(call, "README", 1, "hello, led from here");
    expect(await sync(call)).toMatchObject({ state: "ok", ahead: 0 });
    expect(await upShow("README")).toBe("hello, led from here\nworld");

    // Your own tools use the desktop's git as a remote: clone it, commit, push back.
    const repo = await get(call, "/api/repos/ana/up");
    expect(repo.home).toBe("local");
    const work = mkdtempSync(join(root, "tool-"));
    await sh(`git clone -q ${repo.clone.split(" ")[2]} .`, work);
    await sh(`${repo.push} && git config user.name Ana && git config user.email ana@example.com`, work);
    writeFileSync(join(work, "TOOLS.md"), "from a terminal\n");
    await sh(`git add -A && git commit -qm "from a terminal" && git push -q codesplitter main`, work);
    // Upstream is a commit behind until the next sync, and the panel says so.
    expect(await get(call, "/api/repos/ana/up/mirror")).toMatchObject({ primary: "here", ahead: 1 });
    expect(await sync(call)).toMatchObject({ state: "ok", ahead: 0, behind: 0 });
    expect(await upLog("%s")).toBe("from a terminal");
    expect(await upShow("TOOLS.md")).toBe("from a terminal");

    // Upstream moved too: the push is turned away, so it merges upstream's in and pushes that.
    await upstreamCommit({ "src/b.ts": "export const b = 2\n" }, "bo adds b");
    await editHere(call, "src/a.ts", 1, "export const a = 3");
    expect(await sync(call)).toMatchObject({ state: "ok", ahead: 0, behind: 0 });
    expect(await upShow("src/a.ts")).toBe("export const a = 3");
    expect(await upShow("src/b.ts")).toBe("export const b = 2");
    expect(await upLog("%P")).toContain(" ");   // a merge commit

    // Both changed the same lines: it still asks, even with this copy leading.
    await upstreamCommit({ README: "bo's hello\nworld\n" }, "bo's readme");
    await editHere(call, "README", 1, "ana's hello");
    expect(await sync(call)).toMatchObject({ state: "clash", clash: ["README"], primary: "here" });
    expect(await sync(call, { resolve: "mine" })).toMatchObject({ state: "ok" });
    expect(await upShow("README")).toBe("ana's hello\nworld");

    // Only the owner gets a remote that writes.
    expect((await (await call("bo", "/api/repos/ana/up")).json() as any).push).toBeUndefined();
  });

  test("pull-only: syncs take upstream's commits and never push, and branch and tag pushes answer 409 (#1009)", async () => {
    const call = await mirrored("pull");
    expect((await post(call, "/api/repos/ana/up/mirror", { pullOnly: "yes" })).status).toBe(400);
    // Pull-only wins over this copy leading: nothing goes up first either.
    expect(await sync(call, { pullOnly: true, primary: "here" })).toMatchObject({ state: "ok", pullOnly: true });
    const upTip = await upLog("%H");

    // A commit here stays here; upstream's still come in.
    await editHere(call, "README", 1, "hello, kept here");
    await upstreamCommit({ "src/b.ts": "export const b = 2\n" }, "bo adds b");
    expect(await sync(call)).toMatchObject({ state: "held", ahead: 2, behind: 0, error: "this mirror is pull-only, so nothing goes upstream" });
    expect(await upShow("README")).toBe("hello\nworld");
    expect((await file(call, "src/b.ts")).lines.map((l: any) => l.text)).toEqual(["export const b = 2"]);
    expect(await upLog("%P")).toBe(upTip);

    // A branch and a tag can't go up.
    expect((await post(call, "/api/repos/ana/up/branches", { name: "tidy" })).status).toBe(201);
    expect((await post(call, "/api/repos/ana/up/files", { path: "src/c.ts", content: "export const c = 1", branch: "tidy" })).status).toBe(201);
    expect(await (await post(call, "/api/repos/ana/up/mirror/branches/tidy/push")).json()).toEqual({ error: "this mirror is pull-only, so nothing goes upstream" });
    expect((await post(call, "/api/repos/ana/up/tags", { name: "v9" })).status).toBe(201);
    expect((await post(call, "/api/repos/ana/up/mirror/tags/v9/push")).status).toBe(409);
    expect(await sh(`git --git-dir ${up} for-each-ref --format='%(refname)' refs/heads refs/tags`)).toBe("refs/heads/main");

    // Two-way again: what waited goes up.
    expect(await sync(call, { pullOnly: false })).toMatchObject({ state: "ok", pullOnly: false, ahead: 0 });
    expect(await upShow("README")).toBe("hello, kept here\nworld");

    // Made pull-only from the start.
    expect((await post(call, "/api/mirrors", { url: `file://${up}`, name: "ci", pullOnly: 1 })).status).toBe(400);
    expect(await (await post(call, "/api/mirrors", { url: `file://${up}`, name: "ci", pullOnly: true })).json()).toMatchObject({ name: "ci", pullOnly: true });
    expect(await get(call, "/api/repos/ana/ci/mirror")).toMatchObject({ state: "ok", pullOnly: true });
    expect(await get(call, "/api/repos/ana/ci")).toMatchObject({ mirror: true, pullOnly: true });
  });

  test("a file too big to dig comes over as its blob, and waits when main changed it too", async () => {
    const call = await mirrored("biglock");
    const big = (first: string, last: string) => [first, ...Array.from({ length: 6000 }, (_, i) => `pkg-${i}@1`), last].join("\n") + "\n";
    await upstreamCommit({ "big.lock": big("head", "tail") }, "a lockfile");
    expect(await sync(call)).toMatchObject({ state: "ok" });
    // Upstream's branch changes the lockfile, as a PR's dependency bump does: it comes over whole, not skipped.
    const work = mkdtempSync(join(root, "work-"));
    await sh(`git clone -q ${up} . && git config user.name Bo && git config user.email bo@example.com && git checkout -qb bump`, work);
    writeFileSync(join(work, "big.lock"), big("head bumped", "tail"));
    await sh(`git commit -qam bump && git push -q origin bump`, work);
    expect(await (await post(call, "/api/repos/ana/up/mirror/branches", { ref: "bump" })).json()).toMatchObject({ files: ["big.lock"], skipped: [] });
    expect((await get(call, "/api/repos/ana/up/branches/bump")).files).toEqual([expect.objectContaining({ path: "big.lock", binary: true })]);

    // Main changes it too: merging the blob would drop main's change, so it waits.
    await upstreamCommit({ "big.lock": big("head", "tail moved") }, "main's lockfile");
    expect(await sync(call)).toMatchObject({ state: "ok" });
    const held = await post(call, "/api/repos/ana/up/branches/bump/merge");
    expect(held.status).toBe(409);
    expect(await held.json()).toMatchObject({ files: ["big.lock"] });

    // Main brought into the branch upstream and pulled: it merges with both changes.
    await sh(`git pull -q --no-rebase --no-edit origin main && git push -q origin bump`, work);
    expect(await (await post(call, "/api/repos/ana/up/mirror/branches/bump/pull")).json()).toMatchObject({ files: ["big.lock"] });
    expect(await (await post(call, "/api/repos/ana/up/branches/bump/merge")).json()).toMatchObject({ status: "merged" });
    expect(await sh(`git --git-dir ${call.artifacts.path("ana--up")} show main:big.lock`)).toBe(big("head bumped", "tail moved").trimEnd());
  });

  test("a push to this copy's git reaches the files open here, so the next commit here keeps it (#773)", async () => {
    const call = await mirrored("pushed");
    expect(await sync(call, { primary: "here" })).toMatchObject({ state: "ok" });
    await editHere(call, "README", 1, "hello, here");
    await editHere(call, "src/a.ts", 1, "export const a = 2", false);
    expect(await sync(call)).toMatchObject({ state: "ok", ahead: 0 });

    // A page open on src/a.ts, listening.
    const ws = ((await call("ana", "/api/repos/ana/up/do/ws?path=src%2Fa.ts", { headers: { upgrade: "websocket" } })) as any).webSocket, heard: any[] = [];
    ws.toBrowser = (d: string) => heard.push(JSON.parse(d));
    const pings = () => heard.filter((m) => m.type === "pushclash").length;

    // A terminal pushes a change to README's second line, and to src/a.ts, which has live edits here.
    const repo = await get(call, "/api/repos/ana/up");
    const work = mkdtempSync(join(root, "tool-"));
    await sh(`git clone -q ${repo.clone.split(" ")[2]} . && ${repo.push} && git config user.name Ana && git config user.email ana@example.com`, work);
    writeFileSync(join(work, "README"), "hello, here\nworld, from a terminal\n");
    writeFileSync(join(work, "src/a.ts"), "export const a = 1\nexport const z = 26\n");
    await sh(`git add -A && git commit -qm "from a terminal" && git push -q codesplitter main`, work);
    // It's heard as it arrives (#788): no sync or open needed for src/a.ts's clash to show.
    expect(await pushClash(call)).toEqual(["src/a.ts"]);
    // The open page is told, so it shows the clash without a reload.
    expect(pings()).toBe(1);

    // The sync takes it up and lands it in the open files: README is clean, so it's committed as pushed.
    expect(await sync(call)).toMatchObject({ state: "ok", ahead: 0, behind: 0 });
    expect(await upShow("README")).toBe("hello, here\nworld, from a terminal");
    expect((await file(call, "README")).lines.map((l: any) => [l.text, l.by])).toEqual([["hello, here", "ana"], ["world, from a terminal", "ana"]]);
    // src/a.ts has an edit not committed yet right beside the pushed line: a clash, and the edit here stands.
    expect((await file(call, "src/a.ts")).lines.map((l: any) => l.text)).toEqual(["export const a = 2"]);
    // Its commit waits for a side to be picked, so it can't undo the push (#788). Only the owner picks.
    expect((await commit(call, "src/a.ts")).status).toBe(409);
    expect((await call("bob", "/api/repos/ana/up/pushes", { method: "POST", body: JSON.stringify({ path: "src/a.ts", take: "pushed" }) })).status).toBe(403);
    expect((await post(call, "/api/repos/ana/up/pushes", { path: "src/a.ts", take: "sideways" })).status).toBe(400);
    // Take the pushed lines: they replace the edit here, and the commit goes ahead.
    expect((await post(call, "/api/repos/ana/up/pushes", { path: "src/a.ts", take: "pushed" })).status).toBe(200);
    expect((await file(call, "src/a.ts")).lines.map((l: any) => l.text)).toEqual(["export const a = 1", "export const z = 26"]);
    expect((await get(call, "/api/repos/ana/up")).pushClash).toBeUndefined();
    expect(pings()).toBe(2);
    expect((await commit(call, "src/a.ts")).status).toBe(200);

    // The next commit here keeps the pushed line, and so does upstream.
    await editHere(call, "README", 1, "hello again");
    expect(await sync(call)).toMatchObject({ state: "ok", ahead: 0 });
    expect(await upShow("README")).toBe("hello again\nworld, from a terminal");

    // No sync in between: the push is in before the commit here.
    await sh(`git pull -q --ff-only codesplitter main`, work);
    writeFileSync(join(work, "README"), "hello again\nworld, pushed twice\n");
    await sh(`git commit -qam "again" && git push -q codesplitter main`, work);
    await editHere(call, "README", 1, "hello, third time");
    expect(await sync(call)).toMatchObject({ state: "ok", ahead: 0 });
    expect(await upShow("README")).toBe("hello, third time\nworld, pushed twice");

    // Keep mine: the edit here stands, and its commit writes over the pushed line on purpose.
    await sh(`git pull -q --ff-only codesplitter main`, work);
    await editHere(call, "README", 1, "hello, mine", false);
    writeFileSync(join(work, "README"), "hello, pushed\nworld, pushed twice\n");
    await sh(`git commit -qam "clash" && git push -q codesplitter main`, work);
    expect(await pushClash(call)).toEqual(["README"]);
    expect((await commit(call, "README")).status).toBe(409);
    expect((await post(call, "/api/repos/ana/up/pushes", { path: "README", take: "mine" })).status).toBe(200);
    expect((await post(call, "/api/repos/ana/up/pushes", { path: "README", take: "mine" })).status).toBe(404);
    expect((await commit(call, "README")).status).toBe(200);
    expect(await sync(call)).toMatchObject({ state: "ok", ahead: 0 });
    expect(await upShow("README")).toBe("hello, mine\nworld, pushed twice");
  });

  test("the commit graph: upstream's commits black, this copy's orange, and the merge that took both (#871)", async () => {
    const call = await mirrored("graph");
    // Upstream first: a commit here starts its own push, which a push from outside straight after can race for main's ref.
    await upstreamCommit({ "src/b.ts": "export const b = 2\n" }, "add b");
    await editHere(call, "README", 1, "hi");
    expect((await sync(call)).state).toBe("ok");
    // In step: the merge went up too, so every commit is upstream's, and "add b" is the branch the merge took in.
    const g = await get(call, "/api/repos/ana/up/graph");
    expect(g.commits.map((c: any) => [c.message.split(" ")[0], c.up, c.parents.length, !!c.side])).toEqual([["Merge", true, 2, false], ["add", true, 1, true], ["edit", true, 1, false], ["init", true, 0, false]]);
    expect(g).toMatchObject({ branch: "main", more: false, upstream: g.commits[0].hash });
    expect(g.commits[1].side).toBe(g.commits[0].hash);
    expect((await get(call, "/api/repos/ana/up/graph?limit=2")).more).toBe(true);
    // A repo with no upstream: all of it is this copy's.
    await post(call, "/api/repos", { name: "own" });
    await post(call, "/api/repos/ana/own/files", { path: "a.ts", content: "one" });
    expect((await post(call, "/api/repos/ana/own/do/commit?path=a.ts", { message: "first" })).status).toBe(200);
    expect((await get(call, "/api/repos/ana/own/graph")).commits).toMatchObject([{ message: "first", up: false, parents: [] }]);
    await post(call, "/api/repos", { name: "empty" });
    expect((await get(call, "/api/repos/ana/empty/graph")).commits).toEqual([]);
  });

  test("tags: fetched from upstream on asking, made and deleted here, pushed up, never clobbered (#879)", async () => {
    const call = await mirrored("tags");
    const init = await upLog("%H");
    await upstreamCommit({ "src/b.ts": "export const b = 1\n" }, "add b");
    const b = await upLog("%H");
    // An annotated tag on upstream's tip, a plain one on the commit the mirror was cloned at.
    await sh(`git --git-dir ${up} tag -a v1.1 -m "one one" main && git --git-dir ${up} tag old ${init}`);
    expect((await sync(call)).state).toBe("ok");
    const tags = async () => (await get(call, "/api/repos/ana/up/tags")).tags.map((t: any) => [t.name, t.commit]);
    expect(await tags()).toEqual([]);
    // Upstream's, peeled to their commits; none here yet.
    expect(await get(call, "/api/repos/ana/up/mirror/tags")).toEqual([{ name: "v1.1", commit: b, here: null }, { name: "old", commit: init, here: null }]);
    expect(await (await post(call, "/api/repos/ana/up/mirror/tags", { names: ["v1.1", "nope"] })).json()).toEqual({ fetched: ["v1.1"], kept: [], missing: ["nope"] });
    expect(await tags()).toEqual([["v1.1", b]]);

    // Made here: main's tip by default, or a commit; a name git won't take, or one that's taken, is turned away.
    expect(await (await post(call, "/api/repos/ana/up/tags", { name: "v2" })).json()).toEqual({ name: "v2", commit: b });
    expect((await post(call, "/api/repos/ana/up/tags", { name: "v2" })).status).toBe(409);
    expect(await (await post(call, "/api/repos/ana/up/tags", { name: "a b" })).json()).toEqual({ error: "no spaces in a tag name: use - instead" });
    expect((await post(call, "/api/repos/ana/up/tags", { name: "rc", commit: b })).status).toBe(201);
    expect((await post(call, "/api/repos/ana/up/tags", { name: "x", commit: "f".repeat(40) })).status).toBe(404);

    // Upstream has its own rc, on another commit: fetching leaves ours be, and pushing ours is refused.
    await sh(`git --git-dir ${up} tag rc ${init}`);
    expect((await get(call, "/api/repos/ana/up/mirror/tags")).find((t: any) => t.name === "rc").here).toBe("differs");
    expect(await (await post(call, "/api/repos/ana/up/mirror/tags")).json()).toEqual({ fetched: ["old"], kept: ["rc"], missing: [] });
    expect(await tags()).toEqual([["v2", b], ["v1.1", b], ["old", init], ["rc", b]]);
    expect((await post(call, "/api/repos/ana/up/mirror/tags/rc/push")).status).toBe(409);
    expect(await (await post(call, "/api/repos/ana/up/mirror/tags/v2/push")).json()).toEqual({ pushed: true, name: "v2", commit: b });
    expect(await sh(`git --git-dir ${up} rev-parse v2`)).toBe(b);
    expect((await (await post(call, "/api/repos/ana/up/mirror/tags/v2/push")).json()).pushed).toBe(false);

    // Deleted here (an annotated one too); upstream keeps its own.
    expect((await call("ana", "/api/repos/ana/up/tags/v2", { method: "DELETE" })).status).toBe(200);
    expect((await call("ana", "/api/repos/ana/up/tags/v1.1", { method: "DELETE" })).status).toBe(200);
    expect((await call("ana", "/api/repos/ana/up/tags/v2", { method: "DELETE" })).status).toBe(404);
    expect(await tags()).toEqual([["old", init], ["rc", b]]);
    expect(await sh(`git --git-dir ${up} rev-parse v2`)).toBe(b);

    // A repo that isn't a mirror has tags all the same, just no upstream to trade them with.
    await post(call, "/api/repos", { name: "own" });
    expect((await post(call, "/api/repos/ana/own/tags", { name: "v1" })).status).toBe(409);
    await post(call, "/api/repos/ana/own/files", { path: "a.ts", content: "one" });
    expect((await post(call, "/api/repos/ana/own/do/commit?path=a.ts", { message: "first" })).status).toBe(200);
    expect((await post(call, "/api/repos/ana/own/tags", { name: "v1" })).status).toBe(201);
    expect((await get(call, "/api/repos/ana/own/tags")).tags.map((t: any) => t.name)).toEqual(["v1"]);
    expect((await call("ana", "/api/repos/ana/own/mirror/tags")).status).toBe(404);
  });

  test("git in a folder that isn't there yet is a failed run, not a throw (#887)", async () => {
    const r = await git(["rev-parse", "HEAD"], join(root, "not-cloned-yet.git"));
    expect(r.code).not.toBe(0);
    expect(r.err).toContain("not-cloned-yet.git");
  });

});
