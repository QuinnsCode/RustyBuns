// Run one coding agent on one file of a repo. The agent works on a plain-text
// copy in a sandbox; when it stops, its edit is diffed against the snapshot and
// posted to the file's Durable Object as line ops, so the edit shows up live and
// carries the agent's name in blame like any other edit. The sandbox is a scratch
// directory on this machine (localSandbox), or a container on Cloudflare (sandbox.ts).

import type { Call } from "./local.ts";
import type { Doc, Line, Op } from "./lines.ts";
import { harnessCommand, taskPrompt, type Command, type Harness } from "./harness.ts";
import { diffToOps, rebase } from "./sync.ts";

/** Runs a command in `cwd`; `signal` aborting kills it (Stop on a run). */
export type Exec = (cmd: Command, cwd: string, signal?: AbortSignal) => Promise<{ code: number; out: string }>;

/**
 * Where the agent works: write the file, run the command beside it, read back
 * what it left (null if it removed the file). `signal` aborting stops the agent.
 */
export type Sandbox = (cmd: Command, file: { path: string; text: string }, signal?: AbortSignal) => Promise<{ code: number; out: string; text: string | null }>;

/**
 * Runs the CLI with its working directory set to `cwd`, capturing stdout and stderr.
 * PWD is set too: opencode takes its project directory from $PWD, not the real cwd,
 * and would otherwise edit the caller's directory.
 */
export const execCommand: Exec = async (cmd, cwd, signal) => {
  signal?.throwIfAborted();
  const proc = Bun.spawn([cmd.bin, ...cmd.args], { cwd, env: { ...process.env, ...cmd.env, PWD: cwd }, stdout: "pipe", stderr: "pipe" });
  const kill = () => proc.kill();
  signal?.addEventListener("abort", kill, { once: true });
  try {
    const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    return { code: await proc.exited, out: out + err };
  } finally { signal?.removeEventListener("abort", kill); }
};

/** A scratch directory on this machine, made for one run and deleted after it. The CLIs must be installed here. */
export const localSandbox = (exec: Exec = execCommand): Sandbox => async (cmd, file, signal) => {
  const { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { dirname, join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "codesplitter-agent-"));
  try {
    const at = join(dir, file.path);
    mkdirSync(dirname(at), { recursive: true });
    writeFileSync(at, file.text);
    const run = await exec(cmd, dir, signal);
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
  /** Why it couldn't land, when someone holds the line: "held by @ana". */
  held?: string;
}

export interface Result {
  harness: Harness;
  path: string;
  changed: boolean;
  applied: number;
  /** How many times the agent ran: 1, plus a re-run per round that hit conflicts or brought notes. */
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

/** Re-runs notes may add to one run, so a chatty owner can't keep an agent going for ever. */
const NOTE_RUNS = 5;

export async function runAgent(call: Call, opts: {
  user: string; owner: string; repo: string; path: string;
  harness: Harness; task: string; model?: string; commit?: string;
  /** Work on this branch's copy of the file instead of main's (its claim still holds main's lines). No commit there. */
  branch?: string;
  /** The lines it was given (ids): claimed for the run, so nobody else edits them meanwhile. */
  lines?: string[];
  /** The claim's id; one run's claim, since every agent of a harness edits under one name. */
  claim?: string;
  /** Re-runs allowed when lines change under the agent (default 2; 0 keeps the other writer's lines at once). */
  retries?: number;
  /**
   * Notes its owner sent since the last call. A running CLI can't take messages, so
   * after each run any new ones send it round again, with every note so far in its prompt.
   */
  notes?: () => Promise<string[]>;
  /** Aborting stops the agent (its CLI is killed) and posts nothing more. */
  signal?: AbortSignal;
  /** Where the agent runs (default: a scratch dir here, running `exec`). */
  sandbox?: Sandbox;
  exec?: Exec; log?: (s: string) => void;
}): Promise<Result> {
  const { user, owner, repo, path } = opts;
  const log = opts.log ?? (() => {});
  const sandbox = opts.sandbox ?? localSandbox(opts.exec);
  const file = `/api/repos/${owner}/${repo}/do`, onMain = `?path=${encodeURIComponent(path)}`;
  const q = onMain + (opts.branch ? `&branch=${encodeURIComponent(opts.branch)}` : "");
  const get = async () => {
    const res = await call(user, `${file}/file${q}`);
    if (!res.ok) throw new Error(`read ${path}: ${res.status} ${await res.text()}`);
    return (await res.json()) as Doc;
  };

  // When someone else changes a line the agent also changed, the agent's op on
  // that line is held back and the agent runs again on the file as it is now,
  // told which lines moved under it. Whatever still conflicts after the last
  // run keeps the other writer's version and comes back in `conflicts`.
  const claim = opts.lines?.length ? opts.claim ?? `run-${Date.now().toString(36)}` : undefined;
  if (claim) {
    const res = await call(user, `${file}/claims${onMain}`, { method: "POST", body: JSON.stringify({ id: claim, lines: opts.lines, task: opts.task }) });
    if (!res.ok) throw new Error(`claiming its lines: ${((await res.json().catch(() => ({}))) as { error?: string }).error ?? res.status}`);
  }
  try { return await work(); }
  finally { if (claim) await call(user, `${file}/claims${onMain}`, { method: "POST", body: JSON.stringify({ id: claim, release: true }) }).catch(() => {}); }

  async function work(): Promise<Result> {
  const retries = opts.retries ?? 2, signal = opts.signal;
  let applied = 0, changed = false, runs = 0, retried = 0, noteRuns = 0, conflicts: Conflict[] = [], rev = 0, output = "";
  const told: string[] = [];
  for (;;) {
    runs++;
    signal?.throwIfAborted();
    // 1. Snapshot the file, and 2. let the agent edit a copy of it in the sandbox.
    const snapshot = await get();
    rev = snapshot.rev;
    const cmd = harnessCommand(opts.harness, taskPrompt(path, opts.task, conflicts, told), { model: opts.model });
    log(`${opts.harness}: ${runs === 1 ? "working on" : `re-running on`} ${path} (rev ${snapshot.rev})`);
    const run = await sandbox(cmd, { path, text: toDisk(snapshot.lines) }, signal);
    // Stopped: whatever it left is dropped.
    signal?.throwIfAborted();
    output = run.out.trim();
    if (run.code !== 0) throw new Error(`${opts.harness} exited ${run.code}:\n${output.slice(-2000)}`);
    if (run.text === null) throw new Error(`${opts.harness} removed ${path}`);

    // 3. Diff what it left against the snapshot, and post the change.
    const ops = diffToOps(snapshot.lines, fromDisk(run.text));
    conflicts = [];
    if (ops.length) {
      changed = true;
      // Post the ops whose lines are unchanged since the snapshot; retry on a race.
      // Ops on lines someone holds are left out, and come back as conflicts that say so.
      let landed = false;
      const held = new Map<Op, string>();
      const lineOf = (op: Op) => op.kind === "insert" ? op.after : op.line;
      for (let attempt = 0; attempt < 4 && !landed; attempt++) {
        signal?.throwIfAborted();
        const current = await get();
        const r = rebase(ops.filter((op) => !held.has(op)), current);
        const now = (op: Op) => current.lines.find((l) => l.id === lineOf(op)) ?? null;
        conflicts = [...r.skipped.map((op) => ({ op, now: now(op) })), ...[...held].map(([op, why]) => ({ op, now: now(op), held: why }))];
        if (!r.ops.length) { rev = current.rev; landed = true; break; }
        const res = await call(user, `${file}/ops${q}`, { method: "POST", body: JSON.stringify({ ops: r.ops, ...(claim ? { claim } : {}) }) });
        if (res.ok) {
          const body = (await res.json()) as { rev: number; applied: unknown[] };
          applied += body.applied.length;
          rev = body.rev;
          landed = true;
        } else if (res.status !== 409) throw new Error(`ops: ${res.status} ${await res.text()}`);
        else for (const c of ((await res.json()) as { conflicts?: { index: number; reason: string; claim?: string }[] }).conflicts ?? [])
          if (c.claim && r.ops[c.index]) held.set(r.ops[c.index]!, c.reason);
      }
      if (!landed) throw new Error(`${path} kept changing while ${opts.harness} worked; nothing was posted`);
    }
    const fresh = (await opts.notes?.()) ?? [];
    told.push(...fresh);
    if (fresh.length && noteRuns < NOTE_RUNS) {
      noteRuns++;
      log(`${opts.harness}: told ${fresh.length === 1 ? "something" : `${fresh.length} things`} while it worked; going again`);
      continue;
    }
    // Held lines stay held, so running again won't land them.
    if (!conflicts.some((c) => !c.held) || retried >= retries) break;
    retried++;
    log(`${opts.harness}: ${conflicts.length} line(s) changed by someone else while it worked`);
  }
  if (opts.commit && applied && !opts.branch) {
    const res = await call(user, `${file}/commit${q}`, { method: "POST", body: JSON.stringify({ message: opts.commit }) });
    if (!res.ok) throw new Error(`commit: ${res.status} ${await res.text()}`);
  }
  return { harness: opts.harness, path, changed, applied, runs, conflicts, rev, output };
  }
}
