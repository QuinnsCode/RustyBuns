// Run one coding agent on one file of a repo. The agent works on a plain-text
// copy in a sandbox; when it stops, its edit is diffed against the snapshot and
// posted to the file's Durable Object as line ops, so the edit shows up live and
// carries the agent's name in blame like any other edit. The sandbox is a scratch
// directory on this machine (localSandbox), or a container on Cloudflare (sandbox.ts).

import type { Call } from "./local.ts";
import type { Doc, Line, Op } from "./lines.ts";
import { harnessCommand, taskPrompt, type Command, type Harness } from "./harness.ts";
import { diffToOps, rebase } from "./sync.ts";

export type Exec = (cmd: Command, cwd: string) => Promise<{ code: number; out: string }>;

/**
 * Where the agent works: write the file, run the command beside it, read back
 * what it left (null if it removed the file).
 */
export type Sandbox = (cmd: Command, file: { path: string; text: string }) => Promise<{ code: number; out: string; text: string | null }>;

/** Runs the CLI with its working directory set to `cwd`, capturing stdout and stderr. */
export const execCommand: Exec = async (cmd, cwd) => {
  const proc = Bun.spawn([cmd.bin, ...cmd.args], { cwd, env: { ...process.env, ...cmd.env }, stdout: "pipe", stderr: "pipe" });
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  return { code: await proc.exited, out: out + err };
};

/** A scratch directory on this machine, made for one run and deleted after it. The CLIs must be installed here. */
export const localSandbox = (exec: Exec = execCommand): Sandbox => async (cmd, file) => {
  const { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { dirname, join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "codesplitters-agent-"));
  try {
    const at = join(dir, file.path);
    mkdirSync(dirname(at), { recursive: true });
    writeFileSync(at, file.text);
    const run = await exec(cmd, dir);
    return { ...run, text: existsSync(at) ? readFileSync(at, "utf8") : null };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

/** An agent edit that could not land: someone else changed its line (or the insert's anchor) first. */
export interface Conflict {
  op: Op;
  /** The line as it is now; null if it was deleted. */
  now: Line | null;
}

export interface Result {
  harness: Harness;
  path: string;
  changed: boolean;
  applied: number;
  /** How many times the agent ran: 1, plus a re-run per round that hit conflicts. */
  runs: number;
  /** Edits still in conflict after the last run. The other writer's version was kept. */
  conflicts: Conflict[];
  rev: number;
  output: string;
}

/** What a file's text looks like on disk: lines joined by \n with one trailing \n. */
export const toDisk = (lines: { text: string }[]) => lines.length ? lines.map((l) => l.text).join("\n") + "\n" : "";
/** Back from disk to the lines the agent left. */
export const fromDisk = (s: string) => s === "" ? [] : s.replace(/\n$/, "").split("\n");

export async function runAgent(call: Call, opts: {
  user: string; owner: string; repo: string; path: string;
  harness: Harness; task: string; model?: string; commit?: string;
  /** Re-runs allowed when lines change under the agent (default 2; 0 keeps the other writer's lines at once). */
  retries?: number;
  /** Where the agent runs (default: a scratch dir here, running `exec`). */
  sandbox?: Sandbox;
  exec?: Exec; log?: (s: string) => void;
}): Promise<Result> {
  const { user, owner, repo, path } = opts;
  const log = opts.log ?? (() => {});
  const sandbox = opts.sandbox ?? localSandbox(opts.exec);
  const file = `/api/repos/${owner}/${repo}/do`, q = `?path=${encodeURIComponent(path)}`;
  const get = async () => {
    const res = await call(user, `${file}/file${q}`);
    if (!res.ok) throw new Error(`read ${path}: ${res.status} ${await res.text()}`);
    return (await res.json()) as Doc;
  };

  // When someone else changes a line the agent also changed, the agent's op on
  // that line is held back and the agent runs again on the file as it is now,
  // told which lines moved under it. Whatever still conflicts after the last
  // run keeps the other writer's version and comes back in `conflicts`.
  const maxRuns = 1 + (opts.retries ?? 2);
  let applied = 0, changed = false, runs = 0, conflicts: Conflict[] = [], rev = 0, output = "";
  while (runs < maxRuns) {
    runs++;
    // 1. Snapshot the file, and 2. let the agent edit a copy of it in the sandbox.
    const snapshot = await get();
    rev = snapshot.rev;
    const cmd = harnessCommand(opts.harness, taskPrompt(path, opts.task, conflicts), { model: opts.model });
    log(`${opts.harness}: ${runs === 1 ? "working on" : `re-running on`} ${path} (rev ${snapshot.rev})`);
    const run = await sandbox(cmd, { path, text: toDisk(snapshot.lines) });
    output = run.out.trim();
    if (run.code !== 0) throw new Error(`${opts.harness} exited ${run.code}:\n${output.slice(-2000)}`);
    if (run.text === null) throw new Error(`${opts.harness} removed ${path}`);

    // 3. Diff what it left against the snapshot, and post the change.
    const ops = diffToOps(snapshot.lines, fromDisk(run.text));
    conflicts = [];
    if (!ops.length) break;
    changed = true;
    // Post the ops whose lines are unchanged since the snapshot; retry on a race.
    let landed = false;
    for (let attempt = 0; attempt < 3 && !landed; attempt++) {
      const current = await get();
      const r = rebase(ops, current);
      conflicts = r.skipped.map((op) => ({ op, now: current.lines.find((l) => l.id === (op.kind === "insert" ? op.after : op.line)) ?? null }));
      if (!r.ops.length) { rev = current.rev; landed = true; break; }
      const res = await call(user, `${file}/ops${q}`, { method: "POST", body: JSON.stringify({ ops: r.ops }) });
      if (res.ok) {
        const body = (await res.json()) as { rev: number; applied: unknown[] };
        applied += body.applied.length;
        rev = body.rev;
        landed = true;
      } else if (res.status !== 409) throw new Error(`ops: ${res.status} ${await res.text()}`);
    }
    if (!landed) throw new Error(`${path} kept changing while ${opts.harness} worked; nothing was posted`);
    if (!conflicts.length) break;
    log(`${opts.harness}: ${conflicts.length} line(s) changed by someone else while it worked`);
  }
  if (opts.commit && applied) {
    const res = await call(user, `${file}/commit${q}`, { method: "POST", body: JSON.stringify({ message: opts.commit }) });
    if (!res.ok) throw new Error(`commit: ${res.status} ${await res.text()}`);
  }
  return { harness: opts.harness, path, changed, applied, runs, conflicts, rev, output };
}
