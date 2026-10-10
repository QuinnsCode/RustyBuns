import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { local as boot, type Call } from "../src/local.ts";
import { STEP } from "../src/fresh.ts";

setDefaultTimeout(30_000);
const opened: { close(): void }[] = [];
afterAll(() => { for (const o of opened) o.close(); });
const post = (call: Call, user: string | null, path: string, body: unknown) => call(user, path, { method: "POST", body: JSON.stringify(body) });
const get = async (call: Call, user: string | null, path: string) => (await call(user, path)).json() as Promise<any>;
const sh = async (cmd: string, cwd: string) => {
  const p = Bun.spawn(["sh", "-c", cmd], { cwd, stdout: "pipe", stderr: "pipe" });
  return { code: await p.exited, out: await new Response(p.stdout).text() };
};

async function repoWithGit() {
  const call = await boot();
  opened.push(call);
  await post(call, "ana", "/api/login", { name: "ana" });
  await post(call, "ana", "/api/repos", { name: "dig" });
  for (const [path, content] of [["src/a.ts", "export const a = 1"], ["src/deep/b.ts", "export const b = 2"], ["README", "found it"]]) {
    await post(call, "ana", "/api/repos/ana/dig/files", { path, content });
    await post(call, "ana", `/api/repos/ana/dig/do/commit?path=${encodeURIComponent(path)}`, { message: `add ${path}` });
  }
  return call;
}

async function untilDone(call: Call) {
  for (let i = 0; i < 50; i++) {
    const f = await get(call, "ana", "/api/repos/ana/dig/fresh");
    if (f.state !== "walking" && f.state !== "copying") return f;
  }
  throw new Error("fresh start never finished");
}

describe("fresh start", () => {
  test("moves git to a new Artifact with the same files as one commit, and keeps the old", async () => {
    const call = await repoWithGit();
    const old = await call.artifacts.get("ana--dig");
    const [tip] = await old.log({ ref: "main", limit: 1 });
    expect((await old.log()).length).toBe(3);

    expect((await post(call, "bob", "/api/repos/ana/dig/fresh", {})).status).toBe(403);   // owner only
    expect((await post(call, "ana", "/api/repos/ana/dig/fresh", {})).status).toBe(202);
    // Committed while git is moving: it waits, then lands on the new git.
    await call("ana", "/api/repos/ana/dig/do/ops?path=README", { method: "POST", body: JSON.stringify({ ops: [{ kind: "set", line: "L1", base: 1, text: "found it again" }] }) });
    const mid = await (await post(call, "ana", "/api/repos/ana/dig/do/commit?path=README", { message: "during" })).json() as any;
    expect(mid.git.error).toMatch(/fresh start/);
    expect((await get(call, "ana", "/api/repos/ana/dig/limits")).git.pending).toEqual(["README"]);

    const f = await untilDone(call);
    expect(f).toMatchObject({ state: "done", error: null });
    expect(f.done).toBe(f.total);

    const limits = await get(call, "ana", "/api/repos/ana/dig/limits");
    expect(limits.git).toMatchObject({ measured: true, pending: [], old: ["ana--dig"], error: null });
    expect(limits.git.artifact).not.toBe("ana--dig");
    expect(limits.git.bytes).toBeGreaterThan(0);

    // The new git: the old tip's tree as a root commit, then the file that waited.
    const fresh = await call.artifacts.get(limits.git.artifact);
    const log = await fresh.log({ ref: "main" });
    expect(log.length).toBe(2);
    expect(log[1]!.treeHash).toBe(tip!.treeHash);
    expect(log[1]!.parents).toEqual([]);
    expect(await (await fresh.readFile({ ref: "main", path: "README" }))!.text()).toBe("found it again\n");
    expect(await (await fresh.readFile({ ref: "main", path: "src/deep/b.ts" }))!.text()).toBe("export const b = 2\n");

    // A stock git client clones it, finds every object, and sees no staging branch.
    const { clone } = await get(call, null, "/api/repos/ana/dig");
    const dir = mkdtempSync(join(tmpdir(), "cs-fresh-"));
    expect((await sh(clone, dir)).code).toBe(0);
    expect((await sh("git fsck --full", join(dir, "dig"))).code).toBe(0);
    expect((await sh("git ls-remote origin", join(dir, "dig"))).out).not.toMatch(/fresh-start/);
    rmSync(dir, { recursive: true, force: true });

    // The old git is still there until the owner deletes it.
    expect((await call("ana", "/api/repos/ana/dig/fresh?artifact=ana--dig", { method: "DELETE" })).status).toBe(200);
    expect((await get(call, "ana", "/api/repos/ana/dig/limits")).git.old).toEqual([]);
  });

  test("a big repo moves over many small steps, each its own push", async () => {
    const call = await repoWithGit();
    const [tip] = await (await call.artifacts.get("ana--dig")).log({ ref: "main", limit: 1 });
    const was = { ...STEP };
    Object.assign(STEP, { reads: 1, bytes: 1 });
    try {
      await post(call, "ana", "/api/repos/ana/dig/fresh", {});
      let steps = 1, f;
      for (; steps < 50; steps++) if ((f = await get(call, "ana", "/api/repos/ana/dig/fresh")).state === "done") break;
      expect(f.total).toBe(6);   // three files, src, src/deep and the root
      expect(steps).toBeGreaterThan(f.total);
    } finally { Object.assign(STEP, was); }
    const { git } = await get(call, "ana", "/api/repos/ana/dig/limits");
    const log = await (await call.artifacts.get(git.artifact)).log({ ref: "main" });
    expect(log.map((c) => c.treeHash)).toEqual([tip!.treeHash]);
  });

  test("a repo near the cap starts fresh by itself on its next commit", async () => {
    const call = await repoWithGit();
    await call.env.DB.prepare("UPDATE repos SET git_bytes = ? WHERE owner = 'ana' AND name = 'dig'").bind(1024 ** 3).run();
    await post(call, "ana", "/api/repos/ana/dig/do/commit?path=README", { message: "one more" });
    let state;
    for (let i = 0; i < 50 && !state; i++) { state = (await get(call, "ana", "/api/repos/ana/dig/limits")).fresh?.state; await Bun.sleep(20); }
    expect(state).toBeTruthy();
    expect((await untilDone(call)).state).toBe("done");
    expect((await get(call, "ana", "/api/repos/ana/dig/limits")).git.bytes).toBeLessThan(1024 ** 2);
  });

  test("limits show your own rate limits, and the caps on files", async () => {
    const call = await repoWithGit();
    const l = await get(call, "ana", "/api/repos/ana/dig/limits");
    expect(l.files).toEqual({ maxBytes: 256 * 1024, maxLines: 5000 });
    expect(l.git).toMatchObject({ cap: 1024 ** 3, fileCap: 32 * 1024 ** 2, measured: false });
    expect(l.you.map((r: any) => r.name)).toContain("commit");
    expect((await get(call, null, "/api/repos/ana/dig/limits")).you).toEqual([]);
  });
});
