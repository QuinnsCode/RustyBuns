// `--help` for any script: it prints the script's own top comment, the usage its author already keeps there, and exits.
// One line at the top of a script's main: `help(import.meta.path)`. Agents used to grep a tool's source for its flags
// (scripts/probe.ts was read in 79 sessions in one week, #3165's Dexter count); now they ask it.
import { readFileSync } from "node:fs";

/** The leading `//` comment of a source file, without the slashes: everything up to the first line that isn't one. */
export function usage(src: string): string {
  const out: string[] = [];
  for (const line of src.replace(/^#!.*\n/, "").split("\n")) {
    if (!line.startsWith("//")) break;
    out.push(line.replace(/^\/\/ ?/, ""));
  }
  return out.join("\n").trim();
}

/** When the arguments ask for help, print the file's usage (and `extra`, if any) and exit 0; otherwise do nothing. */
export function help(file: string, argv = process.argv.slice(2), extra?: () => string): void {
  if (!argv.some((a) => a === "--help" || a === "-h")) return;
  console.log([usage(readFileSync(file, "utf8")) || "No usage written at the top of this script.", extra?.()].filter(Boolean).join("\n\n"));
  process.exit(0);
}
