// `bun packages/cli/bench/lifecycle.ts`: what happens to a deploy when rustybuns is stopped
// partway through. A throwaway git repo gets an app whose `alchemy` is a fake (node_modules/.bin)
// that writes its pid and then "deploys" for 20s. `rustybuns deploy --yes --no-check` is started
// and stopped mid-deploy the ways it gets stopped in real life:
//
//   Ctrl-C          SIGINT to the whole process group, as a terminal sends it
//   SIGTERM         to rustybuns only: an agent harness timeout, `kill <pid>`, CI cancelling a job
//   SIGHUP          to rustybuns only: the terminal or SSH session closed
//   SIGKILL         to rustybuns only: the OOM killer, `kill -9`
//
// Then: is the fake alchemy still running (an orphan still writing state), is the state lock
// still there, and does a second deploy start beside the orphan? No network, nothing real.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const CLI = resolve(import.meta.dir, "../src/index.ts");
const CONFIG = resolve(import.meta.dir, "../src/config.ts");
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const waitFor = async (f: () => boolean, ms: number) => { const end = Date.now() + ms; while (!f() && Date.now() < end) await Bun.sleep(25); return f(); };

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "rb-life-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "life", dependencies: { vite: "*" } }));
  writeFileSync(join(dir, "rustybuns.config.ts"), `import { defineConfig } from "${CONFIG}";
export default defineConfig({ name: "life", worker: { main: "src/worker.ts", compatibilityDate: "2026-06-01", compatibilityFlags: [] }, bindings: {}, targets: { edge: { provider: "cloudflare" } } });\n`);
  mkdirSync(join(dir, "src")); writeFileSync(join(dir, "src/worker.ts"), "export default {};\n");
  mkdirSync(join(dir, "node_modules/.bin"), { recursive: true });
  // The fake deploy, a JS CLI like the real one: its pid, then 20s of "writing state". On SIGINT
  // it finishes the write in hand (200ms) and exits 130; SIGTERM and SIGHUP end it at once.
  writeFileSync(join(dir, "node_modules/.bin/alchemy"), `#!${process.execPath}
const fs = require("node:fs");
fs.writeFileSync("${dir}/alchemy.pid", String(process.pid));
let i = 0; const t = setInterval(() => { fs.appendFileSync("${dir}/alchemy.writes", i++ + "\\n"); if (i > 400) process.exit(0); }, 50);
process.on("SIGINT", () => { clearInterval(t); setTimeout(() => { fs.appendFileSync("${dir}/alchemy.writes", "clean\\n"); process.exit(130); }, 200); });
`);
  chmodSync(join(dir, "node_modules/.bin/alchemy"), 0o755);
  Bun.spawnSync(["git", "init", "-q"], { cwd: dir });
  return dir;
}

const env = { ...process.env, CLOUDFLARE_API_TOKEN: "fake", CLOUDFLARE_ACCOUNT_ID: "fake", RUSTYBUNS_NO_UPDATE_CHECK: "1", CI: "1" };
const deploy = (dir: string) => Bun.spawn([process.execPath, CLI, "deploy", "--yes", "--no-check"], { cwd: dir, env, stdout: "pipe", stderr: "pipe", detached: true });
const lockFile = (dir: string) => join(dir, ".git/rustybuns/alchemy/lock");

type Stop = { name: string; stop: (pid: number) => void };
const STOPS: Stop[] = [
  { name: "Ctrl-C", stop: (pid) => process.kill(-pid, "SIGINT") },
  { name: "SIGTERM", stop: (pid) => process.kill(pid, "SIGTERM") },
  { name: "SIGHUP", stop: (pid) => process.kill(pid, "SIGHUP") },
  { name: "SIGKILL", stop: (pid) => process.kill(pid, "SIGKILL") },
];

console.log("stopped by   exit      rustybuns gone  alchemy orphaned  alchemy finished its write  lock left  2nd deploy ran beside it");
for (const s of STOPS) {
  const dir = fixture();
  const first = deploy(dir);
  if (!(await waitFor(() => existsSync(join(dir, "alchemy.pid")), 20_000))) { console.log(`${s.name}: alchemy never started:\n${await new Response(first.stderr).text()}`); continue; }
  const child = Number(readFileSync(join(dir, "alchemy.pid"), "utf8"));
  s.stop(first.pid);
  const t = performance.now();
  const code = await Promise.race([first.exited, Bun.sleep(5000).then(() => "hung")]);
  const exitMs = performance.now() - t;
  await Bun.sleep(300);
  const orphan = alive(child), lock = existsSync(lockFile(dir));
  const clean = existsSync(join(dir, "alchemy.writes")) && readFileSync(join(dir, "alchemy.writes"), "utf8").includes("clean");
  // A second deploy while the first one's alchemy may still be running.
  let second = "-";
  if (orphan) {
    rmSync(join(dir, "alchemy.pid"));
    const p = deploy(dir);
    const started = await waitFor(() => existsSync(join(dir, "alchemy.pid")), 5000);
    second = started ? "YES" : "refused";
    try { process.kill(-p.pid, "SIGKILL"); } catch {}
  }
  try { process.kill(child, "SIGKILL"); } catch {}
  try { process.kill(-first.pid, "SIGKILL"); } catch {}
  console.log(`${s.name.padEnd(12)} ${String(code).padEnd(9)} ${(exitMs.toFixed(0) + "ms").padEnd(15)} ${(orphan ? "YES" : "no").padEnd(17)} ${(clean ? "yes" : "no").padEnd(27)} ${(lock ? "yes" : "no").padEnd(10)} ${second}`);
  rmSync(dir, { recursive: true, force: true });
}
