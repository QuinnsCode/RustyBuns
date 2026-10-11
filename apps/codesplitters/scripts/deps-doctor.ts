// The dependency doctor on a checkout on disk: RustyBuns' own, weekly, from
// .github/workflows/deps-doctor.yml (#615). The same outdated() and OSV check the
// app runs on a codeSplitters repo, over the top package.json and each workspace's,
// with the doctor's defaults (up to minor, three days old; a security fix goes past both).
//
//   bun scripts/deps-doctor.ts [--root ../..] [--write] [--report report.md]
//
// --write bumps the package.json files in place (the lockfile is the caller's:
// `bun install --ignore-scripts`). --report writes a markdown summary for the PR.
// It prints one line for GitHub's output: changed=true|false, exposed=N.

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { bump, floors, npmRegistry, osvAdvisories, outdated, DEFAULTS, type Exposed, type Update, type Vuln } from "../src/deps.ts";
import { workspaceDirs, workspaceGlobs } from "../src/fit.ts";

const args = process.argv.slice(2);
const opt = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const root = resolve(opt("--root") ?? join(import.meta.dir, "../../.."));
const reportPath = opt("--report");

const read = (path: string) => JSON.parse(readFileSync(join(root, path), "utf8")) as Record<string, any>;
const top = read("package.json");
const pnpm = existsSync(join(root, "pnpm-workspace.yaml")) ? readFileSync(join(root, "pnpm-workspace.yaml"), "utf8") : null;
const list = async (dir: string) => existsSync(join(root, dir))
  ? readdirSync(join(root, dir), { withFileTypes: true }).map((e) => ({ path: dir ? `${dir}/${e.name}` : e.name, type: e.isDirectory() ? "dir" : "file" }))
  : null;
const paths = ["package.json", ...(await workspaceDirs(workspaceGlobs(top, pnpm), list)).map((d) => `${d}/package.json`).filter((p) => existsSync(join(root, p)))];
const manifests = new Map(paths.map((p) => [p, read(p)]));
// The workspace's own packages are ours, not the registry's.
const own = new Set([...manifests.values()].map((m) => m.name).filter(Boolean));

const asks = new Map([...manifests.values()].flatMap((m) => floors(m)).filter((p) => !own.has(p.name)).map((p) => [`${p.name}@${p.version}`, p]));
let note = "";
const vulns = await osvAdvisories()([...asks.values()]).catch((e: Error) => { note = `couldn't reach osv.dev (${e.message}); this run checked versions only`; return new Map<string, Vuln[]>(); });

const settings = { ...DEFAULTS, ignore: [...own] };
const updates: (Omit<Update, "status"> & { path: string })[] = [];
const exposed: Exposed[] = [];
let checked = 0;
for (const [path, pkg] of manifests) {
  const r = await outdated(pkg, settings, npmRegistry, Date.now(), vulns);
  checked += r.checked;
  updates.push(...r.updates.map((u) => ({ ...u, path })));
  exposed.push(...r.exposed.filter((x) => !own.has(x.name)).map((x) => ({ ...x, path })));
}

if (args.includes("--write")) for (const path of new Set(updates.map((u) => u.path))) {
  const text = readFileSync(join(root, path), "utf8");
  writeFileSync(join(root, path), bump(text.split("\n"), updates.filter((u) => u.path === path)).join("\n"));
}

if (reportPath) {
  const fixes = updates.filter((u) => u.fixes?.length);
  const md = [
    `The dependency doctor (apps/codesplitters/scripts/deps-doctor.ts) checked ${checked} dependencies across ${manifests.size} package.json files.`,
    ...(note ? ["", `> ${note}`] : []),
    ...(fixes.length ? ["", "### Security fixes", "", ...fixes.map((u) => `- \`${u.name}\` ${u.from} → ${u.to} in \`${u.path}\`: ${u.fixes!.join(", ")}`)] : []),
    ...(exposed.length ? ["", "### Exposed (no release fixes these yet)", "", ...exposed.map((x) => `- \`${x.name}@${x.version}\` in \`${x.path}\`: ${x.ids.join(", ")}`)] : []),
    ...(updates.length ? ["", "### Updates", "", "| package | from | to | level | in |", "|---|---|---|---|---|",
      ...updates.map((u) => `| \`${u.name}\` | ${u.from} | ${u.to} | ${u.level}${u.fixes?.length ? " (security)" : ""} | \`${u.path}\` |`)] : ["", "Everything is up to date."]),
  ].join("\n");
  writeFileSync(reportPath, md + "\n");
}

console.log(`changed=${updates.length > 0}\nexposed=${exposed.length}`);
