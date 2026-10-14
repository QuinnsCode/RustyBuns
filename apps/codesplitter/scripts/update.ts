#!/usr/bin/env bun
// Keep the codeSplitter desktop up to date: pull this checkout, install, and restart the desktop on the new build.
//
//   bun run desktop:update         pull (fast-forward only), bun install, then run the desktop the way desktop:watch does
//   bun run desktop:update -- -y   the same, without asking before it stops a desktop that wasn't started by desktop:watch
//
// A desktop started by `desktop:watch` rebuilds itself when the pull changes files, and its window reloads on its own,
// so there is nothing to restart: this only pulls. Any other running desktop is stopped (SIGTERM, the same as closing
// it) and replaced by a watched one; its data in ~/.codesplitters is untouched.
import { $ } from "bun";
import { desktop } from "./phone.ts";

const root = new URL("../../..", import.meta.url).pathname;
const app = new URL("..", import.meta.url).pathname;

/** True if `pid`'s parent chain is `bun run desktop:watch` / `run desktop --watch`. */
export async function watched(pid: number): Promise<boolean> {
  let at = pid;
  for (let i = 0; i < 4 && at > 1; i++) {
    const [ppid, ...cmd] = (await $`ps -o ppid=,command= -p ${at}`.nothrow().quiet().text()).trim().split(/\s+/);
    if (/run desktop --watch|desktop:watch/.test(cmd.join(" "))) return true;
    at = Number(ppid);
  }
  return false;
}

if (import.meta.main) {
  console.log(`git pull (${(await $`git branch --show-current`.cwd(root).text()).trim()})`);
  const pulled = await $`git pull --ff-only`.cwd(root).nothrow();
  if (pulled.exitCode !== 0) process.exit(pulled.exitCode);
  const installed = await $`bun install`.cwd(root).nothrow();
  if (installed.exitCode !== 0) process.exit(installed.exitCode);

  let running: ReturnType<typeof desktop> | null = null;
  try { running = desktop(); } catch {}
  if (running && (await watched(running.pid))) {
    console.log("Pulled. The desktop is running under desktop:watch: it rebuilds now and its window reloads by itself.");
    process.exit(0);
  }
  if (running) {
    if (!process.argv.includes("-y") && !confirm(`Stop the running desktop (pid ${running.pid}) and start the new build?`)) process.exit(1);
    process.kill(running.pid, "SIGTERM");
    for (let i = 0; i < 50; i++) { try { process.kill(running.pid, 0); await Bun.sleep(100); } catch { break; } }
  }
  const p = Bun.spawn(["bun", "run", "desktop:watch"], { cwd: app, stdio: ["inherit", "inherit", "inherit"] });
  process.exit(await p.exited);
}
