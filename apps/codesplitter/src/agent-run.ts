// Layout: runs an agent on a file: snapshot, edit in a sandbox, diff, post, re-run on conflicts
// Run one coding agent on one file of a repo. The agent works on a plain-text
// copy in a sandbox; when it stops, its edit is diffed against the snapshot and
// posted to the file's Durable Object as line ops, so the edit shows up live and
// carries the agent's name in blame like any other edit. The sandbox is a scratch
// directory on this machine (localSandbox), or a container on Cloudflare (sandbox.ts).

import type { Call } from "./local.ts";
import type { Doc, Line, Op } from "./lines.ts";
import { harnessCommand, taskPrompt, type Command, type Harness, type HeldLine } from "./harness.ts";
import { diffToOps, rebase } from "./sync.ts";
import { NOTE_ASK, tokens, tripped, usageOf, type Budget, type Trip } from "./budget.ts";
import { leakIn } from "./leaks.ts";

/** Runs a command in `cwd`; `signal` aborting kills it (Stop on a run). */
export type Exec = (cmd: Command, cwd: string, signal?: AbortSignal) => Promise<{ code: number; out: string }>;

/**
 * Where the agent works: write the file (and `also`, the other files it may edit), run the
 * command beside it, read back what it left (null if it removed one). `signal` aborting stops the agent.
 */
export type Sandbox = (cmd: Command, file: { path: string; text: string; also?: Record<string, string> }, signal?: AbortSignal) =>
  Promise<{ code: number; out: string; text: string | null; also?: Record<string, string | null> }>;

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
    const at = (p: string) => join(dir, p), left = (p: string) => existsSync(at(p)) ? readFileSync(at(p), "utf8") : null;
    for (const [p, text] of Object.entries({ ...file.also, [file.path]: file.text })) {
      mkdirSync(dirname(at(p)), { recursive: true });
      writeFileSync(at(p), text);
    }
    const run = await exec(cmd, dir, signal);
    return { ...run, text: left(file.path), ...(file.also && { also: Object.fromEntries(Object.keys(file.also).map((p) => [p, left(p)])) }) };
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
  /** The file it's in, when that's one of the run's `also` rather than its own. */
  path?: string;
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
  /** Which of its `also` files it changed. */
  edited?: string[];
  /** How many tokens it read and wrote, every run of the CLI counted: its own usage where it reports it, else about (budget.ts). */
  spent: number;
  /** Cut short before going round again (#1077): at how many tokens, and why. */
  tripped?: Trip;
  /** Each round's failure, for the handoff note: the lines that moved under it. */
  failures?: string[];
  /** Notes its owner sent that no run's prompt carried, as it stopped short: the handoff note takes them (#1090). */
  unheard?: string[];
}

/** What a file's text looks like on disk: lines joined by \n with one trailing \n. */
export const toDisk = (lines: { text: string }[]) => lines.length ? lines.map((l) => l.text).join("\n") + "\n" : "";
/** Back from disk to the lines the agent left. */
export const fromDisk = (s: string) => s === "" ? [] : s.replace(/\n$/, "").split("\n");

/** Re-runs notes may add to one run, so a chatty owner can't keep an agent going for ever. */
const NOTE_RUNS = 5;
/** How often a run renews its claim while the CLI thinks: well inside the file's 2-minute lease (file-do.ts). */
const HEARTBEAT_MS = 30_000;

export async function runAgent(call: Call, opts: {
  user: string; owner: string; repo: string; path: string;
  harness: Harness; task: string; model?: string; commit?: string;
  /** Work on this branch's copy of the file instead of main's (its claim still holds main's lines). No commit there. */
  branch?: string;
  /** The lines it was given (ids): claimed for the run, so nobody else edits them meanwhile. */
  lines?: string[];
  /** The claim's id; one run's claim, since every agent of a harness edits under one name. */
  claim?: string;
  /**
   * Other files it may edit beside `path` (a fix task's: the rest of the branch's changes, heal.ts).
   * Same branch, no claim on them; what it changes there is posted to each file as it is to `path`.
   */
  also?: string[];
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
  /** Its path's budget (#1077): past it, the same failure twice, or a third conflict round, it stops instead of going round again. */
  budget?: Budget;
  /** How often its claim is renewed while it works (default HEARTBEAT_MS). */
  heartbeat?: number;
  /** What the run was handed (its API keys, its GitHub token): an edit that writes one into a file posts nothing (leaks.ts). */
  secrets?: (string | null | undefined)[];
  exec?: Exec; log?: (s: string) => void;
}): Promise<Result> {
  const { user, owner, repo, path } = opts;
  const log = opts.log ?? (() => {});
  const sandbox = opts.sandbox ?? localSandbox(opts.exec);
  const file = `/api/repos/${owner}/${repo}/do`, onMain = `?path=${encodeURIComponent(path)}`;
  const at = (p: string) => `?path=${encodeURIComponent(p)}` + (opts.branch ? `&branch=${encodeURIComponent(opts.branch)}` : "");
  const q = at(path), also = (opts.also ?? []).filter((p) => p !== path);
  const get = async (p = path) => {
    const res = await call(user, `${file}/file${at(p)}`);
    if (!res.ok) throw new Error(`read ${p}: ${res.status} ${await res.text()}`);
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
  // The claim is a lease: renewed by every edit that names it, and by this while the CLI thinks.
  const renew = () => call(user, `${file}/claims${onMain}`, { method: "POST", body: JSON.stringify({ id: claim }) })
    .then((res) => { if (!res.ok) log(`${opts.harness}: couldn't renew its claim on ${path} (${res.status}); its lines may be free to others`); }, () => {});
  const beat = claim ? setInterval(renew, opts.heartbeat ?? HEARTBEAT_MS) : null;
  try { return await work(); }
  finally { if (beat) clearInterval(beat); if (claim) await call(user, `${file}/claims${onMain}`, { method: "POST", body: JSON.stringify({ id: claim, release: true }) }).catch(() => {}); }

  /** Lines of `doc` others hold right now (claims are on main's copy; a branch's lines share its ids), so the agent works elsewhere. */
  async function heldLines(doc: Doc): Promise<HeldLine[]> {
    const res = await call(user, `${file}/claims${onMain}`).catch(() => null);
    if (!res?.ok) return [];
    const now = Date.now(), whose = new Map<string, string>();
    for (const c of (await res.json()) as { id: string; who: string; bot: boolean; lines: string[]; task?: string; until: number | null }[]) {
      if (c.id === claim || (c.who === user && !c.bot) || (c.until !== null && c.until <= now)) continue;
      for (const id of c.lines) whose.set(id, `held by @${c.who}${c.task ? `: ${c.task}` : ""}`);
    }
    return doc.lines.flatMap((l, i) => whose.has(l.id) ? [{ n: i + 1, text: l.text, why: whose.get(l.id)! }] : []);
  }

  async function work(): Promise<Result> {
  const retries = opts.retries ?? 2, signal = opts.signal;
  let applied = 0, changed = false, runs = 0, retried = 0, noteRuns = 0, conflicts: Conflict[] = [], rev = 0, output = "", spent = 0, trip: Trip | undefined;
  const told: string[] = [], touched = new Set<string>(), failures: string[] = [];
  /** How many of `told` the last prompt carried. */
  let heard = 0;
  /** Whether going round again would blow its budget: if so it stops, and says why. */
  const over = () => {
    const why = opts.budget && tripped({ spent, budget: opts.budget.tokens, failures, conflictRounds: failures.length });
    if (why) { trip = { at: spent, why }; log(`${opts.harness}: stopping at ~${spent} tokens: ${why}`); }
    return !!why;
  };

  /**
   * Posts what the agent left in `p` as ops on the lines unchanged since `snapshot`, retrying on a race.
   * Ops on lines someone holds are left out, and come back as conflicts that say so. The file's
   * rev after, or 0 when the agent didn't change it. Only `path` carries the run's claim.
   */
  async function post(p: string, snapshot: Doc, text: string): Promise<number> {
    const ops = diffToOps(snapshot.lines, fromDisk(text));
    if (!ops.length) return 0;
    changed = true;
    const mine = p === path, tag = (c: Conflict): Conflict => mine ? c : { ...c, path: p };
    const held = new Map<Op, string>();
    const lineOf = (op: Op) => op.kind === "insert" ? op.after : op.line;
    for (let attempt = 0; attempt < 4; attempt++) {
      signal?.throwIfAborted();
      const current = await get(p);
      const r = rebase(ops.filter((op) => !held.has(op)), current);
      const now = (op: Op) => current.lines.find((l) => l.id === lineOf(op)) ?? null;
      const lost = [...r.skipped.map((op) => ({ op, now: now(op) })), ...[...held].map(([op, why]) => ({ op, now: now(op), held: why }))].map(tag);
      if (!r.ops.length) { conflicts.push(...lost); return current.rev; }
      const res = await call(user, `${file}/ops${at(p)}`, { method: "POST", body: JSON.stringify({ ops: r.ops, ...(claim && mine ? { claim } : {}) }) });
      if (res.ok) {
        const body = (await res.json()) as { rev: number; applied: unknown[] };
        applied += body.applied.length;
        conflicts.push(...lost);
        return body.rev;
      } else if (res.status !== 409) throw new Error(`ops: ${res.status} ${await res.text()}`);
      else for (const c of ((await res.json()) as { conflicts?: { index: number; reason: string; claim?: string }[] }).conflicts ?? [])
        if (c.claim && r.ops[c.index]) held.set(r.ops[c.index]!, c.reason);
    }
    throw new Error(`${p} kept changing while ${opts.harness} worked; nothing was posted`);
  }
  for (;;) {
    runs++;
    signal?.throwIfAborted();
    // 1. Snapshot the file (and its `also`), and 2. let the agent edit a copy of them in the sandbox.
    const snapshot = await get();
    const others = await Promise.all(also.map((p) => get(p)));
    rev = snapshot.rev;
    const prompt = taskPrompt(path, opts.task, conflicts, told, await heldLines(snapshot), also) + (opts.budget ? `\n${NOTE_ASK}` : "");
    heard = told.length;
    const cmd = harnessCommand(opts.harness, prompt, { model: opts.model, usage: true });
    log(`${opts.harness}: ${runs === 1 ? "working on" : `re-running on`} ${path}${also.length ? ` and ${also.length} more` : ""} (rev ${snapshot.rev})`);
    const run = await sandbox(cmd, { path, text: toDisk(snapshot.lines), ...(also.length && { also: Object.fromEntries(also.map((p, i) => [p, toDisk(others[i]!.lines)])) }) }, signal);
    // Stopped: whatever it left is dropped.
    signal?.throwIfAborted();
    // What it says it read and wrote, where its CLI says (#1088, #1118); else it read the prompt and every file, and wrote its reply and the files back.
    const usage = usageOf(run.out);
    output = (usage?.reply ?? run.out).trim();
    spent += usage?.tokens ?? tokens(prompt.length + snapshot.lines.reduce((n, l) => n + l.text.length + 1, 0) * 2
      + others.reduce((n, d) => n + d.lines.reduce((k, l) => k + l.text.length + 1, 0) * 2, 0) + run.out.length);
    if (run.code !== 0) throw new Error(`${opts.harness} exited ${run.code}:\n${output.slice(-2000)}`);
    if (run.text === null) throw new Error(`${opts.harness} removed ${path}`);
    // Emptied is removed by another name: every line goes. A person does that, not an agent.
    if (run.text === "" && snapshot.lines.length) throw new Error(`${opts.harness} emptied ${path}`);
    const gone = also.find((p) => typeof run.also?.[p] !== "string");
    if (gone) throw new Error(`${opts.harness} removed ${gone}`);
    // A key in what it wrote (a prompt-injected agent told to leak its own): nothing from this round is posted.
    const left: [string, Doc, string][] = [[path, snapshot, run.text], ...also.map((p, i): [string, Doc, string] => [p, others[i]!, run.also![p]!])];
    for (const [p, before, after] of left) {
      const leak = leakIn(before.lines.map((l) => l.text), fromDisk(after), opts.secrets);
      if (leak) throw new Error(`${opts.harness} wrote what looks like ${leak} into ${p}; nothing was posted`);
    }

    // 3. Diff what it left against the snapshot, and post the change: its own file's, then each other's.
    conflicts = [];
    const own = await post(path, snapshot, run.text);
    if (own) rev = own;
    for (const [i, p] of also.entries()) if (await post(p, others[i]!, run.also![p]!)) touched.add(p);
    const fresh = (await opts.notes?.()) ?? [];
    told.push(...fresh);
    // A round whose edits moved under it failed, and says on which lines.
    const moved = conflicts.filter((c) => !c.held);
    if (moved.length) failures.push(`edits lost on ${moved.map((c) => `${c.path ?? path}:${c.op.kind === "insert" ? c.op.after : c.op.line}`).sort().join(" ")}`);
    if (fresh.length && noteRuns < NOTE_RUNS) {
      if (over()) break;
      noteRuns++;
      log(`${opts.harness}: told ${fresh.length === 1 ? "something" : `${fresh.length} things`} while it worked; going again`);
      continue;
    }
    // Held lines stay held, so running again won't land them.
    if (!moved.length || retried >= retries || over()) break;
    retried++;
    log(`${opts.harness}: ${conflicts.length} line(s) changed by someone else while it worked`);
  }
  if (opts.commit && applied && !opts.branch) {
    const res = await call(user, `${file}/commit${q}`, { method: "POST", body: JSON.stringify({ message: opts.commit }) });
    if (!res.ok) throw new Error(`commit: ${res.status} ${await res.text()}`);
  }
  return { harness: opts.harness, path, changed, applied, runs, conflicts, rev, output, spent, ...(touched.size && { edited: [...touched] }), ...(trip && { tripped: trip, failures, unheard: told.slice(heard) }) };
  }
}
