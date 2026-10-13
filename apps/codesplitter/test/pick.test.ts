import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { local as boot, type Call } from "../src/local.ts";
import { pickMessage, plan, planBlob } from "../src/pick.ts";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Doc } from "../src/lines.ts";

setDefaultTimeout(30_000);
const opened: { close(): void }[] = [];
afterAll(() => { for (const o of opened) o.close(); });

const post = (call: Call, path: string, body: unknown = {}, who = "ana") => call(who, path, { method: "POST", body: JSON.stringify(body) });
const get = async (call: Call, path: string) => (await call("ana", path)).json() as Promise<any>;
const file = (call: Call, path: string, branch?: string) => get(call, `/api/repos/ana/p/do/file?path=${path}${branch ? `&branch=${branch}` : ""}`);
const texts = async (call: Call, path: string, branch?: string) => (await file(call, path, branch)).lines.map((l: any) => l.text);
async function edit(call: Call, path: string, n: number, text: string, message?: string) {
  const line = (await file(call, path)).lines[n - 1];
  expect((await post(call, `/api/repos/ana/p/do/ops?path=${path}`, { ops: [{ kind: "set", line: line.id, base: line.rev, text }] })).status).toBe(200);
  if (message) expect((await post(call, `/api/repos/ana/p/do/commit?path=${path}`, { message })).status).toBe(200);
}
const hashOf = async (call: Call, message: string) => (await get(call, "/api/repos/ana/p/graph")).commits.find((c: any) => c.message === message).hash as string;
const git = async (call: Awaited<ReturnType<typeof boot>>, ...args: string[]) => {
  const p = Bun.spawn(["git", "--git-dir", call.artifacts.path("ana--p"), ...args], { stdout: "pipe", stderr: "pipe" });
  return (await new Response(p.stdout).text()).trim();
};

const doc = (lines: string[]): Doc => ({ rev: 1, lines: lines.map((text, i) => ({ id: `l${i}`, text, rev: 1, by: "ana", at: 0 })) } as unknown as Doc);

describe("a commit's changes, planned against the file now (#880)", () => {
  const c = { path: "a.ts", before: ["one", "two", "three", "four", "five"], after: ["one", "TWO", "three", "four", "five"] };
  test("a revert merges after back to before, keeping what came since", () => {
    expect(plan("revert", c, doc(["one", "TWO", "three", "four", "FIVE"]))).toMatchObject({ do: "edit", next: ["one", "two", "three", "four", "FIVE"] });
    expect(plan("revert", c, doc(["one", "two", "three", "four", "five"]))).toEqual({ path: "a.ts", do: "skip" });
    expect(plan("revert", c, doc(["one", "zwei", "three", "four", "five"]))).toEqual({ path: "a.ts", why: "the same lines changed since" });
    expect(plan("revert", c, null)).toEqual({ path: "a.ts", why: "deleted since" });
  });
  test("a pick merges before to after; new and deleted files", () => {
    expect(plan("pick", c, doc(["one", "two", "three", "four", "five", "six"]))).toMatchObject({ do: "edit", next: ["one", "TWO", "three", "four", "five", "six"] });
    const made = { path: "b.ts", before: null, after: ["b"] };
    expect(plan("pick", made, null)).toEqual({ path: "b.ts", do: "make", next: ["b"] });
    expect(plan("revert", made, doc(["b"]))).toEqual({ path: "b.ts", do: "delete" });
    expect(plan("revert", made, doc(["b", "more"]))).toMatchObject({ why: expect.stringContaining("changed since") });
    expect(plan("pick", { path: "x.png", before: null, after: null, binary: { before: null, after: { hash: "h", mode: "100644" } } }, null)).toMatchObject({ why: expect.stringContaining("only main") });
    expect(plan("pick", { path: "sub", before: null, after: null, odd: true }, null)).toMatchObject({ why: expect.stringContaining("submodule") });
  });
  test("a binary file goes by its bytes, when main's are the side it goes from (#888)", () => {
    const b = (...x: number[]) => new Uint8Array(x);
    const c = { path: "x.png", before: null, after: null, binary: { before: { hash: "a", mode: "100644" }, after: { hash: "b", mode: "100755" } } };
    const sides = { before: b(0, 1), after: b(0, 2) };
    expect(planBlob("revert", c, sides, b(0, 2))).toEqual({ path: "x.png", do: "blob", made: false, bytes: b(0, 1), mode: "100644" });
    expect(planBlob("pick", c, sides, b(0, 1))).toEqual({ path: "x.png", do: "blob", made: false, bytes: b(0, 2), mode: "100755" });
    expect(planBlob("revert", c, sides, b(0, 1))).toEqual({ path: "x.png", do: "skip" });
    expect(planBlob("revert", c, sides, b(0, 3))).toEqual({ path: "x.png", why: "a binary file changed since" });
    expect(planBlob("revert", c, sides, null)).toEqual({ path: "x.png", why: "deleted since" });
    const made = { ...c, binary: { before: null, after: c.binary.after } };
    expect(planBlob("revert", made, { before: null, after: b(0, 2) }, b(0, 2))).toEqual({ path: "x.png", do: "delete", blob: true });
    expect(planBlob("pick", made, { before: null, after: b(0, 2) }, null)).toMatchObject({ do: "blob", made: true });
    expect(planBlob("pick", made, { before: null, after: b(0, 2) }, b(9))).toEqual({ path: "x.png", why: "made again since, with other bytes" });
  });
  test("git's wording", () => {
    expect(pickMessage("revert", { hash: "abc", message: "shout two\n\nbody" })).toBe('Revert "shout two"\n\nThis reverts commit abc.');
    expect(pickMessage("pick", { hash: "abc", message: "shout two" })).toBe("shout two\n\n(cherry picked from commit abc)");
  });
});

describe("revert and cherry-pick from the commit graph (#880)", () => {
  test("revert lands as line edits and one commit; pick goes onto a branch; clashes land nothing", async () => {
    const call = await boot();
    opened.push(call);
    await post(call, "/api/login", { name: "ana" });
    await post(call, "/api/repos", { name: "p" });
    await post(call, "/api/repos/ana/p/files", { path: "a.ts", content: "one\ntwo\nthree\nfour\nfive" });
    expect((await post(call, "/api/repos/ana/p/do/commit?path=a.ts", { message: "first" })).status).toBe(200);
    await edit(call, "a.ts", 2, "TWO", "shout two");
    await edit(call, "a.ts", 5, "FIVE", "shout five");
    const two = await hashOf(call, "shout two"), five = (await file(call, "a.ts")).lines[4];

    // Not the crew's, not a commit.
    expect((await post(call, `/api/repos/ana/p/commits/${two}/revert`, {}, "bob")).status).toBe(403);
    expect((await post(call, `/api/repos/ana/p/commits/${"0".repeat(40)}/revert`)).status).toBe(404);

    // Revert "shout two": line 2 goes back, line 5 keeps what came after, and its id.
    const r = await post(call, `/api/repos/ana/p/commits/${two}/revert`);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ kind: "revert", branch: "main", files: [{ path: "a.ts", did: "edit" }], git: { commit: expect.any(String) } });
    const after = (await file(call, "a.ts")).lines;
    expect(after.map((l: any) => l.text)).toEqual(["one", "two", "three", "four", "FIVE"]);
    expect(after[4]).toMatchObject({ id: five.id, by: "ana" });
    expect(await git(call, "show", "main:a.ts")).toBe("one\ntwo\nthree\nfour\nFIVE");
    expect(await git(call, "log", "-1", "--format=%B", "main")).toBe(`Revert "shout two"\n\nThis reverts commit ${two}.`);
    // Twice: nothing left to undo.
    expect((await post(call, `/api/repos/ana/p/commits/${two}/revert`)).status).toBe(409);

    // Cherry-pick it onto a branch: the branch's copy takes it, main waits for the merge.
    expect((await post(call, "/api/repos/ana/p/branches", { name: "again" })).status).toBe(201);
    const pk = await post(call, `/api/repos/ana/p/commits/${two}/pick`, { branch: "again" });
    expect(pk.status).toBe(200);
    expect(await pk.json()).toMatchObject({ kind: "pick", branch: "again", message: `shout two\n\n(cherry picked from commit ${two})` });
    expect(await texts(call, "a.ts", "again")).toEqual(["one", "TWO", "three", "four", "FIVE"]);
    expect(await texts(call, "a.ts")).toEqual(["one", "two", "three", "four", "FIVE"]);
    expect((await post(call, `/api/repos/ana/p/commits/${two}/pick`, { branch: "nope" })).status).toBe(404);

    // A commit that made a file: reverting it deletes the file, in git too.
    await post(call, "/api/repos/ana/p/files", { path: "b.ts", content: "b" });
    expect((await post(call, "/api/repos/ana/p/do/commit?path=b.ts", { message: "add b" })).status).toBe(200);
    const addB = await hashOf(call, "add b");
    expect(await (await post(call, `/api/repos/ana/p/commits/${addB}/revert`)).json()).toMatchObject({ files: [{ path: "b.ts", did: "delete" }] });
    expect(await git(call, "ls-tree", "--name-only", "main")).toBe("a.ts");
    // And picking it again brings it back.
    expect(await (await post(call, `/api/repos/ana/p/commits/${addB}/pick`)).json()).toMatchObject({ files: [{ path: "b.ts", did: "make" }] });
    expect(await git(call, "show", "main:b.ts")).toBe("b");

    // The same line changed since (a live edit): a clash, and nothing lands.
    await edit(call, "a.ts", 2, "zwei");
    const clash = await post(call, `/api/repos/ana/p/commits/${two}/pick`);
    expect(clash.status).toBe(409);
    expect((await clash.json()).clashes).toEqual([{ path: "a.ts", why: "the same lines changed since" }]);
    expect(await texts(call, "a.ts")).toEqual(["one", "zwei", "three", "four", "FIVE"]);
  });
});

describe("a commit that touches a binary file (#888)", () => {
  test("its bytes are reverted and picked on main, in the same git commit as its lines; a branch or a change since clashes", async () => {
    const call = await boot();
    opened.push(call);
    await post(call, "/api/login", { name: "ana" });
    await post(call, "/api/repos", { name: "p" });
    await post(call, "/api/repos/ana/p/files", { path: "a.ts", content: "one\ntwo" });
    expect((await post(call, "/api/repos/ana/p/do/commit?path=a.ts", { message: "first" })).status).toBe(200);
    const work = mkdtempSync(join(tmpdir(), "pick-bin-"));
    const sh = async (cmd: string) => {
      const p = Bun.spawn(["sh", "-c", cmd], { cwd: work, stdout: "pipe", stderr: "pipe", env: { ...process.env, GIT_AUTHOR_NAME: "ana", GIT_AUTHOR_EMAIL: "a@x", GIT_COMMITTER_NAME: "ana", GIT_COMMITTER_EMAIL: "a@x" } });
      expect(await p.exited).toBe(0);
    };
    // A commit from outside, with a binary file and a line.
    await sh(`git clone -q ${call.artifacts.path("ana--p")} . && printf 'P\\000N\\001G' > logo.png && printf 'one\\nTWO\\n' > a.ts && git add -A && git commit -qm "logo and shout" && git push -q origin HEAD:main`);
    const logo = await hashOf(call, "logo and shout");

    // Revert: the logo goes and line 2 comes back, as one commit.
    const r = await post(call, `/api/repos/ana/p/commits/${logo}/revert`);
    expect(r.status).toBe(200);
    expect((await r.json()).files).toEqual([{ path: "a.ts", did: "edit" }, { path: "logo.png", did: "delete" }]);
    expect(await git(call, "ls-tree", "--name-only", "main")).toBe("a.ts");
    expect(await git(call, "show", "main:a.ts")).toBe("one\ntwo");
    expect(await git(call, "log", "-1", "--format=%s", "main")).toBe('Revert "logo and shout"');

    // Pick it again: the bytes are back, byte for byte.
    expect((await (await post(call, `/api/repos/ana/p/commits/${logo}/pick`)).json()).files).toEqual([{ path: "a.ts", did: "edit" }, { path: "logo.png", did: "make" }]);
    expect(await git(call, "rev-parse", "main:logo.png")).toBe(await git(call, "rev-parse", `${logo}:logo.png`));

    // A branch can't take bytes; nor can main once the logo changed since. Nothing lands.
    expect((await post(call, "/api/repos/ana/p/branches", { name: "b" })).status).toBe(201);
    expect((await (await post(call, `/api/repos/ana/p/commits/${logo}/revert`, { branch: "b" })).json()).clashes).toEqual([{ path: "logo.png", why: "a binary file: only main takes those" }]);
    await sh(`git pull -q origin main && printf 'P\\000X' > logo.png && git commit -qam "new logo" && git push -q origin HEAD:main`);
    const clash = await post(call, `/api/repos/ana/p/commits/${logo}/revert`);
    expect(clash.status).toBe(409);
    expect((await clash.json()).clashes).toEqual([{ path: "logo.png", why: "a binary file changed since" }]);
    expect(await git(call, "log", "-1", "--format=%s", "main")).toBe("new logo");
  });
});
