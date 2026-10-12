// The server inside the agent container. One request runs one coding agent on
// one file: POST /run {cmd: {bin, args, env?}, path, text, also?} writes the file
// (and `also`'s {path: text}, the other files a fix task may edit) into a fresh
// directory, runs the CLI there, and answers {code, out, text, also?} with what
// it left (text: null if it removed the file). POST /test {files: {path: text}}
// writes a cut's files (src/cuts.ts) and runs `bun test` there: {code, out,
// report} (report: its JUnit XML). POST /deps-test {remote, files, pm, lock, only?} is the
// dependency doctor's run: a shallow clone of `remote` with `files` swapped in,
// an install with the repo's package manager, the test script if there is one (with
// `only`, just the tests for those files where it can: scoped.mjs), then the clone is deleted
// (answers {ok, out}). POST /deps-fix {cmd, remote, files, pm, name, out, tries, until?}
// is its fixer: a full clone with the update installed, where the agent (`cmd`,
// whose prompt has {{try}}, {{out}}, {{changelog}}, {{history}} and {{sites}}
// filled in each try) patches the code and the tests run again, until they pass
// or the tries run out (answers {ok, tries, out, edits: [{path, before, after}]}).
// Plain Node, no dependencies.
//
// The container's env holds the agent's logins, and the repo's own code (its
// install scripts, its tests) is collaborators' code, so the two never run as
// the same user (#646). In the container the server runs as root and starts
// the agent CLI as `node`, with the logins, and git, installs and tests as
// `runner`, without them. Another user's /proc/<pid>/environ is closed to
// `runner`, and so is /home/node; both share the `work` group, so each can
// write the clone the other works in. And the server answers one request and
// then stops listening (one container per request, see src/sandbox.ts), so
// code a run starts can't ask it for another as the agent.

import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { chmod, chown, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { scopedTest } from "./scoped.mjs";

/** An agent that runs longer than this is killed and reported as failed. */
const LIMIT_MS = Number(process.env.AGENT_TIMEOUT_MS ?? 10 * 60_000);

/** The agents' logins: the repo's install and tests never see them. */
const LOGINS = { ANTHROPIC_API_KEY: undefined, CLAUDE_CODE_OAUTH_TOKEN: undefined, OPENAI_API_KEY: undefined, CODEX_API_KEY: undefined };

/**
 * Who runs what (the users sandbox/Dockerfile makes): `agent` the CLI, with the
 * logins; `code` the repo's git, install and tests, without. Not under root (the
 * tests, a dev box), everything runs as whoever started the server.
 */
const WORK = 1500;
export const USERS = process.getuid?.() === 0
  ? { agent: { uid: 1000, gid: WORK, env: { HOME: "/home/node", USER: "node" } }, code: { uid: 1001, gid: WORK, env: { HOME: "/home/runner", USER: "runner", ...LOGINS } } }
  : { agent: { env: {} }, code: { env: LOGINS } };

/** A fresh directory the user `as` works in (and, through the group, the other one too). */
async function workdir(prefix, as) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  if (as.uid !== undefined) { await chown(dir, as.uid, as.gid); await chmod(dir, 0o2770); }
  return dir;
}

/** What the server (root) wrote under `dir` goes to `as`, so it can change it. */
async function hand(dir, as) {
  if (as.uid !== undefined) await exec("chown", ["-R", `${as.uid}:${as.gid}`, dir], dir, {}, { env: {} });
}

export async function run({ cmd, path, text, also }) {
  const dir = await workdir("agent-", USERS.agent);
  try {
    const files = { ...also, [path]: text }, at = (p) => join(dir, p);
    for (const p of Object.keys(files)) if (relative(dir, at(p)).startsWith("..")) return { code: 2, out: `bad path: ${p}`, text: null };
    for (const [p, t] of Object.entries(files)) {
      await mkdir(dirname(at(p)), { recursive: true });
      await writeFile(at(p), t);
    }
    await hand(dir, USERS.agent);
    const { code, out } = await exec(cmd.bin, cmd.args, dir, cmd.env);
    const left = (p) => readFile(at(p), "utf8").catch(() => null);
    const back = also ? { also: Object.fromEntries(await Promise.all(Object.keys(also).map(async (p) => [p, await left(p)]))) } : {};
    return { code, out, text: await left(path), ...back };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Runs one command in `cwd` as `as` (the agent unless said) and collects what it printed, killed after LIMIT_MS. */
function exec(bin, args, cwd, env = {}, as = USERS.agent) {
  return new Promise((done) => {
    const p = spawn(bin, args, { cwd, env: { ...process.env, ...env, ...as.env, PWD: cwd }, ...(as.uid !== undefined && { uid: as.uid, gid: as.gid }), stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    p.stdout.on("data", (b) => { out += b; });
    p.stderr.on("data", (b) => { out += b; });
    const timer = setTimeout(() => { out += `\nkilled after ${LIMIT_MS} ms`; p.kill("SIGKILL"); }, LIMIT_MS);
    p.on("error", (e) => { clearTimeout(timer); done({ code: 127, out: String(e) }); });
    p.on("close", (code) => { clearTimeout(timer); done({ code: code ?? 1, out }); });
  });
}

/** The dependency doctor's run (src/deps.ts): a clone with an update swapped in, installed and tested. */
const INSTALL = { bun: ["bun", "install"], npm: ["npm", "install"], pnpm: ["corepack", "pnpm", "install", "--no-frozen-lockfile"], yarn: ["corepack", "yarn", "install"] };

/** A clone of `remote` (`depth` 0: all of its history) with `files` swapped in, handed to `work`, then deleted. */
async function inClone(remote, files, depth, work) {
  const dir = await workdir("deps-", USERS.code);
  const run = async (bin, args, cwd = join(dir, "repo")) => {
    const r = await exec(bin, args, cwd, { CI: "1" }, USERS.code);
    return { code: r.code, out: `$ ${[bin, ...args].join(" ")}\n${r.out}`.replaceAll(remote, "<remote>") };
  };
  try {
    const clone = await run("git", ["clone", ...(depth ? ["--depth", String(depth)] : []), "--quiet", remote, "repo"], dir);
    if (clone.code !== 0) return { ok: false, out: clone.out };
    const repo = join(dir, "repo");
    for (const [path, text] of Object.entries(files ?? {})) {
      const at = join(repo, path);
      if (relative(repo, at).startsWith("..")) return { ok: false, out: `bad path: ${path}` };
      await mkdir(dirname(at), { recursive: true });
      await writeFile(at, text);
    }
    await hand(repo, USERS.code);
    return await work(repo, run);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const install = (run, pm) => { const [bin, ...args] = INSTALL[pm] ?? INSTALL.bun; return run(bin, args); };

/** The test script, if there is one; with `only`, just the tests for those files where it can (scoped.mjs). */
async function testScript(run, repo, pm, installed, only) {
  const pkg = JSON.parse(await readFile(join(repo, "package.json"), "utf8").catch(() => "{}"));
  if (!pkg.scripts?.test) return { ok: true, out: installed + "\n(no test script)" };
  const tracked = only?.length ? (await run("git", ["ls-files"])).out.split("\n").slice(1).filter(Boolean) : [];
  const scoped = scopedTest(pkg.scripts.test, only, tracked);
  if (scoped && (scoped[0] === "bun" || await readFile(join(repo, scoped[0])).then(() => true, () => false))) {
    const t = await run(scoped[0], scoped.slice(1));
    return { ok: t.code === 0, out: t.out };
  }
  const t = await (pm === "bun" ? run("bun", ["run", "test"]) : run(...(pm === "npm" ? ["npm", ["run", "test"]] : ["corepack", [pm, "run", "test"]])));
  return { ok: t.code === 0, out: t.out };
}

export function depsTest({ remote, files, pm = "bun", lock = null, only }) {
  return inClone(remote, files, 1, async (repo, run) => {
    const installed = await install(run, pm);
    if (installed.code !== 0) return { ok: false, out: installed.out };
    // The lockfile that install wrote, for the branch (bun.lockb is binary, so not that one).
    const locked = lock && lock !== "bun.lockb" ? await readFile(join(repo, lock), "utf8").then((l) => ({ lock: l }), () => ({})) : {};
    return { ...(await testScript(run, repo, pm, installed.out, only)), ...locked };
  });
}

const LOCKFILES = /(^|\/)(bun\.lockb?|package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/;
const tail = (s) => s.trim().slice(-1500);

/** The fixer (localFixer in src/deps.ts, in a container): the agent patches, the files the doctor owns go back, the tests decide. */
export async function depsFix({ cmd, remote, files, pm = "bun", name, out = "", tries: most = 3, until, usd: budget }) {
  const r = await inClone(remote, files, 0, async (repo, run) => {
    // The agent needs the history, not the remote, whose URL carries a token.
    await run("git", ["remote", "remove", "origin"]);
    const installed = await install(run, pm);
    const changelog = await Promise.any(["CHANGELOG.md", "HISTORY.md", "History.md", "CHANGES.md"].map((f) => readFile(join(repo, "node_modules", name, f), "utf8"))).catch(() => "");
    const context = {
      changelog: changelog.slice(0, 6000),
      history: (await run("git", ["log", "-n", "15", "--format=%h %an, %ar: %s", "-S", name])).out,
      sites: (await run("git", ["grep", "-n", "-F", name, "--", ".", ":!package.json", ":!*.lock", ":!*.lockb"])).out.slice(0, 6000),
    };
    // usd: what claude's JSON answers say the tries cost (deps.ts costOf); no try starts past the budget.
    let tries = 0, ok = false, slowest = 0, usd = 0;
    while (tries < most && !ok && installed.code === 0 && !(until && Date.now() + slowest > until) && !(budget !== undefined && usd >= budget)) {
      tries++;
      const t0 = Date.now();
      const values = { ...context, out: tail(out), try: String(tries) };
      const fill = (s) => s.replace(/\{\{(\w+)\}\}/g, (m, k) => k in values ? values[k].trim() || "(none)" : m);
      const ran = await exec(cmd.bin, cmd.args.map(fill), repo, cmd.env);
      usd += Number(/"total_cost_usd"\s*:\s*([\d.eE+-]+)/.exec(ran.out)?.[1]) || 0;
      for (const [path, text] of Object.entries(files ?? {})) await writeFile(join(repo, path), text);
      const gone = (await run("git", ["ls-files", "--deleted"])).out.split("\n").slice(1).filter(Boolean);
      if (gone.length) await run("git", ["checkout", "--", ...gone]);
      if (ran.code !== 0) out = `${cmd.bin} exited ${ran.code}:\n${ran.out.slice(-2000)}`;
      else {
        const again = await install(run, pm);
        ({ ok, out } = again.code !== 0 ? { ok: false, out: again.out } : await testScript(run, repo, pm, again.out));
      }
      slowest = Math.max(slowest, Date.now() - t0);
    }
    if (installed.code !== 0) out = installed.out;
    if (!ok) return { ok, tries, out, edits: [], usd };
    const status = (await run("git", ["status", "--porcelain", "--untracked-files=all"])).out.split("\n").slice(1);
    const edits = [];
    for (const line of status) {
      const path = line.slice(3).trim();
      if (!path || line.startsWith(" D") || path in (files ?? {}) || LOCKFILES.test(path) || path.startsWith("node_modules/")) continue;
      const before = line.startsWith("??") ? null : (await run("git", ["show", `HEAD:${path}`])).out.replace(/^.*\n/, "");
      edits.push({ path, before, after: await readFile(join(repo, path), "utf8") });
    }
    return { ok, tries, out, edits, usd };
  });
  return { tries: 0, edits: [], ...r };
}

/** A cut's files in a fresh directory, and `bun test` over them. */
export async function test({ files }) {
  const dir = await workdir("cut-", USERS.code);
  try {
    for (const [path, text] of Object.entries(files ?? {})) {
      const at = join(dir, path);
      if (relative(dir, at).startsWith("..")) return { code: 2, out: `bad path: ${path}` };
      await mkdir(dirname(at), { recursive: true });
      await writeFile(at, text);
    }
    // The cut's own files, and bun writing its report beside them.
    await hand(dir, USERS.code);
    const ran = await exec("bun", ["test", "--reporter=junit", "--reporter-outfile=.cut-report.xml"], dir, { CI: "1" }, USERS.code);
    return { ...ran, report: await readFile(join(dir, ".cut-report.xml"), "utf8").catch(() => "") };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const ROUTES = { "/run": run, "/test": test, "/deps-test": depsTest, "/deps-fix": depsFix };

if (import.meta.url === `file://${process.argv[1]}`) {
  // The repo's code and the agent share a group, never a user; anything either makes, the other can write.
  if (USERS.agent.uid !== undefined) process.umask(0o002);
  const server = createServer(async (req, res) => {
    // One request per container: once it's in, nobody else (no process it starts) gets one.
    server.close();
    const handle = ROUTES[req.url];
    if (req.method !== "POST" || !handle) { res.writeHead(404).end(); return; }
    let body = "";
    for await (const chunk of req) body += chunk;
    try {
      const out = await handle(JSON.parse(body));
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(out));
    } catch (e) {
      res.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ error: String(e) }));
    }
  });
  server.listen(8080);
}
