// The server inside the agent container. One request runs one coding agent on
// one file: POST /run {cmd: {bin, args, env?}, path, text} writes the file into a
// fresh directory, runs the CLI there, and answers {code, out, text} with what
// it left (text: null if it removed the file). POST /test {files: {path: text}}
// writes a cut's files (src/cuts.ts) and runs `bun test` there: {code, out,
// report} (report: its JUnit XML). POST /deps-test {remote, files} is the
// dependency doctor's run: a shallow clone of `remote` with `files` swapped in,
// `bun install`, the test script if there is one, then the clone is deleted
// (answers {ok, out}).
// Plain Node, no dependencies.

import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";

/** An agent that runs longer than this is killed and reported as failed. */
const LIMIT_MS = Number(process.env.AGENT_TIMEOUT_MS ?? 10 * 60_000);

export async function run({ cmd, path, text }) {
  const dir = await mkdtemp(join(tmpdir(), "agent-"));
  try {
    const at = join(dir, path);
    if (relative(dir, at).startsWith("..")) return { code: 2, out: `bad path: ${path}`, text: null };
    await mkdir(dirname(at), { recursive: true });
    await writeFile(at, text);
    const { code, out } = await exec(cmd.bin, cmd.args, dir, cmd.env);
    const left = await readFile(at, "utf8").catch(() => null);
    return { code, out, text: left };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Runs one command in `cwd` and collects what it printed, killed after LIMIT_MS. */
function exec(bin, args, cwd, env = {}) {
  return new Promise((done) => {
    const p = spawn(bin, args, { cwd, env: { ...process.env, ...env, PWD: cwd }, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    p.stdout.on("data", (b) => { out += b; });
    p.stderr.on("data", (b) => { out += b; });
    const timer = setTimeout(() => { out += `\nkilled after ${LIMIT_MS} ms`; p.kill("SIGKILL"); }, LIMIT_MS);
    p.on("error", (e) => { clearTimeout(timer); done({ code: 127, out: String(e) }); });
    p.on("close", (code) => { clearTimeout(timer); done({ code: code ?? 1, out }); });
  });
}

/** The dependency doctor's run (src/deps.ts): a clone with an update swapped in, installed and tested. */
export async function depsTest({ remote, files }) {
  const dir = await mkdtemp(join(tmpdir(), "deps-"));
  const run = async (bin, args, cwd) => {
    const r = await exec(bin, args, cwd, { CI: "1" });
    return { code: r.code, out: `$ ${[bin, ...args].join(" ")}\n${r.out}`.replaceAll(remote, "<remote>") };
  };
  try {
    const clone = await run("git", ["clone", "--depth", "1", "--quiet", remote, "repo"], dir);
    if (clone.code !== 0) return { ok: false, out: clone.out };
    const repo = join(dir, "repo");
    for (const [path, text] of Object.entries(files ?? {})) {
      const at = join(repo, path);
      if (relative(repo, at).startsWith("..")) return { ok: false, out: `bad path: ${path}` };
      await writeFile(at, text);
    }
    const install = await run("bun", ["install"], repo);
    if (install.code !== 0) return { ok: false, out: install.out };
    const pkg = JSON.parse(await readFile(join(repo, "package.json"), "utf8").catch(() => "{}"));
    if (!pkg.scripts?.test) return { ok: true, out: install.out + "\n(no test script)" };
    const t = await run("bun", ["run", "test"], repo);
    return { ok: t.code === 0, out: t.out };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** A cut's files in a fresh directory, and `bun test` over them. */
export async function test({ files }) {
  const dir = await mkdtemp(join(tmpdir(), "cut-"));
  try {
    for (const [path, text] of Object.entries(files ?? {})) {
      const at = join(dir, path);
      if (relative(dir, at).startsWith("..")) return { code: 2, out: `bad path: ${path}` };
      await mkdir(dirname(at), { recursive: true });
      await writeFile(at, text);
    }
    const ran = await new Promise((done) => {
      const p = spawn("bun", ["test", "--reporter=junit", "--reporter-outfile=.cut-report.xml"], { cwd: dir, env: { ...process.env, CI: "1", PWD: dir }, stdio: ["ignore", "pipe", "pipe"] });
      let out = "";
      p.stdout.on("data", (b) => { out += b; });
      p.stderr.on("data", (b) => { out += b; });
      const timer = setTimeout(() => { out += `\nkilled after ${LIMIT_MS} ms`; p.kill("SIGKILL"); }, LIMIT_MS);
      p.on("error", (e) => { clearTimeout(timer); done({ code: 127, out: String(e) }); });
      p.on("close", (code) => { clearTimeout(timer); done({ code: code ?? 1, out }); });
    });
    return { ...ran, report: await readFile(join(dir, ".cut-report.xml"), "utf8").catch(() => "") };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const ROUTES = { "/run": run, "/test": test, "/deps-test": depsTest };

if (import.meta.url === `file://${process.argv[1]}`) {
  createServer(async (req, res) => {
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
  }).listen(8080);
}
