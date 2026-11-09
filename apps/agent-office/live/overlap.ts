// #3119: the dispatch hint, at the office's hire and queue handlers, not only on the page. A worker hiring a worker
// (office-workers hire, the hire_worker MCP tool) or a board agent queueing a task now hears, before anyone starts,
// that the task's files are already being changed: by an open pull request, or by a task waiting on the queue.
// It can hire anyway (Mervin orders the merges) or hold: the office queues it itself once that work has merged.
//
// The task's files are the repo's paths its text names (@rustybuns/util/overlap taskFiles), its issue's title and
// body included. A seated worker with no PR yet counts too (#3427): the files its branch and worktree change against
// origin/main, and the ones its first prompt names. Anything the office can't read (no gh, no git, not a GitHub checkout) lets the hire through.
// AGENT_OFFICE_OVERLAP=off turns it off.

import { execFile } from "node:child_process";
import path from "node:path";
import { arr, check, int, maybe, obj, raw, str } from "@rustybuns/util/guard";
import { busyOn, GENERATED, taskFiles } from "@rustybuns/util/overlap";
import { stillBusy } from "../codesplitter/hint.ts";

/** An open pull request and the files it changes. */
export interface OpenPr { number: number; title: string; branch: string; files: string[] }
/** A queue task as the office keeps it (server/queue.js). */
export interface QueueTask { id: string; title: string; prompt?: string; issue?: number; status: string; branch?: string; pr?: unknown }
/** What the new task would collide with. Empty lists: nothing. */
export interface Clash {
  files: string[];
  prs: { pr: number; title: string; branch: string; files: string[] }[];
  queued: { id: string; title: string; files: string[] }[];
  workers: { id: string; name: string; branch: string; files: string[] }[];
}
/** A seated worker with no pull request yet, and the files it is changing (or will, by its first prompt). */
export interface BusyWorker { id: string; name: string; branch: string; files: string[] }

type Issue = { number: number; title?: string; body?: string };

/** What a task's text is for the guess: its prompt and title, plus its issue's title and body when the office has them. */
export function taskText(t: { prompt?: unknown; title?: unknown; issue?: unknown }, issues: Issue[]) {
  const issue = issues.find((i) => i.number === t.issue);
  return [t.title, t.prompt, issue?.title, issue?.body].filter((s) => typeof s === "string" && s).join("\n").slice(0, 20_000);
}

/** The pure part: which open PRs and queued tasks change the files `text` names. Lock and generated files don't count. */
export function clashOf(text: string, paths: string[], prs: OpenPr[], queued: QueueTask[], issues: Issue[] = [], workers: BusyWorker[] = []): Clash {
  const real = (f: string) => !GENERATED.some((g) => g.test(f));
  const files = taskFiles(text, paths).filter(real);
  const byBranch = new Map(prs.map((p) => [p.branch, p]));
  const changed = prs.flatMap((p) => p.files.map((path) => ({ branch: p.branch, path })));
  const hit = busyOn(files, changed).map((b) => ({ pr: byBranch.get(b.branch)!.number, title: byBranch.get(b.branch)!.title, branch: b.branch, files: b.files }));
  const want = new Set(files);
  const others = queued.filter((t) => t.status === "queued").map((t) => ({ id: t.id, title: t.title, files: taskFiles(taskText(t, issues), paths).filter((f) => want.has(f)) }));
  const seated = workers.map((w) => ({ ...w, files: w.files.filter((f) => want.has(f)) })).filter((w) => w.files.length);
  return { files, prs: hit, queued: others.filter((o) => o.files.length), workers: seated };
}

export const clashes = (c: Clash) => c.prs.length + c.queued.length + c.workers.length > 0;

/** The refusal an agent reads: what it collides with, and its two ways on. */
export function clashMessage(c: Clash) {
  const list = (fs: string[]) => fs.slice(0, 4).join(", ") + (fs.length > 4 ? `, +${fs.length - 4} more` : "");
  const what = [
    ...c.prs.map((p) => `PR #${p.pr} ${p.branch} (${list(p.files)})`),
    ...c.queued.map((q) => `the queued task "${q.title}" (${list(q.files)})`),
    ...c.workers.map((w) => `${w.name}, at work with no PR yet (${list(w.files)})`),
  ];
  return `This task touches files other work is already changing: ${what.join("; ")}. ` +
    "Send it again with anyway: true (office-workers --anyway) to start it now from main, and Mervin orders the merges, " +
    "or with hold: true (--hold) and the office queues it once that work has merged.";
}

// --- what the office reads, cached a minute per checkout ---

type Run = (cmd: string, args: string[], cwd: string) => Promise<string>;
const run: Run = (cmd, args, cwd) => new Promise((ok, no) =>
  execFile(cmd, args, { cwd, timeout: 15_000, maxBuffer: 32 << 20 }, (err, out) => (err ? no(err) : ok(out))));

const FRESH_MS = 60_000;
const seen = new Map<string, { at: number; paths: Promise<string[]>; prs: Promise<OpenPr[]> }>();

/** The checkout's tracked paths and its open PRs with their files. Throws when either can't be read. */
export function look(dir: string, exec: Run = run, now = Date.now()) {
  const hit = seen.get(dir);
  if (hit && now - hit.at < FRESH_MS) return hit;
  const paths = exec("git", ["ls-files"], dir).then((o) => o.split("\n").filter(Boolean));
  const prs = exec("gh", ["pr", "list", "--state", "open", "--limit", "100", "--json", "number,title,headRefName,files"], dir).then(parsePrs);
  const fresh = { at: now, paths, prs };
  seen.set(dir, fresh);
  // a failed read is tried again next time, not cached for a minute
  void Promise.all([paths, prs]).catch(() => seen.get(dir) === fresh && seen.delete(dir));
  return fresh;
}

const PrRow = obj({ number: int(1, Infinity), title: str(Infinity, { min: 0, dflt: "" }), headRefName: str(Infinity), files: arr(obj({ path: str(Infinity) }), Infinity, { drop: true }) });

/** `gh pr list --json number,title,headRefName,files`, each row checked; rows of another shape are dropped. */
export function parsePrs(out: string): OpenPr[] {
  return (check(arr(PrRow, Infinity, { drop: true }), JSON.parse(out)) ?? [])
    .map((r) => ({ number: r.number, title: r.title, branch: r.headRefName, files: r.files.map((f) => f.path) }));
}

const Seated = obj({
  id: str(200), name: str(200), prompt: maybe(str(Infinity, { min: 0 })), pr: raw,
  worktree: maybe(obj({ path: str(4096), branch: str(400, { min: 0, dflt: "" }) })),
});

/** Paths `git status --porcelain` lists, renames by their new name. */
export const statusPaths = (out: string) => out.split("\n").filter((l) => l.length > 3).map((l) => l.slice(3).split(" -> ").at(-1)!);

/**
 * Each worker on the floor with its own worktree and no pull request: what its branch changes against origin/main, what
 * it hasn't committed, and the files its first prompt names. A worktree git can't read keeps just the prompt's guess.
 */
export async function busyWorkers(floor: GuardFloor, paths: string[], issues: Issue[], exec: Run = run): Promise<BusyWorker[]> {
  const infos = (floor.workers?.list() ?? []).map((w) => check(Seated, w)).filter((w) => w !== null);
  return Promise.all(infos.filter((w) => w.worktree && !w.pr).map(async (w) => {
    const cwd = path.resolve(floor.dir, w.worktree!.path);
    const lines = (p: Promise<string>, read = (o: string) => o.split("\n").filter(Boolean)) => p.then(read, () => []);
    const [branch, dirty] = await Promise.all([
      lines(exec("git", ["diff", "--name-only", "origin/main...HEAD"], cwd)),
      lines(exec("git", ["status", "--porcelain", "-uall"], cwd), statusPaths),
    ]);
    const guess = taskFiles(taskText({ prompt: w.prompt }, issues), paths);
    return { id: w.id, name: w.name, branch: w.worktree!.branch, files: [...new Set([...branch, ...dirty, ...guess])].sort() };
  }));
}

/** The floor as the guard sees it: its checkout, its issues, its queue and its workers. */
export interface GuardFloor {
  id: string;
  dir: string;
  workers?: { list(): unknown[]; get(id: string): unknown };
  github?: { issues?: { items?: Issue[] } };
  queue: { state(): { tasks: QueueTask[] }; add(prompt: string, by: string, title: string | undefined, issue: number | undefined, ...rest: unknown[]): string | undefined };
}

/** What a hire or queue request collides with; null when the guard is off or the office can't tell. */
export async function hireClash(floor: GuardFloor, body: unknown, exec: Run = run, setting = process.env.AGENT_OFFICE_OVERLAP ?? ""): Promise<Clash | null> {
  if (setting.trim().toLowerCase() === "off" || !floor.dir) return null;
  const b = check(obj({ prompt: maybe(str(Infinity, { min: 0 })), title: maybe(str(Infinity, { min: 0 })), issue: maybe(int(1, Infinity)) }), body) ?? {};
  try {
    const seen = look(floor.dir, exec);
    const [paths, prs] = await Promise.all([seen.paths, seen.prs]);
    const issues = floor.github?.issues?.items ?? [];
    const c = clashOf(taskText(b, issues), paths, prs, floor.queue.state().tasks, issues, await busyWorkers(floor, paths, issues, exec));
    return clashes(c) ? c : null;
  } catch {
    return null;
  }
}

/** Whether the request said to go ahead, or to wait. */
export const flagOf = (body: unknown, k: "anyway" | "hold") => typeof body === "object" && body !== null && k in body && Reflect.get(body, k) === true;

// --- hold until merged ---

export interface HeldTask { id: string; floor: string; by: string; owner?: string; prompt: string; title?: string; issue?: number; branches: string[]; tasks: string[]; workers: string[]; at: number }
const held = new Map<string, HeldTask & { home: GuardFloor; toast: (m: string) => void }>();
const HOLD_DAYS = 14;
const EVERY_MS = 60_000;
let timer: ReturnType<typeof setInterval> | undefined;

/** Holds the task; the office queues it once the clashing PRs have merged and the clashing queue tasks are done. */
export function holdTask(floor: GuardFloor, c: Clash, task: Omit<HeldTask, "id" | "floor" | "branches" | "tasks" | "workers" | "at">, toast: (m: string) => void) {
  const h = { ...task, id: crypto.randomUUID(), floor: floor.id, branches: [...c.prs.map((p) => p.branch), ...c.workers.map((w) => w.branch).filter(Boolean)], tasks: c.queued.map((q) => q.id), workers: c.workers.map((w) => w.id), at: Date.now(), home: floor, toast };
  held.set(h.id, h);
  timer ??= setInterval(() => void releaseHeld(), EVERY_MS);
  (timer as { unref?: () => void }).unref?.();
  const on = [...c.prs.map((p) => `PR #${p.pr}`), ...c.queued.map((q) => `"${q.title}"`), ...c.workers.map((w) => `${w.name}'s work`)];
  return { id: h.id, message: `Held: the office queues it once ${on.join(", ")} ${on.length > 1 ? "have" : "has"} merged` };
}

/**
 * What a held task still waits on: branches with an open PR, queue tasks not done (or done with their PR open), and
 * workers still seated with no PR (`seated` says which).
 */
export function waitingOn(h: Pick<HeldTask, "branches" | "tasks"> & { workers?: string[] }, prs: OpenPr[], tasks: QueueTask[], seated: (id: string) => boolean = () => false): string[] {
  const after = tasks.filter((t) => h.tasks.includes(t.id));
  const branches = [...h.branches, ...after.flatMap((t) => (t.branch ? [t.branch] : []))];
  const open = stillBusy({ id: "", msg: { t: "queue.add", prompt: "" }, branches, at: 0 }, prs.map((p) => ({ name: p.branch, status: "open" }))) ?? branches;
  return [...open, ...after.filter((t) => t.status !== "done").map((t) => t.id), ...(h.workers ?? []).filter(seated)];
}

/** Queues every held task whose work has landed; one dropped after HOLD_DAYS. Returns how many it queued. */
export async function releaseHeld(exec: Run = run, now = Date.now()) {
  let n = 0;
  for (const h of [...held.values()]) {
    if (now - h.at > HOLD_DAYS * 864e5) { held.delete(h.id); continue; }
    let prs: OpenPr[];
    try { prs = await look(h.home.dir, exec, now).prs; } catch { continue; }
    const seated = (id: string) => { const w = check(Seated, h.home.workers?.get(id)); return !!w && !w.pr; };
    if (waitingOn(h, prs, h.home.queue.state().tasks, seated).length) continue;
    held.delete(h.id);
    const err = h.home.queue.add(h.prompt, h.by, h.title, h.issue, undefined, undefined, undefined, h.owner);
    h.toast(err ? `Couldn't queue ${h.by}'s held task "${h.title ?? "task"}": ${err}` : `${h.by}'s held task "${h.title ?? "task"}" is queued: the work it waited on has merged`);
    if (!err) n++;
  }
  return n;
}

/** The tasks held now, for a floor (or all). */
export const heldTasks = (floor?: string): HeldTask[] =>
  [...held.values()].filter((h) => !floor || h.floor === floor).map(({ home: _, toast: __, ...h }) => h);

/** Forgets every held task and the cache (tests). */
export function resetOverlap() {
  held.clear();
  seen.clear();
  if (timer) clearInterval(timer);
  timer = undefined;
}

/** A held task's title on the queue: its own, its issue's, or its prompt's first line (not the agent mark added later). */
export function titleOf(body: unknown): string | undefined {
  const b = check(obj({ prompt: maybe(str(Infinity, { min: 0 })), title: maybe(str(200, { min: 1 })), issue: maybe(int(1, Infinity)) }), body) ?? {};
  return b.title ?? (b.issue ? `Issue #${b.issue}` : b.prompt?.trim().split("\n", 1)[0]?.slice(0, 120) || undefined);
}
