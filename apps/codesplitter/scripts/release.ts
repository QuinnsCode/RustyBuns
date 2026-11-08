// Releases codeSplitter to the live site, from the owner's Mac. ~/release-codesplitters.sh puts a
// worktree of the agent-office clone on origin/main and runs this from it:
//
//   zsh ~/release-codesplitters.sh            a release: plan, show it, ask, deploy, check the site
//   zsh ~/release-codesplitters.sh --checks   the first deploy with checks in a container (#776)
//
// It deploys from that worktree, never the folder you're in. The live Alchemy state lives in the
// clone's git dir (.git/rustybuns/alchemy), shared by all its worktrees. Things it can fix it fixes:
// a locked 1Password, an expired wrangler login, Docker not running, files the last deploy
// regenerated, main moving while you read the plan. Anything that could lose data or cost money
// it stops on, and says so: a plan that deletes, replaces, unbinds or makes something it doesn't
// expect, or one of the CLI's own warnings.
//
// The decisions are plain functions (checkPlan, dirtyFiles, …) and every command goes through an
// IO, so test/release.test.ts replays real plans and edge cases without touching anything live.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const ACCOUNT = /c2d417e6[0-9a-f]{24}/;
/** Plan and deploy rewrite these from rustybuns.config.ts and the flags (#776, the vault rename). */
export const GENERATED = ["wrangler.jsonc", ".env.schema"];
/** The KV namespaces rustybuns.config.ts declares (`STATS: { type: "kv" }`): a plan row doesn't say what type a resource is. */
export const kvBindings = (config: string) => [...config.matchAll(/^\s*([A-Z][A-Z0-9_]*): \{ type: "kv"/gm)].map((m) => m[1]!);
const KV = (() => { try { return kvBindings(readFileSync(join(import.meta.dir, "..", "rustybuns.config.ts"), "utf8")); } catch { return []; } })();

export interface Mode { checksNew: boolean }

export function parseArgs(argv: string[]): Mode {
  const bad = argv.filter((a) => a !== "--checks");
  if (bad.length) throw new Stop(`unknown option ${bad.join(" ")}: the only option is --checks`);
  return { checksNew: argv.includes("--checks") };
}

/**
 * The token out of `wrangler auth token --json`. Wrangler 4.149 (src/user/commands.ts, authTokenCommand)
 * prints `JSON.stringify({ type: "oauth", token }, null, 2)` with no banner when --json is passed;
 * without it the banner comes first, so a plain last line is the fallback. fresh-check.ts reads it too.
 */
export function parseAuthToken(out: string): string | null {
  const json = out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1);
  try {
    const t = JSON.parse(json)?.token;
    if (typeof t === "string" && t.length >= 20) return t;
  } catch { /* not JSON: an older wrangler */ }
  const last = out.trim().split("\n").at(-1)?.trim() ?? "";
  return /^\S{20,}$/.test(last) ? last : null;
}

// ---- the plan ----

export interface Row { line: string; id: string; binding: string | null; action: string }

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
/** Effect's logger, which Alchemy prints its plan through, starts each line `[00:01:08.172] INFO (#1): `. */
const LOG = /^\[\d{2}:\d{2}:\d{2}\.\d{3}\] [A-Z]+ \(#\d+\): ?/;
const ROW = /^\[([^\]]+)\] (create|update|adopted|replace|delete|orphaned|noop|unbind|run|drop)\b/;

/** Alchemy's plan (LoggingCli formatPlanLines): `[ID] action`, `[ID/binding] action`, and a `Plan:` summary. */
export function parsePlan(text: string) {
  const lines = strip(text).split("\n").map((l) => l.replace(LOG, "").trimEnd());
  const rows: Row[] = [];
  for (const line of lines) {
    const m = ROW.exec(line);
    if (!m) continue;
    const slash = m[1]!.indexOf("/");
    rows.push({ line, id: slash < 0 ? m[1]! : m[1]!.slice(0, slash), binding: slash < 0 ? null : m[1]!.slice(slash + 1), action: m[2]! });
  }
  return { summary: lines.find((l) => l.startsWith("Plan:")) ?? null, rows, warnings: lines.filter((l) => l.startsWith("warning: ")) };
}

/** The items of the CLI's "this deploy would delete A, B (x, y), and the data in them" warning. */
export const deleteItems = (warning: string) =>
  (/would delete (.*), and the data in/.exec(warning)?.[1] ?? "").match(/(?:[^,(]|\([^)]*\))+/g)?.map((s) => s.trim()).filter(Boolean) ?? [];

export interface Verdict { show: string[]; stop: string | null; behind: boolean }

/**
 * Whether a plan may go out as a release. A release only updates what's there: anything it makes,
 * takes over, replaces, deletes or unbinds stops it, except what the mode is for. A new setting on
 * the Worker (`[Worker/PRIVACY_EMAIL] create`) is free, so it passes.
 */
export function checkPlan(text: string, mode: Mode): Verdict {
  const { summary, rows, warnings } = parsePlan(text);
  const show = [...warnings, ...(summary ? [summary] : []), ...rows.filter((r) => r.action !== "noop").map((r) => r.line)];
  const out = (stop: string | null, behind = false): Verdict => ({ show, stop, behind });
  if (!summary) return out("the plan printed no summary. Not deploying; paste this to Claude.");

  for (const w of warnings) {
    if (/behind origin\/main/.test(w)) return out(null, true);
    if (/Alchemy state is under the app name/.test(w)) return out("the Alchemy state is under the app's old name, so the deploy would make everything again. Not deploying; paste this to Claude.");
    if (/would delete/.test(w)) {
      const items = deleteItems(w);
      if (items.length) return out(`the deploy would delete ${items.join(", ")}, and the data in it. Not deploying; paste this to Claude.`);
    }
  }

  // A queue's consumer (`[HOOKSConsumer]`) holds no data: Alchemy replaces it to point it at the queue's
  // current id, and the queue keeps its messages until it's back.
  const consumer = (r: Row) => r.action === "replace" && !r.binding && /^[A-Z][A-Z0-9_]*Consumer$/.test(r.id);
  // A new queue comes with its consumer (`[FIXES] create`, `[FIXESConsumer] create`, #1234): it holds only
  // messages and bills per operation, so it goes to the y/N before deploying instead of stopping the release.
  const made = (id: string) => rows.some((r) => r.id === id && !r.binding && r.action === "create");
  const newQueue = (r: Row) => r.action === "create" && !r.binding &&
    (made(`${r.id}Consumer`) || (/^[A-Z][A-Z0-9_]*Consumer$/.test(r.id) && made(r.id.slice(0, -"Consumer".length))));
  // A new KV namespace (`[STATS] create`, #1539) holds nothing yet and bills per read, so it goes to the y/N too.
  const newKv = (r: Row) => r.action === "create" && !r.binding && KV.includes(r.id);
  const making = (r: Row) => (mode.checksNew && r.id === "CI_RUNNER") || newQueue(r) || newKv(r);
  const risky: string[] = [], creates: string[] = [];
  for (const r of rows) {
    if (["delete", "replace", "orphaned", "unbind", "drop"].includes(r.action) && !consumer(r)) risky.push(r.line);
    // A binding the Worker gains is a setting on it; one on anything else comes with that resource.
    if (["create", "adopted"].includes(r.action) && !making(r) && !(r.binding && r.id === "Worker" && r.action === "create")) creates.push(r.line);
  }
  if (risky.length) return out(`the plan deletes, replaces or unbinds something (${risky.join("; ")}). Not deploying; paste this to Claude.`);
  if (creates.length) return out(`the plan makes or takes over something on Cloudflare (${creates.join("; ")}). Not deploying; paste this to Claude.`);
  return out(null);
}

/** Lines of `git status --porcelain` other than the files plan and deploy regenerate. */
export const dirtyFiles = (porcelain: string, app: string) =>
  porcelain.split("\n").filter(Boolean).filter((l) => !l.startsWith("??") && !GENERATED.some((f) => l.slice(3) === `${app}/${f}`));

// ---- the release ----

export interface Ran { code: number; out: string }
export interface IO {
  /** Runs a command with no stdin; `show` prints each line as it comes. Past `timeoutMs` it is killed and answers code 124. */
  run(cmd: string[], opts?: { cwd?: string; env?: Record<string, string | undefined>; show?: (line: string) => boolean; timeoutMs?: number }): Promise<Ran>;
  /** Asks y/N on the terminal. */
  ask(question: string): Promise<boolean>;
  say(line: string): void;
  sleep(ms: number): Promise<void>;
  exists(path: string): boolean;
  read(path: string): string;
  touch(path: string): void;
  get(url: string, headers?: Record<string, string>): Promise<{ status: number; body: string }>;
}

export interface Where { clone: string; wt: string; app: string; home: string }

export class Stop extends Error {}
const stop = (why: string): never => { throw new Stop(why); };

const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;

export async function release(io: IO, mode: Mode, where: Where, env: Record<string, string | undefined>) {
  const { clone, wt, app, home } = where;
  const appDir = join(wt, app);
  const checksOn = join(home, ".codesplitters-checks-on");
  const checks = mode.checksNew || io.exists(checksOn);
  // A Cloudflare token left exported in the terminal would beat the wrangler login; drop them all.
  const base: Record<string, string | undefined> = { ...env, CLOUDFLARE_API_TOKEN: undefined, CLOUDFLARE_ACCOUNT_ID: undefined, CF_API_TOKEN: undefined, CF_ACCOUNT_ID: undefined };
  const flags = { CODESPLITTER_DEPLOYS: "1", CODESPLITTER_AGENTS: "1", CODESPLITTER_PUSH_EVENTS: "1", CODESPLITTER_CHECKS: checks ? "1" : "0" };
  const git = (...args: string[]) => io.run(["git", "-C", wt, ...args]);

  // The plan runs first, always, and the deploy waits on a y/N after it: say so up front, since that's the step that gets left.
  io.say(yellow(`Heads up: this plans first (a minute or two, changes nothing), then asks y/N before deploying. Stay close: a notification pings you when it asks.`));
  io.say("1/5  1Password: unlock it if Touch ID asks");
  if ((await io.run(["op", "vault", "list"])).code !== 0) {
    await io.run(["open", "-a", "1Password"]);
    io.say("     waiting for you to unlock 1Password (2 minutes)…");
    let open = false;
    for (let i = 0; i < 60 && !open; i++) { await io.sleep(2000); open = (await io.run(["op", "vault", "list"])).code === 0; }
    if (!open) stop("1Password is still locked, or its CLI integration is off (Settings > Developer > Integrate with 1Password CLI). Then rerun.");
  }

  const states = join(clone, ".git", "rustybuns", "alchemy", app, "state");
  if (!io.exists(states)) stop(`the live Alchemy state isn't in ${states}. Not deploying; tell Claude.`);

  // Puts the worktree on the newest main. Agents merge all day, so this runs again whenever main
  // moves before the deploy: the CLI refuses a copy behind main, and what you approve must be what goes out.
  const sync = async () => {
    if ((await io.run(["git", "-C", clone, "fetch", "-q", "origin"])).code !== 0) stop("git fetch failed; check your internet, then rerun.");
    if (!io.exists(wt) && (await io.run(["git", "-C", clone, "worktree", "add", "-q", "--detach", wt, "origin/main"])).code !== 0) stop("couldn't make the release worktree; tell Claude.");
    await git("checkout", "-q", "--", ...GENERATED.map((f) => `${app}/${f}`));
    const dirty = dirtyFiles((await git("status", "--porcelain")).out, app);
    if (dirty.length) stop(`the release worktree has local changes (${dirty.map((l) => l.slice(3)).join(", ")}); tell Claude.`);
    if ((await git("checkout", "-q", "--detach", "origin/main")).code !== 0) stop("couldn't put the release worktree on origin/main; tell Claude.");
    if ((await io.run(["bun", "install"], { cwd: wt })).code !== 0) stop("bun install failed; paste this to Claude.");
    io.say(`     at ${(await git("log", "--oneline", "-1", "HEAD")).out.trim().slice(0, 90)}`);
  };
  const behind = async () => {
    await io.run(["git", "-C", clone, "fetch", "-q", "origin"]);
    return (await git("rev-parse", "HEAD")).out.trim() !== (await io.run(["git", "-C", clone, "rev-parse", "origin/main"])).out.trim();
  };

  io.say("2/5  Syncing to the latest main");
  await sync();

  io.say("3/5  Cloudflare login (from wrangler)");
  const wrangler = (...args: string[]) => io.run(["bunx", "wrangler", ...args], { cwd: appDir, env: base });
  const account = async () => ACCOUNT.exec((await wrangler("whoami")).out)?.[0] ?? null;
  // --json: since wrangler 4.155 the plain token goes to stderr (#2669).
  const token = async () => parseAuthToken((await wrangler("auth", "token", "--json")).out);
  // Logged out (it expires now and then): log in here with the scopes this app needs, and go on.
  const login = async (why: string) => {
    const s = await io.run(["bun", "-e", 'const c = (await import(process.cwd() + "/rustybuns.config.ts")).default; const { cloudflareScopes } = await import("../../packages/cli/src/cloudflare-auth.ts"); console.log(cloudflareScopes(c).join(" "))'], { cwd: appDir, env: { ...base, ...flags } });
    const scopes = s.out.trim().split("\n").at(-1)?.split(" ").filter(Boolean) ?? [];
    if (s.code !== 0 || !scopes.length) stop("couldn't work out which Cloudflare scopes to log in with; tell Claude.");
    io.say(`     ${why} Opening Cloudflare's login in your browser: sign in as notryanquinn and approve.`);
    if ((await io.run(["bunx", "wrangler", "login", "--scopes", ...scopes], { cwd: appDir, env: base, show: () => true })).code !== 0) stop("the Cloudflare login didn't finish; rerun to try again.");
  };
  let acct = await account();
  if (!acct) { await login("wrangler isn't logged in to the notryanquinn account."); acct = await account(); }
  if (!acct) stop("logged in, but wrangler still can't see the notryanquinn account. Run  npx wrangler logout  and rerun, picking that account.");
  let tok = await token();
  if (!tok) { await login("wrangler's login didn't hand over a token."); tok = await token(); }
  if (!tok) stop("wrangler still won't hand over a token after logging in; paste this to Claude.");
  const cf = { ...base, CLOUDFLARE_ACCOUNT_ID: acct!, CLOUDFLARE_API_TOKEN: tok! };
  // Wrangler's OAuth token lasts about an hour, and a release can sit at a question longer: each plan
  // and deploy asks wrangler again (it refreshes its own), keeping the last good one if it hands over none.
  const run = async () => { tok = (await token()) ?? tok; return { ...cf, CLOUDFLARE_API_TOKEN: tok!, ...flags, NO_COLOR: "1", FORCE_COLOR: "0" }; };

  // Every deploy builds the sandbox images with Docker: start Docker Desktop rather than fail halfway.
  // A wedged Docker Desktop (its CLI plugins stop answering) makes `docker info` hang forever: say so.
  const docker = () => io.run(["docker", "info"], { timeoutMs: 20_000 });
  const hung = "Docker Desktop isn't answering. Click the whale in the menu bar, choose Quit Docker Desktop, open Docker again, wait until it says it's running, then rerun.";
  let d = await docker();
  if (d.code === 124) stop(hung);
  if (d.code !== 0) {
    if (!io.exists("/Applications/Docker.app")) stop("Docker isn't running and Docker Desktop isn't installed; the sandboxes need it to build. Tell Claude.");
    await io.run(["open", "-a", "Docker"]);
    io.say("     starting Docker Desktop for the sandbox images (up to 3 minutes)…");
    let up = false;
    for (let i = 0; i < 90 && !up; i++) { await io.sleep(2000); d = await docker(); if (d.code === 124) stop(hung); up = d.code === 0; }
    if (!up) stop("Docker Desktop didn't start (3 minutes). Open it, wait for it to say it's running, then rerun.");
  }

  // The live URL is the one the config gives accounts, so it follows a rename.
  const site = /BETTER_AUTH_URL: \{ type: "var", value: "(https:\/\/[^"]+)"/.exec(io.read(join(appDir, "rustybuns.config.ts")))?.[1] ?? stop("couldn't find the site's URL in rustybuns.config.ts; tell Claude.");
  if (mode.checksNew) io.say(yellow("     --checks: turning on checks in a container; the plan may create CI_RUNNER (billed by use, capped at 2 instances)."));

  // Plan, show it, and stop on anything risky or billable. Changes nothing, costs nothing.
  const plan = async () => {
    for (let i = 0; i < 3; i++) {
      const p = await io.run(["bunx", "rustybuns", "plan"], { cwd: appDir, env: await run() });
      if (p.code !== 0) { io.say(p.out.split("\n").slice(-30).join("\n")); stop("plan failed (above). Not deploying; paste this to Claude."); }
      const v = checkPlan(p.out, mode);
      for (const l of v.show) io.say(`     ${l}`);
      if (v.stop) stop(v.stop);
      if (!v.behind) return;
      io.say(yellow("     main moved during the plan; syncing and planning again"));
      await sync();
    }
    stop("main kept moving (3 tries). Nothing was deployed; rerun in a minute.");
  };

  io.say("4/5  Plan (changes nothing, costs nothing)");
  await plan();
  for (let attempt = 0; attempt < 3; attempt++) {
    if (!(await io.ask("5/5  Deploy this to the live site?"))) stop("not deployed; nothing changed.");
    if (await behind()) {
      io.say(yellow("main moved while you were reading; syncing to it and planning again, so what you approve is what goes out"));
      await sync(); await plan(); continue;
    }
    const env = await run();
    const args = ["bunx", "rustybuns", "deploy", "--yes"];
    const d = await io.run(args, { cwd: appDir, env, show: (l) => !/\] noop/.test(l) });
    if (d.code === 0) {
      // Deployed means the live site answers, not just that the command finished.
      const s = await io.get(`${site}/api/session`);
      if (s.status !== 200) stop(`the deploy finished but the site answers ${s.status}; paste this to Claude.`);
      if (mode.checksNew) { io.touch(checksOn); io.say("     checks in a container are on; later releases keep them on (no flag needed)."); }
      return { site, head: (await git("log", "--oneline", "-1", "HEAD")).out.trim().slice(0, 60) };
    }
    // A merge can still land in the seconds before the deploy checks; anything else is a real failure.
    if (!(await behind())) stop("the deploy failed (above); nothing was marked deployed. Paste this to Claude.");
    io.say(yellow("main moved just as it deployed; nothing changed on Cloudflare. Syncing and planning again."));
    await sync(); await plan();
  }
  return stop("main kept moving (3 tries). Nothing was deployed; rerun in a minute.");
}

// ---- on the Mac ----

/** A macOS notification with a sound, for when the release waits on you: osascript with the text quoted for AppleScript. */
export const notifyCmd = (title: string, text: string) => {
  const q = (t: string) => `"${t.replace(/\s+/g, " ").trim().replace(/[\\"]/g, (c) => `\\${c}`)}"`;
  return ["osascript", "-e", `display notification ${q(text)} with title ${q(title)} sound name "Glass"`];
};

export const realIO: IO = {
  async run(cmd, opts = {}) {
    const env = opts.env ? Object.fromEntries(Object.entries(opts.env).filter(([, v]) => v !== undefined)) as Record<string, string> : undefined;
    const p = Bun.spawn(cmd, { cwd: opts.cwd, env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    let killed = false;
    const timer = opts.timeoutMs ? setTimeout(() => { killed = true; p.kill("SIGKILL"); }, opts.timeoutMs) : undefined;
    let out = "";
    const pump = async (s: ReadableStream<Uint8Array>) => {
      let buf = "";
      const text = new TextDecoder();
      for await (const bytes of s) {
        const chunk = text.decode(bytes, { stream: true });
        out += chunk; buf += chunk;
        const lines = buf.split("\n"); buf = lines.pop()!;
        if (opts.show) for (const l of lines) if (opts.show(l)) console.log(l);
      }
      if (opts.show && buf && opts.show(buf)) console.log(buf);
    };
    // A killed command's pipes can stay open in a grandchild (docker's plugins): don't wait on them past the kill.
    const pumped = Promise.all([pump(p.stdout), pump(p.stderr)]);
    const code = await p.exited;
    clearTimeout(timer);
    if (killed) return { code: 124, out };
    await pumped;
    return { code, out };
  },
  async ask(q) {
    // Ping: the terminal's bell, and a notification that reaches you in another app. Best effort, and
    // only with a person at a terminal: run by a script or an agent, there's nobody to call.
    if (process.stdin.isTTY) {
      process.stdout.write("\x07");
      try { Bun.spawn(notifyCmd("codeSplitter release is waiting on you", q), { stdout: "ignore", stderr: "ignore" }); } catch {}
    }
    const a = prompt(`\x1b[1;38;5;117m${q} [y/N]\x1b[0m`);
    return a?.trim().toLowerCase() === "y";
  },
  say: (l) => console.log(l),
  sleep: (ms) => Bun.sleep(ms),
  exists: existsSync,
  read: (p) => readFileSync(p, "utf8"),
  touch: (p) => writeFileSync(p, ""),
  async get(url, headers) {
    try { const r = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) }); return { status: r.status, body: await r.text() }; }
    catch { return { status: 0, body: "" }; }
  },
};

if (import.meta.main) {
  const home = process.env.HOME!;
  const clone = process.env.RELEASE_CLONE ?? `${home}/agent-office/QuinnsCode/RustyBuns`;
  const wt = process.env.RELEASE_WORKTREE ?? `${home}/agent-office/QuinnsCode/RustyBuns-release`;
  try {
    const r = await release(realIO, parseArgs(process.argv.slice(2)), { clone, wt, app: "apps/codesplitter", home }, { ...process.env });
    console.log(`\n\x1b[32m✔ deployed\x1b[0m  ${r.site}  (${r.head})`);
  } catch (e) {
    console.log(`\n\x1b[31m✖ ${e instanceof Stop ? e.message : `the release script crashed: ${(e as Error).stack ?? e}. Paste this to Claude.`}\x1b[0m`);
    process.exit(1);
  }
}
