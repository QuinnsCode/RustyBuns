#!/usr/bin/env bun
// 🥐 Pick up whatever's merged: pull this checkout, re-run rustybunsify (the Druids skin is rebuilt every time),
// then start the office, or say what to do if it's already running.
//
//   bun run office:update                  pull, rebuild, start the office (or reload the page if it's up)
//   bun run office:update -- --port 4700   any args go to the office, as with `bun run office`
import { $ } from "bun";
import { existsSync, readFileSync } from "node:fs";
import { connect } from "node:net";
import path from "node:path";

const root = path.dirname(import.meta.dir);
const stamp = path.join(root, "office/.rustybuns");
const args = process.argv.slice(2);
const at = args.indexOf("--port");
const port = Number((at >= 0 && args[at + 1]) || 4600);

const read = () => (existsSync(stamp) ? readFileSync(stamp, "utf8").trim() : "");

// 1. this checkout, fast-forward only: local changes or a diverged branch stop here, with git's own message
console.log(`🥐 git pull (${(await $`git branch --show-current`.cwd(root).text()).trim()})`);
const pulled = await $`git pull --ff-only`.cwd(root).nothrow();
if (pulled.exitCode !== 0) process.exit(pulled.exitCode);

// 2. the office, Rusty Buns-ified again: only the skin unless the pinned release moved
const before = read();
const built = Bun.spawnSync(["bun", path.join(root, "scripts/rustybunsify.ts")], { cwd: root, stdio: ["inherit", "inherit", "inherit"] });
if (built.exitCode !== 0) process.exit(built.exitCode ?? 1);
const after = read();

// 3. start it, unless it's up already
const up = await new Promise<boolean>((done) => {
  const s = connect(port, "127.0.0.1", () => { s.end(); done(true); });
  s.on("error", () => done(false));
});
if (!up) {
  const office = Bun.spawn(["bun", path.join(root, "office/bin/agent-office.js"), ...args], { cwd: root, stdio: ["inherit", "inherit", "inherit"] });
  process.exit(await office.exited);
}
// stopping it ends every worker's session, so that's left to you
console.log(!before
  ? `🥐 Built ./office here for the first time, but something's already on port ${port} (an office from another checkout?):\n` +
    `   stop it and run this again to start this one.`
  : after !== before
  ? `🥐 The office on port ${port} is still running the old release: stop it and run this again.`
  : `🥐 The office on port ${port} is running: hard-reload its page (Cmd+Shift+R) for the new skin.`);
