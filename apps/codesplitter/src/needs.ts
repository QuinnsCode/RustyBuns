// What a check or deploy needs that the hosted containers don't have (#1689, #818 part 4): Docker, and Rust.
// The scan runs when a run is queued, so the run goes where it can work (the desktop app, or a runner of the
// owner's own) instead of failing partway with `command not found`. `missingTool` is the net under it: the
// signature of a run that hit a missing tool anyway, so it can be handed over rather than marked failed.

/** What each hosted image provides. deploy-sandbox/ci.Dockerfile has git, bun and node: no Docker, no Rust. */
export const IMAGE_CAPS = { docker: false, rust: false } as const;

export type Need = "docker" | "rust";

const PATTERNS: Record<Need, RegExp> = {
  docker: /(^|[\s;&|(])(docker|docker-compose|podman)(\s|$)|docker\s+compose/,
  rust: /(^|[\s;&|(])(cargo|rustc|rustup|wasm-pack)(\s|$)/,
};

/**
 * What a command needs that the hosted image lacks. `scripts` are package.json's, so a command that runs
 * `bun run <name>` is read through that script (one level, which is where these usually hide).
 */
export function scanNeeds(command: string, scripts: Record<string, string> = {}, caps: Record<Need, boolean> = IMAGE_CAPS): Need[] {
  const text = [command, ...[...command.matchAll(/\b(?:bun|npm|pnpm|yarn)\s+(?:run\s+)?([\w:-]+)/g)].map((m) => scripts[m[1]!] ?? "")].join("\n");
  return (Object.keys(PATTERNS) as Need[]).filter((n) => !caps[n] && PATTERNS[n].test(text));
}

/** The tool a failed run's output says was missing, or null. */
export function missingTool(output: string): Need | null {
  if (/(?:^|\n|: )(?:sh: \d+: )?docker(?:-compose)?: (?:command )?not found|Cannot connect to the Docker daemon|docker: command not found/i.test(output)) return "docker";
  if (/(?:^|\n|: )(?:sh: \d+: )?(?:cargo|rustc|rustup|wasm-pack): (?:command )?not found|no such command: `?cargo|exec format error/i.test(output)) return "rust";
  return null;
}

export const NEED_LABEL: Record<Need, string> = { docker: "Docker", rust: "Rust" };

/** The sentence for the chip's tooltip and the run's log. */
export const needsText = (needs: Need[]) => `Needs ${needs.map((n) => NEED_LABEL[n]).join(" and ")}. Hosted checks don't have ${needs.length === 1 ? "it" : "them"}.`;
