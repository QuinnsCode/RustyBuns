import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { local as boot } from "../src/local.ts";

// End to end, with real git: a busy machine can stretch one past bun's 5s default.
setDefaultTimeout(20_000);

const opened: { close(): void }[] = [];
afterAll(() => { for (const o of opened) o.close(); });

const SHA = "b".repeat(40);

test("Ester sorts a branch's red checks, and a person's flaky becomes her rule until someone says fixed (#3923)", async () => {
  const call = await boot({ GH_CLI: "off" });
  opened.push(call);
  const send = (url: string, body: unknown, method = "POST") => call("ryan", url, { method, body: JSON.stringify(body) });
  await send("/api/login", { name: "ryan" });
  await send("/api/repos", { name: "lab" });
  await send("/api/repos/ryan/lab/files", { path: "a.ts", content: "one\ntwo" });
  await send("/api/repos/ryan/lab/do/commit?path=a.ts", { message: "first" });
  await send("/api/repos/ryan/lab/branches", { name: "tidy" });
  const doc = await (await call("ryan", "/api/repos/ryan/lab/do/file?path=a.ts&branch=tidy")).json();
  await send("/api/repos/ryan/lab/do/ops?path=a.ts&branch=tidy", { ops: [{ kind: "set", line: doc.lines[0].id, text: "ONE", base: doc.lines[0].rev }] });
  await send("/api/repos/ryan/lab/checks/settings", { required: ["test", "lint", "e2e"] }, "PUT");

  // test is red on the branch alone, lint on main too, and e2e failed once but passed when run again on the same commit.
  await send("/api/repos/ryan/lab/checks", { ref: "tidy", sha: SHA, name: "test", status: "failed" });
  await send("/api/repos/ryan/lab/checks", { ref: "main", sha: "c".repeat(40), name: "lint", status: "failed" });
  await send("/api/repos/ryan/lab/checks", { ref: "tidy", sha: SHA, name: "lint", status: "failed" });
  await send("/api/repos/ryan/lab/checks", { ref: "tidy", sha: SHA, name: "e2e", status: "passed" });
  await send("/api/repos/ryan/lab/checks", { ref: "tidy", sha: SHA, name: "e2e", status: "failed" });
  const sorted = async () => Object.fromEntries(((await (await call("ryan", "/api/repos/ryan/lab/checks?ref=tidy")).json()).ester as { test: string; owner: string }[]).map((v) => [v.test, v.owner]));
  expect(await sorted()).toEqual({ test: "own", lint: "main", e2e: "flaky" });

  // A word nobody can use is refused; a flaky one becomes her rule, and she remembers who said it.
  expect((await send("/api/repos/ryan/lab/checks/ester", { name: "test", kind: "maybe" })).status).toBe(400);
  const said = await send("/api/repos/ryan/lab/checks/ester", { name: "test", kind: "flaky", ref: "tidy" });
  expect(said.status).toBe(201);
  const mem = (await said.json()).checks.find((c: { name: string }) => c.name === "test");
  expect(mem).toMatchObject({ runs: 1, fails: 1, rule: "flaky", unexplained: false });
  const branch = (await (await call("ryan", "/api/repos/ryan/lab/branches/tidy")).json()).checks.ester;
  expect(branch.find((v: { test: string }) => v.test === "test")).toMatchObject({ owner: "flaky", why: expect.stringContaining("@ryan") });

  // Fixed: she sorts it as the branch's own again. The merge still waits on red either way.
  await send("/api/repos/ryan/lab/checks/ester", { name: "test", kind: "fix" });
  expect((await sorted()).test).toBe("own");
  expect((await send("/api/repos/ryan/lab/branches/tidy/merge", {})).status).toBe(409);
});
