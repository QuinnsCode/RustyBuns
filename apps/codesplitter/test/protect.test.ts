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
