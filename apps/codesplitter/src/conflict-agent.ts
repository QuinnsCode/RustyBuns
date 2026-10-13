// Layout: one merge conflict (or a settled stretch to fact-check) handed to a coding agent: git's markers in, the settled lines out
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
 * the task an agent run made it for; `theirs`: or the commit messages of the upstream branch a mirror's branch follows;
 * `note`: from a third conflict round on (#1089), the terse note of what the rounds before tried.
 */
export function conflictPrompt(path: string, branch: string, c: Conflict, context: string, said: string[] = [], meant?: string, theirs: string[] = [], note?: string) {
  const file = resolveFile(path);
  return [
    ...(note ? [`Fresh eyes: ${branch}'s conflicts came back again, and the agents before you left this note. Don't repeat what it says failed.`, note] : []),
    c.check
      ? `${file} in the current directory holds a stretch of ${path} that main and the branch ${branch} both changed, as git's markers. The merge settled it on its own, but one side may have changed a fact the other's words state (a number, a cap, a name)${c.facts?.length ? `; they differ on ${c.facts.slice(0, 12).join(", ")}` : ""}:`
      : `${file} in the current directory holds one merge conflict from ${path}, merging the branch ${branch} into main, as git's markers:`,
    `main's version, then the base both started from, then the branch's.`,
    ...(context ? [`Around it, ${path} as the merge leaves it, every other change already in (the conflicted line marked >):`, context] : []),
    ...(said.length ? [`Since ${branch} forked, main's commits to ${path} said:`, ...said.map((m) => `- ${m}`)] : []),
    ...(meant ? [`${branch} is a coding agent's work on the task: ${meant}`] : []),
    ...(theirs.length ? [`${branch} follows a branch upstream, whose commits to ${path} said:`, ...theirs.map((m) => `- ${m}`)] : []),
    `Rewrite ${file} in place as the settled text: keep what each side meant to change. When both added something, keep both.`,
    ...(c.check ? [`Make every fact in it true of the merged work: where one side's commits changed a number or a name, the other side's sentences take the new one.`] : []),
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

/**
 * The agent a merge asks on its own (#1012), for a file whose policy hands its leftovers to AI:
 * claude on its cheapest model where it's installed, else the first harness there is, on that
 * CLI's own default (the others name models by provider, which only their owner knows).
 */
export function cheapest(installed: Harness[]): { harness: Harness; model?: string } | null {
  if (installed.includes("claude")) return { harness: "claude", model: "haiku" };
  return installed[0] ? { harness: installed[0] } : null;
}

export async function askAgent(box: Sandbox, o: { harness: Harness; model?: string; path: string; branch: string; conflict: Conflict; merged: Doc; said?: string[]; meant?: string; theirs?: string[]; note?: string }, signal?: AbortSignal) {
  const given = markers(o.conflict);
  const cmd = harnessCommand(o.harness, conflictPrompt(o.path, o.branch, o.conflict, around(o.merged, o.conflict.line.replace(/^check:/, "")), o.said, o.meant, o.theirs, o.note), { model: o.model });
  return settled(await box(cmd, { path: resolveFile(o.path), text: given }, signal), o.harness, given);
}
