#!/usr/bin/env bun
// 🥐 office:dev: the fast loop for working on the office itself. Save a file under this app and it shows up in seconds.
//
//   bun run office:dev                  watch, rebuild what changed, restart the office when a server bundle did
//   bun run office:dev -- --port 4710   any args go to the office, as with `bun run office`
//
// No git pull (office:update does that) and no polling (office:mama polls every 3s): the folders the build reads are
// watched, and only the stages a change needs are rebuilt (plan() below; rustybunsify --only=...). A page script or
// the skin alone needs no restart: open pages refresh themselves (live/reload.ts). A server bundle (live/, the
// checks/triage/codesplitter servers) restarts the office with a SIGTERM, which upstream treats as a restart that keeps
// the workers (their terminals live in the pty host). Never Ctrl+C-style stops: the office is started detached, so
// stopping this script leaves it, and the workers, running. If nothing is on the port, this starts the office.
//
// Failure -> healing (heal() below; add a line here and a case there when a new one turns up). Each is printed as
// one line with the fix, and a failed rebuild always leaves the running office up:
//   source error in a build (syntax, missing import)   say which file; nothing applied, keep watching, save again
//   patch target moved / "expected one assets/..."     rebuild from clean once (--fresh), when no office is running from ./office
//   a build that fails some other way (a save raced)   retry once
//   office not back on the port in 30s                 start it once more; then print its last output
//   EADDRINUSE as it starts (the old one was slow)     wait for the port, start once more
//   pty host trouble as it starts (protocol moved)     start once more: workers resume rather than stay (see mama.ts)
//   office missing its files (./office half built)     rebuild from clean once
//   port held by another checkout's office, or by something else   never touched: say who, and to try --port
//   the office exits on its own                        start another, after a growing wait (mama.ts's backoff)
import { $ } from "bun";
import { spawn } from "node:child_process";
import { existsSync, watch } from "node:fs";
import path from "node:path";
import { backoff } from "./mama.ts";
import { listening, ours } from "./update.ts";

const root = path.dirname(import.meta.dir);

export type Stage = "skin" | "pages" | "live";
export interface Plan { full: boolean; stages: Stage[]; restart: boolean }

/** Our own source the build reads, by folder: what each change needs rebuilt. Anything not matched (tests, docs) needs nothing. */
export function plan(files: string[]): Plan {
  const stages = new Set<Stage>();
  let full = false;
  for (const f of files.filter((f) => !ignored(f))) {
    const [dir = "", name = ""] = f.split("/");
    // the patches applied when the release is unpacked, the pinned release, and the dependencies: from clean
    if (/^(package\.json|bun\.lock)$/.test(f) || /^scripts\/(rustybunsify|release|board|briefs|floorguard|hooktokens)\.ts$/.test(f)
      || f === "checks/patch.ts" || f === "power/patch.ts" || f === "triage/tools.ts" || dir === "shim") full = true;
    // the skin and the codeSplitter tiles share a chunk (rustybunsify.ts's sharedBuild), so they are built together
    else if (dir === "druids") { stages.add("skin"); stages.add("pages"); }
    else if (dir === "codesplitter") { stages.add("skin"); stages.add("pages"); stages.add("live"); }
    else if (dir === "checks" || dir === "triage") { stages.add("pages"); stages.add("live"); }
    else if (dir === "live" || f.startsWith("../excalibrawl/src/")) stages.add("live");
    else if (["icons", "queue", "clock", "asks", "ester", "reload", "power"].includes(dir) && name.endsWith(".ts")) stages.add("pages");
  }
  const order: Stage[] = ["skin", "pages", "live"];
  const list = order.filter((s) => stages.has(s));
  return { full, stages: full ? order : list, restart: full || stages.has("live") };
}

/** Files the watcher never reports: our output, dependencies, caches and the tests. */
export const ignored = (f: string) => /(^|\/)(office|node_modules|dist|\.cache|\.gen|test|bench|\.git)(\/|$)/.test(f) || !/\.(ts|js|json|lock)$/.test(f);

export interface Failure { kind: "build" | "start" | "port"; text: string; attempt: number }
export interface Healing { action: "retry" | "clean" | "none"; line: string }

/** What a failure means and what to do about it: the cases in the header, one line each. */
export function heal({ kind, text, attempt }: Failure): Healing {
  const first = attempt === 0;
  const fileOf = text.match(/([\w./-]+\.ts:\d+)/)?.[1];
  if (kind === "port") return { action: "none", line: `port in use by ${text}, which isn't this checkout's office, so it's left alone: stop it, or run with --port 4710` };
  if (kind === "build") {
    if (/patch target moved|Agent Office changed|expected one assets|ENOENT/.test(text))
      return first ? { action: "clean", line: "the built office doesn't match the patches; rebuilding from clean" }
        : { action: "none", line: `still failing after a clean rebuild (${text.split("\n")[0]}): the pinned release may have moved; the running office is untouched` };
    if (/failed to build|error:|Cannot find module|Expected |Unexpected |SyntaxError|TypeError|ReferenceError/i.test(text))
      return { action: "none", line: `build error${fileOf ? ` in ${fileOf}` : ""} (${text.split("\n")[0]!.slice(0, 120)}): fix it and save; the running office keeps what it has` };
    return first ? { action: "retry", line: "the build failed (a save mid-write?); trying once more" }
      : { action: "none", line: `the build failed twice (${text.split("\n").at(-1)}): the running office keeps what it has; save again to retry` };
  }
  if (/EADDRINUSE|already in use/.test(text))
    return first ? { action: "retry", line: "the port was still held by the old office; waiting for it and starting again" }
      : { action: "none", line: "the port is still in use: something else took it; stop that, or run with --port 4710" };
  if (/Cannot find module|ENOENT/.test(text))
    return first ? { action: "clean", line: "the office's files are missing (a half-built ./office); rebuilding from clean" }
      : { action: "none", line: "the office still won't start after a clean rebuild: see its output above" };
  if (/pty ?host|PTY_PROTOCOL|ptyhost/i.test(text))
    return first ? { action: "retry", line: "the pty host didn't match the new office; starting again (workers will resume rather than stay)" }
      : { action: "none", line: "the pty host still won't connect: stop it (office-workers list), then save to retry" };
  return first ? { action: "retry", line: "the office didn't come back on the port in time; starting it once more" }
    : { action: "none", line: "the office isn't coming back; its output is above. Fix the server code and save to retry" };
}

if (import.meta.main) await main();

async function main() {
  const args = process.argv.slice(2);
  const at = args.indexOf("--port");
  const port = Number((at >= 0 && args[at + 1]) || 4600);
  const say = (m: string) => console.log(`🥐 dev: ${m}`);
  const tail: string[] = [];
  let child: ReturnType<typeof spawn> | null = null;
  let restarting = false, crashes = 0;

  /** Run rustybunsify for these stages, capturing its output; null if it built, else what it said. */
  async function build(p: Plan, fresh: boolean) {
    const t0 = performance.now();
    const argv = ["scripts/rustybunsify.ts", "--timings", ...(fresh ? ["--fresh"] : p.full ? ["--fresh"] : [`--only=${p.stages.join(",")}`])];
    const r = Bun.spawn(["bun", ...argv], { cwd: root, stdout: "pipe", stderr: "pipe" });
    const [out, err] = await Promise.all([new Response(r.stdout).text(), new Response(r.stderr).text()]);
    if (await r.exited !== 0) {
      // Bun's "error: ..." line with the "at <file>:<line>" under it, the paths from this app
      const lines = (err + out).replaceAll(root + "/", "").split("\n").filter((l) => /^\s*(error|at )|changed|ENOENT/.test(l));
      return lines.slice(0, 2).join("\n").trim() || (err + out).trim().split("\n").slice(-2).join("\n") || "exit non-zero";
    }
    const times = [...out.matchAll(/⏱ (.+?)\s+([\d.]+s)/g)].map((m) => `${m[1]} ${m[2]}`).join(" · ");
    say(`built ${p.full || fresh ? "everything" : p.stages.join("+")} in ${((performance.now() - t0) / 1000).toFixed(1)}s (${times})`);
    return null;
  }

  /** Build with healing: true if ./office is now up to date. */
  async function rebuild(p: Plan) {
    let fresh = false;
    for (let attempt = 0; attempt < 2; attempt++) {
      const text = await build(p, fresh);
      if (text === null) return true;
      const h = heal({ kind: "build", text, attempt });
      say(h.line);
      // a clean rebuild replaces ./office, which a running office is serving from: only when it isn't running
      if (h.action === "clean" && (await listening(port))) { say("the office is running from ./office, so it isn't rebuilt from clean under it: stop it (SIGTERM) and save again"); return false; }
      if (h.action === "none") return false;
      fresh = h.action === "clean";
    }
    return false;
  }

  const spawnOffice = () => {
    const c = spawn("bun", [path.join(root, "office/bin/agent-office.js"), ...args], {
      cwd: root, stdio: ["ignore", "pipe", "pipe"], detached: true, env: { ...process.env, AGENT_OFFICE_RB_MAMA: "1" },
    });
    child = c;
    const born = Date.now();
    for (const s of [c.stdout, c.stderr]) s?.on("data", (d: Buffer) => { process.stdout.write(d); tail.push(...d.toString().split("\n")); tail.splice(0, Math.max(0, tail.length - 20)); });
    c.on("exit", (code, sig) => {
      if (child !== c) return;
      child = null;
      if (restarting) return;
      crashes = Date.now() - born > 60_000 ? 1 : crashes + 1;
      say(`the office exited (${sig ?? code}); starting another in ${backoff(crashes) / 1000}s`);
      setTimeout(() => !child && !restarting && void start(), backoff(crashes));
    });
  };

  /** Start the office and wait for the port, healing once; true if it's up. */
  async function start() {
    for (let attempt = 0; attempt < 2; attempt++) {
      tail.length = 0;
      spawnOffice();
      let up = false;
      for (let i = 0; i < 300 && child && !up; i++) { await Bun.sleep(100); up = await listening(port); }
      if (up) { say(`the office is up on port ${port}`); return true; }
      const h = heal({ kind: "start", text: tail.join("\n"), attempt });
      say(h.line);
      if (h.action === "clean" && !(await rebuild({ full: true, stages: ["skin", "pages", "live"], restart: true }))) return false;
      if (h.action === "none") return false;
      child?.kill("SIGTERM");
      for (let i = 0; i < 50 && (await listening(port)); i++) await Bun.sleep(100);
    }
    return false;
  }

  /** SIGTERM whatever office is on the port if it's ours, and start the new one. */
  async function restart() {
    restarting = true;
    try {
      if (await listening(port)) {
        const old = await ours(port);
        if (!old) {
          const pid = (await $`lsof -nP -t -iTCP:${port} -sTCP:LISTEN`.nothrow().quiet().text()).trim().split("\n")[0];
          say(heal({ kind: "port", text: `pid ${pid}`, attempt: 0 }).line);
          return;
        }
        process.kill(old.pid, "SIGTERM");
        // upstream exits 300ms after SIGTERM; never SIGKILL: let it finish
        for (let i = 0; i < 100 && (await listening(port)); i++) await Bun.sleep(100);
        if (await listening(port)) { say(`the old office (pid ${old.pid}) hasn't stopped after 10s; it's left running. Try again, or stop it yourself`); return; }
        if (old.mama) { say("office:mama starts the new one; the workers keep running"); return; }
      }
      child = null;
      await start();
    } finally {
      restarting = false;
    }
  }

  // first: a built ./office, then an office on the port
  const everything: Plan = { full: false, stages: ["skin", "pages", "live"], restart: true };
  if (!existsSync(path.join(root, "office/.rustybuns"))) say("no built ./office yet; building it from clean");
  if (!(await rebuild(existsSync(path.join(root, "office/.rustybuns")) ? everything : { ...everything, full: true }))) process.exit(1);
  if (await listening(port)) {
    if (await ours(port)) say(`the office on port ${port} is this checkout's; it's kept (a server change restarts it)`);
    else { say(heal({ kind: "port", text: "another process", attempt: 0 }).line); process.exit(1); }
  } else if (!(await start())) process.exit(1);

  // then watch
  const pending = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined, busy = false;
  const flush = async () => {
    if (busy) return;
    busy = true;
    try {
      while (pending.size) {
        const files = [...pending];
        pending.clear();
        const p = plan(files);
        if (!p.stages.length) continue;
        say(`${files.slice(0, 3).join(", ")}${files.length > 3 ? ` +${files.length - 3}` : ""} changed`);
        if (await rebuild(p) && p.restart) await restart();
      }
    } finally { busy = false; }
  };
  for (const dir of [root, path.join(root, "../excalibrawl/src")]) {
    watch(dir, { recursive: true }, (_e, f) => {
      if (!f) return;
      const rel = path.relative(root, path.join(dir, f));
      if (ignored(rel)) return;
      pending.add(rel);
      clearTimeout(timer);
      timer = setTimeout(flush, 150);
    });
  }
  say("watching; save a file and it shows up (Ctrl+C stops this, not the office)");
  process.on("SIGINT", () => { say("stopped; the office and its workers keep running"); process.exit(0); });
  process.on("SIGTERM", () => process.exit(0));
}
