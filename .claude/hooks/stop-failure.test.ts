import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const hook = path.join(import.meta.dir, "stop-failure.ts");

test("a turn that ends on an API error leaves one line in the log, and the hook never fails the session", async () => {
  const home = mkdtempSync(path.join(tmpdir(), "rb-stopfail-"));
  const run = async (stdin: string) => {
    const p = Bun.spawn(["bun", hook], { stdin: new Blob([stdin]), env: { ...process.env, HOME: home }, stdout: "pipe", stderr: "pipe" });
    return { code: await p.exited, out: await new Response(p.stdout).text() };
  };
  const failed = { hook_event_name: "StopFailure", session_id: "ef9f309b", cwd: "/x/.agent-office/worktrees/sprocket-b93a", transcript_path: "/t.jsonl", error: "server_error", error_details: "529 overloaded", last_assistant_message: "x".repeat(2000) };
  expect(await run(JSON.stringify(failed))).toEqual({ code: 0, out: "" });
  expect(await run("not json")).toEqual({ code: 0, out: "" });
  const lines = readFileSync(path.join(home, ".rustybuns", "stop-failures.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  expect(lines).toHaveLength(1);
  expect(lines[0]).toMatchObject({ session: "ef9f309b", error: "server_error", details: "529 overloaded", transcript: "/t.jsonl" });
  expect(lines[0].last).toHaveLength(500);
});
