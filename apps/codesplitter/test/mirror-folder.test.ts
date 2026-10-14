import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { local as boot } from "../src/local.ts";
import { folderPath } from "../src/folder-mirror.ts";
import { root, opened, sh, post, get, sync, editHere } from "./mirror-kit.ts";

setDefaultTimeout(30_000);

// A folder mirror (src/folder-mirror.ts): one folder of a monorepo as a repo of its own, both ways.
describe("folder mirrors", () => {
  const up = join(root, "mono.git");
  const commitUp = async (files: Record<string, string>, message: string, author = "Bo") => {
    const work = mkdtempSync(join(root, "work-"));
    await sh(`git clone -q ${up} . && git config user.name ${author} && git config user.email ${author.toLowerCase()}@example.com`, work);
    for (const [p, c] of Object.entries(files)) { await sh(`mkdir -p "$(dirname ${p})"`, work); writeFileSync(join(work, p), c); }
    await sh(`git add -A && git commit -qm "${message}" && git push -q origin main`, work);
  };
  const upShow = (rev: string, path: string) => sh(`git --git-dir ${up} show ${rev}:${path}`);

  test("pulls the folder's commits as its own history, and sends its work up as a branch, never to main", async () => {
    const seed = mkdtempSync(join(root, "seed-"));
    await sh(`git init -q --bare ${up} && git clone -q ${up} . 2>/dev/null; mkdir -p apps/web other && printf 'one\\ntwo\\n' > apps/web/a.ts && printf 'x\\n' > other/x.ts && git add -A && git commit -qm init && git push -q origin main`, seed);
    const call = await boot();
    opened.push(call);
    await post(call, "/api/login", { name: "ana" });

    expect((await post(call, "/api/mirrors", { url: `file://${up}`, name: "up", path: "../web" })).status).toBe(400);
    expect((await post(call, "/api/mirrors", { url: `file://${up}`, name: "up", path: "apps/nope" })).status).toBe(404);
    const made = await post(call, "/api/mirrors", { url: `file://${up}`, name: "up", path: "/apps/web/" });
    expect(made.status).toBe(201);
    expect(await made.json()).toMatchObject({ name: "up", path: "apps/web", sends: "codesplitter/up", upstream: `file://${up}/tree/main/apps/web` });
    // The folder is the root.
    expect((await get(call, "/api/repos/ana/up/tree?path=")).entries.map((e: any) => e.name)).toEqual(["a.ts"]);
    expect(await sync(call)).toMatchObject({ state: "ok", path: "apps/web", sends: "codesplitter/up", ahead: 0, behind: 0 });

    // Upstream's commits come in when they touch the folder, with their author and message; the rest stay upstream.
    await commitUp({ "apps/web/a.ts": "one\ntwo\nthree\n", "other/x.ts": "y\n" }, "web: three");
    await commitUp({ "other/x.ts": "z\n" }, "other only");
    expect(await sync(call)).toMatchObject({ state: "ok", ahead: 0, behind: 0 });
    const here = call.artifacts.path("ana--up");
    expect(await sh(`git --git-dir ${here} log --format=%an/%s main`)).toBe("Bo/web: three\nAna Real/apps/web at " + (await sh(`git --git-dir ${up} rev-parse --short=7 main~2`)));
    expect(await sh(`git --git-dir ${here} log -1 --format=%B main`)).toContain("Upstream-commit: ");
    expect(await sh(`git --git-dir ${here} show main:a.ts`)).toBe("one\ntwo\nthree");

    // A commit here goes up under the folder, on upstream's tip, as a branch of its own. Main upstream doesn't move.
    const mainBefore = await sh(`git --git-dir ${up} rev-parse main`);
    await editHere(call, "a.ts", 1, "ONE");
    const sent = await sync(call);
    expect(sent).toMatchObject({ state: "held" });
    expect(sent.error).toContain("codesplitter/up");
    expect(await sh(`git --git-dir ${up} rev-parse main`)).toBe(mainBefore);
    expect(await upShow("codesplitter/up", "apps/web/a.ts")).toBe("ONE\ntwo\nthree");
    expect(await upShow("codesplitter/up", "other/x.ts")).toBe("z");
    expect(await sh(`git --git-dir ${up} rev-parse codesplitter/up^`)).toBe(mainBefore);

    // Upstream takes it: the folder comes back as this copy has it, and nothing more is sent.
    await sh(`git --git-dir ${up} update-ref refs/heads/main codesplitter/up`);
    const taken = await sh(`git --git-dir ${up} rev-parse main`);
    expect(await sync(call)).toMatchObject({ state: "ok" });
    expect(await sh(`git --git-dir ${up} rev-parse main`)).toBe(taken);
    expect(await sh(`git --git-dir ${here} show main:a.ts`)).toBe("ONE\ntwo\nthree");

    // Upstream's branches and tags stay upstream, and the folder can't lead.
    expect((await call("ana", "/api/repos/ana/up/mirror/branches")).status).toBe(409);
    expect((await post(call, "/api/repos/ana/up/mirror/tags/v1/push")).status).toBe(409);
    expect((await post(call, "/api/repos/ana/up/mirror", { primary: "here" })).status).toBe(409);
  });

  test("a folder path is a folder", () => {
    expect(folderPath("/apps/web/")).toBe("apps/web");
    expect(folderPath("apps//web")).toBe("apps/web");
    for (const bad of ["", "/", "..", "apps/../x", ".git/hooks", 3]) expect(folderPath(bad)).toBeNull();
  });
});
