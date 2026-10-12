// What a snapshot knows about a repo beyond its files' sizes, worked out the same way
// from a checkout (scripts/snapshot.ts) or from GitHub at play time (src/levels/github.ts):
//   - which folders import which: the roads between compounds
//   - how often each file changed lately, and how much of that agents did
//   - which checks are failing: the compounds on fire (codemap.ts's checkHits says which)

import { folderOf, type RepoFile } from "./codemap.ts";

/** Source-ish text worth a building, what's left out (vendored, built, generated), and how many of the biggest a snapshot keeps. */
export const SOURCE = /\.(ts|tsx|js|jsx|mjs|rs|go|py|rb|swift|kt|java|c|h|cc|cpp|css|html|md|toml|ya?ml|sh)$/;
export const SKIP = /(^|\/)(node_modules|dist|vendor|fixtures?|\.github)\/|\.min\.|lock/;
export const MAX_FILES = 360;

/** A commit an agent made, or helped make: its trailer or its author says so. */
const AGENT_TRAILER = /co-authored-by:[^\n]*\b(claude|copilot|codex|cursor|devin|aider|gemini|jules|agent)\b|generated with \[?claude code/i;
const AGENT_AUTHOR = /\b(claude|copilot|codex|devin|agent)\b|\[bot\]$/i;
export const isAgentCommit = (message: string, author = "") => AGENT_TRAILER.test(message) || AGENT_AUTHOR.test(author);

/** The modules a JS or TS file imports: relative ones ("./x", "../y/z") and packages ("@scope/pkg/sub", "pkg"). */
export function importsOf(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["']([^"'\s]+)["']/g)) out.add(m[1]!);
  return [...out];
}

/** Where a relative import from `from` points, as a repo path, or null for one that climbs out of the repo. */
export function resolveImport(from: string, spec: string): string | null {
  const parts = from.split("/").slice(0, -1);
  for (const p of spec.split("/")) {
    if (p === "..") { if (!parts.length) return null; parts.pop(); }
    else if (p !== "." && p) parts.push(p);
  }
  return parts.join("/");
}

/** A package import's package name: "@scope/pkg" or "pkg". */
export const packageOf = (spec: string) => spec.split("/").slice(0, spec.startsWith("@") ? 2 : 1).join("/");

export const isScript = (path: string) => /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/.test(path);

/**
 * Imports that cross from one folder into another, counted once per importing file: [a, b, files] with a before b.
 * `packages` maps a workspace package's name to its folder, so "@acme/core" from apps/web reaches packages/core;
 * only folders the repo has (in `folders`) count.
 */
export function folderLinks(sources: { path: string; text: string }[], packages: Map<string, string>, folders: Set<string>): [string, string, number][] {
  const n = new Map<string, number>();
  for (const { path, text } of sources) {
    const from = folderOf(path), seen = new Set<string>();
    for (const spec of importsOf(text)) {
      const to = spec.startsWith(".") ? resolveImport(path, spec) : null;
      const f = to !== null ? folderOf(to) : packages.get(packageOf(spec));
      if (f === undefined || f === from || seen.has(f) || !folders.has(f)) continue;
      seen.add(f);
      const key = [from, f].sort().join("\0");
      n.set(key, (n.get(key) ?? 0) + 1);
    }
  }
  return [...n.entries()]
    .map(([k, c]) => [...k.split("\0"), c] as [string, string, number])
    .sort((a, b) => b[2] - a[2] || a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
}

/** A workspace's packages: each package.json's name, to the folder it sits in. The root one is left out. */
export function workspacePackages(manifests: { path: string; text: string }[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const { path, text } of manifests) {
    if (!path.includes("/")) continue;
    try {
      const name = (JSON.parse(text) as { name?: unknown }).name;
      if (typeof name === "string" && name) out.set(name, folderOf(path));
    } catch {}
  }
  return out;
}

/** Tally commits onto files: how many touched each lately (churn), and what share of those were agents' (agent). */
export function tally(files: RepoFile[], commits: { agent: boolean; paths: string[] }[]): RepoFile[] {
  const touched = new Map<string, { n: number; agent: number }>();
  for (const c of commits) for (const p of new Set(c.paths)) {
    const t = touched.get(p) ?? { n: 0, agent: 0 };
    t.n++;
    if (c.agent) t.agent++;
    touched.set(p, t);
  }
  return files.map((f) => {
    const t = touched.get(f.path);
    return t ? { ...f, churn: t.n, agent: Math.round((t.agent / t.n) * 100) / 100 } : f;
  });
}
