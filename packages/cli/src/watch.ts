// rustybuns run desktop --watch: rebuild the dev host on save and swap it in.
//
// The old host keeps running while the new one builds (a --dev rebuild is the client build plus
// one bundle: about 0.2 s for codeSplitter). A good build stops the old host and starts the new
// one; a failed one leaves the old one up. Saves that land mid-build fold into one more build, so
// a burst of writes (an agent editing ten files) costs two builds, not ten.
//
// Every host gets the same port and launch token (RB_LISTEN, RB_TOKEN), so the window the first
// one opened stays logged in across restarts and reloads itself (shell-bun reload.ts). RB_WATCH keeps that window open when its
// host exits, and RB_WATCH=again tells a restarted host not to open another (launcher.ts).
// rustybuns.config.ts is read once: a change to it needs the watch started again.
import { statSync, watch as fsWatch } from "node:fs";
import { join, relative, sep } from "node:path";
import type { RustyBunsConfig } from "./config.ts";
import { hostCommand, hostEnv } from "./sandbox.ts";

/** How long the tree has to be quiet before a build starts. */
const QUIET_MS = 150;

/** How far a file's mtime may trail Date.now() and still count as written after the watch began. */
const CLOCK_SLACK_MS = 1000;

/** Directories a build or a running host writes to, which must not start another build. */
export function watchOutputs(c: RustyBunsConfig): string[] {
  const d = c.targets.desktop ?? {};
  const relativeDir = (p?: string) => p && !p.startsWith("~") && !p.startsWith("/") ? p.replace(/^\.\//, "").replace(/\/$/, "") : undefined;
  return ["dist", "native/dist", d.clientDir, c.worker?.assets, d.dataDir].map(relativeDir).filter((p): p is string => !!p);
}

/** True for a changed path (relative to the project) that is not source: dependencies, dot dirs, build output, Vite's temp config. */
export function watchIgnored(rel: string, outputs: string[]): boolean {
  const path = rel.split(sep).join("/");
  if (path.split("/").some((part) => part === "node_modules" || part.startsWith("."))) return true;
  if (/^native\/target/.test(path) || /\.timestamp-[^/]*\.mjs$/.test(path)) return true;
  return outputs.some((o) => path === o || path.startsWith(o + "/"));
}

/**
 * Whether a file the OS reported really changed: its mtime or size moved, or it came or went.
 * macOS reports a file that was only read (the app's own build copying src/client.html, say),
 * and without this check the build that read it would start the next one.
 * A file first seen counts if it was written after the check started, give or take
 * CLOCK_SLACK_MS: Linux stamps mtimes from a coarse clock that can trail Date.now().
 */
export function changeCheck(since = Date.now()) {
  const seen = new Map<string, string>();
  return (abs: string): boolean => {
    let mtime = 0, now = "gone";
    try { const s = statSync(abs); mtime = s.mtimeMs; now = `${s.mtimeMs}:${s.size}`; } catch {}
    const before = seen.get(abs);
    seen.set(abs, now);
    return before === undefined ? now === "gone" || mtime >= since - CLOCK_SLACK_MS : before !== now;
  };
}

export interface Host { kill(signal?: NodeJS.Signals): void; exited: Promise<number | null> }

/**
 * The build-and-swap loop, without the file watching: `changed()` on every save.
 * `build` throws when the build fails; `start(again)` starts a host from the last good build.
 */
export function swapper(opts: { build: () => Promise<unknown>; start: (again: boolean) => Host; log?: (s: string) => void; quietMs?: number }) {
  const log = opts.log ?? ((s: string) => console.log(`[watch] ${s}`));
  let host: Host | null = null;
  let opened = false;
  let building = false;
  let dirty = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopping = false;

  const launch = () => {
    const h = host = opts.start(opened);
    opened = true;
    void h.exited.then((code) => {
      if (host !== h || stopping) return;
      host = null;
      log(`the host exited (${code}); save a file to build and start it again`);
    });
  };

  const stopHost = async () => {
    const old = host;
    host = null;
    if (!old) return;
    old.kill("SIGTERM");
    if (!(await Promise.race([old.exited.then(() => true), Bun.sleep(5000).then(() => false)]))) old.kill("SIGKILL");
  };

  /** Build, then swap; one more build if files changed meanwhile. */
  const cycle = async () => {
    building = true;
    do {
      dirty = false;
      const t = Date.now();
      try {
        await opts.build();
      } catch (e) {
        log(`build failed${host ? ", so the running host stays up" : ""}. Fix it and save.\n${(e as Error).message ?? e}`);
        continue;
      }
      if (stopping) break;
      log(`built in ${Date.now() - t}ms${host ? "; restarting the host" : ""}`);
      await stopHost();
      launch();
    } while (dirty && !stopping);
    building = false;
  };

  return {
    /** The first build and start. */
    run: () => cycle(),
    changed(file: string) {
      if (stopping) return;
      if (building) { dirty = true; return; }
      clearTimeout(timer);
      timer = setTimeout(() => { log(`${file} changed`); void cycle(); }, opts.quietMs ?? QUIET_MS);
    },
    async stop() {
      stopping = true;
      clearTimeout(timer);
      await stopHost();
    },
    get host() { return host; },
  };
}

/** A port nothing listens on right now, for every host the watch starts. */
function freePort(hostname: string): number {
  const s = Bun.serve({ hostname, port: 0, fetch: () => new Response() });
  const port = s.port!;
  s.stop(true);
  return port;
}

/** `rustybuns run desktop --watch [host args]`: runs until Ctrl+C. */
export async function watchDesktop(c: RustyBunsConfig, build: () => Promise<unknown>, args: string[], sandbox = false): Promise<never> {
  const root = process.cwd();
  const listen = c.targets.desktop?.listen;
  const env: Record<string, string> = {
    RB_TOKEN: Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString("base64url"),
  };
  // Pinned unless the user already pinned it: --listen, RB_LISTEN or a configured port.
  if (!args.some((a) => a === "--listen" || a.startsWith("--listen=")) && !process.env.RB_LISTEN && !listen?.port) {
    const hostname = listen?.hostname ?? "127.0.0.1";
    env.RB_LISTEN = `${hostname}:${freePort(hostname)}`;
  }
  const loop = swapper({
    build,
    start: (again) => Bun.spawn(hostCommand(".rustybuns/dev/desktop.js", args, { sandbox, cwd: root }), {
      cwd: root, stdio: ["inherit", "inherit", "inherit"],
      env: { ...hostEnv(process.env), ...env, RB_WATCH: again ? "again" : "1" },
    }),
  });
  const outputs = watchOutputs(c), moved = changeCheck();
  fsWatch(root, { recursive: true }, (_event, name) => {
    if (!name) return;
    const abs = join(root, name), rel = relative(root, abs);
    if (!watchIgnored(rel, outputs) && moved(abs)) loop.changed(rel);
  });
  // Ctrl+C reaches the host too (same process group); SIGTERM is passed on.
  const quit = async () => { await loop.stop(); process.exit(0); };
  process.on("SIGINT", quit);
  process.on("SIGTERM", quit);
  await loop.run();
  console.log("[watch] watching for changes (Ctrl+C stops)");
  return new Promise<never>(() => {});
}
