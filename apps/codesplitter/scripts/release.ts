// Releases codeSplitter to the live site, from the owner's Mac. ~/release-codesplitters.sh puts a
// worktree of the agent-office clone on origin/main and runs this from it:
//
//   zsh ~/release-codesplitters.sh            a release: plan, show it, ask, deploy, check the site
//   zsh ~/release-codesplitters.sh --checks   the first deploy with checks in a container (#776)
//   zsh ~/release-codesplitters.sh --move     the deploy that moves the data off the codesplitters-*
//                                             names (#809, #825), copying it first
//
// It deploys from that worktree, never the folder you're in. The live Alchemy state lives in the
// clone's git dir (.git/rustybuns/alchemy), shared by all its worktrees. Things it can fix it fixes:
// a locked 1Password, an expired wrangler login, Docker not running, files the last deploy
// regenerated, main moving while you read the plan. Anything that could lose data or cost money
// it stops on, and says so: a plan that deletes, replaces, unbinds or makes something it doesn't
// expect, or one of the CLI's own warnings. --move copies only after you say deploy, and deploys
// straight after, so the copy can't go stale while the question waits.
//
// The decisions are plain functions (checkPlan, dirtyFiles, …) and every command goes through an
// IO, so test/release.test.ts replays real plans and edge cases without touching anything live.

import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const ACCOUNT = /c2d417e6[0-9a-f]{24}/;
/** Plan and deploy rewrite these from rustybuns.config.ts and the flags (#776, the vault rename). */
export const GENERATED = ["wrangler.jsonc", ".env.schema"];
/** What --move renames (#809): each replaced, the new one adopted or made, the old one deleted. */
export const MOVED = ["DB", "HOOKS", "JOBS", "LEVEL_DIGS", "LEVEL_CHUNKS"];
const OLD = "codesplitters", NEW = "codesplitter";

export interface Mode { checksNew: boolean; move: boolean }

export function parseArgs(argv: string[]): Mode {
  const known = new Set(["--checks", "--move"]);
  const bad = argv.filter((a) => !known.has(a));
  if (bad.length) throw new Stop(`unknown option ${bad.join(" ")}: the options are --checks and --move`);
  return { checksNew: argv.includes("--checks"), move: argv.includes("--move") };
}

// ---- the plan ----

export const MOVE_PENDING = "the plan is the codesplitters move (#825), which hasn't run yet: DB, HOOKS, JOBS, LEVEL_DIGS and LEVEL_CHUNKS still have their old names. A plain release can't go out until it has.";

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

const movedItem = new RegExp(`^(D1|Queue|R2) (${MOVED.join("|")}) \\(${OLD}-[\\w-]+, renamed to ${NEW}-[\\w-]+\\)$`);

/** `move`: what stopped it is only the codesplitters move (#825), not run yet; --move is the release that does it. */
/**
 * A plain release's plan that stops only on the five renames: every risky row is one of MOVED, the old
 * DB replaced or deleted among them, and the delete warning, if printed, names nothing else.
 */
function movePending(rows: Row[], warnings: string[]) {
  const risky = rows.filter((r) => ["delete", "replace", "orphaned", "unbind", "drop", "create", "adopted"].includes(r.action) && !(r.binding && r.id === "Worker" && r.action === "create"));
  if (!risky.some((r) => r.id === "DB" && !r.binding && ["replace", "delete"].includes(r.action)) || !risky.every((r) => MOVED.includes(r.id) && !r.binding)) return false;
  if (warnings.some((w) => /Alchemy state is under the app name/.test(w))) return false;
  return warnings.filter((w) => /would delete/.test(w)).every((w) => deleteItems(w).every((i) => movedItem.test(i)));
}

export interface Verdict { show: string[]; stop: string | null; behind: boolean; move?: boolean }

/**
 * Whether a plan may go out as a release. A release only updates what's there: anything it makes,
 * takes over, replaces, deletes or unbinds stops it, except what the mode is for. A new setting on
 * the Worker (`[Worker/PRIVACY_EMAIL] create`) is free, so it passes.
 */
export function checkPlan(text: string, mode: Mode): Verdict {
  const { summary, rows, warnings } = parsePlan(text);
  const show = [...warnings, ...(summary ? [summary] : []), ...rows.filter((r) => r.action !== "noop").map((r) => r.line)];
  const out = (stop: string | null, behind = false): Verdict => ({ show, stop, behind });
  const toMove = (): Verdict => ({ show, stop: MOVE_PENDING, behind: false, move: true });
  if (summary && !mode.move && movePending(rows, warnings)) return toMove();
  if (!summary) return out("the plan printed no summary. Not deploying; paste this to Claude.");

  for (const w of warnings) {
    if (/behind origin\/main/.test(w)) return out(null, true);
    if (/Alchemy state is under the app name/.test(w)) return out("the Alchemy state is under the app's old name, so the deploy would make everything again. Not deploying; paste this to Claude.");
    if (/would delete/.test(w)) {
      const rest = deleteItems(w).filter((i) => !(mode.move && movedItem.test(i)));
      if (rest.length) return out(`the deploy would delete ${rest.join(", ")}, and the data in it. Not deploying; paste this to Claude.`);
    }
  }

  const moving = (r: Row) => mode.move && MOVED.includes(r.id);
  const making = (r: Row) => moving(r) || (mode.checksNew && r.id === "CI_RUNNER");
  const risky: string[] = [], made: string[] = [];
  for (const r of rows) {
    if (["delete", "replace", "orphaned", "unbind", "drop"].includes(r.action) && !moving(r)) risky.push(r.line);
    // A binding the Worker gains is a setting on it; one on anything else comes with that resource.
    if (["create", "adopted"].includes(r.action) && !making(r) && !(r.binding && r.id === "Worker" && r.action === "create")) made.push(r.line);
  }
  if (risky.length) return out(`the plan deletes, replaces or unbinds something (${risky.join("; ")}). Not deploying; paste this to Claude.`);
  if (made.length) return out(`the plan makes or takes over something on Cloudflare (${made.join("; ")}). Not deploying; paste this to Claude.`);
  if (mode.move && !rows.some((r) => r.id === "DB" && !r.binding && r.action !== "noop" && r.action !== "update"))
    return out("--move, but the plan doesn't move DB to codesplitter-db. Not deploying; paste this to Claude.");
  return out(null);
}

/** Lines of `git status --porcelain` other than the files plan and deploy regenerate. */
export const dirtyFiles = (porcelain: string, app: string) =>
  porcelain.split("\n").filter(Boolean).filter((l) => !l.startsWith("??") && !GENERATED.some((f) => l.slice(3) === `${app}/${f}`));

/** The ready levels in /api/levels: they come from D1, so the count says which database the site reads. */
export const readyLevels = (body: string) => {
  try { const j = JSON.parse(body); return Array.isArray(j) ? j.filter((l) => l?.status === "ready").length : null; } catch { return null; }
};

// ---- the release ----

export interface Ran { code: number; out: string }
export interface IO {
  /** Runs a command with no stdin; `show` prints each line as it comes. */
  run(cmd: string[], opts?: { cwd?: string; env?: Record<string, string | undefined>; show?: (line: string) => boolean }): Promise<Ran>;
  /** Asks y/N on the terminal. */
  ask(question: string): Promise<boolean>;
  say(line: string): void;
  sleep(ms: number): Promise<void>;
  exists(path: string): boolean;
  read(path: string): string;
  touch(path: string): void;
  rename(from: string, to: string): void;
  get(url: string, headers?: Record<string, string>): Promise<{ status: number; body: string }>;
}

export interface Where { clone: string; wt: string; app: string; home: string }

export class Stop extends Error {}
/** Stopped only because the codesplitters move (#825) hasn't run: `main` offers to run it. */
export class NeedsMove extends Stop {}
const stop = (why: string): never => { throw new Stop(why); };

const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;

export async function release(io: IO, mode: Mode, where: Where, env: Record<string, string | undefined>) {
  const { clone, wt, app, home } = where;
  const appDir = join(wt, app);
  const checksOn = join(home, ".codesplitters-checks-on");
  const checks = mode.checksNew || io.exists(checksOn);
  // A Cloudflare token left exported in the terminal would beat the wrangler login; drop them all.
  const base: Record<string, string | undefined> = { ...env, CLOUDFLARE_API_TOKEN: undefined, CLOUDFLARE_ACCOUNT_ID: undefined, CF_API_TOKEN: undefined, CF_ACCOUNT_ID: undefined };
  const flags = { CODESPLITTER_DEPLOYS: "1", CODESPLITTER_AGENTS: "1", CODESPLITTER_CHECKS: checks ? "1" : "0" };
  const git = (...args: string[]) => io.run(["git", "-C", wt, ...args]);

  // The plan runs first, always, and the deploy waits on a y/N after it: say so up front, since that's the step that gets left.
  io.say(yellow(`Heads up: this plans first (a minute or two, changes nothing), then asks y/N before ${mode.move ? "copying the data and deploying" : "deploying"}. Stay close: a notification pings you when it asks.`));
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
  // The state still under the old app name means the move hasn't run: know that now, not after a minute's plan.
  if (!mode.move && io.exists(join(states, OLD))) throw new NeedsMove(`the Alchemy state is still under the old app name (${join(states, OLD)}), so the codesplitters move (#825) hasn't run yet. A plain release can't go out until it has.`);

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
  const token = async () => { const t = (await wrangler("auth", "token")).out.trim().split("\n").at(-1)?.trim() ?? ""; return t.length >= 20 ? t : null; };
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
  const run = { ...cf, ...flags, NO_COLOR: "1", FORCE_COLOR: "0" };

  // Every deploy builds the sandbox images with Docker: start Docker Desktop rather than fail halfway.
  if ((await io.run(["docker", "info"])).code !== 0) {
    if (!io.exists("/Applications/Docker.app")) stop("Docker isn't running and Docker Desktop isn't installed; the sandboxes need it to build. Tell Claude.");
    await io.run(["open", "-a", "Docker"]);
    io.say("     starting Docker Desktop for the sandbox images (up to 3 minutes)…");
    let up = false;
    for (let i = 0; i < 90 && !up; i++) { await io.sleep(2000); up = (await io.run(["docker", "info"])).code === 0; }
    if (!up) stop("Docker Desktop didn't start (3 minutes). Open it, wait for it to say it's running, then rerun.");
  }

  // The live URL is the one the config gives accounts, so it follows a rename.
  const site = /BETTER_AUTH_URL: \{ type: "var", value: "(https:\/\/[^"]+)"/.exec(io.read(join(appDir, "rustybuns.config.ts")))?.[1] ?? stop("couldn't find the site's URL in rustybuns.config.ts; tell Claude.");
  const levels = async () => readyLevels((await io.get(`${site}/api/levels`)).body);
  let before: number | null = null;
  const moveScript = (...args: string[]) => io.run(["bun", "scripts/move-resources.ts", ...args], { cwd: appDir, env: cf, show: () => true });

  if (mode.move) {
    io.say("3b   Getting ready to move the data off the codesplitters names (#825)");
    before = await levels();
    if (before === null) stop("couldn't read the live levels list before the move; tell Claude.");
    io.say(`     the live site lists ${before} ready levels; it should after the move too`);
    // The stack is named after the app, so the state moves to the new name before the plan reads it.
    const from = join(states, OLD), to = join(states, NEW);
    if (io.exists(from)) {
      if (io.exists(to)) stop(`the Alchemy state is under both ${from} and ${to}. Not deploying; tell Claude.`);
      io.rename(from, to);
      io.say(`     moved the Alchemy state to the app's name, ${NEW}`);
    }
    // The move script finds the state at .alchemy/state, which plan links, and plan hasn't run yet.
    const link = await io.run(["bun", "-e", 'const { linkSharedState } = await import("../../packages/cli/src/state.ts"); linkSharedState(process.cwd())'], { cwd: appDir });
    if (link.code !== 0) stop(`couldn't link the shared Alchemy state (${link.out.trim().split("\n").at(-1)}); tell Claude.`);
    io.say("     what's there (reads only):");
    if ((await moveScript()).code !== 0) stop("the move script stopped (above). Nothing was copied or deleted; paste this to Claude.");
    await io.run(["open", `https://dash.cloudflare.com/${acct}/workers/queues`]);
    io.say("     The deploy deletes the old queues with any messages still in them. The Queues page just opened.");
    if (!(await io.ask(`3b   Do ${OLD}-hooks, ${OLD}-jobs and ${OLD}-level-digs all show a backlog of 0?`))) stop("stopped; nothing was copied or deleted.");
  }
  if (mode.checksNew) io.say(yellow("     --checks: turning on checks in a container; the plan may create CI_RUNNER (billed by use, capped at 2 instances)."));
  if (mode.move) io.say(yellow(`     --move: ${MOVED.join(", ")} move to their ${NEW}-* names, and the old ones are deleted.`));

  // Plan, show it, and stop on anything risky or billable. Changes nothing, costs nothing.
  const plan = async () => {
    for (let i = 0; i < 3; i++) {
      const p = await io.run(["bunx", "rustybuns", "plan"], { cwd: appDir, env: run });
      if (p.code !== 0) { io.say(p.out.split("\n").slice(-30).join("\n")); stop("plan failed (above). Not deploying; paste this to Claude."); }
      const v = checkPlan(p.out, mode);
      for (const l of v.show) io.say(`     ${l}`);
      if (v.move) throw new NeedsMove(v.stop!);
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
    if (!(await io.ask(mode.move ? "5/5  Copy the data and deploy this to the live site?" : "5/5  Deploy this to the live site?"))) stop("not deployed; nothing changed.");
    if (await behind()) {
      io.say(yellow("main moved while you were reading; syncing to it and planning again, so what you approve is what goes out"));
      await sync(); await plan(); continue;
    }
    if (mode.move) {
      // Only now: the deploy follows at once, so nothing written meanwhile is left behind. A write
      // landing during the copy makes the counts differ; the second try copies again.
      io.say("     copying the data to the new names:");
      if ((await moveScript("--copy")).code !== 0 && (await moveScript("--copy")).code !== 0)
        stop("the copy stopped twice (above). Nothing was deleted, and the live site still reads the old names; paste this to Claude.");
    }
    const args = ["bunx", "rustybuns", "deploy", "--yes", ...(mode.move ? ["--allow-delete"] : [])];
    const d = await io.run(args, { cwd: appDir, env: run, show: (l) => !/\] noop/.test(l) });
    if (d.code === 0) {
      // Deployed means the live site answers, not just that the command finished.
      const s = await io.get(`${site}/api/session`);
      if (s.status !== 200) stop(`the deploy finished but the site answers ${s.status}; paste this to Claude.`);
      if (mode.move) {
        const now = await levels();
        if (now !== before) stop(`moved, but the site lists ${now} ready levels, not ${before}. The export is in ${appDir}/.rustybuns/moved; paste this to Claude.`);
        io.say(`     the site reads the moved database: ${now} ready levels, as before`);
      }
      if (mode.checksNew) { io.touch(checksOn); io.say("     checks in a container are on; later releases keep them on (no flag needed)."); }
      return { site, head: (await git("log", "--oneline", "-1", "HEAD")).out.trim().slice(0, 60) };
    }
    // A merge can still land in the seconds before the deploy checks; anything else is a real failure.
    if (!(await behind())) stop(mode.move
      ? "the deploy failed (above). The live site still reads the old names; a rerun of --move copies again. Paste this to Claude."
      : "the deploy failed (above); nothing was marked deployed. Paste this to Claude.");
    io.say(yellow("main moved just as it deployed; nothing changed on Cloudflare. Syncing and planning again."));
    await sync(); await plan();
  }
  return stop("main kept moving (3 tries). Nothing was deployed; rerun in a minute.");
}

/**
 * The release, and when a plain one finds the codesplitters move still to do, the offer to do it then
 * and there: --move asks again before it copies anything, and before the deploy deletes anything.
 */
export async function main(io: IO, mode: Mode, where: Where, env: Record<string, string | undefined>) {
  try { return await release(io, mode, where, env); }
  catch (e) {
    if (!(e instanceof NeedsMove) || mode.move) throw e;
    io.say(yellow(`     ${e.message}`));
    if (!(await io.ask("     Run the move now? (the same as --move: it copies the data first, and asks before deploying)")))
      stop("not deployed; nothing changed. When you're ready:  zsh ~/release-codesplitters.sh --move");
    return release(io, { ...mode, move: true }, where, env);
  }
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
    await Promise.all([pump(p.stdout), pump(p.stderr)]);
    return { code: await p.exited, out };
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
  rename: renameSync,
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
    const r = await main(realIO, parseArgs(process.argv.slice(2)), { clone, wt, app: "apps/codesplitter", home }, { ...process.env });
    console.log(`\n\x1b[32m✔ deployed\x1b[0m  ${r.site}  (${r.head})`);
  } catch (e) {
    console.log(`\n\x1b[31m✖ ${e instanceof Stop ? e.message : `the release script crashed: ${(e as Error).stack ?? e}. Paste this to Claude.`}\x1b[0m`);
    process.exit(1);
  }
}
