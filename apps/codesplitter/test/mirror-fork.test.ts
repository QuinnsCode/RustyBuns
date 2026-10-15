import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Call } from "../src/local.ts";
import { up, sh, post, get, sync, file, editHere, upstreamRewrite, mirrored, upstreamCommit, upLog, upShow, dug, sides, turn } from "./mirror-kit.ts";

setDefaultTimeout(30_000);

describe("mirrors: a dug fork turned into one (#875)", () => {
  test("a dug fork turns into a mirror: its commits since the dig go up on the first sync (#875)", async () => {
    // A dig on the desktop is the same shallow clone, without a mirror_url: make one, then forget it was a mirror.
    const call = await mirrored("turn") as Call & { env: any };
    const dug = await upLog("%H");
    await call.env.DB.prepare("UPDATE repos SET mirror_url = NULL, expires_at = ? WHERE owner = 'ana' AND name = 'up'").bind(Date.now() + 3600_000).run();
    expect(await get(call, "/api/repos/ana/up")).toMatchObject({ mirror: false, mirrorable: true });
    expect((await (await call("bob", "/api/repos/ana/up")).json() as any).mirrorable).toBeUndefined();

    // Work here, and upstream moves too, while it's a plain fork: nothing goes either way.
    await editHere(call, "README", 1, "hello from the dig");
    await upstreamCommit({ "src/b.ts": "export const b = 1\n" }, "bo's b");
    expect(await upShow("README")).toBe("hello\nworld");
    const before = await get(call, "/api/repos/ana/up/mirror/turn");
    expect(before).toEqual({ url: `file://${up}`, branch: "main", commit: dug, ahead: 1 });
    expect((await call("bob", "/api/repos/ana/up/mirror/turn")).status).toBe(403);

    // Turned: the first sync merges upstream's commit in and sends this copy's up.
    const turned = await post(call, "/api/repos/ana/up/mirror/turn", { ahead: 1 });
    expect(turned.status).toBe(201);
    expect(await turned.json()).toMatchObject({ state: "ok", ahead: 0, behind: 0 });
    expect(await upShow("README")).toBe("hello from the dig\nworld");
    expect(await get(call, "/api/repos/ana/up/tree?path=src")).toMatchObject({ entries: [{ name: "a.ts" }, { name: "b.ts" }] });
    expect(await get(call, "/api/repos/ana/up")).toMatchObject({ mirror: true, expires_at: null });
    expect((await get(call, "/api/repos/ana/up")).mirrorable).toBeUndefined();
    expect((await post(call, "/api/repos/ana/up/mirror/turn")).status).toBe(409);

    // A dig that came from a tarball has a commit of its own, not upstream's: nothing to sync from.
    await call.env.DB.prepare("UPDATE repos SET mirror_url = NULL, upstream_commit = ? WHERE owner = 'ana' AND name = 'up'").bind("f".repeat(40)).run();
    expect((await get(call, "/api/repos/ana/up/mirror/turn")).error).toMatch(/doesn't have the commit it was dug at/);
    // Nor is one folder of a repo.
    await call.env.DB.prepare("UPDATE repos SET upstream = 'github:a/b/tree/main/src' WHERE owner = 'ana' AND name = 'up'").run();
    expect((await get(call, "/api/repos/ana/up")).mirrorable).toBeUndefined();
    expect((await post(call, "/api/repos/ana/up/mirror/turn")).status).toBe(409);
  });

  test("a fork turned pull-only takes upstream's commits and sends nothing up", async () => {
    const call = await dug("turn-pull");
    await editHere(call, "README", 1, "hello from the dig");
    await upstreamCommit({ "src/b.ts": "export const b = 1\n" }, "bo's b");
    const before = await upShow("README");
    const r = await turn(call, { pullOnly: true });
    expect(r.status).toBe(201);
    expect(await r.json()).toMatchObject({ pullOnly: true });
    expect(await get(call, "/api/repos/ana/up")).toMatchObject({ mirror: true, pullOnly: true });
    expect(await upShow("README")).toBe(before);
    expect((await turn(call, { pullOnly: "yes" })).status).toBe(409);
  });

  test("turning a fork sends up only what the owner was shown: a blind or stale POST moves nothing (#875)", async () => {
    const call = await dug("turn-blind");
    await editHere(call, "README", 1, "hello from the dig");
    const was = await sides(call);
    // An agent that never looked, or says the wrong count: refused, with the real one.
    for (const body of [{}, { ahead: 0 }, { ahead: "1" }, { ahead: 2 }]) {
      const r = await turn(call, body);
      expect(r.status).toBe(409);
      expect(await r.json()).toMatchObject({ ahead: 1 });
    }
    expect((await call("bob", "/api/repos/ana/up/mirror/turn", { method: "POST", body: JSON.stringify({ ahead: 1 }) })).status).toBe(403);
    expect(await sides(call)).toEqual(was);
    expect(await get(call, "/api/repos/ana/up")).toMatchObject({ mirror: false, mirrorable: true });

    // A page shown 1, and a commit lands before the click: it asks again.
    await editHere(call, "src/a.ts", 1, "export const a = 2");
    expect((await turn(call, { ahead: 1 })).status).toBe(409);
    expect(await upShow("README")).toBe("hello\nworld");

    // Two clicks at once: one turns it, the other finds a mirror, and each commit goes up once.
    const [x, y] = await Promise.all([turn(call, { ahead: 2 }), turn(call, { ahead: 2 })]);
    expect([x.status, y.status].sort()).toEqual([201, 409]);
    expect(await sh(`git --git-dir ${up} log --format=%s main`)).toBe("edit src/a.ts\nedit README\ninit");
  });

  for (const truth of ["github", "codesplitter"]) {
    test(`a fork's first sync stops at a clash even when git truth is ${truth}: neither side moves (#875)`, async () => {
      const call = await dug(`turn-clash-${truth}`);
      expect((await call("ana", "/api/me", { method: "PUT", body: JSON.stringify({ git_truth: truth }) })).status).toBe(200);
      await upstreamCommit({ "README": "hello from bo\nworld\n" }, "bo");
      await editHere(call, "README", 1, "hello from ana");
      const was = await sides(call);
      expect(await (await turn(call, { ahead: 1 })).json()).toMatchObject({ state: "clash", clash: ["README"] });
      expect(await sides(call)).toEqual(was);
      expect((await file(call, "README")).lines.map((l: any) => l.text)).toEqual(["hello from ana", "world"]);
      // Settled by the owner, it syncs: a merge, nothing forced.
      expect(await sync(call, { resolve: "mine" })).toMatchObject({ state: "ok", ahead: 0, behind: 0 });
      expect(await upShow("README")).toBe("hello from ana\nworld");
      expect(await sh(`git --git-dir ${up} merge-base --is-ancestor ${was.upstream} main && echo kept`)).toBe("kept");
    });
  }

  test("a fork whose upstream was force-pushed since the dig stops at rewritten, and drops nothing, even with git truth github (#875)", async () => {
    const call = await dug("turn-rewritten");
    expect((await call("ana", "/api/me", { method: "PUT", body: JSON.stringify({ git_truth: "github" }) })).status).toBe(200);
    await upstreamRewrite({ "README": "brand\nnew\n" }, "start over");
    await editHere(call, "README", 1, "hello from the dig");
    const was = await sides(call);
    expect(await (await turn(call, { ahead: 1 })).json()).toMatchObject({ state: "rewritten" });
    expect(await sides(call)).toEqual(was);
    expect(was.kept).toBe("");
    expect((await file(call, "README")).lines.map((l: any) => l.text)).toEqual(["hello from the dig", "world"]);
  });

  test("a fork turned while upstream is away, or says no, keeps its commits here and upstream as it was (#875)", async () => {
    const call = await dug("turn-away");
    await editHere(call, "README", 1, "hello from the dig");
    const was = await sides(call);
    renameSync(up, up + ".away");
    expect(await (await turn(call, { ahead: 1 })).json()).toMatchObject({ state: "down", ahead: 1 });
    renameSync(up + ".away", up);
    expect(await sides(call)).toEqual(was);
    expect(await sync(call)).toMatchObject({ state: "ok", ahead: 0 });
    expect(await upShow("README")).toBe("hello from the dig\nworld");

    // Upstream that won't take our push (no rights): refused, and it all stays here.
    const no = await dug("turn-refused");
    writeFileSync(join(up, "hooks", "pre-receive"), "#!/bin/sh\necho 'permission denied to ana' >&2\nexit 1\n", { mode: 0o755 });
    await editHere(no, "README", 1, "hello from the dig");
    const before = await sides(no);
    expect(await (await turn(no, { ahead: 1 })).json()).toMatchObject({ state: "refused", ahead: 1 });
    expect(await sides(no)).toEqual(before);
  });

  test("a fork whose git started over since the dig, or that has private lines, sends nothing up (#875)", async () => {
    const call = await dug("turn-fresh");
    const here = call.artifacts.path("ana--up");
    const fresh = await sh(`git --git-dir ${here} commit-tree $(git --git-dir ${here} mktree </dev/null) -m fresh`);
    await sh(`git --git-dir ${here} update-ref refs/heads/main ${fresh}`);
    expect((await get(call, "/api/repos/ana/up/mirror/turn")).error).toMatch(/doesn't build on the commit it was dug at/);
    expect((await turn(call, { ahead: 1 })).status).toBe(409);
    expect(await upShow("README")).toBe("hello\nworld");

    // A secret on a private line: turned, it's held, and upstream never sees the secret.
    const priv = await dug("turn-private");
    await editHere(priv, "README", 2, "token=s3cret", false);
    const secret = (await file(priv, "README")).lines[1];
    expect((await post(priv, "/api/repos/ana/up/do/private?path=README", { lines: [secret.id], private: true })).status).toBe(200);
    await editHere(priv, "README", 1, "hello from here");
    const { ahead } = await get(priv, "/api/repos/ana/up/mirror/turn");
    expect(await (await turn(priv, { ahead })).json()).toMatchObject({ state: "held", private: true });
    expect(await upShow("README")).toBe("hello\nworld");
    expect(await sh(`git --git-dir ${up} log -p --all | grep -c s3cret || true`)).toBe("0");
  });

});
