// The server inside the deploy container. POST /exec {cmd: [bin, ...args], cwd}
// runs one command of a deploy (git clone, bun install, rustybuns deploy) in a
// directory under /work and answers {code, out}. The deploy key is already in
// this container's env (see DeployRunner in src/deploy-runner.ts), so the
// commands inherit it. Runs under Bun; plain Node APIs, no dependencies.

import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { relative, resolve } from "node:path";

const ROOT = process.env.WORK_ROOT ?? "/work";
/** A command that runs longer than this is killed and fails its step. */
const LIMIT_MS = Number(process.env.DEPLOY_TIMEOUT_MS ?? 15 * 60_000);
const MAX_OUT = 60_000;

export async function exec({ cmd, cwd }, root = ROOT) {
  const at = resolve(root, cwd ?? ".");
  if (!Array.isArray(cmd) || !cmd.length || relative(root, at).startsWith("..")) return { code: 2, out: `bad command or directory: ${cwd}\n` };
  await mkdir(at, { recursive: true });
  return await new Promise((done) => {
    const p = spawn(cmd[0], cmd.slice(1), { cwd: at, env: { ...process.env, CI: "1" }, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    const add = (b) => { out = (out + b).slice(-MAX_OUT); };
    p.stdout.on("data", add);
    p.stderr.on("data", add);
    const timer = setTimeout(() => { add(`\nkilled after ${LIMIT_MS} ms\n`); p.kill("SIGKILL"); }, LIMIT_MS);
    p.on("error", (e) => { clearTimeout(timer); done({ code: 127, out: String(e) + "\n" }); });
    p.on("close", (code) => { clearTimeout(timer); done({ code: code ?? 1, out }); });
  });
}

if (import.meta.main ?? import.meta.url === `file://${process.argv[1]}`) {
  createServer(async (req, res) => {
    if (req.method !== "POST" || req.url !== "/exec") { res.writeHead(404).end(); return; }
    let body = "";
    for await (const chunk of req) body += chunk;
    try {
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(await exec(JSON.parse(body))));
    } catch (e) {
      res.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ code: 2, out: String(e) }));
    }
  }).listen(8080);
}
