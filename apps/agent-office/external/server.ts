// An orange `external` label on the issues and PRs of people who aren't on the repo's team, so a comment from
// outside (a stranger, a competition judge) can't pass for the team's own, and the board's label filter can hide
// them all in one click. The team is the repo's collaborators (owner, members, outside collaborators), asked of
// GitHub once and again every ten minutes; until that answers, or if it can't (no push access), nothing is flagged.
import { execFile } from "node:child_process";

export const EXTERNAL = { name: "external", color: "#f38020" };

type Label = { name: string; color: string };

/** `labels` with `external` added when `login` isn't on the team. A team that isn't known flags nobody. */
export function mark(labels: Label[], login: string | undefined, team: Set<string> | undefined): Label[] {
  if (!team || !login || team.has(login.toLowerCase()) || labels.some((l) => l.name === EXTERNAL.name)) return labels;
  return [EXTERNAL, ...labels];
}

const gh = (dir: string) => new Promise<string>((resolve, reject) =>
  execFile("gh", ["api", "--paginate", "repos/{owner}/{repo}/collaborators", "--jq", ".[].login"],
    { cwd: dir, timeout: 20_000, maxBuffer: 1 << 20 }, (err, out) => err ? reject(err) : resolve(out)));

const TTL = 10 * 60_000;
const teams = new Map<string, { team?: Set<string>; at: number }>();

/** The labels with `external` on them if the author is outside the team of the repo at `dir`. */
export function external(labels: Label[], login: string | undefined, dir: string, ask: (dir: string) => Promise<string> = gh): Label[] {
  let t = teams.get(dir);
  if (!t || Date.now() - t.at > TTL) {
    const next = { team: t?.team, at: Date.now() };
    teams.set(dir, next);
    ask(dir).then((out) => { next.team = new Set(out.split("\n").map((l) => l.trim().toLowerCase()).filter(Boolean)); }, () => {});
    t = next;
  }
  return mark(labels, login, t.team);
}
