// How the CLI fails. An expected failure is a tagged error and prints as one line,
// `✗ [Tag] what went wrong`. A plain Error thrown with a written message prints that message.
// Anything else (a TypeError from code that met input it didn't expect) is a bug in the CLI,
// and prints with the file:line it came from, which a bare message never said.
import { relative } from "node:path";
import { Schema } from "effect";

/** A command or flag used wrong. Exits 2, like a shell builtin. */
export class UsageError extends Schema.TaggedError<UsageError>()("UsageError", { message: Schema.String }) {}

/** rustybuns.config.ts is missing, doesn't load, or doesn't export a config. */
export class ConfigLoadFailed extends Schema.TaggedError<ConfigLoadFailed>()("ConfigLoadFailed", { message: Schema.String }) {}

/** plan/deploy refused to go ahead (a guard, or no plan on record). Exits 2: nothing ran. */
export class DeployRefused extends Schema.TaggedError<DeployRefused>()("DeployRefused", { message: Schema.String, exitCode: Schema.optional(Schema.Number) }) {}

/** alchemy itself exited non-zero. Its own output is above; this is the one line that says so. */
export class AlchemyFailed extends Schema.TaggedError<AlchemyFailed>()("AlchemyFailed", { sub: Schema.String, exitCode: Schema.Number }) {
  override get message() { return `alchemy ${this.sub} exited ${this.exitCode} (its output is above)`; }
}

const BUGS = [TypeError, ReferenceError, RangeError];

/** Where an error was thrown: the first stack frame outside node_modules, relative to `cwd`. */
export function throwSite(e: Error, cwd = process.cwd()): string | null {
  for (const line of (e.stack ?? "").split("\n").slice(1)) {
    const m = line.match(/\(?((?:\/|[A-Za-z]:\\)[^():]+):(\d+):(\d+)\)?\s*$/);
    if (m && !m[1]!.includes("/node_modules/")) return `${relative(cwd, m[1]!) || m[1]}:${m[2]}:${m[3]}`;
  }
  return null;
}

/** The text and exit code for whatever reached the top. */
export function renderError(e: unknown, cwd = process.cwd()): { text: string; code: number } {
  if (e && typeof e === "object" && typeof (e as { _tag?: unknown })._tag === "string") {
    const t = e as { _tag: string; message?: string; exitCode?: number };
    return { text: `✗ [${t._tag}] ${t.message ?? ""}`, code: t.exitCode ?? (t._tag === "UsageError" || t._tag === "DeployRefused" ? 2 : 1) };
  }
  if (e instanceof Error && BUGS.some((B) => e instanceof B)) {
    const at = throwSite(e, cwd);
    return { text: `✗ [Bug] ${e.message}${at ? `\n  at ${at}` : ""}\n  This is a RustyBuns bug, or input it should have rejected with a clear message.`, code: 1 };
  }
  return { text: `✗ ${e instanceof Error ? e.message : String(e)}`, code: 1 };
}

/** The paste-into-your-agent block printed under a failure. No secrets: the error text and the command line only. */
export function triagePrompt(text: string, o: { argv: string[]; version: string; platform?: string }): string {
  const body = text.replace(/\b(?:cfut|cfat|ghp|gho|sk)[-_][A-Za-z0-9_-]{16,}/g, "<redacted>");
  const prompt = [
    `I ran \`rustybuns ${o.argv.join(" ")}\` (rustybuns ${o.version}, ${o.platform ?? process.platform}) and it failed:`,
    "",
    ...body.split("\n").map((l) => `    ${l}`),
    "",
    "Find the cause in this repo and my rustybuns.config.ts. Read GETTING_STARTED.md and REFERENCE.md from https://github.com/QuinnsCode/RustyBuns if you need them.",
    "Fix it if it's my config. If it's a RustyBuns bug, draft a GitHub issue with the exact command and error. Don't deploy, and don't read .env files.",
  ].join("\n");
  return `\nStuck? Paste this into your coding agent (or run \`rustybuns triage\`):\n\n${prompt.split("\n").map((l) => `  │ ${l}`).join("\n")}`;
}

/** `--name <value>`, or undefined when absent. A flag with nothing after it is a usage error, not a default. */
export function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const v = args[i + 1];
  if (v === undefined || v.startsWith("--")) throw new UsageError({ message: `--${name} needs a value` });
  return v;
}

/** A whole-number flag in [min, max], `fallback` when absent. "ten" or 0 is a usage error, not the fallback. */
export function intFlag(args: string[], name: string, min: number, max: number, fallback: number): number {
  const v = flag(args, name);
  if (v === undefined) return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new UsageError({ message: `--${name} takes a whole number from ${min} to ${max}, got ${JSON.stringify(v)}` });
  return n;
}

/** The closest of `known` to a mistyped `word` (edit distance 2 or less), for "did you mean". */
export function closest(word: string, known: string[]): string | undefined {
  const d = (a: string, b: string) => {
    const row = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      let prev = row[0]!; row[0] = i;
      for (let j = 1; j <= b.length; j++) { const t = row[j]!; row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = t; }
    }
    return row[b.length]!;
  };
  return known.map((k) => [k, d(word, k)] as const).filter(([, n]) => n <= 2).sort((a, b) => a[1] - b[1])[0]?.[0];
}
