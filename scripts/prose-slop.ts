// Anti-slop for prose (#5953): the tells in a PR title, PR body or commit message that the code rules in
// scripts/lint/anti-slop can't see. It only warns: preflight.ts prints what it finds in the branch's commits,
// and a PR body can be checked before `gh pr create`. Text in backticks and code fences is skipped.
//
//   bun scripts/prose-slop.ts [file ...]      check files (a PR body); none, or `-`, reads stdin
//   bun scripts/prose-slop.ts --commits [base] check every commit message in base..HEAD (default origin/main)
//
// Exits 1 when it finds something, 0 otherwise. The rules are RULES below, one row each: add or drop a row.
import { help } from "./help.ts";

export interface Rule { name: string; re: RegExp; why: string }
export interface Finding { line: number; rule: string; text: string; why: string }

const FILLER = ["comprehensive", "robust", "seamless(?:ly)?", "leverag(?:e|es|ed|ing)", "delv(?:e|es|ing)", "utiliz(?:e|es|ed|ing)",
  "streamlin(?:e|es|ed|ing)", "cutting-edge", "game-?changer", "elevat(?:e|es|ing)", "empower(?:s|ing)?", "showcas(?:e|es|ing)"];

export const RULES: Rule[] = [
  { name: "emoji", re: /\p{Extended_Pictographic}/u, why: "no emojis in PRs or commits; say it in words" },
  { name: "em-dash", re: /—/, why: "a colon, comma or full stop reads plainer than an em dash" },
  { name: "filler", re: new RegExp(`\\b(?:${FILLER.join("|")})\\b`, "i"), why: "a word that sounds good and says nothing: name what it does" },
  { name: "throat-clearing", re: /\b(?:it'?s worth noting|in conclusion|let'?s dive|in today'?s|this (?:PR|commit) (?:aims|seeks) to)\b/i, why: "cut it and start with the point" },
  { name: "manual-close", re: /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+QuinnsCode\/rustybuns-manual#\d+/i, why: "a closing word across repos closes the manual run: write \"Part of\" (AGENTS.md)" },
];

/** Lines that are ours to skip: Claude Code's attribution line carries its own emoji. */
const EXEMPT = /Generated with \[Claude Code\]/;

/** What the rules find in `text`, line by line, with code fences and backticked spans left out. */
export function proseSlop(text: string, rules = RULES): Finding[] {
  const out: Finding[] = [];
  let fence = false;
  text.split("\n").forEach((raw, i) => {
    if (/^\s*(```|~~~)/.test(raw)) { fence = !fence; return; }
    if (fence || EXEMPT.test(raw)) return;
    const line = raw.replace(/`[^`]*`/g, "");
    for (const r of rules) if (r.re.test(line)) out.push({ line: i + 1, rule: r.name, text: raw.trim().slice(0, 100), why: r.why });
  });
  return out;
}

/** One line per finding, under `label`. */
export function report(label: string, found: Finding[]): string[] {
  return found.map((f) => `  ${label}:${f.line} ${f.rule}: ${f.why}\n    ${f.text}`);
}

/** Every commit in base..HEAD as [short sha, message]. */
export function commitMessages(git: (...a: string[]) => string, base: string): [string, string][] {
  return git("log", "--format=%h%x00%B%x01", `${base}..HEAD`).split("\x01").map((c) => c.trim()).filter(Boolean)
    .map((c) => { const [sha, body = ""] = c.split("\x00"); return [sha!, body]; });
}

if (import.meta.main) {
  help(import.meta.path);
  const args = process.argv.slice(2);
  const lines: string[] = [];
  if (args[0] === "--commits") {
    const git = (...a: string[]) => Bun.spawnSync(["git", ...a]).stdout.toString();
    for (const [sha, msg] of commitMessages(git, args[1] ?? "origin/main")) lines.push(...report(sha, proseSlop(msg)));
  } else {
    const paths = args.length ? args : ["-"];
    for (const p of paths) lines.push(...report(p === "-" ? "stdin" : p, proseSlop(p === "-" ? await Bun.stdin.text() : await Bun.file(p).text())));
  }
  if (lines.length) console.log(`Prose tells (#5953):\n${lines.join("\n")}`);
  process.exit(lines.length ? 1 : 0);
}
