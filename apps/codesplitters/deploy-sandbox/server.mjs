// The server inside the deploy container. POST /exec {cmd: [bin, ...args], cwd, limit_ms?}
// runs one command of a deploy (git clone, bun install, rustybuns deploy) in a
// directory under /work and answers {code, out}. limit_ms is what's left of the
// run's time; the command is killed when it's up. The deploy key is already in
// this container's env (see DeployRunner in src/deploy-runner.ts), so the
// commands inherit it. Runs under Node (see the Dockerfile); plain Node APIs, no dependencies.
//
// POST /state {cwd, files?} carries the app's Alchemy state (.alchemy/state) across
// runs, since each container starts empty: with files it writes them, without it
// answers {files} as they are after the deploy. DeployRunner keeps them sealed.

import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

const ROOT = process.env.WORK_ROOT ?? "/work";
/** A command that runs longer than this is killed and fails its step. */
const LIMIT_MS = Number(process.env.DEPLOY_TIMEOUT_MS ?? 15 * 60_000);
const MAX_OUT = 60_000;

export async function exec({ cmd, cwd, limit_ms }, root = ROOT, max = LIMIT_MS) {
  const limitMs = Number(limit_ms) > 0 ? Math.min(Number(limit_ms), max) : max;
  const at = resolve(root, cwd ?? ".");
  if (!Array.isArray(cmd) || !cmd.length || relative(root, at).startsWith("..")) return { code: 2, out: `bad command or directory: ${cwd}\n` };
  await mkdir(at, { recursive: true });
  return await new Promise((done) => {
    const p = spawn(cmd[0], cmd.slice(1), { cwd: at, env: { ...process.env, CI: "1" }, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    const add = (b) => { out = (out + b).slice(-MAX_OUT); };
    p.stdout.on("data", add);
    p.stderr.on("data", add);
    // Killed, it answers on exit: what it started may still hold the output open
    // (alchemy under rustybuns), and goes when the run destroys the container.
    const timer = setTimeout(() => {
      add(`\nkilled after ${limitMs} ms\n`);
      p.on("exit", () => done({ code: 124, out }));
      p.kill("SIGKILL");
    }, limitMs);
    p.on("error", (e) => { clearTimeout(timer); done({ code: 127, out: String(e) + "\n" }); });
    p.on("close", (code) => { clearTimeout(timer); done({ code: code ?? 1, out }); });
  });
}

/** Read (no files) or write the Alchemy state under cwd: {relative path: text}. */
export async function state({ cwd, files }, root = ROOT) {
  const dir = resolve(root, cwd ?? ".", ".alchemy", "state");
  if (relative(root, dir).startsWith("..")) throw new Error(`bad directory: ${cwd}`);
  if (files) {
    for (const [name, text] of Object.entries(files)) {
      const at = resolve(dir, name);
      if (relative(dir, at).startsWith("..")) throw new Error(`bad state file: ${name}`);
      await mkdir(dirname(at), { recursive: true });
      await writeFile(at, String(text));
    }
    return { files: Object.keys(files).length };
  }
  const out = {};
  const walk = async (d) => {
    for (const e of await readdir(d, { withFileTypes: true }).catch(() => [])) {
      if (e.isDirectory()) await walk(join(d, e.name));
      else if (e.isFile()) out[relative(dir, join(d, e.name))] = await readFile(join(d, e.name), "utf8");
    }
  };
  await walk(dir);   // through the symlink rustybuns makes for shared state
  return { files: out };
}

if (import.meta.main ?? import.meta.url === `file://${process.argv[1]}`) {
  createServer(async (req, res) => {
    const route = req.method === "POST" && { "/exec": exec, "/state": state }[req.url];
    if (!route) { res.writeHead(404).end(); return; }
    let body = "";
    for await (const chunk of req) body += chunk;
    try {
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(await route(JSON.parse(body))));
    } catch (e) {
      res.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ code: 2, out: String(e) }));
    }
  }).listen(8080);
}
