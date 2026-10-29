import { expect, test } from "bun:test";
import { LocalArtifacts, gitHttp } from "@rustybuns/shell-bun";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { local as boot } from "./app-kit.ts";
import { namesOf } from "../src/artifact-move.ts";
import { mirror, type Job } from "../scripts/move-artifacts.ts";

// End to end (real git, in-process D1): mirror a private repo into a second namespace, verify it, then rewrite its stored remote (#823).

test("names of a repo's Artifacts: its own and its crew copy, once each", () => {
  expect(namesOf([{ artifact: "a--x", crew_artifact: "a--x.crew" }, { artifact: "a--x", crew_artifact: null }, { artifact: null, crew_artifact: null }])).toEqual(["a--x", "a--x.crew"]);
});

async function sh(args: string[], cwd: string) {
  const p = Bun.spawn(["git", "-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const [code, err] = await Promise.all([p.exited, new Response(p.stderr).text()]);
  if (code) throw new Error(err);
}

test("copy, mirror push, verify and rewrite move a private repo, and a push after the copy is caught", async () => {
  const dir = mkdtempSync(join(tmpdir(), "move-next-"));
  const next = new LocalArtifacts(dir, "codesplitter");
  const server = Bun.serve({ port: 0, fetch: (req) => gitHttp(req, [next]) });
  next.remoteBase = `http://127.0.0.1:${server.port}`;
  const call = await boot({ GH_CLI: "off", ADMINS: "ryan", ARTIFACTS_NEXT: next as any });
  try {
    const send = (user: string, url: string, body: unknown = {}) => call(user, url, { method: "POST", body: JSON.stringify(body) });
    await send("ryan", "/api/login", { name: "ryan" });
    await send("ryan", "/api/repos", { name: "lab" });
    const row = () => call.env.DB.prepare("SELECT artifact, artifact_remote FROM repos WHERE owner = 'ryan' AND name = 'lab'").first() as Promise<{ artifact: string; artifact_remote: string }>;
    const before = await row();

    // The old repo gets a commit pushed over its token-guarded remote.
    const work = mkdtempSync(join(tmpdir(), "move-work-"));
    const commit = async (file: string) => {
      const url = before.artifact_remote.replace("://", `://x:${call.artifacts.mint(before.artifact, "write").plaintext.split("?")[0]}@`);
      await sh(["init", "-q", "-b", "main"], work).catch(() => {});
      await Bun.write(join(work, file), file);
      await sh(["add", "."], work); await sh(["commit", "-q", "-m", file], work);
      await sh(["push", "-q", url, "HEAD:main", "-f"], work);
    };
    await commit("a.txt");

    // Not an admin: refused, and nothing made.
    await send("mia", "/api/login", { name: "mia" });
    for (const route of ["copy", "verify"]) expect((await send("mia", `/api/admin/artifacts/${route}`)).status).toBe(403);
    await expect(next.get(before.artifact)).rejects.toThrow();

    // Verify before the copy: not copied, and nothing recorded as moved.
    const early = (await (await send("ryan", "/api/admin/artifacts/verify")).json()) as { verified: string[]; mismatched: { why: string }[] };
    expect(early.verified).toEqual([]);
    expect(early.mismatched[0]!.why).toMatch(/not copied/);

    const plan = (await (await send("ryan", "/api/admin/artifacts/copy")).json()) as { todo: Job[]; failed: unknown[]; next: string | null };
    expect(plan.failed).toEqual([]);
    expect(plan.todo.map((j) => j.name)).toEqual([before.artifact]);
    await mirror(plan.todo[0]!);

    const verify = async () => (await (await send("ryan", "/api/admin/artifacts/verify")).json()) as { verified: string[]; mismatched: { name: string; why: string }[] };
    expect((await verify()).verified).toEqual([before.artifact]);
    const again = (await (await send("ryan", "/api/admin/artifacts/copy")).json()) as { todo: Job[]; skipped: string[] };
    expect(again.todo).toEqual([]);
    expect(again.skipped).toEqual([before.artifact]);

    // A commit lands on the old one after the copy: verify says so, and copy hands the repo out again.
    await commit("b.txt");
    expect((await verify()).mismatched).toEqual([{ name: before.artifact, why: expect.stringMatching(/copy again/) }]);
    const redo = (await (await send("ryan", "/api/admin/artifacts/copy")).json()) as { todo: Job[] };
    await mirror(redo.todo[0]!);
    expect((await verify()).verified).toEqual([before.artifact]);

    // The stored remote isn't touched until the binding has moved.
    expect((await row()).artifact_remote).toBe(before.artifact_remote);
    const done = (await (await send("ryan", "/api/admin/artifacts/rewrite")).json()) as { rewritten: { artifact_remote: number }; notCopied: string[] };
    expect(done.rewritten.artifact_remote).toBe(1);
    expect(done.notCopied).toEqual([]);
    expect((await row()).artifact_remote).toBe((await (await next.get(before.artifact)).info()).remote);
    rmSync(work, { recursive: true, force: true });
  } finally { call.close(); server.stop(true); rmSync(dir, { recursive: true, force: true }); }
});
