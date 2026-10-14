// The office's three helpers (Dexter, who trims tokens, is ester/dexter.ts), called on from the page (ester/index.ts). Both are apps/codesplitter/scripts/mervin-board.ts:
// Mervin lists the open PRs and how they merge (no flags), Ester is its `--check`, which builds the merged tree in a
// sandbox and, when it goes red, sorts each failing test by who owns it (scripts/ester.ts). Testing is the bottleneck she
// takes, merging the one he takes, and her `Ester says hold` list is what he is handed. This runs them in the floor's
// repo, one run each at a time, and keeps the tail of what they printed. Pure over `spawn`, so it is tested without installing.
import { existsSync } from "node:fs";
import path from "node:path";

export const BOARD = "apps/codesplitter/scripts/mervin-board.ts";
const KEEP = 200;

export type EsterPhase = "idle" | "running" | "green" | "red" | "error";
export interface EsterState {
  phase: EsterPhase;
  /** The tail of what the check printed. */
  lines: string[];
  /** The PRs she says to hold back (`Ester says hold: #1, #2`). */
  hold: number[];
  startedAt?: number;
  endedAt?: number;
  error?: string;
}

/** Runs `cmd` in `cwd`, calls `onLine` for each line it prints (stdout and stderr), answers its exit code. */
export type Spawn = (cmd: string[], cwd: string, onLine: (line: string) => void) => Promise<number>;

export const bunSpawn: Spawn = async (cmd, cwd, onLine) => {
  const proc = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  const pump = async (stream: ReadableStream<Uint8Array>) => {
    let rest = "";
    const decoder = new TextDecoder(), reader = stream.getReader();
    for (let r = await reader.read(); !r.done; r = await reader.read()) {
      const parts = (rest + decoder.decode(r.value, { stream: true })).split("\n");
      rest = parts.pop()!;
      parts.forEach(onLine);
    }
    if (rest) onLine(rest);
  };
  await Promise.all([pump(proc.stdout), pump(proc.stderr)]);
  return proc.exited;
};

/** The PRs in her `Ester says hold: #12, #34` line. */
export const holdFrom = (lines: string[]) =>
  (lines.findLast((l) => l.startsWith("Ester says hold:")) ?? "").match(/#(\d+)/g)?.map((n) => Number(n.slice(1))) ?? [];

/** What each helper runs: a script under the floor's repo, from `cwd`, with `args`. */
export const DEXTER = "apps/agent-office/ester/dexter.ts";
export const HELPERS = {
  ester: { script: BOARD, cwd: "apps/codesplitter", args: ["--check"] },
  mervin: { script: BOARD, cwd: "apps/codesplitter", args: [] as string[] },
  dexter: { script: DEXTER, cwd: ".", args: [] as string[] },
} as const;
export type Helper = keyof typeof HELPERS;
export const isHelper = (n: string): n is Helper => Object.hasOwn(HELPERS, n);

/** The repo root for `script`: the first floor dir, or a parent of one (a floor may sit in apps/agent-office), that holds it. */
export function repoWith(script: string, dirs: Iterable<string>): string | null {
  for (const d of dirs)
    for (let dir = path.resolve(d); ; dir = path.dirname(dir)) {
      if (existsSync(path.join(dir, script))) return dir;
      if (dir === path.dirname(dir)) break;
    }
  return null;
}

/** One helper: `start` begins a run in a floor's repo unless one is going, `state` is how it stands. */
export function createHelper(h: { script: string; cwd: string; args: readonly string[] }, spawn: Spawn = bunSpawn, bun = "bun") {
  let s: EsterState = { phase: "idle", lines: [], hold: [] };
  return {
    state: (): EsterState => ({ ...s, lines: [...s.lines], hold: [...s.hold] }),
    /** Starts the run in `repo`. It goes on after this answers; null when it did start. */
    start(repo: string): { status: number; error: string } | null {
      if (s.phase === "running") return { status: 409, error: "Already on it" };
      if (!existsSync(path.join(repo, h.script))) return { status: 404, error: `This helper works from ${h.script}, and ${repo} doesn't have it` };
      s = { phase: "running", lines: [], hold: [], startedAt: Date.now() };
      const mine = s;
      const push = (line: string) => {
        mine.lines.push(line);
        if (mine.lines.length > KEEP) mine.lines.shift();
      };
      const run = () => spawn([bun, path.join(repo, h.script), ...h.args], path.join(repo, h.cwd), push);
      // a fresh checkout has no node_modules, so the script can't import its packages: install first
      (existsSync(path.join(repo, "node_modules")) ? run() : spawn([bun, "install"], repo, push).then((code) => (code === 0 ? run() : 2))).then(
        (code) => Object.assign(mine, { phase: code === 0 ? "green" : code === 1 ? "red" : "error", hold: holdFrom(mine.lines), endedAt: Date.now() }, code > 1 ? { error: `stopped with exit ${code}` } : {}),
        (err: Error) => Object.assign(mine, { phase: "error", endedAt: Date.now(), error: err.message }),
      );
      return null;
    },
  };
}

/** The helpers of an office. */
export const createHelpers = (spawn?: Spawn) => ({ ester: createHelper(HELPERS.ester, spawn), mervin: createHelper(HELPERS.mervin, spawn), dexter: createHelper(HELPERS.dexter, spawn) });
