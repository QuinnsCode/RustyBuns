// The coding agents that can plug in. Each one is a CLI run non-interactively in
// a scratch directory that holds just the file being edited; whatever it leaves
// there is read back and turned into ops (see sync.ts). The CLI brings its own
// model and login, so nothing about the model lives here.

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

/** The instruction every harness gets: one file, edit it in place, nothing else. */
export function taskPrompt(path: string, task: string): string {
  return [
    `You are editing one file, ${path}, in the current directory.`,
    `Task: ${task}`,
    `Edit ${path} in place. Change only what the task needs, keep every other line as it is, and do not add files.`,
    `Do not run git commands.`,
  ].join("\n");
}
