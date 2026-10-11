// Keeps the root docs honest. `bun run docs` heals what it can in place; `bun run docs --check`
// (typecheck.yml runs it) fails when anything is stale, so a PR that adds an app or moves a file
// can't leave the README behind. What it owns:
//   - the README banner's version ("Alpha, `x.y.z`"), from packages/cli
//   - the "See it work" table: a row per apps/* dir, in place. Hand-written rows are kept as they
//     are; a missing app gets a row from its own README's first paragraph, a deleted one loses its row
//   - every relative link in the root *.md files must point at a file that exists (reported, not fixed)
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const check = process.argv.includes("--check");
const problems: string[] = [];
const healed: string[] = [];

let readme = readFileSync("README.md", "utf8");
const before = readme;

// Banner version.
const version = JSON.parse(readFileSync("packages/cli/package.json", "utf8")).version as string;
readme = readme.replace(/Alpha, `([^`]+)`/, (m, v) => {
  if (v === version) return m;
  healed.push(`README banner ${v} -> ${version}`);
  return `Alpha, \`${version}\``;
});

// Examples table: the one whose header is "| Example |".
const apps = readdirSync("apps", { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join("apps", d.name, "package.json")))
  .map((d) => d.name);
const lines = readme.split("\n");
const head = lines.findIndex((l) => l.startsWith("| Example |"));
if (head < 0) problems.push("README.md: no `| Example |` table found");
else {
  let end = head + 2;
  while (end < lines.length && lines[end]!.startsWith("|")) end++;
  const rowApp = (row: string) => row.match(/\]\(apps\/([^/)]+)\//)?.[1];
  const rows = lines.slice(head + 2, end).filter((row) => {
    const app = rowApp(row);
    if (app && apps.includes(app)) return true;
    healed.push(`dropped the README row for ${app ?? row.slice(0, 40)}, no such app`);
    return false;
  });
  const listed = new Set(rows.map(rowApp));
  for (const app of apps.filter((a) => !listed.has(a))) {
    rows.push(`| [${app}](apps/${app}/README.md) | ${blurb(app)} |`);
    healed.push(`added a README row for apps/${app}`);
  }
  lines.splice(head + 2, end - head - 2, ...rows);
  readme = lines.join("\n");
}

// First prose paragraph of an app's README, links flattened, as a stand-in until someone writes a row.
function blurb(app: string): string {
  const path = join("apps", app, "README.md");
  if (!existsSync(path)) return "TODO: say what this one proves";
  const para = readFileSync(path, "utf8").split(/\n\s*\n/).find((p) => /^[A-Za-z]/.test(p.trim())) ?? "";
  const text = para.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/\s+/g, " ").trim();
  return (text.match(/^.*?[.!?](\s|$)/)?.[0] ?? text).trim().replace(/\|/g, "\\|") || "TODO: say what this one proves";
}

// Features: every `###` under "## Features" is a one-line short explanation, then the long one in a
// <details> block, so the README reads as a list and expands where you want more.
const features = readme.match(/\n## Features\n([\s\S]*?)\n## /)?.[1];
if (!features) problems.push("README.md: no `## Features` section");
else
  for (const [, title, body] of features.matchAll(/\n### (.+)\n([\s\S]*?)(?=\n### |$)/g)) {
    const [short, ...rest] = body!.trim().split(/\n\s*\n/);
    if (!short || short.startsWith("<")) problems.push(`README.md feature "${title}": needs a one-line short explanation`);
    if (!/^<details><summary>/.test(rest[0] ?? "") || !body!.trim().endsWith("</details>"))
      problems.push(`README.md feature "${title}": put the long explanation in <details><summary>More</summary> ... </details>`);
  }

// Relative links (and their #anchors) in the root docs.
const docs = readdirSync(".").filter((f) => f.endsWith(".md")).concat(existsSync("notes/ROADMAP.md") ? ["notes/ROADMAP.md"] : []);
const textOf = (doc: string) => (doc === "README.md" ? readme : readFileSync(doc, "utf8"));
// GitHub's heading ids: lowercase, punctuation dropped, spaces to hyphens.
const anchors = (doc: string) =>
  new Set(
    [...textOf(doc).replace(/```[\s\S]*?```/g, "").matchAll(/^#+ (.+)$/gm)].map(([, h]) =>
      h!.toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, "").replace(/ /g, "-"),
    ),
  );
for (const doc of docs) {
  const prose = textOf(doc).replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
  for (const [, target] of prose.matchAll(/\]\(([^)\s]+)\)/g)) {
    if (/^[a-z]+:/.test(target!)) continue;
    const [path, hash] = target!.split("#");
    const file = path ? join(dirname(doc), decodeURI(path)) : doc;
    if (!existsSync(file)) problems.push(`${doc}: broken link to ${path}`);
    else if (hash && file.endsWith(".md") && !anchors(file).has(hash)) problems.push(`${doc}: no heading #${hash} in ${file}`);
  }
}

if (readme !== before) {
  if (check) problems.push(...healed.map((h) => `README.md is stale: ${h}`));
  else writeFileSync("README.md", readme);
}
if (!check) for (const h of healed) console.log(`healed: ${h}`);
if (problems.length) {
  console.error(`docs check failed${check ? " (run `bun run docs` to heal what it can, then commit)" : ""}:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log(check ? "docs ok" : healed.length ? "docs healed" : "docs already up to date");
