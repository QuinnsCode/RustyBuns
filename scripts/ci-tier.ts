// Risk tier of a change, from its file list (#2329, "Local build monster", Part 2). Cheapest test wins.
//
//   bun scripts/ci-tier.ts <base-ref>    prints the highest tier the diff touches (and whether it may stack), then each file's tier
//
// 0 docs   1 one app's source   2 packages/, lockfile, shared config   3 build tooling, CI, Docker images
// 4 secrets and deploys (a human gate)
// A tier 3 change runs alone; tiers 0 and 1 may share a run (see `stackable`). `testWaves` and `bisect` are how Mervin's
// `--stack` uses that (#5476).
export type Tier = 0 | 1 | 2 | 3 | 4;

const RULES: [Tier, RegExp][] = [
  [4, /(^|\/)(\.env(?!\.schema$|\.example$)[^/]*|\.dev\.vars[^/]*|\.alchemy\/|alchemy\.run\.ts$|wrangler\.jsonc?$|desktop-drop\.yml$|npm-publish\.yml$)/],
  [3, /(^|\/)(Dockerfile[^/]*|[^/]*\.Dockerfile|bunfig\.toml|tsconfig[^/]*\.json)$|^(\.github\/|scripts\/|\.claude\/)|\/(sandbox|deploy-sandbox)\//],
  [2, /^(packages\/|bun\.lock$|package\.json$)/],
  [0, /\.(md|mdx|txt)$|^docs\//],
  [1, /^apps\/[^/]+\//],
];

export function tierOf(file: string): Tier {
  for (const [tier, re] of RULES) if (re.test(file)) return tier;
  return 2; // unknown files could affect anything
}

export const classify = (files: string[]): Tier => files.reduce<Tier>((t, f) => Math.max(t, tierOf(f)) as Tier, 0);

// Tiers 0 and 1 ride together; 2 is already everything; 3 and 4 never stack with anything.
export const stackable = (tier: Tier) => tier <= 2;

/** Mervin's test runs for a set of PRs: every stackable one shares the first run, and each tier 3 or 4 PR gets a run of its own, so a broken dev dep is blamed on the dep. */
export function testWaves<T>(prs: T[], files: (pr: T) => string[]): T[][] {
  const shared = prs.filter((p) => stackable(classify(files(p))));
  return [...(shared.length ? [shared] : []), ...prs.filter((p) => !shared.includes(p)).map((p) => [p])];
}

/**
 * Tests a batch once; when it is red, splits it in half and tests each half, down to the PRs that fail alone, so one bad PR
 * doesn't fail the rest. A batch that is red though both halves pass breaks only together, and all of it comes back bad.
 */
export async function bisect<T>(batch: T[], green: (b: T[]) => Promise<boolean>): Promise<{ good: T[]; bad: T[]; runs: number }> {
  if (!batch.length) return { good: [], bad: [], runs: 0 };
  if (await green(batch)) return { good: batch, bad: [], runs: 1 };
  if (batch.length === 1) return { good: [], bad: batch, runs: 1 };
  const mid = Math.ceil(batch.length / 2);
  const [a, b] = [await bisect(batch.slice(0, mid), green), await bisect(batch.slice(mid), green)];
  const runs = 1 + a.runs + b.runs;
  if (!a.bad.length && !b.bad.length) return { good: [], bad: batch, runs };
  return { good: [...a.good, ...b.good], bad: [...a.bad, ...b.bad], runs };
}

const NAMES = ["docs", "one app", "shared code", "tooling", "secrets or deploys"] as const;

/** One line naming a diff's tier and whether it may share a test run, for `bun run builder <base-ref>`. */
export function tierLine(files: string[]): string {
  const t = classify(files);
  const why = t === 4 ? "a person checks it before it merges" : stackable(t) ? "may share a test run" : "runs alone, never stacked";
  return `tier ${t} (${NAMES[t]}): ${why}`;
}

if (import.meta.main) {
  const base = process.argv[2];
  if (!base) throw new Error("usage: bun scripts/ci-tier.ts <base-ref>");
  const files = (await Bun.$`git diff --name-only ${base}...HEAD`.text()).split("\n").filter(Boolean);
  console.log(tierLine(files));
  for (const f of files) console.log(`${tierOf(f)} ${f}`);
}
