import { expect, setDefaultTimeout, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { local } from "./app-kit.ts";
import type { Exec } from "../src/agent-run.ts";
import { commitNote } from "../src/why.ts";

setDefaultTimeout(30_000);

const until = async (f: () => Promise<boolean>) => { for (const end = performance.now() + 15_000; performance.now() < end && !(await f());) await Bun.sleep(20); };

test("an agent's lines, committed, carry its run's why as a git note; a person's commit has none", async () => {
  const call = await local({ GH_CLI: "off" });
  // A fake CLI that upper-cases the file and leaves the note the prompt asks for.
  const exec: Exec = async (_cmd, cwd) => {
    const f = join(cwd, "a.js");
    writeFileSync(f, readFileSync(f, "utf8").toUpperCase());
    return { code: 0, out: "shouted\nDONE: upper-cased a.js\nNEXT: nothing" };
  };
  call.env.AGENT_EXEC = exec;
  call.env.AGENT_REVIEW_MS = "100";
  const post = (url: string, body: unknown) => call("ryan", url, { method: "POST", body: JSON.stringify(body) });
  await post("/api/login", { name: "ryan" });
  await post("/api/repos", { name: "lab", visibility: "public" });
  await post("/api/repos/ryan/lab/files", { path: "a.js", content: "let a = 1" });
  const tip = async () => ((await (await call("ryan", "/api/repos/ryan/lab/graph")).json()) as { commits: { hash: string }[] }).commits[0]!.hash;
  const noteOf = async (sha: string) => ((await (await call(null, `/api/repos/ryan/lab/commits/${sha}/note`)).json()) as { note: string | null }).note;

  await post("/api/repos/ryan/lab/do/commit?path=a.js", { message: "first" });
  expect(await noteOf(await tip())).toBeNull();

  const run = await (await post("/api/repos/ryan/lab/agents", { path: "a.js", harness: "claude", task: "shout", model: "opus" })).json() as { id: number };
  await until(async () => !!((await (await call("ryan", "/api/repos/ryan/lab/agents?path=a.js")).json()) as { landed?: unknown }[])[0]!.landed);
  // Landing the run is its commit (#3402).
  const note = await noteOf(await tip());
  expect(note?.split("\n")).toEqual([
    "agent: agent-claude",
    "harness: claude, model opus",
    `prompt: sha256:${new Bun.CryptoHasher("sha256").update("shout").digest("hex").slice(0, 16)}`,
    `run: ${run.id}, done`,
    "DONE: upper-cased a.js",
    "NEXT: nothing",
  ]);
  // Its checks finish: the note says how they went, and a commit without a note stays without.
  const sha = await tip(), first = ((await (await call("ryan", "/api/repos/ryan/lab/graph")).json()) as { commits: { hash: string }[] }).commits[1]!.hash;
  await post("/api/repos/ryan/lab/checks", { ref: "main", sha: first, name: "lint", status: "passed" });
  await post("/api/repos/ryan/lab/checks", { ref: "main", sha, name: "test", status: "passed" });
  expect((await noteOf(sha))?.split("\n").at(-1)).toBe("checks: passed");
  await post("/api/repos/ryan/lab/checks", { ref: "main", sha, name: "lint", status: "failed" });
  const after = (await noteOf(sha))!.split("\n");
  expect(after.filter((l) => l.startsWith("checks: "))).toEqual(["checks: failed (lint)"]);
  expect(after.slice(0, 6)).toEqual(note!.split("\n"));
  expect(await noteOf(first)).toBeNull();
  // The commit before keeps having none: the notes tree adds, it doesn't replace.
  const commits = ((await (await call("ryan", "/api/repos/ryan/lab/graph")).json()) as { commits: { hash: string }[] }).commits;
  expect(await noteOf(commits[1]!.hash)).toBeNull();
});

test("a fix run that read another file's private line keeps it out of its output and its commit's note (#3637)", async () => {
  const call = await local({ GH_CLI: "off", HEAL: "1" });
  const secret = "const vault = 48151623";
  // A fake CLI that fixes a.js and quotes b.js's private line in its note.
  call.env.AGENT_EXEC = (async (_cmd, cwd) => {
    writeFileSync(join(cwd, "a.js"), "let a = 2\n");
    return { code: 0, out: `fixed\nDONE: a.js, and left ${secret} in b.js\nNEXT: nothing` };
  }) as Exec;
  const send = (url: string, body: unknown, method = "POST") => call("ryan", url, { method, body: JSON.stringify(body) });
  const lines = async (path: string, branch = "") => ((await (await call("ryan", `/api/repos/ryan/lab/do/file?path=${path}${branch && `&branch=${branch}`}`)).json()) as { lines: { id: string; rev: number }[] }).lines;
  await send("/api/login", { name: "ryan" });
  await send("/api/repos", { name: "lab", visibility: "public" });
  await send("/api/repos/ryan/lab/files", { path: "a.js", content: "let a = 1" });
  await send("/api/repos/ryan/lab/files", { path: "b.js", content: `${secret}\nlet b = 1` });
  await send("/api/repos/ryan/lab/do/private?path=b.js", { lines: [(await lines("b.js"))[0]!.id], private: true });
  for (const path of ["a.js", "b.js"]) await send(`/api/repos/ryan/lab/do/commit?path=${path}`, { message: path });
  // A branch that changes both: the fix task on a.js has b.js in front of it too.
  await send("/api/repos/ryan/lab/branches", { name: "tidy" });
  for (const path of ["a.js", "b.js"]) {
    const l = (await lines(path, "tidy")).at(-1)!;
    await send(`/api/repos/ryan/lab/do/ops?path=${path}&branch=tidy`, { ops: [{ kind: "set", line: l.id, text: `// ${path} changed`, base: l.rev }] });
  }
  await send("/api/repos/ryan/lab/checks/settings", { required: ["test"] }, "PUT");
  const check = await (await send("/api/repos/ryan/lab/checks", { ref: "tidy", sha: "a".repeat(40), name: "test" })).json() as { id: number };
  await send(`/api/repos/ryan/lab/checks/${check.id}`, { status: "failed", append: "a.js:1 expected 2\n1 fail\n" }, "PUT");
  const runs = async () => (await (await call("ryan", "/api/repos/ryan/lab/agents")).json()) as { path: string; status: string; also?: string[]; private?: true; output?: string }[];
  await until(async () => (await runs()).some((r) => r.status === "done"));
  const [run] = await runs();
  expect(run).toMatchObject({ path: "a.js", status: "done", also: ["b.js"], private: true });
  expect(run!.output).not.toContain("48151623");
  // a.js has no private lines of its own, and still the note says only who ran it.
  const note = await commitNote(call.env, "ryan", "lab", "a.js", ["agent-claude"], true);
  expect(note).toStartWith("agent: agent-claude");
  expect(note).not.toContain("48151623");
  expect(note).not.toContain("DONE:");
});
