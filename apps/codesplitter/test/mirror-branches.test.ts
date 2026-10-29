import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { git, pushBranch, upstreamMessages } from "../src/mirror.ts";
import type { Exec } from "../src/agent-run.ts";
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

  test("a rebuild task that finishes pushes its branch upstream, as a merge of main's tip (#1226)", async () => {
    const call = await mirrored("rebuild");
    const q = (b: string) => `?path=src%2Fa.ts&branch=${b}`;
    const edit = async (b: string, text: string) => {
      const line = (await get(call, `/api/repos/ana/up/do/file${q(b)}`)).lines[0];
      expect((await post(call, `/api/repos/ana/up/do/ops${q(b)}`, { ops: [{ kind: "set", line: line.id, base: line.rev, text }] })).status).toBe(200);
    };
    // Two branches change the same line: the plan holds late for first, and late is upstream already.
    for (const b of ["first", "late"]) expect((await post(call, "/api/repos/ana/up/branches", { name: b })).status).toBe(201);
    await edit("first", "export const a = 2");
    await edit("late", "export const a = 3");
    expect(await (await post(call, "/api/repos/ana/up/mirror/branches/late/push")).json()).toMatchObject({ pushed: true });
    const prev = await sh(`git --git-dir ${up} rev-parse late`);
    await get(call, "/api/repos/ana/up/merge-plan");
    // The agent waits till main's commit is up, then puts main's side back beside the branch's.
    let go!: () => void;
    const held = new Promise<void>((r) => { go = r; });
    call.env.HEAL = "1";
    call.env.AGENT_EXEC = (async (_cmd, cwd) => {
      await held;
      const f = join(cwd, "src/a.ts");
      writeFileSync(f, readFileSync(f, "utf8").replace("export const a = 3", "export const a = 2 + 3"));
      return { code: 0, out: "ENGINE src/a.ts L1 no: both set the same constant" };
    }) as Exec;
    const merged = await (await post(call, "/api/repos/ana/up/branches/first/merge")).json() as any;
    expect(merged.took).toEqual([{ branch: "late", status: "rebuilding", files: ["src/a.ts"], fix: expect.any(Number) }]);
    // Main's commit goes up, and the sync after it sees late clash with main in git: it leaves late to the task,
    // which holds only the branch's side yet.
    expect((await commit(call, "src/a.ts")).status).toBe(200);
    expect(await sync(call)).toMatchObject({ state: "ok" });
    expect(await sh(`git --git-dir ${up} rev-parse late`)).toBe(prev);
    go();
    const run = async () => (await get(call, "/api/repos/ana/up/agents")).find((x: any) => x.id === merged.took[0].fix);
    for (const end = performance.now() + 20_000; performance.now() < end && (await run())?.status === "running";) await Bun.sleep(20);
    expect(await run()).toMatchObject({ status: "done", rebuild: "first", pushed: { ok: true }, engine: [{ path: "src/a.ts", line: "L1", yes: false, how: "both set the same constant" }] });
    expect(await sh(`git --git-dir ${up} log -1 --format=%P late`)).toBe(`${prev} ${await upLog("%H")}`);
    expect(await sh(`git --git-dir ${up} show late:src/a.ts`)).toBe("export const a = 2 + 3");
    // The next sync finds it in step with main: nothing more goes up.
    const pushed = await sh(`git --git-dir ${up} rev-parse late`);
    expect(await sync(call)).toMatchObject({ state: "ok" });
    expect(await sh(`git --git-dir ${up} rev-parse late`)).toBe(pushed);
    expect((await get(call, `/api/repos/ana/up/do/file${q("late")}`)).lines.map((l: any) => l.text)).toEqual(["export const a = 2 + 3"]);
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

  test("a branch stacked on one main took in as a squash brings and pushes only its own change (#1200)", async () => {
    const call = await mirrored("squash");
    const work = mkdtempSync(join(root, "work-"));
    const files = async (b: string) => (await get(call, `/api/repos/ana/up/branches/${b}`)).files.map((f: any) => [f.path, f.conflicts.length]);
    // Bo's parent branch, and a child stacked on it (pushed twice, one to open later).
    await sh(`git clone -q ${up} . && git config user.name Bo && git config user.email bo@example.com && git checkout -qb parent &&
      printf 'export const a = 1\\nexport const b = 2\\n' > src/a.ts && printf 'export const p = 1\\n' > src/p.ts && git add -A && git commit -qm parent && git push -q origin parent &&
      git checkout -qb child && printf 'hello\\nworld, child\\n' > README && git commit -qam child && git push -q origin child child:late`, work);
    // Opened while the parent's still open, it carries the parent's files too.
    expect(await (await post(call, "/api/repos/ana/up/mirror/branches", { ref: "child" })).json()).toMatchObject({ files: ["README", "src/a.ts", "src/p.ts"] });
    // The parent lands on main as one squash, and main changes one of its files again: git's merge clashes.
    await sh(`git checkout -q main && git merge -q --squash parent && git commit -qm "parent (#1)" && printf 'export const p = 2\\n' > src/p.ts && git commit -qam "p again" && git push -q origin main`, work);
    expect((await git(["merge-tree", "--write-tree", "main", "child"], up)).code).toBe(1);
    // The next sync moves the open one onto the squash: the parent's files are main's again.
    const prev = await sh(`git --git-dir ${up} rev-parse child`);
    expect(await sync(call)).toMatchObject({ state: "ok" });
    expect(await files("child")).toEqual([["README", 0]]);
    expect((await file(call, "README")).lines.map((l: any) => l.text)).toEqual(["hello", "world"]);
    expect((await get(call, "/api/repos/ana/up/do/file?path=README&branch=child")).lines.map((l: any) => l.text)).toEqual(["hello", "world, child"]);
    // Opened after, it starts from the parent's head.
    expect(await (await post(call, "/api/repos/ana/up/mirror/branches", { ref: "late" })).json()).toMatchObject({ files: ["README"] });
    expect(await upstreamMessages(call.env, "ana", "up", "late", "README")).toEqual(["child"]);
    // It clashed with main only in git, so that sync pushed it too (#1190): a merge of main's tip, main's copy
    // of the parent's files, its own change on top. Pushing again has nothing new.
    expect(await (await post(call, "/api/repos/ana/up/mirror/branches/child/push")).json()).toMatchObject({ pushed: false });
    expect(await sh(`git --git-dir ${up} log -1 --format=%P child`)).toBe(`${prev} ${await upLog("%H")}`);
    expect(await sh(`git --git-dir ${up} show child:src/p.ts`)).toBe("export const p = 2");
    expect(await sh(`git --git-dir ${up} show child:README`)).toBe("hello\nworld, child");
    expect((await post(call, "/api/repos/ana/up/branches/child/merge")).status).toBe(200);
    expect((await file(call, "README")).lines.map((l: any) => l.text)).toEqual(["hello", "world, child"]);
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

  test("a branch file with a line too long for a doc stays a blob, so main's sync isn't held up by edits nobody made", async () => {
    const call = await mirrored("longline");
    const wide = (c: string) => c.repeat(12_000);
    const work = mkdtempSync(join(root, "work-"));
    const push = (ref: string) => `git push -q origin ${ref}`;
    await sh(`git clone -q ${up} . && git config user.name Bo && git config user.email bo@example.com`, work);
    writeFileSync(join(work, "rig.json"), wide("a"));
    await sh(`git add -A && git commit -qm rig && ${push("HEAD:main")} && git checkout -qb pr`, work);
    writeFileSync(join(work, "rig.json"), wide("b"));
    await sh(`git commit -qam tweak && ${push("pr")} && git checkout -q main`, work);
    expect(await sync(call)).toMatchObject({ state: "ok" });
    expect((await post(call, "/api/repos/ana/up/mirror/branches", { ref: "pr" })).status).toBe(201);
    writeFileSync(join(work, "rig.json"), wide("c"));
    await sh(`git commit -qam moves && ${push("HEAD:main")}`, work);
    expect(await sync(call)).toMatchObject({ state: "ok" });
  });
  test("a branch that moves a folder takes main's other files in it along (#2844)", async () => {
    const call = await mirrored("moved-folder");
    await upstreamCommit({ "src/b.ts": "export const b = 1\n" }, "more in src");
    expect(await sync(call)).toMatchObject({ state: "ok" });
    const work = mkdtempSync(join(root, "work-"));
    await sh(`git clone -q ${up} . && git config user.name Bo && git config user.email bo@example.com && git checkout -qb rename && git mv src lib && git commit -qm "src is lib" && git push -q origin rename`, work);
    expect((await post(call, "/api/repos/ana/up/mirror/branches", { ref: "rename" })).status).toBe(201);
    // Main adds a file in the old folder after the branch left it.
    await upstreamCommit({ "src/d.ts": "export const d = 4\n" }, "main adds d");
    expect(await sync(call)).toMatchObject({ state: "ok" });
    const review = await get(call, "/api/repos/ana/up/branches/rename");
    expect(review.moved).toEqual([{ from: "src/d.ts", to: "lib/d.ts" }]);
    expect(review.files.map((f: any) => f.path)).toEqual(["lib/a.ts", "lib/b.ts", "lib/d.ts", "src/a.ts", "src/b.ts", "src/d.ts"]);
    const merged = await post(call, "/api/repos/ana/up/branches/rename/merge");
    expect(merged.status).toBe(200);
    expect(await get(call, "/api/repos/ana/up/tree?path=lib").then((t: any) => t.entries.map((e: any) => e.name))).toEqual(["a.ts", "b.ts", "d.ts"]);
  });
});
