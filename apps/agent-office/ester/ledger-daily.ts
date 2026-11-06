// The ledger every morning: at 10am, days cut 10am to 10am, so yesterday is whole. Writes the files to ~/.rustybuns/ledger,
// then has a headless Claude put them on the two pages (Artifacts need Claude's own tools, there is no API for them).
// Run: bun apps/agent-office/ester/ledger-daily.ts             (now: ledger, then publish)
//      bun apps/agent-office/ester/ledger-daily.ts --no-publish (files only)
//      bun apps/agent-office/ester/ledger-daily.ts --install    (a launchd job at 10:07 every day; --uninstall takes it off)
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { arr, obj, str } from "@rustybuns/util/guard";

const DAY_STARTS = 10;
const WEEK = "https://claude.ai/artifact/FBNXoT3SnfvJvL8kyZPDo3"; // RustyBuns weekly ledger, last 8 days
const MONTH = "https://claude.ai/artifact/Y7fSLkHoTgLMV1i3oLNERn"; // tokens per line of code, last 30 days
const LABEL = "com.rustybuns.ledger";
const out = path.join(homedir(), ".rustybuns", "ledger");
const repo = path.resolve(import.meta.dir, "../../..");
const plist = path.join(homedir(), "Library/LaunchAgents", `${LABEL}.plist`);

/** The weekly page with the last `days` rows of the ledger in it. */
export function weekPage(template: string, ledger: { rows: unknown[] }, days = 8): string {
  const at = template.indexOf("/*LEDGER*/");
  const end = template.indexOf(";\n", at);
  if (at < 0 || end < 0) throw new Error("ledger-week.html lost its /*LEDGER*/ slot");
  const data = { ...ledger, rows: ledger.rows.slice(-days) };
  return template.slice(0, at) + JSON.stringify(data).replace(/</g, "\\u003c") + template.slice(end);
}

const Ledger = obj({ generated: str(40), rows: arr(obj({ date: str(10) }), 400), size: arr(obj({ date: str(10) }), 5000) });

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
  writeFileSync(path.join(out, "week.html"), weekPage(readFileSync(path.join(import.meta.dir, "ledger-week.html"), "utf8"), ledger));
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
