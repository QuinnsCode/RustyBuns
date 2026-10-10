// Type checking for `plan` (the generated stack) and `build desktop --check` (the app).
// Three checkers, fastest first: Bun's built-in `bun check` (Bun >= 1.4.3, canaries
// included: no stable release has it yet), tsc-rs
// (Rust port of tsc 7, with Effect's diagnostics built in), and plain tsc.
// `bun check` ignores tsconfig "plugins", so a project that asks for
// @effect/language-service gets tsc-rs when it is installed.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export type CheckerName = "bun" | "tsc-rs" | "tsc";
export const CHECKERS: CheckerName[] = ["bun", "tsc-rs", "tsc"];
export const BUN_CHECK_MIN = "1.4.3";

export interface Checker { name: CheckerName; bin: string }
export interface CheckResult { checker: CheckerName; ok: boolean; ms: number; output: string }

/** node_modules/.bin/<name>, walking up from `from` (workspaces hoist bins to the root). */
export function localBin(name: string, from = process.cwd()): string | null {
  for (let d = resolve(from); ; d = dirname(d)) {
    const p = join(d, "node_modules", ".bin", name);
    if (existsSync(p)) return p;
    if (dirname(d) === d) return null;
  }
}

/** Does this Bun version have `bun check`? A 1.4.3 canary counts: semver ranks 1.4.3-canary.N below 1.4.3. */
export const hasBunCheck = (version: string) => Bun.semver.satisfies(version, `>=${BUN_CHECK_MIN}-0`);

/** A Bun that has `bun check`: $RB_BUN if set, else this Bun when it is new enough. */
export function bunWithCheck(): string | null {
  if (process.env.RB_BUN) return process.env.RB_BUN;
  return hasBunCheck(Bun.version) ? process.execPath : null;
}

function find(name: CheckerName): Checker | null {
  const bin = name === "bun" ? bunWithCheck() : localBin(name);
  return bin ? { name, bin } : null;
}

export function wantsEffectDiagnostics(tsconfig: string): boolean {
  try { return readFileSync(tsconfig, "utf8").includes("@effect/language-service"); } catch { return false; }
}

/**
 * The checker to use. "auto": tsc-rs when the tsconfig wants Effect diagnostics
 * and tsc-rs is installed, otherwise the fastest one available. Null when none is.
 */
export function pickChecker(want: CheckerName | "auto", tsconfig: string | null): Checker | null {
  if (want !== "auto") {
    const c = find(want);
    if (c) return c;
    throw new Error(want === "bun"
      ? `bun check needs Bun >= ${BUN_CHECK_MIN} (this is ${Bun.version}). Until 1.4.3 ships, \`bun upgrade --canary\` has it, or point RB_BUN at a newer bun.`
      : `${want} is not installed here. Add it: bun add -d ${want === "tsc" ? "typescript" : want}`);
  }
  if (tsconfig && wantsEffectDiagnostics(tsconfig)) { const rs = find("tsc-rs"); if (rs) return rs; }
  for (const n of tsconfig ? CHECKERS : ["bun" as const]) { const c = find(n); if (c) return c; }
  return null;
}

/** No tsconfig: only bun check can run, with its defaults over the current directory. */
export function checkCommand(c: Checker, tsconfig: string | null): string[] {
  if (c.name === "bun") return tsconfig ? [c.bin, "check", "-p", tsconfig] : [c.bin, "check"];
  if (!tsconfig) throw new Error(`${c.name} needs a tsconfig.json to check against`);
  return [c.bin, "-p", tsconfig, "--noEmit"];
}

export async function runCheck(c: Checker, tsconfig: string | null): Promise<CheckResult> {
  const t = performance.now();
  const p = Bun.spawn(checkCommand(c, tsconfig), { stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { checker: c.name, ok: code === 0, ms: performance.now() - t, output: (out + err).trim() };
}

/** `--check`, `--no-check`, `--checker <name>` out of a flag list; the rest is returned untouched. */
export function checkFlags(args: string[], defaultOn: boolean): { on: boolean; checker: CheckerName | "auto"; rest: string[] } {
  let on = defaultOn, checker: CheckerName | "auto" = "auto";
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--check") on = true;
    else if (a === "--no-check") on = false;
    else if (a === "--checker" || a.startsWith("--checker=")) {
      const v = a.includes("=") ? a.slice(a.indexOf("=") + 1) : args[++i];
      if (v !== "auto" && !CHECKERS.includes(v as CheckerName)) throw new Error(`--checker must be one of auto, ${CHECKERS.join(", ")}`);
      checker = v as CheckerName | "auto";
      on = true;
    } else rest.push(a);
  }
  return { on, checker, rest };
}

/** The tsconfig `plan` checks the generated stack with, independent of the app's own tsconfig. */
export const STACK_TSCONFIG = ".rustybuns/tsconfig.stack.json";
export function stackTsconfig(): string {
  return JSON.stringify({
    compilerOptions: {
      target: "ESNext", module: "ESNext", moduleResolution: "bundler", lib: ["ESNext"],
      strict: true, noEmit: true, skipLibCheck: true, types: [],
      // tsc-rs runs Effect's diagnostics when this is present; bun check and tsc ignore it.
      plugins: [{ name: "@effect/language-service" }],
    },
    files: ["alchemy.run.ts"],
  }, null, 2) + "\n";
}
