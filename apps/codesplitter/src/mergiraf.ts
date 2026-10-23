// Layout: Mergiraf, a structured merge driver, as a second opinion on a file Mervin left cards in
// Mergiraf (mergiraf.org, GPL-3.0, run as its own program, never linked) merges a file by its syntax tree. Mervin goes
// first; a file he leaves conflicts in gets one Mergiraf run on its three versions, before any agent is asked
// (branches.ts mergirafed). Where git's own line merge settles the file, Mervin refused on purpose (a rename, a
// strict delete), so Mergiraf isn't asked to overrule him. Hosted it runs in the agent container
// (sandbox/Dockerfile); on this machine only when MERGIRAF is "on", with the mergiraf on PATH.
import type { Command } from "./harness.ts";
import { localSandbox, type Exec, type Sandbox } from "./agent-run.ts";
import { containerSandbox } from "./sandbox.ts";
import { MARK } from "./conflict-agent.ts";
import type { Env } from "./env.ts";

/** The resolver level it shows as, in a merge's answer and Mervin's learning events. */
export const MERGIRAF = "mergiraf";

/** git's line merge first (its exit is the conflicts it left): clean there, exit 3 and leave it to Mervin's card. */
const SCRIPT = `git merge-file -q -p MAIN BASE BRANCH >/dev/null; [ $? -eq 0 ] && exit 3; exec mergiraf merge BASE MAIN BRANCH -p "$1" -o MERGED`;

export const mergirafCommand = (path: string): Command => ({ bin: "sh", args: ["-c", SCRIPT, "sh", path] });

/** Where it runs: the agent container when hosted, a stand-in under test, the local binary when turned on, else nowhere. */
export function mergirafBox(env: Env): Sandbox | null {
  if (env.AGENT_SANDBOX) return containerSandbox(env.AGENT_SANDBOX);
  if (typeof env.MERGIRAF === "function") return localSandbox(env.MERGIRAF as Exec);
  return env.MERGIRAF === "on" && typeof Bun !== "undefined" && Bun.which("mergiraf") ? localSandbox() : null;
}

/**
 * What `out` has where each of `marks` stands in `template`: the lines between the ones around it. Null when the lines
 * around a mark aren't in `out` in order, or two marks touch (where one ends would be a guess).
 */
export function fill(template: string[], marks: string[], out: string[]): string[] | null {
  const runs: string[][] = [[]], order: number[] = [];
  for (const line of template) {
    const i = marks.indexOf(line);
    if (i < 0) runs.at(-1)!.push(line);
    else { order.push(i); runs.push([]); }
  }
  if (order.length !== marks.length) return null;
  const at = (j: number, run: string[]) => j >= 0 && j + run.length <= out.length && run.every((l, k) => out[j + k] === l);
  if (!at(0, runs[0]!)) return null;
  const texts: string[] = [];
  let from = runs[0]!.length;
  for (let k = 1; k < runs.length; k++) {
    const run = runs[k]!, last = k === runs.length - 1;
    if (!run.length && !last) return null;
    let to = from;
    if (last) to = out.length - run.length;
    else while (to + run.length <= out.length && !at(to, run)) to++;
    if (to < from || !at(to, run)) return null;
    texts[order[k - 1]!] = out.slice(from, to).join("\n");
    from = to + run.length;
  }
  return texts;
}

/** `path` merged by Mergiraf, main's changes and the branch's both in; null when it left conflicts or didn't run. */
export async function mergiraf(box: Sandbox, path: string, base: string, main: string, branch: string): Promise<string | null> {
  const nl = (s: string) => s ? s + "\n" : "";
  const r = await box(mergirafCommand(path), { path: "MERGED", text: "", also: { BASE: nl(base), MAIN: nl(main), BRANCH: nl(branch) } });
  if (r.code !== 0 || r.text === null || MARK.test(r.text)) return null;
  return r.text.replace(/\n$/, "");
}
