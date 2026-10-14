// Layout: the coding-agent CLIs and the prompt each one gets
// The coding agents that can plug in. Each one is a CLI run non-interactively in
// a scratch directory that holds just the file being edited; whatever it leaves
// there is read back and turned into ops (see sync.ts). The CLI brings its own
// model and login, so nothing about the model lives here. All four have been run
// live on a small file with these exact command lines; setup is in the README.

import type { Conflict } from "./agent-run.ts";

export type Harness = "claude" | "codex" | "pi" | "opencode";

export const HARNESSES: Harness[] = ["claude", "codex", "pi", "opencode"];

export interface Command { bin: string; args: string[]; env?: Record<string, string> }

/** claude's tools: reading and editing files, nothing that runs a command. */
export const CLAUDE_TOOLS = "Read,Edit,Write,Glob,Grep";

/**
 * The harnesses that can fix a broken update (deps.ts). The fixer works in a
 * clone with node_modules installed, as the user that holds the agent's login,
 * so it may only use a harness that can't run a command: codex's shell is how it
 * works, and its sandbox still lets what it runs read the login (#683).
 */
export const FIX_HARNESSES: Harness[] = ["claude", "pi", "opencode"];

/** The harnesses with a shell, the only ones a GH_TOKEN is any use to (#1428). The rest could only leak it. */
export const RUNS_COMMANDS: Harness[] = ["codex"];

/**
 * The harnesses a hosted run may use. codex (a shell) and pi (a `read` tool that
 * isn't held to its directory) can read their own key from the run's environment,
 * so they stay off the site until a proxy adds the key on the way out (#1428).
 */
export const HOSTED_HARNESSES: Harness[] = ["claude", "opencode"];

// opencode reads permissions from config. OPENCODE_CONFIG_CONTENT outranks any
// global or project config, so a stray opencode.json can't loosen it. Everything
// is denied except reading and editing inside the working directory.
export const OPENCODE_PERMISSION = {
  "*": "deny",
  read: "allow", edit: "allow", glob: "allow", grep: "allow", list: "allow",
  external_directory: "deny",
} as const;

/**
 * The command line that runs `harness` on `prompt` with `dir` as its working directory.
 * `usage`: answer in JSON that says what it read, which budget.ts usageOf reads back (#1088, #1118).
 */
export function harnessCommand(harness: Harness, prompt: string, opts: { model?: string; usage?: boolean } = {}): Command {
  const model = opts.model ? (args: string[]) => [...args, "--model", opts.model!] : (args: string[]) => args;
  switch (harness) {
    // Print mode, edits allowed without asking, and only the file tools: no Bash,
    // so it can't run the code it's working on (#683). Only the user's settings
    // load, as a repo's .claude/settings.json can add hooks (shell commands run at
    // startup) and permissions, and no MCP servers, as a repo's .mcp.json starts them.
    case "claude":
      return { bin: "claude", args: model(["-p", prompt, "--permission-mode", "acceptEdits", "--tools", CLAUDE_TOOLS, "--setting-sources", "user", "--strict-mcp-config", ...opts.usage ? ["--output-format", "json"] : []]) };
    // Workspace-write sandbox: it can edit the scratch dir, not the rest of the machine
    // (a write to $HOME is refused). Needs `codex login` or a provider in ~/.codex/config.toml.
    case "codex":
      return { bin: "codex", args: model(["exec", "--skip-git-repo-check", "-s", "workspace-write", ...opts.usage ? ["--json"] : [], prompt]) };
    // Print mode, no session saved. Only the file tools, no bash, and no
    // extensions, MCP or project-local config that could add tools back.
    // pi defaults to Google, so pass --model as provider/id (e.g. anthropic/claude-sonnet-4-5).
    case "pi":
      return { bin: "pi", args: model(["-p", "--no-session", "--tools", "read,edit,write", "--no-extensions", "--no-mcp", "--no-approve", ...opts.usage ? ["--mode", "json"] : [], prompt]) };
    // Permissions as above: no shell, no web, nothing outside the working directory.
    // --pure skips third-party plugins, which run code when they load. It takes its
    // project dir from $PWD, which execCommand sets. Its free models refuse this
    // locked-down config, so it needs `opencode auth login` and a provider's model.
    case "opencode":
      return { bin: "opencode", args: model(["run", "--pure", ...opts.usage ? ["--format", "json"] : [], prompt]), env: { OPENCODE_CONFIG_CONTENT: JSON.stringify({ permission: OPENCODE_PERMISSION }) } };
  }
}

/**
 * The instruction every harness gets: one file, edit it in place, nothing else.
 * On a re-run, `conflicts` lists the lines someone else changed while the agent
 * worked; their version is already in the file and the agent must keep it.
 * `notes` are what its owner told it since it started (a note sends it round again).
 * `also` are other files beside it the agent may edit too (a fix task's, heal.ts).
 */
/** A line someone else holds while the agent works: its number (from 1), text, and who has it. */
export interface HeldLine { n: number; text: string; why: string }
/** Held lines named in a prompt at most; past that it says how many more. */
const HELD_LISTED = 40;

export function taskPrompt(path: string, task: string, conflicts: Conflict[] = [], notes: string[] = [], held: HeldLine[] = [], also: string[] = []): string {
  // With other files in front of it, each line says which file it's in.
  const moved = conflicts.filter((c) => !c.held).map(({ op, now, path: p }) => {
    const at = also.length ? ` in ${p ?? path}` : "";
    return now === null ? `- a line you ${op.kind === "insert" ? "anchored an insert to" : "changed"}${at} was deleted by someone else`
      : `- ${JSON.stringify(now.text)}${at} (changed by ${now.by}; you had ${op.kind === "set" ? JSON.stringify(op.text) : op.kind === "delete" ? "deleted it" : `inserted ${JSON.stringify(op.text)} after it`})`;
  });
  return [
    also.length ? `You are editing ${path}, and may edit ${also.join(", ")} too, in the current directory.` : `You are editing one file, ${path}, in the current directory.`,
    `Task: ${task}`,
    ...(moved.length ? [
      `You already worked on this task once. While you worked, someone else changed these lines, so your edits to them did not land:`,
      ...moved,
      `The ${also.length ? "files now have" : "file now has"} their version and your other edits. Keep their changes, and finish the task on the file as it is now.`,
    ] : []),
    // Notes its owner sent while it worked: they come in on the next run, as the CLI can't take messages mid-run.
    ...(notes.length ? [
      ...(moved.length ? [] : [`You already worked on this task once, and the file has your edits.`]),
      `While you worked, the person who gave you the task told you:`,
      ...notes.map((n) => `- ${n}`),
      `Take that into account, and finish the task on the file as it is now.`,
    ] : []),
    // Lines someone holds won't take its edits: it works elsewhere, and the claim may have lapsed by its next run.
    ...(held.length ? [
      `Someone else is working on these lines right now, so edits to them will not land. Leave them exactly as they are and do the task on the rest of the file:`,
      ...held.slice(0, HELD_LISTED).map((h) => `- line ${h.n}: ${JSON.stringify(h.text)} (${h.why})`),
      ...(held.length > HELD_LISTED ? [`- and ${held.length - HELD_LISTED} more held lines`] : []),
    ] : []),
    also.length ? `Edit those files in place. Change only what the task needs, keep every other line as it is, and do not add or remove files.`
    : `Edit ${path} in place. Change only what the task needs, keep every other line as it is, and do not add files.`,
    `Do not run git commands.`,
  ].join("\n");
}
