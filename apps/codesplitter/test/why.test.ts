import { expect, setDefaultTimeout, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { local } from "./app-kit.ts";
import type { Exec } from "../src/agent-run.ts";

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
  await post("/api/repos/ryan/lab/do/commit?path=a.js", { message: "shout" });
  const note = await noteOf(await tip());
  expect(note?.split("\n")).toEqual([
    "agent: agent-claude",
    "harness: claude, model opus",
    `prompt: sha256:${new Bun.CryptoHasher("sha256").update("shout").digest("hex").slice(0, 16)}`,
    `run: ${run.id}, done`,
    "DONE: upper-cased a.js",
    "NEXT: nothing",
  ]);
  // The commit before keeps having none: the notes tree adds, it doesn't replace.
  const commits = ((await (await call("ryan", "/api/repos/ryan/lab/graph")).json()) as { commits: { hash: string }[] }).commits;
  expect(await noteOf(commits[1]!.hash)).toBeNull();
});
