// Unchecked values at a boundary: JSON from a request, a fetch reply or a stored string is
// `unknown` until something looks at it. A cast (`as { owner: string }`), `any` or `never` skips
// the look, so the type claims a shape nothing checked. This finds those lines.
//
//   bun scripts/boundary-audit.ts            fail if any file has more than scripts/boundary-audit.allow.json says
//                                            (or fewer: lower the allowance, so the count only goes down)
//   bun scripts/boundary-audit.ts --update   write the allowance from today's code
//   bun scripts/boundary-audit.ts --list     every finding, line by line
//
// Safe, so not found: `as { ops?: unknown }` (every field optional and `unknown`, narrowed before use),
// `readBody`, `parseJson`. Fix a finding by narrowing the value, not by adding it to the allowance.
import { readFileSync, writeFileSync } from "node:fs";

const ALLOW = new URL("./boundary-audit.allow.json", import.meta.url).pathname;
// A parse that consumes: `x.json()` (never `Response.json(body)`, which builds one) or `JSON.parse(…)`.
const SOURCE = /(?<!Response)\.json\(\)|JSON\.parse\(/;

/** Where the parse call ends: past `()` for `.json()`, past the matching `)` for `JSON.parse(`. */
function afterParse(line: string): number {
  const m = SOURCE.exec(line);
  if (!m) return -1;
  let i = m.index + m[0].length;
  if (!m[0].endsWith("(")) return i;
  for (let depth = 1; i < line.length; i++) {
    if (line[i] === "(") depth++;
    else if (line[i] === ")" && --depth === 0) return i + 1;
  }
  return line.length;
}

/** The type text after the first ` as ` that follows the parse: `{ a: string }` through its closing brace, or one word. */
function asserted(line: string): string | null {
  const parse = afterParse(line);
  const at = parse < 0 ? -1 : line.indexOf(" as ", parse);
  if (at < 0) return null;
  const rest = line.slice(at + 4).trimStart();
  if (!rest.startsWith("{")) return /^[\w.]+(<[^>]*>)?(\[\])?/.exec(rest)?.[0] ?? null;
  let depth = 0;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "{") depth++;
    else if (rest[i] === "}" && --depth === 0) return rest.slice(0, i + 1);
  }
  return rest;
}

/** A type that promises nothing: `unknown`, or an object whose every member is optional and `unknown`. */
function promisesNothing(type: string): boolean {
  if (type === "unknown") return true;
  if (/^Body<.*>$/.test(type)) return true;
  if (!type.startsWith("{")) return false;
  const members = type.slice(1, -1).split(/[;,]/).map((m) => m.trim()).filter(Boolean);
  // An index signature or a nested type is more than one `unknown`: not safe by this check.
  return members.length > 0 && members.every((m) => /^[\w"-]+\?: unknown$/.test(m));
}

/** Findings in one file's text: [line number, why, the line]. */
export function findings(text: string): [number, string, string][] {
  const out: [number, string, string][] = [];
  text.split("\n").forEach((raw, i) => {
    const line = raw.replace(/\/\/.*$/, "");
    const hit = (why: string) => out.push([i + 1, why, raw.trim().slice(0, 140)]);
    if (/\bas never\b/.test(line)) return hit("`as never` turns the check off");
    if (!SOURCE.test(line)) return;
    if (/: any\b|<any>/.test(line) || /\bas any\b/.test(line.slice(afterParse(line)))) return hit("`any` after a parse");
    const type = asserted(line);
    if (type && !promisesNothing(type)) return hit(`parsed value asserted as ${type.length > 50 ? type.slice(0, 50) + "…" : type}`);
    // `const x = await y.json();` with no annotation is `any`.
    if (/\b(const|let)\s+[\w{}, ]+\s*=\s*(await\s+)?[\w.()]+\.json\(\)\s*;?\s*$/.test(line) && !/:\s*[\w{]/.test(line.split("=")[0]!)) return hit("`.json()` kept as `any`");
  });
  return out;
}

const SKIP = /(^|\/)(tests?|node_modules|dist)\/|\.test\.tsx?$|\.d\.ts$/;

function scan(): Map<string, [number, string, string][]> {
  const files = Bun.spawnSync(["git", "ls-files", "*.ts", "*.tsx"]).stdout.toString().split("\n").filter((f) => f && !SKIP.test(f) && f !== "scripts/boundary-audit.ts");
  const all = new Map<string, [number, string, string][]>();
  for (const f of files) {
    let found: [number, string, string][];
    try { found = findings(readFileSync(f, "utf8")); } catch { continue; }
    if (found.length) all.set(f, found);
  }
  return all;
}

if (import.meta.main) {
  const mode = process.argv[2];
  const now = scan();
  const counts = Object.fromEntries([...now].map(([f, l]) => [f, l.length]).sort(([a], [b]) => String(a).localeCompare(String(b))));
  if (mode === "--update") {
    writeFileSync(ALLOW, JSON.stringify(counts, null, 2) + "\n");
    console.log(`allowance written: ${Object.values(counts).reduce((a, b) => a + b, 0)} findings in ${Object.keys(counts).length} files`);
  } else if (mode === "--list") {
    for (const [f, l] of now) for (const [n, why, text] of l) console.log(`${f}:${n}  ${why}\n    ${text}`);
  } else {
    const allowed: Record<string, number> = JSON.parse(readFileSync(ALLOW, "utf8"));
    const bad: string[] = [];
    for (const f of new Set([...Object.keys(counts), ...Object.keys(allowed)])) {
      const have = counts[f] ?? 0, may = allowed[f] ?? 0;
      if (have > may) bad.push(`${f}: ${have} unchecked boundary value${have === 1 ? "" : "s"}, ${may} allowed\n` + now.get(f)!.map(([n, why, t]) => `    ${n}  ${why}\n        ${t}`).join("\n") + "\n  Narrow the value (readBody, parseJson, or check each field) instead of casting it.");
      else if (have < may) bad.push(`${f}: ${have} left, ${may} allowed: run bun scripts/boundary-audit.ts --update, so the allowance only goes down`);
    }
    if (bad.length) { console.error(bad.join("\n")); process.exit(1); }
    console.log(`boundary audit: ${Object.values(counts).reduce((a, b) => a + b, 0)} unchecked values, none new`);
  }
}
