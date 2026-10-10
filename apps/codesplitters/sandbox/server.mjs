// The server inside the agent container. One request runs one coding agent on
// one file: POST /run {cmd: {bin, args, env?}, path, text} writes the file into a
// fresh directory, runs the CLI there, and answers {code, out, text} with what
// it left (text: null if it removed the file). POST /test {files: {path: text}}
// writes a cut's files (src/cuts.ts) and runs `bun test` there: {code, out,
// report} (report: its JUnit XML).
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
    const { code, out } = await new Promise((done) => {
      const p = spawn(cmd.bin, cmd.args, { cwd: dir, env: { ...process.env, ...cmd.env, PWD: dir }, stdio: ["ignore", "pipe", "pipe"] });
      let out = "";
      p.stdout.on("data", (b) => { out += b; });
      p.stderr.on("data", (b) => { out += b; });
      const timer = setTimeout(() => { out += `\nkilled after ${LIMIT_MS} ms`; p.kill("SIGKILL"); }, LIMIT_MS);
      p.on("error", (e) => { clearTimeout(timer); done({ code: 127, out: String(e) }); });
      p.on("close", (code) => { clearTimeout(timer); done({ code: code ?? 1, out }); });
    });
    const left = await readFile(at, "utf8").catch(() => null);
    return { code, out, text: left };
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

if (import.meta.url === `file://${process.argv[1]}`) {
  createServer(async (req, res) => {
    const handler = req.method === "POST" && { "/run": run, "/test": test }[req.url];
    if (!handler) { res.writeHead(404).end(); return; }
    let body = "";
    for await (const chunk of req) body += chunk;
    try {
      const out = await handler(JSON.parse(body));
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(out));
    } catch (e) {
      res.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ error: String(e) }));
    }
  }).listen(8080);
}
