// The coding agents that can plug in. Each one is a CLI run non-interactively in
// a scratch directory that holds just the file being edited; whatever it leaves
// there is read back and turned into ops (see sync.ts). The CLI brings its own
// model and login, so nothing about the model lives here. All four have been run
// live on a small file with these exact command lines; setup is in the README.

import type { Conflict } from "./agent-run.ts";

export type Harness = "claude" | "codex" | "pi" | "opencode";

export const HARNESSES: Harness[] = ["claude", "codex", "pi", "opencode"];

export interface Command { bin: string; args: string[]; env?: Record<string, string> }

// opencode reads permissions from config. OPENCODE_CONFIG_CONTENT outranks any
// global or project config, so a stray opencode.json can't loosen it. Everything
// is denied except reading and editing inside the working directory.
export const OPENCODE_PERMISSION = {
  "*": "deny",
  read: "allow", edit: "allow", glob: "allow", grep: "allow", list: "allow",
  external_directory: "deny",
} as const;

/** The command line that runs `harness` on `prompt` with `dir` as its working directory. */
export function harnessCommand(harness: Harness, prompt: string, opts: { model?: string } = {}): Command {
  const model = opts.model ? (args: string[]) => [...args, "--model", opts.model!] : (args: string[]) => args;
  switch (harness) {
    // Print mode, edits allowed without asking. It can still run shell commands.
    case "claude":
      return { bin: "claude", args: model(["-p", prompt, "--permission-mode", "acceptEdits"]) };
    // Workspace-write sandbox: it can edit the scratch dir, not the rest of the machine
    // (a write to $HOME is refused). Needs `codex login` or a provider in ~/.codex/config.toml.
    case "codex":
      return { bin: "codex", args: model(["exec", "--skip-git-repo-check", "-s", "workspace-write", prompt]) };
    // Print mode, no session saved. Only the file tools, no bash, and no
    // extensions, MCP or project-local config that could add tools back.
    // pi defaults to Google, so pass --model as provider/id (e.g. anthropic/claude-sonnet-4-5).
    case "pi":
      return { bin: "pi", args: model(["-p", "--no-session", "--tools", "read,edit,write", "--no-extensions", "--no-mcp", "--no-approve", prompt]) };
    // Permissions as above: no shell, no web, nothing outside the working directory.
    // --pure skips third-party plugins, which run code when they load. It takes its
    // project dir from $PWD, which execCommand sets. Its free models refuse this
    // locked-down config, so it needs `opencode auth login` and a provider's model.
    case "opencode":
      return { bin: "opencode", args: model(["run", "--pure", prompt]), env: { OPENCODE_CONFIG_CONTENT: JSON.stringify({ permission: OPENCODE_PERMISSION }) } };
  }
}

/**
 * The instruction every harness gets: one file, edit it in place, nothing else.
 * On a re-run, `conflicts` lists the lines someone else changed while the agent
 * worked; their version is already in the file and the agent must keep it.
 */
export function taskPrompt(path: string, task: string, conflicts: Conflict[] = []): string {
  const moved = conflicts.map(({ op, now }) =>
    now === null ? `- a line you ${op.kind === "insert" ? "anchored an insert to" : "changed"} was deleted by someone else`
    : `- ${JSON.stringify(now.text)} (changed by ${now.by}; you had ${op.kind === "set" ? JSON.stringify(op.text) : op.kind === "delete" ? "deleted it" : `inserted ${JSON.stringify(op.text)} after it`})`);
  return [
    `You are editing one file, ${path}, in the current directory.`,
    `Task: ${task}`,
    ...(moved.length ? [
      `You already worked on this task once. While you worked, someone else changed these lines, so your edits to them did not land:`,
      ...moved,
      `The file now has their version and your other edits. Keep their changes, and finish the task on the file as it is now.`,
    ] : []),
    `Edit ${path} in place. Change only what the task needs, keep every other line as it is, and do not add files.`,
    `Do not run git commands.`,
  ].join("\n");
}
