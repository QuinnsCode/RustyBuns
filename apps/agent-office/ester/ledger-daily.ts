// The ledger every morning: at 10am, days cut 10am to 10am, so yesterday is whole. Writes the files to ~/.rustybuns/ledger,
// then has a headless Claude put them on the two pages (Artifacts need Claude's own tools, there is no API for them).
// Transcripts last 30 days, so every run folds its days into history.json, which only grows: the weekly page reads all of it.
// Run: bun apps/agent-office/ester/ledger-daily.ts             (now: ledger, then publish)
//      bun apps/agent-office/ester/ledger-daily.ts --no-publish (files only)
//      bun apps/agent-office/ester/ledger-daily.ts --install    (a launchd job at 10:07 every day; --uninstall takes it off)
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { arr, num, obj, str, type Of } from "@rustybuns/util/guard";

const DAY_STARTS = 10;
const WEEK = "https://claude.ai/artifact/FBNXoT3SnfvJvL8kyZPDo3"; // RustyBuns weekly ledger: last 8 days, or any recorded week, with overlays
const MONTH = "https://claude.ai/artifact/Y7fSLkHoTgLMV1i3oLNERn"; // tokens per line of code, last 30 days
const LABEL = "com.rustybuns.ledger";
const out = path.join(homedir(), ".rustybuns", "ledger");
const repo = path.resolve(import.meta.dir, "../../..");
const plist = path.join(homedir(), "Library/LaunchAgents", `${LABEL}.plist`);

const n = num(0, 1e13);
/** One day of ledger.ts's output. */
export const Row = obj({
  date: str(10, { re: /^\d{4}-\d{2}-\d{2}$/ }), sessions: n, turns: n, units: n, input: n, output: n, cacheRead: n, cacheWrite: n,
  fights: n, episodes: n, ciReads: n, testOutput: n, oversize: n, mervin: n, ester: n, dexter: n,
  prs: n, added: n, removed: n, codeAdded: n, codeRemoved: n,
});
export type Row = Of<typeof Row>;
const Ledger = obj({ generated: str(40), dayStarts: num(0, 23), saves: n, settles: n, rows: arr(Row, 400), size: arr(obj({ date: str(10), code: num(-1e9, 1e9) }), 5000) });
const History = arr(Row, 20000, { drop: true });

/** Fold a run's days into the history. A day keeps whichever count saw more turns: today grows, and the oldest day of a
 *  run thins as Claude Code deletes its transcripts, so an earlier run's fuller count stands. */
export function mergeHistory(old: Row[], fresh: Row[]): Row[] {
  const by = new Map(old.map((r) => [r.date, r]));
  for (const r of fresh) { const o = by.get(r.date); if (!o || r.turns >= o.turns) by.set(r.date, r); }
  return [...by.values()].sort((a, b) => a.date.localeCompare(b.date));
}

const PAGE = ["date", "sessions", "turns", "units", "output", "mervin", "ester", "dexter", "prs", "added", "removed", "codeAdded", "codeRemoved"] as const;
/** The weekly page with every recorded day in it (only the fields it draws); it picks the weeks itself. */
export function weekPage(template: string, ledger: { generated: string; dayStarts: number; saves: number; settles: number }, history: Row[]): string {
  const at = template.indexOf("/*LEDGER*/");
  const end = template.indexOf(";\n", at);
  if (at < 0 || end < 0) throw new Error("ledger-week.html lost its /*LEDGER*/ slot");
  const rows = history.map((r) => Object.fromEntries(PAGE.map((k) => [k, k === "date" ? r.date : Math.round(r[k])])));
  const data = { generated: ledger.generated, dayStarts: ledger.dayStarts, saves: ledger.saves, settles: ledger.settles, rows };
  return template.slice(0, at) + JSON.stringify(data).replace(/</g, "\\u003c") + template.slice(end);
}

function readHistory(): Row[] {
  const f = path.join(out, "history.json");
  return existsSync(f) ? History(JSON.parse(readFileSync(f, "utf8"))) : [];
}

function build() {
  mkdirSync(out, { recursive: true });
  Bun.spawnSync(["git", "fetch", "-q", "origin", "main"], { cwd: repo });
  const run = Bun.spawnSync(["bun", "apps/agent-office/ester/ledger.ts", "32", "--day-starts", String(DAY_STARTS)], { cwd: repo, stderr: "inherit" });
  if (run.exitCode !== 0) throw new Error(`ledger.ts exited ${run.exitCode}`);
  const text = run.stdout.toString();
  const ledger = Ledger(JSON.parse(text));
  writeFileSync(path.join(out, "ledger.json"), text);
  writeFileSync(path.join(out, "daily.json"), JSON.stringify(ledger.rows));
  writeFileSync(path.join(out, "size.json"), JSON.stringify(ledger.size));
  const history = mergeHistory(readHistory(), ledger.rows);
  writeFileSync(path.join(out, "history.json"), JSON.stringify(history));
  writeFileSync(path.join(out, "week.html"), weekPage(readFileSync(path.join(import.meta.dir, "ledger-week.html"), "utf8"), ledger, history));
  const last = ledger.rows.at(-2);
  console.log(`${ledger.generated} ledger written to ${out}; yesterday (${last?.date ?? "none"}, ${DAY_STARTS}am to ${DAY_STARTS}am) is the second-to-last row`);
}

const prompt = () => `Refresh two of my Artifacts from files on disk. Do only this, then reply in one line.
1. Weekly ledger ${WEEK}: Artifact read it, then Artifact publish with url ${WEEK} and file_path ${path.join(out, "week.html")}.
2. Dashboard ${MONTH}: Artifact read it. Upload ${path.join(out, "daily.json")} and then ${path.join(out, "size.json")}, each with Artifact publish, url ${MONTH}, asset: true (one file per call).
   ArtifactData get datasets/daily and datasets/size, then one ArtifactData batch of two updates pinned to the versions you read:
   source: {kind: "file", url: <that upload's url as returned>, name: <daily.json or size.json>}, updated: {at: <now, UTC ISO>, by: "ledger-daily.ts on the office Mac"}, edit: {via: "claude", at: <now>}.
   Then ArtifactData get collection data/users/me doc check; if it says checking, read it again (5 reads at most).
Change nothing else on either page. Reply: "ledger published" plus the check status, or what failed.`;

function publish() {
  const tools = "Artifact ArtifactData ToolSearch";
  const r = Bun.spawnSync(["claude", "-p", prompt(), "--allowedTools", tools, "--model", "claude-sonnet-5-5"], { cwd: repo, stdout: "inherit", stderr: "inherit" });
  if (r.exitCode !== 0) throw new Error(`claude -p exited ${r.exitCode}`);
}

function install() {
  mkdirSync(path.dirname(plist), { recursive: true });
  mkdirSync(out, { recursive: true });
  const log = path.join(out, "daily.log");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
 <key>Label</key><string>${LABEL}</string>
 <key>ProgramArguments</key><array><string>${process.execPath}</string><string>${path.join(import.meta.dir, "ledger-daily.ts")}</string></array>
 <key>WorkingDirectory</key><string>${repo}</string>
 <key>EnvironmentVariables</key><dict><key>PATH</key><string>${process.env.PATH ?? "/usr/bin:/bin"}</string></dict>
 <key>StartCalendarInterval</key><dict><key>Hour</key><integer>${DAY_STARTS}</integer><key>Minute</key><integer>7</integer></dict>
 <key>StandardOutPath</key><string>${log}</string><key>StandardErrorPath</key><string>${log}</string>
</dict></plist>
`;
  writeFileSync(plist, xml);
  const uid = process.getuid?.() ?? 501;
  Bun.spawnSync(["launchctl", "bootout", `gui/${uid}/${LABEL}`]);
  const r = Bun.spawnSync(["launchctl", "bootstrap", `gui/${uid}`, plist], { stderr: "inherit" });
  console.log(r.exitCode === 0 ? `installed: ${LABEL} runs ${repo} at ${DAY_STARTS}:07 daily, log ${log}` : "launchctl bootstrap failed");
}

if (import.meta.main) {
  const a = process.argv.slice(2);
  if (a.includes("--install")) install();
  else if (a.includes("--uninstall")) { Bun.spawnSync(["launchctl", "bootout", `gui/${process.getuid?.() ?? 501}/${LABEL}`]); rmSync(plist, { force: true }); console.log("uninstalled"); }
  else { build(); if (!a.includes("--no-publish")) publish(); }
}
