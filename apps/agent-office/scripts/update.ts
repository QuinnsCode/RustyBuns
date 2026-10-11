#!/usr/bin/env bun
// 🥐 Pick up whatever's merged: pull this checkout, re-run rustybunsify (the Druids skin is rebuilt every time),
// then start the office, swapping out the one that's running.
//
//   bun run office:update                  pull, rebuild, restart the office (or start it if it's down)
//   bun run office:update -- --watch       the same, then keep watching like office:mama (see mama.ts)
//   bun run office:update -- --port 4700   any other args go to the office, as with `bun run office`
//
// The swap is a SIGTERM, which upstream treats as a restart (not Ctrl+C, which closes everything): the workers'
// terminals live in a detached pty host, and the new office picks them back up with their scrollback. A failed
// pull or build leaves the running office alone. The caveat from mama.ts applies: a release that bumps
// PTY_PROTOCOL stops the old pty host, so Claude workers are resumed rather than kept.
import { $ } from "bun";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { connect } from "node:net";
import path from "node:path";
import { build, watch } from "./mama.ts";

const root = path.dirname(import.meta.dir);
const stamp = path.join(root, "office/.rustybuns");
const all = process.argv.slice(2);
const watching = all.includes("--watch");
const args = all.filter((a) => a !== "--watch");
const at = args.indexOf("--port");
const port = Number((at >= 0 && args[at + 1]) || 4600);

const read = () => (existsSync(stamp) ? readFileSync(stamp, "utf8").trim() : "");
const listening = () =>
  new Promise<boolean>((done) => {
    const s = connect(port, "127.0.0.1", () => { s.end(); done(true); });
    s.on("error", () => done(false));
  });

/** The office on `port` if it's this checkout's: its pid, and whether office:mama is minding it. */
export async function ours(port: number, dir = root) {
  const pid = Number((await $`lsof -nP -t -iTCP:${port} -sTCP:LISTEN`.nothrow().quiet().text()).trim().split("\n")[0]);
  if (!pid) return null;
  const cwd = (await $`lsof -a -p ${pid} -d cwd -Fn`.nothrow().quiet().text()).match(/^n(.*)$/m)?.[1];
  const [ppid, ...cmd] = (await $`ps -o ppid=,command= -p ${pid}`.nothrow().quiet().text()).trim().split(/\s+/);
  if (cwd !== realpathSync(dir) || !cmd.some((c) => c.endsWith("office/bin/agent-office.js"))) return null;
  const parent = (await $`ps -o command= -p ${ppid}`.nothrow().quiet().text()).trim();
  return { pid, mama: /scripts\/mama\.ts|office:mama|--watch/.test(parent) };
}

if (import.meta.main) {
  // 1. this checkout, fast-forward only: local changes or a diverged branch stop here, with git's own message
  console.log(`🥐 git pull (${(await $`git branch --show-current`.cwd(root).text()).trim()})`);
  const pulled = await $`git pull --ff-only`.cwd(root).nothrow();
  if (pulled.exitCode !== 0) process.exit(pulled.exitCode);

  // 2. the office, Rusty Buns-ified again (only the skin unless the pinned release moved), while the old one runs
  const first = !read();
  if (!build()) process.exit(1);

  // 3. swap out the running office, if it's ours
  if (await listening()) {
    const office = await ours(port);
    if (!office) {
      console.log(first
        ? `🥐 Built ./office here for the first time, but something's already on port ${port} (an office from another checkout?):\n` +
          `   stop it and run this again to start this one.`
        : `🥐 Something on port ${port} isn't this checkout's office, so it's left alone: stop it and run this again.`);
      process.exit(1);
    }
    process.kill(office.pid, "SIGTERM");
    if (office.mama) {
      console.log(`🥐 Restarted the office on port ${port}; office:mama starts the new one, and the workers keep running.`);
      process.exit(0);
    }
    // upstream exits 300ms after SIGTERM
    for (let i = 0; i < 50 && (await listening()); i++) await Bun.sleep(100);
    if (await listening()) process.kill(office.pid, "SIGKILL");
    console.log(`🥐 Swapped the office on port ${port} for the new build; the workers keep running.`);
  }

  // 4. start it here
  if (watching) watch(args);
  else {
    const office = Bun.spawn(["bun", path.join(root, "office/bin/agent-office.js"), ...args], { cwd: root, stdio: ["inherit", "inherit", "inherit"] });
    process.exit(await office.exited);
  }
}
