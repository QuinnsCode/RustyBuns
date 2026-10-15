// Risk tier of a change, from its file list (notes/local-build-monster.md, Part 2). Cheapest test wins.
//
//   bun scripts/ci-tier.ts <base-ref>    prints the highest tier the diff touches, then each file's tier
//
// 0 docs   1 one app's source   2 packages/, lockfile, shared config   3 build tooling, CI, Docker images
// 4 secrets and deploys (a human gate)
// A tier 3 change runs alone; tiers 0 and 1 may share a run (see `stackable`).
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

if (import.meta.main) {
  const base = process.argv[2];
  if (!base) throw new Error("usage: bun scripts/ci-tier.ts <base-ref>");
  const files = (await Bun.$`git diff --name-only ${base}...HEAD`.text()).split("\n").filter(Boolean);
  console.log(`tier=${classify(files)}`);
  for (const f of files) console.log(`${tierOf(f)} ${f}`);
}
