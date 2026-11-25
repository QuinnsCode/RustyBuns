// Code mode for this worktree, as an MCP server over stdio (wired in .mcp.json as `repo`, so the tool is
// `mcp__repo__execute`). Every Bash or Read result stays in the context and is re-read on every reply after it;
// a program here does the reads, greps and checks in one call and hands back only what it returns.
//
// The program is the body of an async function. In scope:
//   read(path, from?, to?)     the file's lines from..to (1-based, inclusive) as one string
//   lines(path)                the file as an array of lines
//   grep(re, path?, max?)      git grep -nE: [{ file, line, text }], at most `max` (default 200)
//   files(pathspec?)           git ls-files
//   sh(cmd)                    { code, out }: runs in the worktree, turned away by .claude/hooks/guard.ts as Bash would be
//   outline(file, name?)       bun run outline
//   console.log                lines come back after the result
// `return` what you need, small: an answer over CAP characters is cut.
//
// The program runs in a fresh vm context with only these in scope. That is a speed bump, not a sandbox, like the guard:
// the same agent can run a shell. What it stops is a program reading a secret or pushing to main by accident.
// Run: bun scripts/codemode-mcp.ts (Claude Code starts it from .mcp.json)
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createContext, runInContext } from "node:vm";
import { check } from "../.claude/hooks/guard.ts";
import { int, obj, opt, raw, str, type Of } from "../packages/util/src/guard.ts";
import { help } from "./help.ts";

help(import.meta.path);

export const CAP = 12_000;
export const RUN_MS = 120_000;
const ROOT = resolve(process.env.CODEMODE_ROOT ?? process.cwd());
const GUARD = resolve(import.meta.dir, "../.claude/hooks/guard.ts");

const DOC = readFileSync(import.meta.path, "utf8").split("\n").filter((l) => l.startsWith("//")).slice(0, 13).map((l) => l.slice(3)).join("\n");
export const TOOLS = [{
  name: "execute",
  description: `Run a JavaScript program over this worktree and get back only what it returns. Put independent reads, greps and checks in one program instead of many Bash or Read calls.\n${DOC}`,
  inputSchema: { type: "object", properties: { code: { type: "string", description: "Body of an async function; `return` the answer." } }, required: ["code"] },
}];

const blocked = (tool: string, input: Record<string, string>) => check({ tool_name: tool, tool_input: input, cwd: ROOT });

function text(path: string): string {
  const why = blocked("Read", { file_path: path });
  if (why) throw new Error(`guard: ${why}`);
  return readFileSync(resolve(ROOT, path), "utf8");
}

/** Runs `cmd` in the worktree after the guard hook itself passes it (the same checks a Bash call gets, valve included). */
function sh(cmd: string): { code: number; out: string } {
  const hook = Bun.spawnSync(["bun", GUARD], { cwd: ROOT, stdin: Buffer.from(JSON.stringify({ tool_name: "Bash", tool_input: { command: cmd }, cwd: ROOT })), stderr: "pipe" });
  if (hook.exitCode === 2) throw new Error(hook.stderr.toString().trim());
  const r = Bun.spawnSync(["sh", "-c", cmd], { cwd: ROOT, stderr: "pipe", timeout: RUN_MS });
  return { code: r.exitCode ?? 1, out: (r.stdout.toString() + r.stderr.toString()).trimEnd() };
}

const git = (args: string[]) => Bun.spawnSync(["git", ...args], { cwd: ROOT, stderr: "ignore" }).stdout.toString().split("\n").filter(Boolean);

const scope = () => ({
  read: (p: string, from = 1, to = Infinity) => text(p).split("\n").slice(from - 1, to).join("\n"),
  lines: (p: string) => text(p).split("\n"),
  grep: (re: string, path = ".", max = 200) => git(["grep", "-nE", "-I", "--", re, path]).slice(0, max).map((l) => {
    const [file, line, ...rest] = l.split(":");
    return { file, line: Number(line), text: rest.join(":") };
  }).filter((h) => !blocked("Read", { file_path: h.file })),
  files: (spec = ".") => git(["ls-files", "--", spec]),
  sh,
  outline: (file: string, name?: string) => sh(`bun scripts/outline.ts ${JSON.stringify(file)}${name ? ` ${JSON.stringify(name)}` : ""}`).out,
});

/** Runs one program and shapes its answer: the returned value (a string as is, else JSON), then its log, cut at CAP. */
export async function execute(code: string): Promise<{ text: string; isError: boolean }> {
  const log: string[] = [];
  const ctx = createContext({ ...scope(), console: { log: (...a: unknown[]) => log.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ")) } });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const ran: unknown = runInContext(`(async () => {\n${code}\n})()`, ctx, { timeout: RUN_MS });
    const value: unknown = await Promise.race([ran, new Promise((_, no) => { timer = setTimeout(() => no(new Error(`ran past ${RUN_MS / 1000}s`)), RUN_MS); })]);
    const body = typeof value === "string" ? value : value === undefined ? "(nothing returned)" : JSON.stringify(value);
    return { text: cut([body, ...log].join("\n")), isError: false };
  } catch (e) {
    return { text: cut([e instanceof Error ? e.message : String(e), ...log].join("\n")), isError: true };
  } finally { clearTimeout(timer); }
}

const cut = (s: string) => (s.length > CAP ? `${s.slice(0, CAP)}\n(cut at ${CAP} of ${s.length} characters: return less)` : s);

// MCP over stdio is JSON-RPC, one message a line: initialize, tools/list, tools/call, ping.
const Message = obj({ id: opt(int(-1e15, 1e15)), method: str(200), params: opt(obj({ name: opt(str(200)), arguments: opt(raw) })) });
const Args = obj({ code: str(200_000) });
const send = (m: unknown) => process.stdout.write(JSON.stringify(m) + "\n");
const answer = (id: number | undefined, result: unknown) => { if (id !== undefined) send({ jsonrpc: "2.0", id, result }); };

async function handle(m: Of<typeof Message>) {
  if (m.method === "initialize") return answer(m.id, { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "rustybuns-repo", version: "0.1.0" } });
  if (m.method === "tools/list") return answer(m.id, { tools: TOOLS });
  if (m.method === "ping") return answer(m.id, {});
  if (m.method === "tools/call") {
    const args = (() => { try { return Args(m.params?.arguments); } catch { return null; } })();
    if (m.params?.name !== "execute" || !args) return answer(m.id, { content: [{ type: "text", text: "execute takes { code: string }" }], isError: true });
    const r = await execute(args.code);
    return answer(m.id, { content: [{ type: "text", text: r.text }], isError: r.isError });
  }
  if (m.id !== undefined) send({ jsonrpc: "2.0", id: m.id, error: { code: -32601, message: `no method ${m.method}` } });
}

if (import.meta.main) {
  for await (const line of console) {
    if (!line.trim()) continue;
    const m = (() => { try { return Message(JSON.parse(line)); } catch { return null; } })();
    if (m) await handle(m);
  }
}
