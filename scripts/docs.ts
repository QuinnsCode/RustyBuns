// Keeps the root docs honest. `bun run docs` heals what it can in place; `bun run docs --check`
// (typecheck.yml runs it) fails when anything is stale, so a PR that adds an app or moves a file
// can't leave the README behind. What it owns:
//   - the README banner's version ("Alpha, `x.y.z`"), from packages/cli
//   - the "See it work" gallery (scripts/readme-apps.ts): an entry per apps/* dir in docs/readme/apps.json,
//     a missing app gets one from its own README's first paragraph, a deleted one loses its entry, and each
//     group is in eqosys's order (APPS in apps/eqosys/src/apps.ts)
//   - every relative link in the root *.md files must point at a file that exists (reported, not fixed)
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { APPS, HOME } from "../apps/eqosys/src/apps.ts";
import { DATA, END, inOrder, readGroups, render, plays, START } from "./readme-apps.ts";

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

// The app gallery: every apps/* dir in docs/readme/apps.json, written between the markers. A new app
// goes on top of the last group, "Everything else", until someone moves it to its section; a deleted
// one is dropped. The JSON is healed too, so the gallery and the data never disagree.
const apps = readdirSync("apps", { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join("apps", d.name, "package.json")))
  .map((d) => d.name);
const groups = readGroups();
const dataBefore = JSON.stringify(groups);
for (const g of groups)
  g.apps = g.apps.filter((e) => {
    if (apps.includes(e.app)) return true;
    healed.push(`dropped ${e.app} from the gallery, no such app`);
    return false;
  });
const listed = new Set(groups.flatMap((g) => g.apps.map((e) => e.app)));
for (const app of apps.filter((a) => !listed.has(a))) {
  groups.at(-1)!.apps.unshift({ app, name: app, line: blurb(app) });
  healed.push(`added apps/${app} to the gallery's last group`);
}
// Each group lists its apps the way eqosys does (its APPS), so the README and the eqosys home never disagree on who comes first.
// eqosys isn't in its own list, so it leads.
const ordered = inOrder(groups, [HOME, ...APPS.map((a) => a.id)]);
if (JSON.stringify(ordered) !== JSON.stringify(groups)) healed.push("put the gallery in eqosys's order (apps/eqosys/src/apps.ts)");
groups.splice(0, groups.length, ...ordered);
for (const e of groups.flatMap((g) => g.apps))
  if (!existsSync(e.doc ?? `apps/${e.app}/README.md`)) problems.push(`${DATA}: ${e.app} has no ${e.doc ?? "README.md"}`);
const dataChanged = JSON.stringify(groups) !== dataBefore;
const from = readme.indexOf(START), to = readme.indexOf(END);
if (from < 0 || to < from) problems.push(`README.md: no gallery markers (${START} ... ${END})`);
else readme = readme.slice(0, from) + render(groups, plays()) + readme.slice(to + END.length);
if (readme !== before && !healed.length) healed.push("the gallery is out of step with docs/readme/apps.json");

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

if (readme !== before || dataChanged) {
  if (check) problems.push(...healed.map((h) => `README.md is stale: ${h}`));
  else {
    writeFileSync("README.md", readme);
    if (dataChanged) writeFileSync(DATA, JSON.stringify(groups, null, 2) + "\n");
  }
}
if (!check) for (const h of healed) console.log(`healed: ${h}`);
if (problems.length) {
  console.error(`docs check failed${check ? " (run `bun run docs` to heal what it can, then commit)" : ""}:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log(check ? "docs ok" : healed.length ? "docs healed" : "docs already up to date");
