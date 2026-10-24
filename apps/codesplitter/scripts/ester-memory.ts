// Ester's memory: every test gets an id, and she keeps what happened to it across runs, so a failure is more than a
// red line that scrolls by. A test that fails is an open incident until someone says what it was:
//
//   fix     a real failure, fixed by a PR (the incident report is that PR)
//   stale   the test was no longer valid: the PR rewrote or removed it, the code was right
//   flaky   passed when only the failing run was repeated (Ester records these herself)
//
// From those she answers two questions nobody can answer from one run: where do failures land, and which tests
// have never failed in many runs and aren't a journey through the app (candidates to cut). Each is one line a
// person or agent reads before writing the next test.
//
// The ledger is JSONL (`.mervin/ester-memory.jsonl`): a `test` line the first time a test is seen (and again when
// its file or hotness changes), a `run` line per test run with the ids that passed, failed and skipped, and a
// `verdict` line per resolution. Runs come from bun's JUnit reporter, the one output that names passes too.
//
//   bun scripts/ester-memory.ts remember <junit.xml> [--dir apps/x] [--label "board abc1234"] [--root <tree>]
//   bun scripts/ester-memory.ts resolve <id | "apps/x: suite > name"> --pr <n> [--stale] [--note "..."]
//   bun scripts/ester-memory.ts recall [--min 5] [--top 10]
//
// Pure over the text of a JUnit file and the ledger's lines, so it is tested without running a suite.

import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { isPlainObject } from "../src/util.ts";
import type { Run } from "./shadow.ts";

export type Status = "pass" | "fail" | "skip";
export type Kind = "fix" | "stale" | "flaky";

/** One test as a run saw it. `name` is bun's console name (`suite > inner > test`), `dir` the app it ran in. */
export interface Seen { id: string; dir: string; file: string; name: string; status: Status; ms: number }

interface TestLine { t: "test"; id: string; dir: string; file: string; name: string; hot: boolean }
interface RunLine { t: "run"; at: string; label: string; dir: string; pass: string[]; fail: string[]; skip: string[] }
interface VerdictLine { t: "verdict"; at: string; id: string; kind: Kind; pr?: number; note?: string }
type Line = TestLine | RunLine | VerdictLine;

/** A test's id: ten hex chars of `dir: name`, the same key Ester's verdicts use, so a `(fail)` line finds its memory. */
export const idOf = (dir: string, name: string) => `t${createHash("sha1").update(`${dir}: ${name}`).digest("hex").slice(0, 10)}`;

/** A test is hot when its file is a journey through the running app (`local()` from the app kit), which AGENTS.md keeps by default. */
export const hot = (fileText: string) => /app-kit|\blocal\(/.test(fileText);

const unescape = (s: string) => s.replace(/&(quot|apos|amp|lt|gt|#(\d+));/g, (_, k: string, n?: string) =>
  n ? String.fromCharCode(Number(n)) : ({ quot: '"', apos: "'", amp: "&", lt: "<", gt: ">" })[k]!);

const attrs = (s: string) => Object.fromEntries([...s.matchAll(/(\w+)="([^"]*)"/g)].map((m) => [m[1]!, unescape(m[2]!)]));

/**
 * The tests in a bun JUnit report (`--reporter=junit --reporter-outfile=...`), as run in `dir`. bun writes nested
 * describes into `classname` innermost first (`in > o` for `describe("o", describe("in", ...))`), so it is reversed
 * to match the console's `o > in > deep`.
 */
export function fromJunit(xml: string, dir: string): Seen[] {
  const out: Seen[] = [];
  for (const m of xml.matchAll(/<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g)) {
    const a = attrs(m[1]!), body = m[2] ?? "";
    const suites = (a.classname ?? "").split(" > ").filter(Boolean).reverse();
    const name = [...suites, a.name ?? ""].join(" > ");
    const status: Status = /<failure\b|<error\b/.test(body) ? "fail" : /<skipped\b/.test(body) ? "skip" : "pass";
    out.push({ id: idOf(dir, name), dir, file: a.file ?? "", name, status, ms: Math.round(Number(a.time ?? 0) * 1000) });
  }
  return out;
}

/** The same run, also writing its JUnit report to `<outDir>/<dir>.xml` (shadow.ts's `sh` adds the flags); a run that isn't `bun test` is left alone. */
export function withJunit(run: Run, outDir: string): Run {
  if (!/^bun test\b/.test(run.cmd)) return run;
  return { ...run, junit: join(outDir, `${run.dir.replace(/[^\w]+/g, "-").replace(/^-|-$/g, "") || "root"}.xml`) };
}

const isStr = (v: unknown): v is string => typeof v === "string";
const strs = (v: unknown): v is string[] => Array.isArray(v) && v.every(isStr);

/** One ledger line, each field checked; null for a torn or foreign line. */
function asLine(v: unknown): Line | null {
  if (!isPlainObject(v)) return null;
  if (v.t === "test" && isStr(v.id) && isStr(v.dir) && isStr(v.file) && isStr(v.name) && typeof v.hot === "boolean") return { t: "test", id: v.id, dir: v.dir, file: v.file, name: v.name, hot: v.hot };
  if (v.t === "run" && isStr(v.at) && isStr(v.label) && isStr(v.dir) && strs(v.pass) && strs(v.fail) && strs(v.skip)) return { t: "run", at: v.at, label: v.label, dir: v.dir, pass: v.pass, fail: v.fail, skip: v.skip };
  if (v.t === "verdict" && isStr(v.at) && isStr(v.id) && (v.kind === "fix" || v.kind === "stale" || v.kind === "flaky")) {
    return { t: "verdict", at: v.at, id: v.id, kind: v.kind, ...(typeof v.pr === "number" ? { pr: v.pr } : {}), ...(isStr(v.note) ? { note: v.note } : {}) };
  }
  return null;
}

function lines(file: string): Line[] {
  if (!existsSync(file)) return [];
  const out: Line[] = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const l = asLine(JSON.parse(line));
      if (l) out.push(l);
    } catch { /* a torn line is skipped */ }
  }
  return out;
}

function write(file: string, ls: Line[]) {
  if (!ls.length) return;
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, ls.map((l) => JSON.stringify(l)).join("\n") + "\n");
}

/**
 * Records one run of one app's tests. `hotOf(file)` says whether a test file is a journey (read it from the tree the
 * run used); a test is written once, and again when its file or hotness moved.
 */
export function remember(file: string, seen: Seen[], label: string, hotOf: (testFile: string) => boolean = () => false, at = new Date().toISOString()) {
  if (!seen.length) return;
  const known = new Map(lines(file).filter((l): l is TestLine => l.t === "test").map((l) => [l.id, l]));
  const out: Line[] = [];
  const dir = seen[0]!.dir;
  for (const s of seen) {
    const was = known.get(s.id), isHot = hotOf(s.file);
    if (!was || was.file !== s.file || was.hot !== isHot) out.push({ t: "test", id: s.id, dir: s.dir, file: s.file, name: s.name, hot: isHot });
  }
  const ids = (st: Status) => [...new Set(seen.filter((s) => s.status === st).map((s) => s.id))];
  out.push({ t: "run", at, label, dir, pass: ids("pass"), fail: ids("fail"), skip: ids("skip") });
  write(file, out);
}

/** Says what a failure was. `test` is an id or `dir: name`. Returns the id, or null when the ledger has never seen it. */
export function resolve(file: string, test: string, kind: Kind, pr?: number, note?: string, at = new Date().toISOString()): string | null {
  const id = /^t[0-9a-f]{10}$/.test(test) ? test : (() => { const i = test.indexOf(": "); return i < 0 ? null : idOf(test.slice(0, i), test.slice(i + 2)); })();
  if (!id || !lines(file).some((l) => l.t === "test" && l.id === id)) return null;
  write(file, [{ t: "verdict", at, id, kind, ...(pr ? { pr } : {}), ...(note ? { note } : {}) }]);
  return id;
}

export interface Memory {
  id: string; dir: string; file: string; name: string; hot: boolean;
  runs: number; fails: number; last?: Status; lastFail?: string; lastPass?: string;
  verdicts: { at: string; kind: Kind; pr?: number; note?: string }[];
}

/** Every test the ledger knows, with its record (`runs` counts the runs it ran in, not the ones that skipped it). */
export function recall(file: string): { tests: Memory[]; runs: number } {
  const by = new Map<string, Memory>();
  let runs = 0;
  for (const l of lines(file)) {
    if (l.t === "test") {
      const m = by.get(l.id);
      by.set(l.id, m ? { ...m, file: l.file, hot: l.hot } : { ...l, runs: 0, fails: 0, verdicts: [] });
    } else if (l.t === "run") {
      runs++;
      for (const [st, ids] of [["pass", l.pass], ["fail", l.fail], ["skip", l.skip]] as const) for (const id of ids) {
        const m = by.get(id);
        if (!m) continue;
        m.last = st;
        if (st === "skip") continue; // a skipped test didn't run: it earns no "never failed" credit
        m.runs++;
        if (st === "fail") { m.fails++; m.lastFail = l.at; }
        if (st === "pass") m.lastPass = l.at;
      }
    } else by.get(l.id)?.verdicts.push({ at: l.at, kind: l.kind, pr: l.pr, note: l.note });
  }
  return { tests: [...by.values()], runs };
}

/** A failure nobody has explained: it failed, and no verdict came after its last failure. */
export const unresolved = (m: Memory) => m.fails > 0 && !m.verdicts.some((v) => v.at >= m.lastFail!);

const day = (iso?: string) => iso?.slice(0, 10) ?? "?";
const prs = (ms: Memory[], kind: Kind) => [...new Set(ms.flatMap((m) => m.verdicts.filter((v) => v.kind === kind && v.pr).map((v) => `#${v.pr}`)))];

/**
 * Ester's memory, as she reports it: the count, where failures land (by test file, with how each was resolved),
 * what failed and was never explained, the tests that never failed in `min` or more runs and aren't journeys, and the
 * files whose tests go stale more than they catch anything.
 */
export function recallLines(mem: ReturnType<typeof recall>, min = 5, top = 10): string[] {
  const { tests, runs } = mem;
  if (!tests.length) return ["Ester remembers nothing yet: run a board --check, or `bun test --reporter=junit --reporter-outfile=junit.xml` then `bun scripts/ester-memory.ts remember junit.xml`"];
  const failed = tests.filter((m) => m.fails > 0);
  const kinds = (ms: Memory[]) => Object.fromEntries((["fix", "stale", "flaky"] as const).map((k) => [k, ms.filter((m) => m.verdicts.some((v) => v.kind === k)).length])) as Record<Kind, number>;
  const k = kinds(failed);
  const open = failed.filter(unresolved);
  const out = [`Ester remembers: ${tests.length} tests across ${runs} runs; ${failed.length} failed at least once: ${k.fix} fixed by a PR, ${k.stale} stale, ${k.flaky} flaky, ${open.length} unresolved`];

  const byFile = new Map<string, Memory[]>();
  for (const m of failed) byFile.set(`${m.dir}/${m.file}`, [...(byFile.get(`${m.dir}/${m.file}`) ?? []), m]);
  const themes = [...byFile.entries()].sort((a, b) => sum(b[1]) - sum(a[1]) || a[0].localeCompare(b[0])).slice(0, top);
  if (themes.length) {
    out.push("where failures land");
    for (const [f, ms] of themes) {
      const kk = kinds(ms), fixed = prs(ms, "fix"), stale = prs(ms, "stale");
      out.push(`  ${f.padEnd(48)} ${sum(ms)} fail${sum(ms) === 1 ? "" : "s"} in ${ms.length} test${ms.length === 1 ? "" : "s"}   fixed ${kk.fix}${fixed.length ? ` (${fixed.join(", ")})` : ""}  stale ${kk.stale}${stale.length ? ` (${stale.join(", ")})` : ""}  flaky ${kk.flaky}  unresolved ${ms.filter(unresolved).length}`);
    }
  }

  if (open.length) {
    out.push("unresolved: failed, and nobody has said what it was (resolve <id> --pr <n>, or --stale when the test was wrong)");
    for (const m of [...open].sort((a, b) => b.lastFail!.localeCompare(a.lastFail!)).slice(0, top)) {
      out.push(`  ${m.id}  ${m.dir}: ${m.name}   failed ${day(m.lastFail)}${m.last === "fail" ? ", still failing" : `, passed again ${day(m.lastPass)}`}`);
    }
  }

  const quiet = tests.filter((m) => !m.hot && m.fails === 0 && m.runs >= min);
  if (quiet.length) {
    const files = new Map<string, number>();
    for (const m of quiet) files.set(`${m.dir}/${m.file}`, (files.get(`${m.dir}/${m.file}`) ?? 0) + 1);
    out.push(`never failed in ${min}+ runs and not a journey through the app: ${quiet.length} test${quiet.length === 1 ? "" : "s"}, candidates to cut or fold`);
    for (const [f, n] of [...files.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, top)) out.push(`  ${f.padEnd(48)} ${n} test${n === 1 ? "" : "s"}`);
  }

  const staleProne = [...byFile.entries()].map(([f, ms]) => ({ f, ...kinds(ms) })).filter((x) => x.stale > x.fix).sort((a, b) => b.stale - a.stale);
  if (staleProne.length) {
    out.push("stale-prone: rewritten more often than they caught a bug");
    for (const x of staleProne.slice(0, top)) out.push(`  ${x.f.padEnd(48)} stale ${x.stale}, fixed ${x.fix}`);
  }
  return out;
}

const sum = (ms: Memory[]) => ms.reduce((n, m) => n + m.fails, 0);

if (import.meta.main) {
  const args = process.argv.slice(2);
  const arg = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
  const git = (...a: string[]) => Bun.spawnSync(["git", ...a], { stderr: "pipe" }).stdout.toString().trim();
  const top = git("rev-parse", "--show-toplevel") || process.cwd();
  const ledger = arg("file") ?? join(top, ".mervin/ester-memory.jsonl");
  const [cmd, ...rest] = args;
  const flags = new Set(["--stale", "--flaky"]);
  // positional words: not a flag, and not the value of the `--name value` flag before it
  const plain = rest.filter((a, i) => !a.startsWith("--") && !(rest[i - 1]?.startsWith("--") && !flags.has(rest[i - 1]!)));
  if (cmd === "remember") {
    const dir = arg("dir") ?? (git("rev-parse", "--show-prefix").replace(/\/$/, "") || ".");
    const root = arg("root") ?? top;
    const hotOf = (f: string) => { try { return hot(readFileSync(join(root, dir, f), "utf8")); } catch { return false; } };
    for (const xml of plain) {
      const seen = fromJunit(readFileSync(xml, "utf8"), dir);
      remember(ledger, seen, arg("label") ?? `bun test in ${dir}`, hotOf);
      console.log(`remembered ${seen.length} tests in ${dir} (${seen.filter((s) => s.status === "fail").length} failed) from ${xml}`);
    }
    if (!plain.length) throw new Error("usage: remember <junit.xml>... [--dir apps/x] [--label ...] [--root <tree>]");
  } else if (cmd === "resolve") {
    const pr = arg("pr") ? Number(arg("pr")) : undefined;
    const id = plain[0] && resolve(ledger, plain[0], args.includes("--stale") ? "stale" : args.includes("--flaky") ? "flaky" : "fix", pr, arg("note"));
    if (!id) throw new Error(plain[0] ? `Ester has never seen ${plain[0]}; ids are in \`recall\`` : "usage: resolve <id | \"apps/x: suite > name\"> --pr <n> [--stale] [--note ...]");
    console.log(`${id}: ${args.includes("--stale") ? "stale test" : args.includes("--flaky") ? "flaky" : "real failure"}${pr ? `, PR #${pr}` : ""}`);
  } else if (cmd === "recall" || !cmd) {
    console.log(recallLines(recall(ledger), Number(arg("min") ?? 5), Number(arg("top") ?? 10)).join("\n"));
  } else throw new Error(`unknown command ${cmd}: remember, resolve or recall`);
}
