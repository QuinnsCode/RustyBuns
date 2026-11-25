// Lint with oxlint (Rust, the whole repo in a few seconds): its correctness rules plus five vendored
// anti-slop rules that flag casts and copies (scripts/lint/anti-slop, config in .oxlintrc.json).
// Today's findings are an allowance per file and rule in scripts/lint.allow.json; a new one fails.
//
//   bun run lint            fail if a file has more findings of a rule than the allowance says
//                           (or fewer: lower the allowance, so the count only goes down)
//   bun run lint --update   write the allowance from today's code
//   bun run lint --list     every finding, line by line
//   bun run lint <files>    just those files, every finding (what to fix before you push)
//
// Fix a finding rather than adding it to the allowance. A rule that is wrong for this repo gets
// turned off in .oxlintrc.json with a line saying why.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { arr, int, obj, opt, rec, str } from "../packages/util/src/guard.ts";
import { help } from "./help.ts";

const ALLOW = new URL("./lint.allow.json", import.meta.url).pathname;
const ROOT = new URL("..", import.meta.url).pathname;

const Report = obj({
  diagnostics: arr(obj({
    code: str(200),
    message: str(2000),
    filename: str(1000),
    labels: arr(obj({ span: obj({ line: opt(int(0, 1e7)) }) }), 100),
  }), 1e6),
});
const Allowed = rec(rec(int(0, 1e6)));

export type Finding = { file: string; rule: string; line: number; message: string };

/** oxlint's JSON report as findings: `eslint(no-eval)` becomes `no-eval`, `anti-slop(x)` stays `anti-slop/x`. */
export function findings(report: unknown): Finding[] {
  return Report(report).diagnostics.map((d) => {
    const m = /^([\w-]+)\((.+)\)$/.exec(d.code);
    const rule = !m ? d.code : m[1] === "eslint" ? m[2]! : `${m[1]}/${m[2]}`;
    return { file: d.filename.replace(/^\.\//, ""), rule, line: d.labels[0]?.span.line ?? 0, message: d.message };
  });
}

export type Allowance = Record<string, Record<string, number>>;

/** Findings counted per file, then per rule, both sorted so the allowance diffs cleanly. */
export function count(all: Finding[]): Allowance {
  const out: Allowance = {};
  for (const f of all) (out[f.file] ??= {})[f.rule] = (out[f.file]![f.rule] ?? 0) + 1;
  const sorted = (o: Record<string, number>) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)).map(([f, r]) => [f, sorted(r)]));
}

/** What breaks the allowance: a file and rule with more findings than allowed, or fewer (lower it). */
export function compare(now: Allowance, allowed: Allowance, all: Finding[]): string[] {
  const bad: string[] = [];
  for (const file of new Set([...Object.keys(now), ...Object.keys(allowed)])) {
    for (const rule of new Set([...Object.keys(now[file] ?? {}), ...Object.keys(allowed[file] ?? {})])) {
      const have = now[file]?.[rule] ?? 0, may = allowed[file]?.[rule] ?? 0;
      if (have > may) {
        const lines = all.filter((f) => f.file === file && f.rule === rule).map((f) => `    ${f.line}  ${f.message}`);
        bad.push(`${file}: ${have} × ${rule}, ${may} allowed\n${lines.join("\n")}`);
      } else if (have < may) bad.push(`${file}: ${have} × ${rule} left, ${may} allowed: run bun run lint --update, so the allowance only goes down`);
    }
  }
  return bad;
}

// Through bun, not the bin's `node` shebang: CI has no Node new enough to load the .ts plugin.
// The report goes to a file: through a pipe, oxlint exits before the end is written (cut JSON on Linux CI).
function lint(paths: string[]): Finding[] {
  const dir = mkdtempSync(join(tmpdir(), "lint-"));
  const file = join(dir, "report.json");
  const run = Bun.spawnSync([process.execPath, `${ROOT}node_modules/oxlint/bin/oxlint`, "--format=json", ...(paths.length ? paths : ["."])], { cwd: ROOT, stdout: Bun.file(file) });
  const out = readFileSync(file, "utf8");
  rmSync(dir, { recursive: true });
  if (!out.trim()) { console.error(run.stderr.toString() || "oxlint printed nothing"); process.exit(2); }
  return findings(JSON.parse(out));
}

if (import.meta.main) {
  help(import.meta.path);
  const args = process.argv.slice(2);
  const mode = args[0]?.startsWith("--") ? args[0] : null;
  const files = args.filter((a) => !a.startsWith("--"));
  const all = lint(files);
  const show = () => { for (const f of all) console.log(`${f.file}:${f.line}  ${f.rule}  ${f.message}`); };
  if (mode === "--update") {
    writeFileSync(ALLOW, JSON.stringify(count(all), null, 2) + "\n");
    console.log(`allowance written: ${all.length} findings in ${Object.keys(count(all)).length} files`);
  } else if (mode === "--list" || files.length) {
    show();
    console.log(`${all.length} finding${all.length === 1 ? "" : "s"}`);
  } else {
    const allowed = Allowed(JSON.parse(readFileSync(ALLOW, "utf8")));
    const bad = compare(count(all), allowed, all);
    if (bad.length) { console.error(bad.join("\n")); process.exit(1); }
    console.log(`lint: ${all.length} old findings allowed, none new`);
  }
}
