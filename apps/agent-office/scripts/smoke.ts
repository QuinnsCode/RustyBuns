#!/usr/bin/env bun
// 🥐 The compiled binary, checked end to end (bun run desktop:smoke, after desktop:build).
//
// Starts dist/agent-office-<os>-<arch> on a throwaway floor, signs in, and checks /__rb/mem lists the office
// and that floor's pty host, which in the binary is the binary re-running itself (/$bunfs/root/ptyhost), and that
// /__rb/asks and the ask-first card are there. CI runs it on every Mac and Linux target (apps.yml's smoke job).
// Dev mode (bun run office) never takes that path. Everything lives in a temp dir; both processes are stopped.
import { $ } from "bun";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const root = path.dirname(import.meta.dir);
const bin = path.join(root, "dist", `agent-office-${process.platform}-${process.arch}`);
if (!existsSync(bin)) throw new Error(`no ${path.relative(root, bin)}: bun run desktop:build first`);

const tmp = mkdtempSync(path.join(tmpdir(), "rb-smoke-"));
const floor = path.join(tmp, "floor");
mkdirSync(floor);
await $`git init -q && git -c user.name=smoke -c user.email=smoke@localhost commit -q --allow-empty -m init`.cwd(floor);

const port = 4600 + 100 + Math.floor(Math.random() * 800);
const base = `http://localhost:${port}`;
const password = crypto.randomUUID();
const office = Bun.spawn([bin, floor, "--port", String(port), "--password", password, "--no-open"], {
  env: { ...process.env, AGENT_OFFICE_HOME: path.join(tmp, "home"), XDG_CACHE_HOME: path.join(tmp, "cache") },
  stdin: "ignore", stdout: "pipe", stderr: "pipe",
});
let ptyPid = 0;
try {
  await until("the office to answer", async () => (await fetch(`${base}/api/login`).catch(() => null))?.ok);
  const login = await fetch(`${base}/api/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }) });
  const cookie = login.headers.get("set-cookie")?.split(";")[0];
  if (!login.ok || !cookie) throw new Error(`sign-in failed: ${login.status}`);

  type Mem = { office: { rssMb: number }; ptyHosts: { floor: string; mem: { rssMb: number; pid: number } | null }[] };
  let mem: Mem | undefined;
  await until("/__rb/mem to list the floor's pty host", async () => {
    const res = await fetch(`${base}/__rb/mem`, { headers: { cookie } });
    if (!res.ok) throw new Error(`/__rb/mem: ${res.status}`);
    mem = await res.json();
    return !!mem!.ptyHosts[0]?.mem;
  });
  const host = mem!.ptyHosts[0]!.mem!;
  ptyPid = host.pid;
  if (!(mem!.office.rssMb > 0) || !(host.rssMb > 0)) throw new Error(`no memory numbers: ${JSON.stringify(mem)}`);
  const cmd = (await $`ps -o command= -p ${ptyPid}`.nothrow().text()).trim();
  if (!cmd.startsWith(bin) || !cmd.includes("ptyhost")) throw new Error(`pty host ${ptyPid} isn't the binary: ${cmd}`);
  const log = readFileSync(path.join(floor, ".agent-office", "pty-host.log"), "utf8");
  if (!log.includes("[mem]")) throw new Error(`no [mem] line in pty-host.log: ${log}`);

  // AGENT_OFFICE_ASK_FIRST's questions (live/floorguard.ts), and the card that answers them on the office's page
  const asks = await fetch(`${base}/__rb/asks`, { headers: { cookie } });
  if (!asks.ok || !Array.isArray((await asks.json()).asks)) throw new Error(`/__rb/asks: ${asks.status}`);
  const page = await (await fetch(`${base}/`, { headers: { cookie } })).text();
  if (!/\/assets\/rb-asks-\w+\.js/.test(page)) throw new Error("the office's page doesn't load the ask-first card (rb-asks)");

  console.log(`   ✓ /__rb/mem: office ${mem!.office.rssMb} MB, pty host ${host.rssMb} MB (pid ${ptyPid}, the binary as its pty host)`);
} catch (err) {
  office.kill();
  console.error(await new Response(office.stdout).text(), await new Response(office.stderr).text());
  throw err;
} finally {
  // Ctrl+C closes the office; the pty host is detached to outlive it, so it's stopped on its own
  office.kill("SIGINT");
  await office.exited;
  if (ptyPid) try { process.kill(ptyPid); } catch {}
  rmSync(tmp, { recursive: true, force: true });
}

async function until(what: string, ok: () => Promise<boolean | undefined>, ms = 30_000) {
  for (const end = Date.now() + ms; Date.now() < end; await Bun.sleep(250)) if (await ok()) return;
  throw new Error(`timed out waiting for ${what}`);
}
