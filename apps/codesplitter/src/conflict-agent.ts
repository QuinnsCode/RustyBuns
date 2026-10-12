// Layout: one merge conflict handed to a coding agent: git's markers in, the settled lines out
// Hand one merge conflict to a coding agent. It gets the conflict as git's markers in a file of its own
// (main's, the base's and the branch's version), the merge of the rest of the file around it, and what
// main's commits to the file said since the branch forked, and edits the file into the settled text. branches.ts then checks it: the
// merged file parses, and the repo's tests pass in a throwaway clone (deps.ts). It comes back as a
// suggestion either way, with any failure attached: nothing lands until someone merges with it as `{text}`.
// A branch doesn't commit, so for its side the agent gets the task of the agent run that made it, if one did (#986),
// or the commit messages of the upstream branch a mirror's branch follows (#990).
// Run as the feed digest runs one (feed.ts): on this machine, or in a container when hosted.
import { harnessCommand, type Harness } from "./harness.ts";
import type { Conflict, Doc } from "./lines.ts";
import type { Sandbox } from "./agent-run.ts";

const MARK = /^(<{7}|\|{7}|={7}|>{7})( |$)/m;

/** The conflict as git writes one, diff3 style, so every agent knows what it's looking at. */
export function markers(c: Conflict) {
  const side = (s: string | null, gone: string) => s === null ? [`(${gone} deleted it)`] : s.split("\n");
  return [
    "<<<<<<< main", ...side(c.main, "main"),
    "||||||| base", ...(c.base ? c.base.split("\n") : []),
    "=======", ...side(c.branch, "the branch"),
    ">>>>>>> branch",
  ].join("\n") + "\n";
}

/** The merged file's lines around the conflict, numbered, for the prompt: up to `n` either side. */
export function around(merged: Doc, id: string, n = 8) {
  const i = merged.lines.findIndex((l) => l.id === id);
  if (i < 0) return "";
  return merged.lines.slice(Math.max(0, i - n), i + n + 1)
    .map((l, k) => `${String(Math.max(0, i - n) + k + 1).padStart(5)}${l.id === id ? ">" : " "} ${l.text}`).join("\n");
}

/** The file the agent edits: RESOLVE with the conflicted file's extension, so it reads as that language. */
export const resolveFile = (path: string) => `RESOLVE${/\.[\w-]+$/.exec(path)?.[0] ?? ".txt"}`;

/**
 * `said`: main's commit messages for the file since the branch forked, why main changed it; `meant`: why the branch did,
 * the task an agent run made it for; `theirs`: or the commit messages of the upstream branch a mirror's branch follows.
 */
export function conflictPrompt(path: string, branch: string, c: Conflict, context: string, said: string[] = [], meant?: string, theirs: string[] = []) {
  const file = resolveFile(path);
  return [
    `${file} in the current directory holds one merge conflict from ${path}, merging the branch ${branch} into main, as git's markers:`,
    `main's version, then the base both started from, then the branch's.`,
    ...(context ? [`Around it, ${path} as the merge leaves it, every other change already in (the conflicted line marked >):`, context] : []),
    ...(said.length ? [`Since ${branch} forked, main's commits to ${path} said:`, ...said.map((m) => `- ${m}`)] : []),
    ...(meant ? [`${branch} is a coding agent's work on the task: ${meant}`] : []),
    ...(theirs.length ? [`${branch} follows a branch upstream, whose commits to ${path} said:`, ...theirs.map((m) => `- ${m}`)] : []),
    `Rewrite ${file} in place as the settled text: keep what each side meant to change. When both added something, keep both.`,
    `Leave no markers. Keep the indentation. Write only the lines that replace the conflict, nothing around them.`,
    `Do not add files, and do not run git commands. The merged file is parsed and the repo's tests run on your answer after you stop.`,
  ].join("\n");
}

/** The agent's settled text, or why there isn't one. */
export function settled(run: { code: number; out: string; text: string | null }, harness: string, given: string): { text: string } | { error: string } {
  if (run.code !== 0) return { error: `${harness} exited ${run.code}: ${run.out.trim().slice(-500)}` };
  const text = (run.text ?? "").replace(/\n+$/, "");
  if (!text.trim() || text === given.replace(/\n+$/, "")) return { error: `${harness} left the conflict as it was` };
  if (MARK.test(text)) return { error: `${harness} left git's markers in` };
  return { text };
}

export async function askAgent(box: Sandbox, o: { harness: Harness; model?: string; path: string; branch: string; conflict: Conflict; merged: Doc; said?: string[]; meant?: string; theirs?: string[] }, signal?: AbortSignal) {
  const given = markers(o.conflict);
  const cmd = harnessCommand(o.harness, conflictPrompt(o.path, o.branch, o.conflict, around(o.merged, o.conflict.line), o.said, o.meant, o.theirs), { model: o.model });
  return settled(await box(cmd, { path: resolveFile(o.path), text: given }, signal), o.harness, given);
}
