// What the builder is running, on the builder's own screen (#3951). scripts/remote-ci.ts writes a record per slot
// in ~/builder/runs (<slot>.json while it runs, with its output teed to <slot>.log; done/ keeps the last few that
// finished). This reads them and prints a SwiftBar menu: "Bob: 2 running" in the menu bar, and under it each slot's
// worker, command, time running and last output line, a click opening the log. builder-setup.sh bundles this file
// to ~/builder/bar.js and points SwiftBar at it; it only reads files, nothing of Agent Office runs there.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { check, num, obj, opt, str, type Of } from "../packages/util/src/guard.ts";

/** One run's record, as remote-ci.ts writes it: who started it, what, and (once done) how it ended. */
export const Record = obj({ who: str(200), cmd: str(2000), started: num(0, Infinity), ended: opt(num(0, Infinity)), code: opt(num(-1, 1000)) });
export type Record = Of<typeof Record>;
export type Run = Record & { slot: string; log: string; last: string };

const lastLine = (path: string) => {
  try {
    const text = readFileSync(path, "utf8");
    return text.slice(-4000).split("\n").map((l) => l.trim()).filter(Boolean).pop() ?? "";
  } catch { return ""; }
};

function read(dir: string, name: string): Run | null {
  let parsed: unknown;
  try { parsed = JSON.parse(readFileSync(`${dir}/${name}`, "utf8")); } catch { return null; }
  const rec = check(Record, parsed);
  if (!rec) return null;
  const log = `${dir}/${name.replace(/\.json$/, ".log")}`;
  return { ...rec, slot: name.replace(/\.json$/, "").replace(/^\d+-/, ""), log, last: lastLine(log) };
}

const jsons = (dir: string) => { try { return readdirSync(dir).filter((f) => f.endsWith(".json")); } catch { return []; } };

/** The runs going now (a record whose slot is still locked) and the last finished ones, newest first. */
export function readRuns(root: string): { running: Run[]; done: Run[] } {
  const running = jsons(`${root}/runs`).filter((f) => existsSync(`${root}/locks/${f.replace(/\.json$/, "")}`))
    .map((f) => read(`${root}/runs`, f)).filter((r) => r !== null).sort((a, b) => a.slot.localeCompare(b.slot));
  const done = jsons(`${root}/runs/done`).map((f) => read(`${root}/runs/done`, f)).filter((r) => r !== null)
    .sort((a, b) => (b.ended ?? b.started) - (a.ended ?? a.started));
  return { running, done };
}

export const took = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${Math.floor(s / 3600)}h ${Math.floor(s / 60) % 60}m`;
};

// SwiftBar's own syntax: "text | params", "---" a separator, "--" a submenu line. A "|" in our text would cut it.
const clean = (s: string, max = 80) => { const t = s.replace(/\|/g, "/").replace(/\s+/g, " "); return t.length > max ? `${t.slice(0, max - 1)}…` : t; };
const open = (log: string) => `bash=/usr/bin/open param1="${log}" terminal=false`;

/** The SwiftBar menu for these runs at `now`. */
export function menu({ running, done }: { running: Run[]; done: Run[] }, now: number, name = "Bob"): string {
  const out = [running.length ? `${name}: ${running.length} running` : `${name}: idle`, "---"];
  if (!running.length) out.push("Nothing running | color=gray");
  for (const r of running) {
    out.push(`${r.slot}  ${clean(r.who, 30)}  ${took(now - r.started)} | font=Menlo ${open(r.log)}`);
    out.push(`--${clean(r.cmd)} | font=Menlo`);
    if (r.last) out.push(`--${clean(r.last)} | font=Menlo color=gray`);
  }
  if (done.length) out.push("---", "Finished | color=gray");
  for (const r of done) {
    const ago = r.ended ? `${took(now - r.ended)} ago` : "";
    out.push(`${r.code ? "failed" : "passed"}  ${clean(r.who, 30)}  ${took((r.ended ?? r.started) - r.started)}  ${ago} | font=Menlo ${open(r.log)}`);
    out.push(`--${clean(r.cmd)} | font=Menlo`);
    if (r.last) out.push(`--${clean(r.last)} | font=Menlo color=gray`);
  }
  return out.join("\n");
}

if (import.meta.main) {
  const root = process.env.BUILDER_ROOT ?? `${process.env.HOME}/builder`;
  console.log(menu(readRuns(root), Date.now(), process.env.BUILDER_NAME ?? "Bob"));
}
