import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pushBranch, upstreamMessages } from "../src/mirror.ts";
import { root, up, sh, post, get, sync, file, editHere, upstreamRewrite, mirrored, upstreamCommit, upLog, commit, pushClash, upShow } from "./mirror-kit.ts";

setDefaultTimeout(30_000);

describe("mirrors: branches and this copy's own git", () => {
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
    expect(await sh(`git --git-dir ${up} log -1 --format=%P%n%an%n%B tidy`)).toBe(`${mainTip}\nAna Real\ntidy, from codeSplitter\n\nCo-authored-by: agent-a <agent-a@codesplitters.local>`);
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
    // Why Bo changed each file, for the conflict agent: upstream's messages, newest first, not this copy's own push (#990).
    expect(await upstreamMessages(call.env, "ana", "up", "Feature/Shiny", "NEW")).toEqual(["newer", "shiny"]);
    expect(await upstreamMessages(call.env, "ana", "up", "Feature/Shiny", "README")).toEqual(["shiny"]);
    expect(await upstreamMessages(call.env, "ana", "up", "nope", "README")).toEqual([]);

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

  test("a branch that took main in by line id pushes the settled files as a merge, where git alone clashes (#1162)", async () => {
    const call = await mirrored("took-main");
    const q = "?path=src%2Fa.ts&branch=late";
    expect((await post(call, "/api/repos/ana/up/branches", { name: "late" })).status).toBe(201);
    const line = (await get(call, `/api/repos/ana/up/do/file${q}`)).lines[0];
    await post(call, `/api/repos/ana/up/do/ops${q}`, { ops: [{ kind: "set", line: line.id, base: line.rev, text: "export const a = 3" }] });
    expect(await (await post(call, "/api/repos/ana/up/mirror/branches/late/push")).json()).toMatchObject({ pushed: true });
    // Main changes the same line upstream: git can't merge the two, nor can line ids, so the sync leaves it be.
    await upstreamCommit({ "src/a.ts": "export const a = 2\n" }, "first");
    const prev = await sh(`git --git-dir ${up} rev-parse late`);
    expect(await sync(call)).toMatchObject({ state: "ok" });
    expect(await sh(`git --git-dir ${up} rev-parse late`)).toBe(prev);
    const settled = (await get(call, `/api/repos/ana/up/do/file${q}`)).lines[0];
    await post(call, `/api/repos/ana/up/do/ops${q}`, { ops: [{ kind: "set", line: settled.id, base: settled.rev, text: "export const a = 2 + 3" }] });
    expect((await pushBranch(call.env, "ana", "up", "late"))!.status).toBe(409);
    expect(await (await pushBranch(call.env, "ana", "up", "late", { tookMain: true }))!.json()).toMatchObject({ pushed: true });
    expect(await sh(`git --git-dir ${up} log -1 --format=%P late`)).toBe(`${prev} ${await upLog("%H")}`);
    expect(await sh(`git --git-dir ${up} show late:src/a.ts`)).toBe("export const a = 2 + 3");
  });

  test("a branch that clashes with main only in git takes main in and pushes it, once main's commit is up (#1190)", async () => {
    const call = await mirrored("git-only");
    const q = (b: string) => `?path=README&branch=${b}`;
    const edit = async (b: string, i: number, text: string) => {
      const line = (await get(call, `/api/repos/ana/up/do/file${q(b)}`)).lines[i];
      expect((await post(call, `/api/repos/ana/up/do/ops${q(b)}`, { ops: [{ kind: "set", line: line.id, base: line.rev, text }] })).status).toBe(200);
    };
    // Two branches change neighbouring lines: line ids settle it, git calls it a clash.
    for (const b of ["late", "early"]) expect((await post(call, "/api/repos/ana/up/branches", { name: b })).status).toBe(201);
    await edit("late", 0, "hello, late");
    await edit("early", 1, "world, early");
    expect(await (await post(call, "/api/repos/ana/up/mirror/branches/late/push")).json()).toMatchObject({ pushed: true });
    const prev = await sh(`git --git-dir ${up} rev-parse late`);
    expect(await (await post(call, "/api/repos/ana/up/branches/early/merge")).json()).toMatchObject({ status: "merged" });

    // Main's git doesn't hold the merge till its commit: upstream's branch waits.
    expect(await sync(call)).toMatchObject({ state: "ok" });
    expect(await sh(`git --git-dir ${up} rev-parse late`)).toBe(prev);
    expect((await post(call, "/api/repos/ana/up/do/commit?path=README", { message: "early" })).status).toBe(200);
    expect(await sync(call)).toMatchObject({ state: "ok" });
    expect(await upShow("README")).toBe("hello\nworld, early");
    // Then it takes main in: a merge of main's tip, both lines in, and git merges it cleanly now.
    expect(await sh(`git --git-dir ${up} log -1 --format=%P late`)).toBe(`${prev} ${await upLog("%H")}`);
    expect(await sh(`git --git-dir ${up} show late:README`)).toBe("hello, late\nworld, early");
    expect((await get(call, `/api/repos/ana/up/do/file${q("late")}`)).lines.map((l: any) => l.text)).toEqual(["hello, late", "world, early"]);
    const pushed = await sh(`git --git-dir ${up} rev-parse late`);
    expect(await sync(call)).toMatchObject({ state: "ok" });
    expect(await sh(`git --git-dir ${up} rev-parse late`)).toBe(pushed);
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

});
