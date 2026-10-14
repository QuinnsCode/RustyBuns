import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalArtifacts, gitHttp } from "@rustybuns/shell-bun";
import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { local as boot } from "../src/local.ts";
import { namesOf } from "../src/artifact-move.ts";

// End to end (real git, in-process D1): copy a repo into a second namespace, then rewrite its stored remote (#823).
setDefaultTimeout(20_000);

const opened: { close(): void }[] = [];
const dirs: string[] = [];
afterAll(() => { for (const o of opened) o.close(); for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

test("names of a repo's Artifacts: its own and its crew copy, once each", () => {
  expect(namesOf([{ artifact: "a--x", crew_artifact: "a--x.crew" }, { artifact: "a--x", crew_artifact: null }, { artifact: null, crew_artifact: null }])).toEqual(["a--x", "a--x.crew"]);
});

test("copy plans, the script mirrors with real git, verify records, and rewrite points the stored remotes at the copies", async () => {
  const dir = mkdtempSync(join(tmpdir(), "codesplitter-next-"));
  dirs.push(dir);
  const next = new LocalArtifacts(dir, "codesplitter");
  const git = Bun.serve({ port: 0, fetch: (req) => gitHttp(req, [next]) });
  git.unref();
  next.remoteBase = `http://127.0.0.1:${git.port}`;
  const call = await boot({ GH_CLI: "off", ADMINS: "ryan", ARTIFACTS_NEXT: next as any });
  opened.push(call);
  const send = (user: string, url: string, body: unknown = {}) => call(user, url, { method: "POST", body: JSON.stringify(body) });
  await send("ryan", "/api/login", { name: "ryan" });
  await send("ryan", "/api/repos", { name: "lab" });
  await send("ryan", "/api/repos/ryan/lab/files", { path: "a.ts", content: "one\ntwo" });
  await send("ryan", "/api/repos/ryan/lab/files", { path: "b.ts", content: "three" });
  const row = () => call.env.DB.prepare("SELECT artifact, artifact_remote FROM repos WHERE owner = 'ryan' AND name = 'lab'").first() as Promise<{ artifact: string; artifact_remote: string }>;
  // Each commit lands in git; the old repo needs some history.
  for (const [path, message] of [["a.ts", "one"], ["b.ts", "two"]]) await send("ryan", `/api/repos/ryan/lab/do/commit?path=${path}`, { message });
  const before = await row();

  // Not an admin: refused, and nothing made.
  await send("mia", "/api/login", { name: "mia" });
  expect((await send("mia", "/api/admin/artifacts/copy")).status).toBe(403);
  expect((await next.list()).repos).toHaveLength(0);

  const plan = (await (await send("ryan", "/api/admin/artifacts/copy")).json()) as { repos: { name: string }[]; failed: unknown[]; next: string | null };
  expect(plan.failed).toEqual([]);
  expect(plan.repos.map((r) => r.name)).toEqual([before.artifact]);
  expect(plan.next).toBeNull();

  // Before the mirror the new repo is empty, so verify finds it different and records nothing.
  const early = (await (await send("ryan", "/api/admin/artifacts/verify")).json()) as { verified: string[]; differs: unknown[] };
  expect(early.verified).toEqual([]);
  expect(early.differs).toHaveLength(1);

  const file = join(dir, "plan.json");
  writeFileSync(file, JSON.stringify(plan.repos));
  // Async: the git servers are this process.
  const run = Bun.spawn(["bun", join(import.meta.dir, "../scripts/move-artifacts.ts"), file], { stdout: "pipe", stderr: "pipe" });
  expect(await new Response(run.stderr).text()).toBe("");
  expect(await run.exited).toBe(0);

  const late = (await (await send("ryan", "/api/admin/artifacts/verify")).json()) as { verified: string[]; differs: unknown[] };
  expect(late).toMatchObject({ verified: [before.artifact], differs: [] });
  // The copy has the history.
  expect((await (await next.get(before.artifact)).log({ limit: 5 })).length).toBeGreaterThan(0);
  // A planned repo that's verified is skipped from now on.
  expect(((await (await send("ryan", "/api/admin/artifacts/copy")).json()) as { skipped: string[] }).skipped).toEqual([before.artifact]);

  // The stored remote isn't touched until the binding has moved.
  expect((await row()).artifact_remote).toBe(before.artifact_remote);
  const done = (await (await send("ryan", "/api/admin/artifacts/rewrite")).json()) as { rewritten: { artifact_remote: number }; notCopied: string[] };
  expect(done.rewritten.artifact_remote).toBe(1);
  expect(done.notCopied).toEqual([]);
  expect((await row()).artifact_remote).toBe(next.remote(before.artifact));
});
