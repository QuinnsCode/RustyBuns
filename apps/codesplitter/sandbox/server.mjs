// The server inside the agent container. One request runs one coding agent on
// one file: POST /run {cmd: {bin, args, env?, say?}, path, text, also?} writes the file
// (and `also`'s {path: text}, the other files a fix task may edit) into a fresh
// directory, runs the CLI there, and answers {code, out, text, also?} with what
// it left (text: null if it removed the file). A listening run (cmd.say, #3711) comes as NDJSON:
// the run on its first line, then {"note"} lines while it works, each written to the CLI's stdin
// after `say` till its turn's result; it also answers `heard`, the notes that went in, and `kept`,
// claude's log of the turn, which a `kept` in the next run's body puts back for its --resume (#3715). POST /test {files: {path: text}}
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
// POST /regenerate {remote, files, pm, cwd, command, read} rebuilds a merge's generated
// text (src/deps.ts regenerateDocs): a shallow clone with `files` swapped in, an install,
// `command` run from the folder `cwd`, and the files in `read` read back (answers {ok, out, files}).
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
import { constants } from "node:fs";
import { chmod, chown, mkdtemp, mkdir, open, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative } from "node:path";
import { scopedTest } from "./scoped.mjs";

/**
 * The text of `p` under `root`, as the agent or the repo's code left it, or null. The server reading
 * it is root, and they aren't: a symlink there to /proc/1/environ (the agent's logins) or another
 * user's home would hand back what they can't read themselves. So no symlink, at the end or on the
 * way, nothing that isn't a plain file (a fifo would hang the read), and nothing outside `root`.
 */
export async function readInside(root, p) {
  try {
    const [top, dir] = await Promise.all([realpath(root), realpath(dirname(join(root, p)))]);
    const rel = relative(top, dir);
    if (rel.startsWith("..") || isAbsolute(rel)) return null;
    const fh = await open(join(dir, basename(p)), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try { return (await fh.stat()).isFile() ? await fh.readFile("utf8") : null; } finally { await fh.close(); }
  } catch { return null; }
}

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

/** A claude session id. */
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** The longest session log that goes back to the thread (src/thread-do.ts SESSION_CHARS). */
const SESSION_CHARS = 8_000_000;
/** The folder claude keeps a directory's sessions in, under its config dir: every character but a letter or digit a dash. */
export const projectDir = (cwd) => cwd.replace(/[^a-zA-Z0-9]/g, "-");
/** The last session id a claude stream-json run printed (its init and result lines carry it). */
export const sessionIdOf = (out) => [...out.matchAll(/"session_id"\s*:\s*"([^"]+)"/g)].map((m) => m[1]).filter((id) => SESSION_ID.test(id)).pop();

/**
 * One agent on one file. `notes` (a listening run's streamed body, #3711): what people say while it works, each
 * written to its stdin after `cmd.say` (claude's stream-json) till its turn's result. Answers which went in (`heard`).
 *
 * A listening run gets a claude config dir of its own (CLAUDE_CONFIG_DIR, beside its directory), and answers the
 * session claude kept there (`kept`: {id, log, cwd}), which its thread keeps (#3715). Given `kept`, that log goes
 * back where claude looks for it, its old directory swapped for this one, so the `--resume` in `cmd` finds it: the
 * container went when the last turn ended, so a quiet thread costs nothing, and the next turn starts where it stopped.
 */
export async function run({ cmd, path, text, also, given, kept }, notes) {
  const listening = typeof cmd.say === "string";
  const dir = await workdir("agent-", USERS.agent), conf = listening ? await workdir("claude-", USERS.agent) : null;
  try {
    const files = { ...also, [path]: text }, at = (p) => join(dir, p);
    for (const p of Object.keys(files)) if (relative(dir, at(p)).startsWith("..")) return { code: 2, out: `bad path: ${p}`, text: null };
    // Files dropped into its thread (#3723): in .thread/, beside what it edits, never read back. More come down `notes` as it works.
    await give(dir, given);
    const told = notes && (async function* () { for await (const n of notes) { if (typeof n === "string") yield n; else { await give(dir, [n]); await hand(join(dir, ".thread"), USERS.agent); } } })();
    for (const [p, t] of Object.entries(files)) {
      await mkdir(dirname(at(p)), { recursive: true });
      await writeFile(at(p), t);
    }
    await hand(dir, USERS.agent);
    // claude names a directory's folder after its real path.
    const cwd = await realpath(dir), folder = conf && join("projects", projectDir(cwd));
    if (conf && SESSION_ID.test(kept?.id ?? "") && typeof kept.log === "string") {
      await mkdir(join(conf, folder), { recursive: true });
      await writeFile(join(conf, folder, `${kept.id}.jsonl`), typeof kept.cwd === "string" && kept.cwd ? kept.log.replaceAll(kept.cwd, cwd) : kept.log);
      await hand(conf, USERS.agent);
    }
    const env = conf ? { ...cmd.env, CLAUDE_CONFIG_DIR: conf } : cmd.env;
    const { code, out, heard } = await exec(cmd.bin, cmd.args, dir, env, USERS.agent, listening ? { say: cmd.say, notes: told } : undefined);
    const left = (p) => readInside(dir, p);
    const back = also ? { also: Object.fromEntries(await Promise.all(Object.keys(also).map(async (p) => [p, await left(p)]))) } : {};
    const id = conf && sessionIdOf(out), log = id && await readInside(conf, join(folder, `${id}.jsonl`));
    const ran = log && log.length <= SESSION_CHARS ? { kept: { id, log, cwd } } : {};
    return { code, out, text: await left(path), ...back, ...(heard?.length && { heard }), ...ran };
  } finally {
    await rm(dir, { recursive: true, force: true });
    if (conf) await rm(conf, { recursive: true, force: true });
  }
}

/** Writes files dropped into a thread under `dir`/.thread (src/agent-run.ts give): base64 bytes, a path nowhere else. */
async function give(dir, files) {
  for (const f of Array.isArray(files) ? files : []) {
    if (typeof f?.path !== "string" || typeof f.b64 !== "string" || !/^\.thread\/[\w.-]+$/.test(f.path) || f.path.includes("..")) continue;
    await mkdir(join(dir, ".thread"), { recursive: true });
    await writeFile(join(dir, f.path), Buffer.from(f.b64, "base64"));
  }
}

/** One user message on claude's stream-json stdin (src/harness.ts streamMessage). */
const streamMessage = (text) => JSON.stringify({ type: "user", message: { role: "user", content: text } }) + "\n";

/**
 * Runs one command in `cwd` as `as` (the agent unless said) and collects what it printed, killed after LIMIT_MS.
 * With `talk`, its stdin is open: `talk.say`, then each of `talk.notes` as it comes, till a result line ends its turn.
 */
function exec(bin, args, cwd, env = {}, as = USERS.agent, talk) {
  return new Promise((done) => {
    const p = spawn(bin, args, { cwd, env: { ...process.env, ...env, ...as.env, PWD: cwd }, ...(as.uid !== undefined && { uid: as.uid, gid: as.gid }), stdio: [talk ? "pipe" : "ignore", "pipe", "pipe"] });
    let out = "", rest = "", open = !!talk;
    const heard = [];
    const write = (t) => { if (!open) return false; try { p.stdin.write(streamMessage(t)); return true; } catch { return false; } };
    const close = () => { if (!open) return; open = false; try { p.stdin.end(); } catch { /* gone */ } };
    if (talk) {
      p.stdin.on("error", () => { open = false; });
      write(talk.say);
      void (async () => { try { for await (const n of talk.notes ?? []) { if (!open) break; if (write(n)) heard.push(n); } } catch { /* the caller hung up */ } })();
    }
    p.stdout.on("data", (b) => {
      out += b;
      if (!open) return;
      rest += b;
      for (let nl = rest.indexOf("\n"); nl >= 0 && open; nl = rest.indexOf("\n")) {
        const line = rest.slice(0, nl);
        rest = rest.slice(nl + 1);
        try { if (JSON.parse(line)?.type === "result") close(); } catch { /* not a stream-json line */ }
      }
    });
    p.stderr.on("data", (b) => { out += b; });
    const timer = setTimeout(() => { out += `\nkilled after ${LIMIT_MS} ms`; p.kill("SIGKILL"); }, LIMIT_MS);
    p.on("error", (e) => { clearTimeout(timer); done({ code: 127, out: String(e) }); });
    p.on("close", (code) => { clearTimeout(timer); close(); done({ code: code ?? 1, out, ...(talk && { heard }) }); });
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

export function depsTest({ remote, files, pm = "bun", lock = null, only, build }) {
  return inClone(remote, files, 1, async (repo, run) => {
    // No package.json: the repo's own build, nothing to install (#1407).
    if (build?.length) { const b = await run(build[0], build.slice(1)); return { ok: b.code === 0, out: b.out }; }
    const installed = await install(run, pm);
    if (installed.code !== 0) return { ok: false, out: installed.out };
    // The lockfile that install wrote, for the branch (bun.lockb is binary, so not that one).
    const locked = lock && lock !== "bun.lockb" ? await readFile(join(repo, lock), "utf8").then((l) => ({ lock: l }), () => ({})) : {};
    return { ...(await testScript(run, repo, pm, installed.out, only)), ...locked };
  });
}

/** A merge's generated text made again (localRegenerator in src/deps.ts, in a container): install, the command from `cwd`, `read` read back. */
export function regenerate({ remote, files, pm = "bun", cwd = "", command, read = [] }) {
  return inClone(remote, files, 1, async (repo, run) => {
    const inside = (p) => !relative(repo, join(repo, p)).startsWith("..");
    const bad = [cwd, ...read].find((p) => !inside(p));
    if (bad !== undefined) return { ok: false, out: `bad path: ${bad}` };
    const installed = await install(run, pm);
    if (installed.code !== 0) return { ok: false, out: installed.out };
    const [bin, ...args] = String(command ?? "").split(/\s+/).filter(Boolean);
    if (!bin) return { ok: false, out: "no command" };
    const r = await run(bin, args, join(repo, cwd));
    if (r.code !== 0) return { ok: false, out: r.out };
    const back = await Promise.all(read.map(async (p) => [p, await readInside(repo, p)]));
    return { ok: true, out: r.out, files: Object.fromEntries(back.filter(([, t]) => t !== null)) };
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
      // A symlink, a fifo or a path out of the clone isn't an edit: the repo's code may have left it to be read as root.
      const after = await readInside(repo, path);
      if (after === null) continue;
      const before = line.startsWith("??") ? null : (await run("git", ["show", `HEAD:${path}`])).out.replace(/^.*\n/, "");
      edits.push({ path, before, after });
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

/** A streamed body's lines, one at a time. */
export async function* linesOf(stream) {
  let rest = "";
  const dec = new TextDecoder();
  for await (const chunk of stream) {
    rest += typeof chunk === "string" ? chunk : dec.decode(chunk, { stream: true });
    for (let nl = rest.indexOf("\n"); nl >= 0; nl = rest.indexOf("\n")) { const l = rest.slice(0, nl); rest = rest.slice(nl + 1); if (l.trim()) yield l; }
  }
  if (rest.trim()) yield rest;
}

/** The notes behind a streamed run's first line: each {"note": text}, and each {"file": {path, b64}} (#3723) as it is; anything else skipped. */
export async function* notesOf(lines) {
  for await (const l of lines) {
    try {
      const m = JSON.parse(l), n = m?.note, f = m?.file;
      if (typeof n === "string" && n.trim()) yield n.slice(0, 4000);
      else if (typeof f?.path === "string" && typeof f.b64 === "string") yield { path: f.path, b64: f.b64 };
    } catch { /* not a note */ }
  }
}

const ROUTES = { "/run": run, "/test": test, "/deps-test": depsTest, "/deps-fix": depsFix, "/regenerate": regenerate };

if (import.meta.url === `file://${process.argv[1]}`) {
  // The repo's code and the agent share a group, never a user; anything either makes, the other can write.
  if (USERS.agent.uid !== undefined) process.umask(0o002);
  const server = createServer(async (req, res) => {
    // One request per container: once it's in, nobody else (no process it starts) gets one.
    server.close();
    const handle = ROUTES[req.url];
    if (req.method !== "POST" || !handle) { res.writeHead(404).end(); return; }
    try {
      // A listening run streams (NDJSON): the run on its first line, then {"note"} lines while it works.
      const lines = req.headers["content-type"] === "application/x-ndjson" ? linesOf(req) : null;
      let body = "";
      if (lines) body = (await lines.next()).value ?? "";
      else for await (const chunk of req) body += chunk;
      const out = await handle(JSON.parse(body), lines && notesOf(lines));
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(out));
    } catch (e) {
      res.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ error: String(e) }));
    }
  });
  server.listen(8080);
}
