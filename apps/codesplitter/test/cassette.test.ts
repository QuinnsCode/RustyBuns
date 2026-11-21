import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { text, type Doc } from "../src/lines.ts";
import { local as boot } from "../src/local.ts";
import { runAgent, type Exec } from "../src/agent-run.ts";
import { cassette } from "./cassette.ts";

// The agent path on a recorded model answer (test/cassette.ts): no CLI, no login, no tokens.
const opened: { close(): void }[] = [], scratch = mkdtempSync(join(tmpdir(), "cassette-"));
afterAll(() => { for (const o of opened) o.close(); rmSync(scratch, { recursive: true, force: true }); });

test("an agent run replayed from a cassette lands the recorded edit as the agent's lines, with the tokens it reported", async () => {
  const call = await boot();
  opened.push(call);
  const post = (url: string, body: unknown) => call("ryan", url, { method: "POST", body: JSON.stringify(body) });
  await post("/api/login", { name: "ryan" });
  await post("/api/repos", { name: "r1", visibility: "public" });
  await post("/api/repos/ryan/r1/collaborators", { name: "agent-x" });
  await post("/api/repos/ryan/r1/files", { path: "a.js", content: "var x = 1\nfunction f() {\n  return x\n}" });

  const tape = cassette("use-let");
  const r = await runAgent(call, { user: "agent-x", owner: "ryan", repo: "r1", path: "a.js", harness: "claude", task: "use let", exec: tape });
  expect(tape.turns()).toBe(1);
  expect(r.changed).toBe(true);
  expect(r.output).toContain("let x");
  if (process.env.CASSETTE !== "record") expect(r.spent).toBe(473);
  const doc = await (await call("ryan", "/api/repos/ryan/r1/do/file?path=a.js")).json() as Doc;
  expect(text(doc)).toBe("let x = 1\nfunction f() {\n  return x\n}");
  expect(doc.lines.map((l) => l.by)).toEqual(["agent-x", "ryan", "ryan", "ryan"]);
});

test("a recorded two-turn run: a person changes the line the agent was editing, and its second turn keeps their change", async () => {
  const call = await boot();
  opened.push(call);
  const post = (url: string, body: unknown) => call("ryan", url, { method: "POST", body: JSON.stringify(body) });
  await post("/api/login", { name: "ryan" });
  await post("/api/repos", { name: "r2", visibility: "public" });
  await post("/api/repos/ryan/r2/collaborators", { name: "agent-x" });
  await post("/api/repos/ryan/r2/files", { path: "a.js", content: "a\nb\nc" });
  const read = async () => await (await call("ryan", "/api/repos/ryan/r2/do/file?path=a.js")).json() as Doc;

  // Recorded with claude (test/fixtures/cassettes/conflict-rerun.json): it uppercased a and b; Ryan set line 1 as it worked.
  const tape = cassette("conflict-rerun");
  let turn = 0;
  const r = await runAgent(call, {
    user: "agent-x", owner: "ryan", repo: "r2", path: "a.js", harness: "claude", task: "uppercase the first two lines",
    exec: async (cmd, cwd, signal, ear) => {
      if (turn++ === 0) expect((await post("/api/repos/ryan/r2/do/ops?path=a.js", { ops: [{ kind: "set", line: "L1", base: (await read()).lines[0]!.rev, text: "human" }] })).status).toBe(200);
      return tape(cmd, cwd, signal, ear);
    },
  });
  expect([tape.turns(), r.runs]).toEqual([2, 2]);
  expect(r.conflicts).toEqual([]);
  if (process.env.CASSETTE !== "record") expect(r.spent).toBe(32_896);
  // Its second turn saw Ryan's line and the B that landed, and left Ryan's line as he wrote it.
  const doc = await read();
  expect(text(doc)).toBe("human\nB\nc");
  expect(doc.lines.map((l) => l.by)).toEqual(["ryan", "agent-x", "ryan"]);
});

test("a recording plays back what the CLI did, keeps none of its start-up lines, and stops when the file it was made on has changed", async () => {
  const work = (start: string) => { const d = mkdtempSync(join(scratch, "work-")); writeFileSync(join(d, "a.js"), start); return d; };
  // A stand-in for a signed-in CLI: it edits the file and answers as claude's stream does, start-up line first.
  const cli: Exec = async (_cmd, cwd) => {
    writeFileSync(join(cwd, "a.js"), "B\n");
    writeFileSync(join(cwd, "new.md"), "made\n");
    return { code: 0, out: [
      JSON.stringify({ type: "system", subtype: "init", cwd, tools: ["Read", "Edit"], mcp_servers: [{ name: "mine" }] }),
      JSON.stringify({ type: "result", result: `Edited ${cwd}/a.js`, session_id: "abcd1234-ef", usage: { input_tokens: 5, output_tokens: 2, service_tier: "standard" }, total_cost_usd: 0.01 }),
    ].join("\n") };
  };
  const cmd = { bin: "claude", args: ["-p", "upper-case it"] };
  const first = work("b\n");
  await cassette("upper", { dir: scratch, real: cli, record: true })(cmd, first);

  const saved = readFileSync(join(scratch, "upper.json"), "utf8");
  expect(saved).not.toContain("mcp_servers");
  expect(saved).not.toContain(first);
  expect(saved).not.toContain("total_cost_usd");

  const again = work("b\n");
  const played = await cassette("upper", { dir: scratch, record: false })(cmd, again);
  expect(played.code).toBe(0);
  expect(JSON.parse(played.out)).toEqual({ type: "result", result: "Edited <cwd>/a.js", session_id: "abcd1234-ef", usage: { input_tokens: 5, output_tokens: 2 } });
  expect(readFileSync(join(again, "a.js"), "utf8")).toBe("B\n");
  expect(readFileSync(join(again, "new.md"), "utf8")).toBe("made\n");

  await expect(cassette("upper", { dir: scratch, record: false })(cmd, work("someone changed it\n"))).rejects.toThrow("cassette upper is stale: turn 1 was recorded on other files (a.js)");
  await expect(cassette("never-made", { dir: scratch, record: false })(cmd, work("b\n"))).rejects.toThrow("no recording");
});
