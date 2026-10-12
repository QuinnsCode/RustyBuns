// Layout: a unified diff and a `git format-patch` mail written in JS, for beams on the hosted site where there's no git to run
// What `git diff` and `git format-patch` print, for a Worker that has no git
// (beam.ts on Cloudflare). The lines matched come from sync.ts's Myers diff; the
// rest is git's format: headers, hunks with three lines of context, and the
// mail `git am` reads.

import { keptPairs } from "./sync.ts";

/** One side of a changed file: its blob's hash and mode, and its text (null when it's binary). */
export interface Side { hash: string; mode: string; text: string | null }
/** A changed file: `before` null when it was added, `after` null when it was deleted. */
export interface FileDiff { path: string; before: Side | null; after: Side | null }

const CONTEXT = 3;
const ZERO = "0000000";
const short = (h: string) => h.slice(0, 7);

/** A text's lines, each with its own "\n" if it has one, so a missing newline at the end is a change like any other. */
const linesOf = (s: string) => s.match(/[^\n]*\n|[^\n]+$/g) ?? [];

/**
 * What git puts after a hunk's `@@`: the last line before it that starts with a letter, `_` or `$`
 * (its default funcname), trailing space trimmed, at most 80 bytes.
 */
function funcname(a: string[], before: number) {
  for (let k = before - 1; k >= 0; k--) {
    if (!/^[A-Za-z_$]/.test(a[k]!)) continue;
    const bytes = new TextEncoder().encode(a[k]!.replace(/\n$/, "")).slice(0, 80);
    return " " + new TextDecoder().decode(bytes).trimEnd();
  }
  return "";
}

/** `-a,n`'s numbers: a range of one drops its count; an empty one names the line before it. */
const range = (start: number, len: number) => len === 1 ? `${start + 1}` : `${len ? start + 1 : start},${len}`;

type Step = { op: " " | "-" | "+"; line: string; i: number; j: number };

/** The hunks between two texts, as `git diff` prints them. */
export function hunks(before: string, after: string): string {
  const a = linesOf(before), b = linesOf(after);
  // The edit script: the kept lines, and between them what went and what came.
  const steps: Step[] = [];
  let i = 0, j = 0;
  for (const p of [...keptPairs(a, b), { i: a.length, j: b.length }]) {
    for (; i < p.i; i++) steps.push({ op: "-", line: a[i]!, i, j });
    for (; j < p.j; j++) steps.push({ op: "+", line: b[j]!, i, j });
    if (i < a.length && j < b.length) steps.push({ op: " ", line: a[i]!, i: i++, j: j++ });
  }
  const changed = steps.flatMap((s, k) => s.op === " " ? [] : [k]);
  let out = "";
  for (let c = 0; c < changed.length;) {
    // A hunk runs from three lines before a change to three after the last change that close to the one before.
    const start = changed[c]!;
    let end = start;
    while (c + 1 < changed.length && changed[c + 1]! - end <= 2 * CONTEXT + 1) end = changed[++c]!;
    c++;
    const part = steps.slice(Math.max(0, start - CONTEXT), Math.min(steps.length, end + CONTEXT + 1));
    out += `@@ -${range(part[0]!.i, part.filter((s) => s.op !== "+").length)} +${range(part[0]!.j, part.filter((s) => s.op !== "-").length)} @@${funcname(a, part[0]!.i)}\n`;
    for (const s of part) out += s.op + (s.line.endsWith("\n") ? s.line : `${s.line}\n\\ No newline at end of file\n`);
  }
  return out;
}

/** One file's part of `git diff`. */
export function fileDiff({ path, before, after }: FileDiff): string {
  let out = `diff --git a/${path} b/${path}\n`;
  if (!before && after) out += `new file mode ${after.mode}\nindex ${ZERO}..${short(after.hash)}\n`;
  else if (before && !after) out += `deleted file mode ${before.mode}\nindex ${short(before.hash)}..${ZERO}\n`;
  else if (before && after) {
    if (before.mode !== after.mode) out += `old mode ${before.mode}\nnew mode ${after.mode}\n`;
    if (before.hash === after.hash) return out;
    out += `index ${short(before.hash)}..${short(after.hash)}${before.mode === after.mode ? ` ${after.mode}` : ""}\n`;
  }
  const [a, b] = [before ? `a/${path}` : "/dev/null", after ? `b/${path}` : "/dev/null"];
  if (before?.text === null || after?.text === null) return out + `Binary files ${a} and ${b} differ\n`;
  const h = hunks(before?.text ?? "", after?.text ?? "");
  // An empty file added or deleted has no hunks, and git leaves out the ---/+++ lines with them.
  return h ? out + `--- ${a}\n+++ ${b}\n` + h : out;
}

/** `git diff` of several files, in path order as git prints them. */
export const unifiedDiff = (files: FileDiff[]) => [...files].sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0)).map(fileDiff).join("");

/** The commit as `git format-patch -1 --stdout` writes it: a mail `git am` takes. */
export function formatPatch(c: { sha: string; author: { name: string; email: string }; at: number; message: string }, diff: string): string {
  const [title, ...rest] = c.message.trimEnd().split("\n");
  const body = rest.join("\n").trim();
  const date = new Date(c.at).toUTCString().replace("GMT", "+0000");
  return `From ${c.sha} Mon Sep 17 00:00:00 2001\nFrom: ${c.author.name} <${c.author.email}>\nDate: ${date}\nSubject: [PATCH] ${title}\n\n${body ? `${body}\n` : ""}---\n\n${diff}-- \ncodeSplitter\n\n`;
}
