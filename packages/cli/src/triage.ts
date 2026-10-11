// `<cli> triage`: hand a misbehaving install to the user's own coding agent, after t3code's `t3 triage`.
// It writes context.md (the machine facts: versions, paths, what answers) and prompt.md (the playbook)
// to a fresh folder, then starts claude or codex interactively, told to read prompt.md. The agent asks
// what went wrong, investigates and drafts the issue; its own permission prompts gate everything it
// runs. With neither installed, the two files are the paste-anywhere fallback.
//
// Plain Node, no Bun APIs: the codeSplitters CLI bundles this into its cli.js, which runs on Node 18+.

import { spawn } from "node:child_process";
import { accessSync, constants, mkdirSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";

export const TRIAGE_AGENTS = [
  { id: "claude", command: "claude", label: "Claude Code" },
  { id: "codex", command: "codex", label: "Codex" },
] as const;
export type TriageAgentId = (typeof TRIAGE_AGENTS)[number]["id"];

export interface TriageOptions {
  /** The product, as the prompt names it: "codeSplitters", "RustyBuns". */
  product: string;
  /** The command that started this, for the prompt: "codesplitters triage". */
  command: string;
  /** Where the run's folder goes: <dir>/<time>/. */
  dir: string;
  /** context.md's markdown. */
  context: string;
  /** The playbook's markdown; it says where the newest copy is. */
  playbook: string;
  /** The arguments after `triage`. */
  argv: string[];
  /** Where the agent starts. @default process.cwd() */
  cwd?: string;
  env?: Record<string, string | undefined>;
  /** Which agent CLIs are on PATH. */
  installed?: () => TriageAgentId[];
  /** Asks which agent, when both are installed; undefined when there's no terminal. */
  choose?: (ids: TriageAgentId[]) => Promise<TriageAgentId | undefined>;
  /** Runs the agent with the terminal; resolves to its exit code. */
  run?: (command: string, args: string[], cwd: string) => Promise<number>;
  log?: (line: string) => void;
  now?: () => Date;
}

export const TRIAGE_USAGE = "triage [--agent claude|codex] [--model <m>] [--print]   start your coding agent on what went wrong, with the machine facts and a playbook";

/** Who's on PATH, by looking (no shell, so it works the same on every OS). */
export function agentsOnPath(env: Record<string, string | undefined> = process.env): TriageAgentId[] {
  const dirs = (env.PATH ?? "").split(delimiter).filter(Boolean);
  const exts = process.platform === "win32" ? (env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";") : [""];
  const found = (cmd: string) => dirs.some((d) => exts.some((e) => {
    try { accessSync(join(d, cmd + e), constants.X_OK); return true; } catch { return false; }
  }));
  return TRIAGE_AGENTS.filter((a) => found(a.command)).map((a) => a.id);
}

/** The prompt.md the agent reads: who started it, where the facts are, then the playbook. */
export function seedPrompt(o: { product: string; command: string; contextFile: string; playbook: string }): string {
  return `A ${o.product} user is having a problem and started this session with \`${o.command}\`.\n\n` +
    `The machine facts (versions, paths, what answers) are in the triage context file:\n\n    ${o.contextFile}\n\n` +
    `Follow the playbook below, starting by asking the user what went wrong.\n\n---\n\n${o.playbook}`;
}

/** The one line the agent starts with; the playbook is too long for a Windows .cmd argument. */
export const launchPrompt = (promptFile: string, product: string) =>
  `Read the file "${promptFile}" and follow its instructions exactly: it is your ${product} triage playbook, and it starts with asking the user what went wrong.`;

function parse(argv: string[]): { agent?: string; model?: string; print: boolean } | string {
  const out: { agent?: string; model?: string; print: boolean } = { print: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--print") out.print = true;
    else if ((a === "--agent" || a === "--model") && argv[i + 1]) out[a.slice(2) as "agent" | "model"] = argv[++i];
    else return `usage: ${TRIAGE_USAGE}`;
  }
  if (out.agent && !TRIAGE_AGENTS.some((t) => t.id === out.agent)) return "--agent is claude or codex";
  return out;
}

/** Runs triage; resolves to the exit code. */
export async function triage(o: TriageOptions): Promise<number> {
  const log = o.log ?? ((l) => console.log(l));
  const flags = parse(o.argv);
  if (typeof flags === "string") { log(flags); return 2; }

  const at = (o.now ?? (() => new Date()))();
  const dir = join(o.dir, at.toISOString().replace(/[:.]/g, "-"));
  mkdirSync(dir, { recursive: true });
  const contextFile = join(dir, "context.md"), promptFile = join(dir, "prompt.md");
  writeFileSync(contextFile, o.context);
  writeFileSync(promptFile, seedPrompt({ product: o.product, command: o.command, contextFile, playbook: o.playbook }));
  const files = `  ${promptFile}\n  ${contextFile}`;

  const installed = (o.installed ?? (() => agentsOnPath(o.env)))();
  let agent: TriageAgentId | undefined;
  if (flags.agent) {
    if (!installed.includes(flags.agent as TriageAgentId)) { log(`${flags.agent} isn't installed or isn't on PATH. The triage files are here:\n${files}`); return 1; }
    agent = flags.agent as TriageAgentId;
  } else if (installed.length === 1) agent = installed[0];
  else if (installed.length > 1 && !flags.print) {
    agent = await (o.choose ?? chooseOnTerminal)(installed);
    if (!agent) { log(`Both claude and codex are installed and there's no terminal to ask which: run it again with --agent claude or --agent codex.`); return 2; }
  }

  if (flags.print || !agent) {
    log(`${agent || flags.print ? "" : "No coding agent CLI (claude, codex) was found here.\n\n"}The triage prompt and the machine facts are in:\n${files}\n\nPaste the prompt file into any coding agent to run triage by hand.`);
    return 0;
  }
  const label = TRIAGE_AGENTS.find((t) => t.id === agent)!.label;
  log(`Starting ${label}. It will ask what went wrong.\n`);
  const args = [...(flags.model ? ["--model", flags.model] : []), launchPrompt(promptFile, o.product)];
  return (o.run ?? runWithTerminal)(agent, args, o.cwd ?? process.cwd());
}

function runWithTerminal(command: string, args: string[], cwd: string): Promise<number> {
  return new Promise((resolve) => {
    // Windows' npm shims are .cmd files, which only run through a shell
    const child = spawn(command, args, { cwd, stdio: "inherit", shell: process.platform === "win32" });
    child.once("error", (err) => { console.error(`Couldn't start ${command}: ${err.message}`); resolve(1); });
    child.once("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
}

async function chooseOnTerminal(ids: TriageAgentId[]): Promise<TriageAgentId | undefined> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return undefined;
  const { createInterface } = await import("node:readline/promises");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const menu = ids.map((id, i) => `  [${i + 1}] ${TRIAGE_AGENTS.find((t) => t.id === id)!.label}`).join("\n");
  try {
    for (;;) {
      const a = (await rl.question(`Run triage with:\n${menu}\n> `)).trim().toLowerCase();
      const pick = ids[Number(a) - 1] ?? ids.find((id) => id === a);
      if (pick) return pick;
    }
  } finally { rl.close(); }
}

/** A fetch that gives up after `ms`, as one line for context.md: what answered, or why nothing did. */
export async function probe(url: string, init: RequestInit = {}, ms = 5000, send: typeof fetch = fetch): Promise<{ ok: boolean; status?: number; text: string; line: string }> {
  try {
    const res = await send(url, { ...init, signal: AbortSignal.timeout(ms) });
    const text = await res.text();
    return { ok: res.ok, status: res.status, text, line: `${res.status} ${res.statusText}`.trim() };
  } catch (err) {
    return { ok: false, text: "", line: `no answer (${(err as Error).name === "TimeoutError" ? `timed out after ${ms / 1000}s` : (err as Error).message})` };
  }
}
