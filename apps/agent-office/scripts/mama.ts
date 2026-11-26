#!/usr/bin/env bun
// 🥐 Mama: runs the office and swaps it for a fresh one when Bun or the dependencies change underneath it.
//
//   bun run office:mama                    build, start the office, then watch
//   bun run office:mama -- --port 4700     any args go to the office, as with `bun run office`
//   bun run office:update -- --watch       the same, after a pull (see update.ts)
//
// She also watches this app's own source: a change rebuilds ./office while it runs, open pages refresh themselves,
// and a server change makes the office say it needs a restart, with a Restart button (reload/, live/reload.ts).
// Every few seconds she looks at the bun binary, the lockfile and the pinned release. When one of them moved
// (a `bun upgrade`, a `bun install`, a pull), she rebuilds ./office while the old office keeps serving. A failed
// build leaves the old office running. A good one gets the old office a SIGTERM, which upstream treats as a
// restart: the workers keep running in their pty host and the next office picks them back up. If an office
// dies on its own she starts another, waiting a little longer each time it keeps dying.
// Ctrl+C stops both, and like Ctrl+C on `bun run office` it closes the office and its workers.
//
// One caveat: a new Agent Office release that bumps its PTY_PROTOCOL makes the new office stop the old pty host,
// so Claude workers are resumed (`claude --resume`) rather than kept.
import { existsSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { supervise } from "@rustybuns/util/supervise";

const root = path.dirname(import.meta.dir);
const POLL_MS = 3000;
/** An office up this long has stopped crash-looping, so the next restart waits from the start again. */
const STEADY_MS = 60_000;

/** What she watches: the bun on PATH, the repo's lockfile, this app's dependencies and the pinned release. */
export function watched(bun = Bun.which("bun")) {
  return [
    bun && realpathSync(bun),
    path.join(root, "../../bun.lock"),
    path.join(root, "package.json"),
    path.join(root, "scripts/release.ts"),
  ].filter((f): f is string => !!f);
}

/** The files' sizes and mtimes, so a change to any of them changes this. */
export function fingerprint(files: string[]) {
  return files.map((f) => (existsSync(f) ? `${f}:${statSync(f).size}:${statSync(f).mtimeMs}` : `${f}:-`)).join("\n");
}

/** Our own source, which the office is built from: what a rebuild picks up (page scripts, the skin, the server bundles). */
export function sources(dir = root) {
  const skip = /^(office|node_modules|dist|\.cache|test|bench)\//;
  return [...new Bun.Glob("**/*.{ts,js,json}").scanSync({ cwd: dir })].filter((f) => !skip.test(f)).sort().map((f) => path.join(dir, f));
}

/** Build ./office with rustybunsify: true if it built. */
export const build = () =>
  Bun.spawnSync(["bun", path.join(root, "scripts/rustybunsify.ts")], { cwd: root, stdio: ["inherit", "inherit", "inherit"] }).exitCode === 0;

/** Start the office from an already-built ./office and keep it running, swapping it on changes; her timer keeps this process alive. */
export function watch(args: string[]) {
  let swapping = false;
  let stopping = false;
  // upstream exits 300ms after SIGTERM; one that hangs after 5s gets a SIGKILL
  const office = supervise(["bun", path.join(root, "office/bin/agent-office.js"), ...args], {
    cwd: root, env: { ...process.env, AGENT_OFFICE_RB_MAMA: "1" }, steadyMs: STEADY_MS, graceMs: 5000,
    onExit: (code, signal, wait) => console.log(`🥐 mama: the office exited (${signal ?? code}); starting another in ${wait / 1000}s`),
  });

  let seen = fingerprint(watched());
  let seenSrc = fingerprint(sources());
  office.start();

  setInterval(async () => {
    if (swapping || stopping) return;
    const src = fingerprint(sources());
    if (src !== seenSrc) {
      // our code changed: rebuild while the office keeps serving. Open pages refresh themselves, and a changed server
      // bundle makes the office say it needs a restart (live/reload.ts); it isn't swapped here, since that's their call
      await Bun.sleep(500);
      if (fingerprint(sources()) !== src) return;
      swapping = true;
      console.log("🥐 mama: the code changed; rebuilding (open pages refresh, server changes ask for a restart)");
      if (!build()) console.log("🥐 mama: that build failed, so the office keeps what it has. Fix it and save; she'll try again.");
      seenSrc = fingerprint(sources());
      seen = fingerprint(watched());
      swapping = false;
      return;
    }
    const now = fingerprint(watched());
    if (now === seen) return;
    // let a bun install or upgrade finish writing before building on it
    await Bun.sleep(2000);
    if (fingerprint(watched()) !== now) return;
    swapping = true;
    console.log("🥐 mama: Bun or the dependencies changed; rebuilding while the office keeps running");
    if (build()) {
      console.log("🥐 mama: swapping in a fresh office (workers keep running)");
      await office.restart();
    } else {
      console.log("🥐 mama: the rebuild failed, so the old office stays up. Fix it and save; she'll try again.");
    }
    // taken after the build, so anything the build itself touched doesn't count as another change
    seen = fingerprint(watched());
    seenSrc = fingerprint(sources());
    swapping = false;
  }, POLL_MS);

  // Ctrl+C reaches the office too (same process group); she just waits for it and goes
  process.on("SIGINT", async () => {
    stopping = true;
    await office.stop({ signal: null });
    process.exit(0);
  });
  process.on("SIGTERM", async () => {
    stopping = true;
    await office.stop();
    process.exit(0);
  });
}

if (import.meta.main) {
  if (!build()) process.exit(1);
  watch(process.argv.slice(2));
}
