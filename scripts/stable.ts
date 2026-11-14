// The stable ring (notes/RELEASE_RINGS.md step 7, #4494). stable.yml runs it on Monday after deps-doctor:
// it picks the newest commit whose ring/daily run and the two dailies after it were all green (three green days),
// writes release notes from the squash titles since the last `v*` tag, and opens one `MANUAL RUN:` taste issue for
// `bun run manual` (or moves last week's open one to the new pick). The owner pushes the `v` tag and approves npm, as
// before. With no such commit yet (the daily ring, #4493, hasn't run three days in a row) it says so and exits 0.
//
//   bun scripts/stable.ts <head sha>          pick, write notes, open or update the issue
//   bun scripts/stable.ts <head sha> --dry    print the pick and the issue body; file nothing
//
// Needs GH_TOKEN, GITHUB_REPOSITORY (owner/name) and a full clone with tags (fetch-depth: 0), as in a workflow.
import { readFileSync } from "node:fs";
import { obj, str } from "../packages/util/src/guard.ts";
import { help } from "./help.ts";
import { history, type Tested } from "./rings.ts";

const green = (s?: string) => s === "SUCCESS" || s === "success";

/** The commit the stable ring takes: of the commits the daily ring ran (newest first), the newest one whose own run and
 *  the `k - 1` runs after it were all green. Undefined until the daily ring has `k` greens in a row. */
export function pickStable(history: Tested[], k = 3): string | undefined {
  const runs = history.filter((c) => c.state);
  for (let i = k - 1; i < runs.length; i++)
    if (runs.slice(i - k + 1, i + 1).every((c) => green(c.state))) return runs[i]!.sha;
  return undefined;
}

/** The next patch version: "0.1.11" -> "0.1.12". */
export function nextVersion(v: string): string {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v);
  if (!m) throw new Error(`not a plain x.y.z version: ${v}`);
  return `${m[1]}.${m[2]}.${Number(m[3]) + 1}`;
}

/** A squash title without its issue and PR numbers: in an issue body each `#N` would post a reference on that issue
 *  or PR every week. "x (Part of #4) (#5)" -> "x". The compare link above the notes reaches every PR. */
export function bare(title: string): string {
  return title.replace(/\s*\([^()]*#\d+[^()]*\)/g, "").replace(/#(\d+)/g, "$1").trim();
}

/** Release notes from squash titles (newest first): grouped by the app or area before the first ": ", the biggest
 *  group first, at most `max` lines, the rest counted. */
export function releaseNotes(titles: string[], max = 300): string {
  const groups = new Map<string, string[]>();
  for (const t of titles.slice(0, max).map(bare)) {
    const m = /^([\w .@/-]{1,30}?): (.+)$/.exec(t);
    const [area, line] = m ? [m[1]!, m[2]!] : ["Other", t];
    groups.set(area, [...groups.get(area) ?? [], line]);
  }
  const sorted = [...groups].sort(([a, x], [b, y]) => (a === "Other" ? 1 : b === "Other" ? -1 : y.length - x.length || a.localeCompare(b)));
  const out = sorted.map(([area, lines]) => `**${area}**\n${lines.map((l) => `- ${l}`).join("\n")}`).join("\n\n");
  const more = titles.length - Math.min(titles.length, max);
  return (out || "No commits since the last tag.") + (more ? `\n\nAnd ${more} more (see the compare link).` : "");
}

/** The MANUAL RUN taste issue's body. */
export function issueBody(o: { repo: string; sha: string; tag?: string; version: string; next: string; titles: string[] }): string {
  const short = o.sha.slice(0, 7);
  const since = o.tag ? `since ${o.tag}` : "so far";
  const compare = o.tag ? `https://github.com/${o.repo}/compare/${o.tag}...${o.sha}` : `https://github.com/${o.repo}/commits/${o.sha}`;
  return `**Time:** about 20 minutes. **Steps:**

1. In your checkout: \`git fetch && git switch --detach ${o.sha}\`, then \`bun run manual\` and walk the apps you care about this week.
2. If it tastes right: bump the packages ${o.version} -> ${o.next} in a PR (\`packages/*/package.json\`, \`bun install\`, the README banner; \`bun scripts/check-release.ts\` checks them), merge it, push the tag \`v${o.next}\` on that commit, and approve the \`npm\` environment as before. The bump lands on top of main, so ${short}...the bump commit is what ships past the soak.
3. Answer Yes in the \`bun run manual\` window (comments and closes this). No leaves it open; next Monday's pick moves it.

Picked by the stable ring (\`.github/workflows/stable.yml\`, \`scripts/stable.ts\`): ${short} is the newest commit whose daily run and the two dailies after it were all green. Plan: notes/RELEASE_RINGS.md.

## Release notes: ${o.titles.length} squash commit${o.titles.length === 1 ? "" : "s"} ${since}

${compare}

${releaseNotes(o.titles)}
`;
}

const TITLE = "MANUAL RUN: stable ring taste walk";

if (import.meta.main) {
  help(import.meta.path);
  const [head = "", ...flags] = process.argv.slice(2);
  const dry = flags.includes("--dry");
  const repo = process.env.GITHUB_REPOSITORY ?? "";
  if (!/^[0-9a-f]{40}$/.test(head) || !/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    console.error("usage: bun scripts/stable.ts <40-char head sha> [--dry] (with GITHUB_REPOSITORY set); --help");
    process.exit(2);
  }
  // Main takes a few hundred squash commits a day, so look back far enough to see a week of dailies.
  const sha = pickStable(await history(repo, "daily", head, 3000));
  if (!sha) {
    console.log("No commit with three green daily runs in a row yet (the daily ring is #4493): nothing to pick this week.");
    process.exit(0);
  }
  const tag = (await Bun.$`git describe --tags --abbrev=0 --match ${"v*"} ${sha}`.quiet().nothrow().text()).trim() || undefined;
  const titles = (await Bun.$`git log --first-parent --format=%s ${tag ? `${tag}..${sha}` : sha}`.quiet().text()).split("\n").filter(Boolean);
  const version = obj({ version: str(40) })(JSON.parse(readFileSync("packages/cli/package.json", "utf8"))).version;
  const title = `${TITLE}, ${sha.slice(0, 7)} (${new Date().toISOString().slice(0, 10)})`;
  const body = issueBody({ repo, sha, tag, version, next: nextVersion(version), titles });
  if (dry) {
    console.log(`${title}\n\n${body}`);
    process.exit(0);
  }
  const open = (await Bun.$`gh issue list --repo ${repo} --label ${"manual run"} --state open --search ${`"${TITLE}" in:title`} --json number -q .[0].number`.quiet().text()).trim();
  const file = `${process.env.RUNNER_TEMP ?? "."}/stable-body.md`;
  await Bun.write(file, body);
  if (open) {
    await Bun.$`gh issue edit ${open} --repo ${repo} --title ${title} --body-file ${file}`.quiet();
    await Bun.$`gh issue comment ${open} --repo ${repo} --body ${`Moved to this week's pick, ${sha.slice(0, 7)}.`}`.quiet();
    console.log(`#${open} moved to ${sha.slice(0, 7)}`);
  } else {
    await Bun.$`gh label create ${"manual run"} --repo ${repo} --color FBCA04`.quiet().nothrow();
    console.log((await Bun.$`gh issue create --repo ${repo} --label ${"manual run"} --title ${title} --body-file ${file}`.quiet().text()).trim());
  }
}
