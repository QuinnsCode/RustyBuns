// The coding agents that can plug in. Each one is a CLI run non-interactively in
// a scratch directory that holds just the file being edited; whatever it leaves
// there is read back and turned into ops (see sync.ts). The CLI brings its own
// model and login, so nothing about the model lives here.

import type { Conflict } from "./agent-run.ts";

export type Harness = "claude" | "codex" | "pi" | "opencode";

export const HARNESSES: Harness[] = ["claude", "codex", "pi", "opencode"];

export interface Command { bin: string; args: string[] }

/** The command line that runs `harness` on `prompt` with `dir` as its working directory. */
export function harnessCommand(harness: Harness, prompt: string, opts: { model?: string } = {}): Command {
  const model = opts.model ? (args: string[]) => [...args, "--model", opts.model!] : (args: string[]) => args;
  switch (harness) {
    // Print mode, edits allowed without asking. It can still run shell commands.
    case "claude":
      return { bin: "claude", args: model(["-p", prompt, "--permission-mode", "acceptEdits"]) };
    // Workspace-write sandbox: it can edit the scratch dir, not the rest of the machine.
    case "codex":
      return { bin: "codex", args: model(["exec", "--skip-git-repo-check", "-s", "workspace-write", prompt]) };
    // Print mode, no session saved. Runs in the process cwd.
    case "pi":
      return { bin: "pi", args: model(["-p", "--no-session", prompt]) };
    case "opencode":
      return { bin: "opencode", args: model(["run", prompt]) };
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
