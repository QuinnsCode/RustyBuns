#!/usr/bin/env bun
// 🥐 office:demo: the office's pages in a chosen state, with nothing real behind them (demo/stage.ts).
//
//   bun run demo --list                          every scenario, what it shows and the MANUAL RUN issues it stands in for
//   bun run demo --scenario writes-ask-pending   serve that state and print its link (--port 4720, --open to open it)
//
// A fake GitHub, a temp-folder keychain and a replayed Ester run stand in for the GitHub app, 1Password, Touch ID
// and the LLM. It binds to 127.0.0.1, reads no env and none of the real office's files, and is not in the shipped binary.
import { startStage } from "../demo/stage.ts";
import { SCENARIOS, names } from "../demo/scenarios.ts";

const args = process.argv.slice(2);
const value = (flag: string) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };

if (args.includes("--list") || !args.length) {
  const width = Math.max(...names().map((n) => n.length));
  for (const n of names()) console.log(`${n.padEnd(width)}  ${SCENARIOS[n]!.serves.map((i) => `#${i}`).join(" ").padEnd(11)} ${SCENARIOS[n]!.about}`);
  if (!args.length) console.log("\nbun run demo --scenario <name>");
  process.exit(0);
}

const scenario = value("--scenario");
if (!scenario) { console.error("Say which: bun run demo --scenario <name> (bun run demo --list shows them)"); process.exit(1); }
const port = Number(value("--port") ?? 4720);
if (!Number.isInteger(port) || port < 0 || port > 65535) { console.error("--port should be a number from 0 to 65535"); process.exit(1); }

try {
  const stage = await startStage({ scenario, port });
  console.log(`${scenario}: ${stage.url}/?scenario=${scenario}\nSwitch state on the page, or open /?scenario=<name>. Ctrl+C stops it.`);
  if (args.includes("--open")) Bun.spawn(["open", `${stage.url}/?scenario=${scenario}`]);
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
}
