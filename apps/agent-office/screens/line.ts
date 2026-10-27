// GET /__rb/line (triage/server.ts): the gitpath screen's line, read from GitHub with the floor's own `gh` (read only):
// the open PRs with their checks, and how many merged in the last day. Asked at most once a minute per floor, so any
// number of open pages cost one `gh` pair.
import { mergedPrs, openPrs, type MergedPr, type OpenPr } from "./read.ts";

/** Runs `gh` with `args` in `cwd`, answers what it printed (null when it failed). */
export type Gh = (args: string[], cwd: string) => Promise<string | null>;

const bunGh: Gh = async (args, cwd) => {
  const p = Bun.spawn(["gh", ...args], { cwd, stdout: "pipe", stderr: "ignore", stdin: "ignore" });
  const [out, code] = await Promise.all([new Response(p.stdout).text(), p.exited]);
  return code === 0 ? out : null;
};

const FRESH_MS = 60_000, DAY_MS = 24 * 3600_000;
const parse = (t: string | null): unknown => { try { return t ? JSON.parse(t) : null; } catch { return null; } };

export interface Line { open: OpenPr[]; merged: MergedPr[]; error?: string }

export function lineOf(gh: Gh = bunGh) {
  const cache = new Map<string, { at: number; body: Promise<Line> }>();
  const read = async (dir: string): Promise<Line> => {
    const [open, merged] = await Promise.all([
      gh(["pr", "list", "--state", "open", "--limit", "60", "--json", "number,title,url,isDraft,statusCheckRollup"], dir),
      gh(["pr", "list", "--state", "merged", "--limit", "100", "--json", "number,title,mergedAt"], dir),
    ]);
    const since = Date.now() - DAY_MS;
    return {
      open: openPrs(parse(open)), merged: mergedPrs(parse(merged)).filter((p) => p.mergedAt >= since),
      ...(open === null && { error: "gh couldn't list this floor's pull requests" }),
    };
  };
  return (dir: string): Promise<Line> => {
    const hit = cache.get(dir);
    if (hit && Date.now() - hit.at < FRESH_MS) return hit.body;
    const body = read(dir);
    cache.set(dir, { at: Date.now(), body });
    return body;
  };
}
