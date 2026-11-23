// One heavy job of a kind at a time on this Mac, at low priority: `bun scripts/heavy.ts <kind> <cmd...>`.
//
//   bun scripts/heavy.ts chrome bun scripts/burst-shots.ts out now --hit
//
// When several agents share one Mac, each wraps its headless Chrome and dev-server runs in `chrome` (any word
// names a lock). A run waits its turn for that kind's lock, then runs under `nice`, so the Mac stays usable.
// It is not a way to run Blender on the office Mac: nothing runs Blender there (docs/BLENDER-TOOLS.md).
// The lock is a folder in the temp dir holding the owner's pid; a lock whose owner is gone is taken over.
// Exits with the command's own code.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { help } from "../../../scripts/help.ts";

help(import.meta.path);

const [kind, ...cmd] = process.argv.slice(2);
if (!kind || !/^[a-z]+$/.test(kind) || !cmd.length) { console.error("usage: bun scripts/heavy.ts <kind> <cmd...>"); process.exit(2); }

const lock = join(tmpdir(), `rustybuns-heavy-${kind}.lock`), pidFile = join(lock, "pid");
/** Whether the process that wrote the lock is still there. An unreadable pid is a lock being made: alive. */
function ownerAlive(): boolean {
  let pid: number;
  try { pid = Number(readFileSync(pidFile, "utf8")); } catch { return true; }
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}
function take(): boolean {
  try { mkdirSync(lock); } catch { return false; }
  writeFileSync(pidFile, String(process.pid));
  return true;
}
const release = () => { try { rmSync(lock, { recursive: true }); } catch { /* already gone */ } };

const since = Date.now();
let said = false, strikes = 0;
while (!take()) {
  // two looks a second apart, so a lock caught between its mkdir and its pid is not taken for a dead one
  strikes = ownerAlive() ? 0 : strikes + 1;
  if (strikes >= 2) { release(); strikes = 0; continue; }
  if (!said) { console.error(`heavy: waiting for the ${kind} lock`); said = true; }
  await Bun.sleep(1000);
}
if (said) console.error(`heavy: got the ${kind} lock after ${Math.round((Date.now() - since) / 1000)} s`);

const child = Bun.spawn(["nice", "-n", "15", ...cmd], { stdin: "inherit", stdout: "inherit", stderr: "inherit" });
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(sig, () => { child.kill(sig); });
const code = await child.exited;
release();
process.exit(code);
