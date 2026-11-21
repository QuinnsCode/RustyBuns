// An app as a brief, for an agent about to work in it: `bun run brief <app>` prints what the app is (its README's
// lede), how a person uses it (its "## Play it" or "## Use it" section: the answer to "how do I use this?"), the sections its README has, the other notes in its folder with their first lines, its license note, the
// scripts in its package.json, its tests, its default port, and the page handle `bun run probe` reads. All of it is
// read from the app's own files, so it can't go stale the way a hand-written skill per app would. With no app, it
// lists every app and its one-line lede. `--full` prints the probe handle in full.
//
//   bun run brief                       every app, one line each
//   bun run brief skate-tech-park       one app's brief
//   bun run brief fm-daw --full
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { help } from "./help.ts";
import { HANDLES } from "./probe.ts";
import { PORTS } from "../packages/util/src/ports.ts";
import { isRecord } from "../packages/util/src/guard.ts";

const ROOT = path.join(import.meta.dir, "..");
const read = (f: string) => (existsSync(f) ? readFileSync(f, "utf8") : "");
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** The README's first paragraph of prose: past the title, badges, html and quote boxes' markup. */
export function lede(md: string): string {
  const paras = md.replace(/<[^>]+>/g, "").split(/\n\s*\n/).map((p) => p.trim());
  for (const p of paras) {
    if (!p || p.startsWith("#") || p.startsWith("![") || p.startsWith("```") || p.startsWith("|")) continue;
    const text = p.replace(/^>\s?/gm, "").replace(/\*\*/g, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/\s+/g, " ").trim();
    if (text.length > 20) return text;
  }
  return "";
}

/** The README's "## Play it" (a game) or "## Use it" (a tool) section: what a person asking "how do I use this?" needs,
 *  in plain words (what it is, the link, how to play, controls, account). Empty when the README has neither. */
export function playIt(md: string): string {
  const m = md.match(/^##\s+(Play it|Use it)\s*$([\s\S]*?)(?=^##\s|(?![\s\S]))/m);
  if (!m) return "";
  // It ends at its **Account:** line (always last); what follows under the same heading is the README's own prose.
  const body = m[2]!.trim(), account = body.search(/^\*\*Account:\*\*/m);
  const after = account < 0 ? -1 : body.indexOf("\n\n", account);
  return `${m[1]}:\n${after < 0 ? body : body.slice(0, after)}`;
}

/** The first line of a notes file worth showing: its title, else its first prose. */
const firstLine = (md: string) => (md.match(/^#\s+(.+)$/m)?.[1] ?? lede(md)).trim();

const camel = (dir: string) => dir.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());

function testFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    if (!existsSync(d)) return;
    for (const f of readdirSync(d)) {
      if (f === "node_modules" || f.startsWith(".")) continue;
      const p = path.join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.test\.tsx?$/.test(f)) out.push(path.relative(dir, p));
    }
  };
  walk(path.join(dir, "test"));
  walk(path.join(dir, "src"));
  return out.sort();
}

export function brief(app: string, root = ROOT, full = false): string {
  const dir = path.join(root, "apps", app);
  if (!existsSync(dir)) throw new Error(`no apps/${app}: \`bun run brief\` lists them`);
  const readme = read(path.join(dir, "README.md"));
  const lines = [`# ${app}`, "", lede(readme) || "(no README lede)", "",
    playIt(readme) || "(no \"## Play it\" or \"## Use it\" in its README: someone asking how to use it gets the build notes; add one)"];
  const sections = [...readme.matchAll(/^##\s+(.+)$/gm)].map((m) => m[1]!.trim());
  if (sections.length) lines.push("", `README sections: ${sections.join(" · ")}`);

  const notes = readdirSync(dir).filter((f) => f.endsWith(".md") && !["README.md", "CLAUDE.md", "AGENTS.md"].includes(f));
  const agents = read(path.join(dir, "AGENTS.md"));
  if (agents) notes.unshift("AGENTS.md");
  if (notes.length) {
    lines.push("", "Notes:");
    for (const f of notes) lines.push(`- apps/${app}/${f}: ${cut(firstLine(read(path.join(dir, f))), 110)}`);
  }
  if (/License|PolyForm|QNTBR/i.test(agents)) lines.push("", "License: not the repo's Apache-2.0; read its AGENTS.md before copying code out.");

  const pkg: unknown = JSON.parse(read(path.join(dir, "package.json")) || "{}");
  const scripts = isRecord(pkg) && isRecord(pkg.scripts) ? Object.keys(pkg.scripts) : [];
  if (scripts.length) lines.push("", `Scripts (bun run …, in apps/${app}): ${scripts.join(", ")}`);

  const tests = testFiles(dir);
  if (tests.length) {
    lines.push("", `Tests (${tests.length}): ${tests.slice(0, 12).join(", ")}${tests.length > 12 ? ", …" : ""}`,
      `Run one: cd apps/${app} && bun test ${tests[0]}`);
  }
  const port = Object.entries(PORTS).find(([k]) => k === camel(app))?.[1];
  if (port) lines.push("", `Port: ${port} (PORTS.${camel(app)} in @rustybuns/util/ports)`);
  const handle = HANDLES[app];
  if (handle) lines.push("", `Page handle: bun run probe ${app} (reads ${handle.state})`, full ? handle.does : cut(handle.does, 400));
  return lines.join("\n");
}

export function index(root = ROOT): string {
  return readdirSync(path.join(root, "apps"))
    .filter((a) => existsSync(path.join(root, "apps", a, "package.json")))
    .sort()
    .map((a) => `${a.padEnd(24)} ${cut(lede(read(path.join(root, "apps", a, "README.md"))), 96)}`)
    .join("\n");
}

if (import.meta.main) {
  help(import.meta.path);
  const args = process.argv.slice(2);
  const app = args.find((a) => !a.startsWith("--"));
  try {
    console.log(app ? brief(app, ROOT, args.includes("--full")) : index());
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
}
