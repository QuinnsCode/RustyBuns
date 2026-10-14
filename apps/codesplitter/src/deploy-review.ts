// Layout: what a deploy (hosted or desktop) may run with the owner's keys: the owner's own commits, or what they approved after reading the diff
// What a deploy may run with the owner's keys (#646, #682). A deploy runs the
// repo's install and Alchemy code with keys in its env (the stored ones in a
// hosted container, this machine's logins on the desktop), so whoever gets
// code onto main gets it run with them. Crew and agents can do that, so their
// code waits for the owner.
//
// The remote deploys clone (the crew's, when there is one) is walked from its
// tip back through each commit's parents. A commit is cleared when the owner
// made it alone (their own commit of a file nobody else edited since its last
// commit, which the commit route records), or when the owner approved it or a
// commit after it, having read the diff. Anything else (a crew or agent commit,
// a file with someone else's edits in it, a merge's, a mirror's or an import's
// commits, the crew remote's backfill) means the deploy waits until the owner
// approves the tip. A hosted runner checks again right before it unseals the
// keys, and either way the clone has to be the commit that was checked.
//
//   deploy_cleared   (owner, repo, sha, kind: own | approved)

import { handleFor } from "./archive.ts";
import type { ArtifactsRepo, Env, TreeEntry } from "./env.ts";
import { keptPairs } from "./sync.ts";

/** `at`: when it was authored, in ms (git keeps seconds). */
export interface Waiting { sha: string; message: string; author: string; at: number }
/** `commits`: the ones not cleared, newest first; `more`: the walk stopped before it reached a cleared commit or the root. */
export interface Review { tip: string | null; base: string | null; commits: Waiting[]; more: boolean }

/** How far back a review walks before it calls the rest unknown. */
const MAX_WALK = 200;

/** Nothing waits on the owner: the tip is there and everything up to it is cleared. */
export const isCleared = (r: Review) => !!r.tip && !r.commits.length && !r.more;

/** Why a deploy waits, in a sentence. */
export function waitingNote(r: Review) {
  if (!r.tip) return "this repo has no commits to deploy yet";
  const n = r.commits.length, who = [...new Set(r.commits.map((c) => c.author))].slice(0, 3).join(", ");
  return `waiting for you: ${n ? `${n}${r.more ? "+" : ""} commit${n === 1 && !r.more ? "" : "s"} since your last approved deploy aren't yours alone${who ? ` (${who})` : ""}` : "this history goes back further than it checks"}. Read the diff and approve it in the Deploy panel`;
}

/** The owner's own commit, of a file only they edited since its last commit. */
export async function clearOwn(env: Env, owner: string, repo: string, sha: string) {
  await env.DB.prepare("INSERT OR IGNORE INTO deploy_cleared (owner, repo, sha, kind, at) VALUES (?, ?, ?, 'own', ?)").bind(owner, repo, sha, Date.now()).run();
}

/** The owner read the diff up to `sha` and approved it: it and everything before it are cleared. */
export async function approve(env: Env, owner: string, repo: string, sha: string) {
  await env.DB.prepare(`INSERT INTO deploy_cleared (owner, repo, sha, kind, at) VALUES (?, ?, ?, 'approved', ?)
    ON CONFLICT (owner, repo, sha) DO UPDATE SET kind = 'approved', at = excluded.at`).bind(owner, repo, sha, Date.now()).run();
}

/** Which of the remote's commits since the last approval aren't the owner's alone. */
export async function review(env: Env, owner: string, repo: string): Promise<Review & { handle?: ArtifactsRepo }> {
  const h = await handleFor(env, owner, repo, true);
  const log = h ? await h.handle.log({ ref: h.branch, limit: 100 }).catch(() => []) : [];
  const tip = log[0]?.hash ?? null;
  if (!h || !tip) return { tip: null, base: null, commits: [], more: false };
  const known = new Map(log.map((c) => [c.hash, c]));
  const kinds = new Map<string, string>();
  const look = async (shas: string[]) => {
    for (let i = 0; i < shas.length; i += 90) {
      const part = shas.slice(i, i + 90);
      const { results } = await env.DB.prepare(`SELECT sha, kind FROM deploy_cleared WHERE owner = ? AND repo = ? AND sha IN (${part.map(() => "?").join(", ")})`)
        .bind(owner, repo, ...part).all();
      for (const r of results as { sha: string; kind: string }[]) kinds.set(r.sha, r.kind);
    }
  };
  await look([...known.keys()]);
  const commits: Waiting[] = [], seen = new Set<string>(), queue = [tip];
  let base: string | null = null, more = false;
  while (queue.length) {
    const sha = queue.shift()!;
    if (seen.has(sha)) continue;
    if (seen.size >= MAX_WALK) { more = true; break; }
    seen.add(sha);
    if (!known.has(sha)) await look([sha]);
    if (kinds.get(sha) === "approved") { base ??= sha; continue; }
    const c = known.get(sha) ?? await h.handle.readCommit(sha).catch(() => null);
    // A commit it can't read, it can't clear.
    if (!c) { more = true; continue; }
    if (kinds.get(sha) !== "own") commits.push({ sha, message: c.message.split("\n")[0]!.slice(0, 200), author: c.author.name, at: c.authoredAt < 1e12 ? c.authoredAt * 1000 : c.authoredAt });
    queue.push(...c.parents);
  }
  return { tip, base, commits, more, handle: h.handle };
}

/** `cut`: the person sees less than the file holds (lines past the cap, or binary or too big to show). */
export interface FileDiff { path: string; lines: string[]; note?: string; cut?: true }

const MAX_FILES = 40, MAX_FILE_LINES = 200, MAX_BYTES = 256 * 1024, CONTEXT = 2;

/** What changed from `base` (null: from nothing) to `tip`, file by file: `-` what goes, `+` what comes, two lines of context. */
export async function diff(handle: ArtifactsRepo, base: string | null, tip: string): Promise<{ files: FileDiff[]; more: boolean }> {
  const treeOf = async (sha: string | null) => sha ? (await handle.readCommit(sha))?.treeHash ?? null : null;
  const files: FileDiff[] = [];
  let more = false;
  const blob = async (e: TreeEntry | undefined) => {
    if (!e || e.type === "tree" || e.type === "gitlink") return { text: "" };
    const b = await handle.readBlob(e.hash);
    if (!b) return { text: "" };
    if (b.size > MAX_BYTES) return { note: `${b.size} bytes, too big to show` };
    const text = await b.text();
    return text.includes("\0") ? { note: "binary" } : { text };
  };
  const walk = async (a: string | null, b: string | null, dir: string): Promise<void> => {
    const [ea, eb] = await Promise.all([a ? handle.readTree(a) : null, b ? handle.readTree(b) : null]);
    const left = new Map((ea ?? []).map((e) => [e.name, e])), right = new Map((eb ?? []).map((e) => [e.name, e]));
    for (const name of [...new Set([...left.keys(), ...right.keys()])].sort()) {
      const x = left.get(name), y = right.get(name), path = dir ? `${dir}/${name}` : name;
      if (x?.hash === y?.hash) continue;
      if (files.length >= MAX_FILES) { more = true; return; }
      const xt = x?.type === "tree" ? x.hash : null, yt = y?.type === "tree" ? y.hash : null;
      if (xt || yt) await walk(xt, yt, path);
      // What's left is a file on either side (a folder can turn into a file, or the other way round).
      const xf = xt ? undefined : x, yf = yt ? undefined : y;
      if (!xf && !yf) continue;
      const [then, now] = await Promise.all([blob(xf), blob(yf)]);
      const d = then.note || now.note ? [] : textDiff(then.text ?? "", now.text ?? "");
      const cut = !!(then.note || now.note) || d.length > MAX_FILE_LINES;
      const note = [!xf && "new file", !yf && "deleted", then.note ?? now.note, d.length > MAX_FILE_LINES && `${d.length - MAX_FILE_LINES} more lines`].filter(Boolean).join(", ");
      if (d.length || note) files.push({ path, lines: d.slice(0, MAX_FILE_LINES), ...(note && { note }), ...(cut && { cut: true as const }) });
    }
  };
  await walk(await treeOf(base), await treeOf(tip), "");
  return { files, more };
}

/** Why reading the diff isn't reading all of it, or null when it is: the history walk or the file list stopped short, or a file was cut. */
export function cutShort(r: Review, d: { files: FileDiff[]; more: boolean }): string | null {
  const cut = d.files.filter((f) => f.cut).map((f) => f.path);
  const why = [r.more && "the history goes back further than the review walks", d.more && `more than ${MAX_FILES} files changed`, cut.length && `${cut.length} file${cut.length === 1 ? " is" : "s are"} cut short, binary or too big to show (${cut.slice(0, 3).join(", ")}${cut.length > 3 ? ", ..." : ""})`].filter(Boolean);
  return why.length ? why.join("; ") : null;
}

/** A line diff a person reads: `- ` taken out, `+ ` put in, `  ` context, `@@ n` where a hunk starts in the new text. */
export function textDiff(a: string, b: string): string[] {
  const split = (s: string) => s === "" ? [] : s.replace(/\n$/, "").split("\n");
  const x = split(a), y = split(b);
  const pairs = keptPairs(x, y);
  pairs.push({ i: x.length, j: y.length });
  // Every line as kept, taken out or put in, in order.
  const all: { kind: " " | "-" | "+"; text: string; j: number }[] = [];
  let i = 0, j = 0;
  for (const p of pairs) {
    while (i < p.i) all.push({ kind: "-", text: x[i++]!, j });
    while (j < p.j) { all.push({ kind: "+", text: y[j]!, j }); j++; }
    if (p.i < x.length) { all.push({ kind: " ", text: x[i]!, j }); i++; j++; }
  }
  const near = all.map(() => false);
  all.forEach((l, k) => { if (l.kind !== " ") for (let t = Math.max(0, k - CONTEXT); t <= Math.min(all.length - 1, k + CONTEXT); t++) near[t] = true; });
  const out: string[] = [];
  all.forEach((l, k) => {
    if (!near[k]) return;
    if (k === 0 || !near[k - 1]) out.push(`@@ ${l.j + 1}`);
    out.push(`${l.kind} ${l.text}`);
  });
  return out;
}
