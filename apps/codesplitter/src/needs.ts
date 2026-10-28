// What a check or deploy needs that the hosted containers don't have (#1689, #818 part 4): Docker, and Rust.
// The scan runs when a run is queued, so the run goes where it can work (the desktop app, or a runner of the
// owner's own) instead of failing partway with `command not found`. `missingTool` is the net under it: the
// signature of a run that hit a missing tool anyway, so it can be handed over rather than marked failed.

export type Need = "docker" | "rust";

/**
 * What the hosted image provides, from the CI_IMAGE_CAPS var rustybuns.config.ts binds (a JSON object, e.g. {"rust":true}).
 * Unset or unreadable, nothing is assumed: deploy-sandbox/ci.Dockerfile has git, bun and node, no Docker, no Rust.
 */
export function imageCaps(raw?: string): Record<Need, boolean> {
  let v: unknown = null;
  try { v = raw ? JSON.parse(raw) : null; } catch { /* no caps */ }
  const has = (k: Need) => typeof v === "object" && v !== null && (v as Record<string, unknown>)[k] === true;
  return { docker: has("docker"), rust: has("rust") };
}

const PATTERNS: Record<Need, RegExp> = {
  docker: /(^|[\s;&|(])(docker|docker-compose|podman)(\s|$)|docker\s+compose/,
  rust: /(^|[\s;&|(])(cargo|rustc|rustup|wasm-pack)(\s|$)/,
};

/**
 * What a command needs that the hosted image lacks. `scripts` are package.json's, so a command that runs
 * `bun run <name>` is read through that script (one level, which is where these usually hide).
 */
export function scanNeeds(command: string, scripts: Record<string, string> = {}, caps: Record<Need, boolean> = imageCaps()): Need[] {
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

/** True when a rustybuns.config.ts asks for an arm64 (Hetzner cax) box: the hosted deploy container can't build its native/ crates (preview.ts refuses that at run time). */
export const armBox = (config: string) => /\bbox\s*:\s*\{[^}]*\bserverType\s*:\s*["'`]cax/i.test(config);

export const ARM_BOX_WARNING = "This repo deploys an arm64 box (cax): the hosted deploy can't compile native/ crates for it, so it will be refused if there are any. Deploy from the desktop app, or pick an x86 server type.";
