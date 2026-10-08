#!/usr/bin/env bun
// Node vs Bun, side by side, on Agent Office's real paths.
//   bun bench/bench.ts [--runs 5] [--mb 20]
// Node = the release under ~/.local/share/agent-office (install.sh), Bun = ./dist/agent-office-<os>-<arch>.
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { $ } from "bun";

const arg = (k: string, d: number) => { const i = process.argv.indexOf(k); return i > 0 ? Number(process.argv[i + 1]) : d; };
const RUNS = arg("--runs", 5), MB = arg("--mb", 20);
const root = path.dirname(import.meta.dir);
const versions = path.join(os.homedir(), ".local/share/agent-office/versions");
const nodeDir = path.join(versions, readdirSync(versions).filter((v) => existsSync(path.join(versions, v, ".installed"))).sort((a, b) => Bun.semver.order(a.slice(1), b.slice(1))).at(-1)!);
const bin = path.join(root, "dist", `agent-office-${process.platform}-${process.arch}`);
if (!existsSync(bin)) throw new Error("build first: bun run desktop:build");
const tmp = mkdtempSync(path.join(os.tmpdir(), "aob-"));

const variants = {
  node: { office: ["node", path.join(nodeDir, "bin/agent-office.js")], ptyhost: ["node", path.join(nodeDir, "dist/server/server/ptyhost.js")] },
  bun: { office: [bin], ptyhost: [bin, "/$bunfs/root/ptyhost"] },
} as const;
type V = keyof typeof variants;

const median = (xs: number[]) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];
async function rssMB(pid: number) { const o = await $`ps -o rss= -p ${pid}`.nothrow().text(); return Number(o.trim()) / 1024; }
async function cpuSec(pid: number) {
  const t = (await $`ps -o time= -p ${pid}`.nothrow().text()).trim(); // [[dd-]hh:]mm:ss.cc
  return t.split(":").reverse().reduce((s, p, i) => s + Number(p) * 60 ** i, 0);
}

// 1. startup + idle memory: the office on a floor (so it also starts its pty host)
async function startup(v: V, i: number) {
  const floor = path.join(tmp, `floor-${v}-${i}`);
  await $`mkdir -p ${floor} && git -C ${floor} init -q && git -C ${floor} commit -q --allow-empty -m x`.quiet();
  const port = 4800 + i + (v === "bun" ? 50 : 0);
  const t0 = performance.now();
  const p = Bun.spawn([...variants[v].office, floor, "--port", String(port), "--password", "bench", "--no-open"], {
    env: { ...process.env, AGENT_OFFICE_HOME: path.join(tmp, `home-${v}-${i}`) }, stdout: "ignore", stderr: "ignore",
  });
  let ms = 0;
  for (;;) {
    try { if ((await fetch(`http://127.0.0.1:${port}/login.html`)).ok) { ms = performance.now() - t0; break; } } catch {}
    await Bun.sleep(5);
    if (performance.now() - t0 > 20000) throw new Error(`${v} never answered`);
  }
  await Bun.sleep(3000);
  // Node renames its pty host's command line (process.title), so find it as the office's child
  const kids = (await $`ps -axo pid=,ppid=,command=`.text()).split("\n").map((l) => l.trim().split(/\s+/));
  const host = Number(kids.find(([, ppid, ...cmd]) => Number(ppid) === p.pid && /agent-office-ptys|ptyhost/.test(cmd.join(" ")))?.[0] ?? 0);
  const office = await rssMB(p.pid), ptys = host ? await rssMB(host) : 0;
  p.kill(); if (host) process.kill(host);
  await p.exited;
  return { ms, office, ptys };
}

// 2. terminal throughput: a worker printing MB of ANSI-heavy output through the pty host (node-pty + headless xterm)
const workload = path.join(tmp, "ansi.txt");
{
  const line = (n: number) => `\x1b[1;3${n % 8}m●\x1b[0m \x1b[2m${new Date(0).toISOString()}\x1b[22m  \x1b[38;5;${n % 256}mtool_use\x1b[39m Read(src/server/${"x".repeat(n % 40)}.ts) — ✓ ${n} lines 🥐\r\n`;
  const chunks: string[] = []; let size = 0, n = 0;
  while (size < MB * 1e6) { const l = line(n++); chunks.push(l); size += Buffer.byteLength(l); }
  await Bun.write(workload, chunks.join(""));
}
async function throughput(v: V, i: number) {
  const dir = mkdtempSync(path.join(tmp, `pt-${v}-${i}-`));
  const sock = path.join(dir, "s.sock"), info = path.join(dir, "info.json");
  await Bun.write(info, JSON.stringify({ token: "t" }));
  const host = Bun.spawn([...variants[v].ptyhost, sock, info], { cwd: os.homedir(), stdout: "ignore", stderr: "ignore" });
  for (let k = 0; k < 100 && !existsSync(sock); k++) await Bun.sleep(20);
  const cpu0 = await cpuSec(host.pid);
  let peak = 0, cpu = 0;
  const sampler = setInterval(async () => { peak = Math.max(peak, await rssMB(host.pid)); }, 50);
  const res = await new Promise<{ ms: number; bytes: number }>((resolve, reject) => {
    const c = net.connect(sock); let buf = "", bytes = 0, t0 = 0;
    c.setEncoding("utf8");
    c.on("data", (d: string) => {
      buf += d; let j;
      while ((j = buf.indexOf("\n")) >= 0) {
        const m = JSON.parse(buf.slice(0, j)); buf = buf.slice(j + 1);
        if (m.t === "ready") { t0 = performance.now(); c.write(JSON.stringify({ t: "spawn", id: "w", opts: { file: "/bin/cat", args: [workload], cols: 120, rows: 40, cwd: os.homedir(), env: process.env } }) + "\n"); }
        if (m.t === "data") bytes += Buffer.byteLength(m.data);
        if (m.t === "exit") { const ms = performance.now() - t0; cpuSec(host.pid).then((c1) => { cpu = c1 - cpu0; resolve({ ms, bytes }); c.end(); }); }
      }
    });
    c.on("connect", () => c.write(JSON.stringify({ t: "hello", token: "t" }) + "\n"));
    c.on("error", reject);
    setTimeout(() => reject(new Error(`${v} throughput timed out`)), 120000);
  });
  clearInterval(sampler);
  host.kill(); await host.exited;
  return { ...res, cpu, peak };
}

// 3. a busy office: 10 live terminals, each with a full scrollback, held open
async function office10(v: V, i: number) {
  const dir = mkdtempSync(path.join(tmp, `o10-${v}-${i}-`));
  const sock = path.join(dir, "s.sock"), info = path.join(dir, "info.json");
  await Bun.write(info, JSON.stringify({ token: "t" }));
  const host = Bun.spawn([...variants[v].ptyhost, sock, info], { cwd: os.homedir(), stdout: "ignore", stderr: "ignore" });
  for (let k = 0; k < 100 && !existsSync(sock); k++) await Bun.sleep(20);
  const c = net.connect(sock);
  let quiet = performance.now();
  c.setEncoding("utf8");
  c.on("data", () => (quiet = performance.now()));
  await new Promise((r) => c.on("connect", r));
  c.write(JSON.stringify({ t: "hello", token: "t" }) + "\n");
  await Bun.sleep(200);
  for (let w = 0; w < 10; w++)
    c.write(JSON.stringify({ t: "spawn", id: `w${w}`, opts: { file: "/bin/sh", args: ["-c", `head -c 3000000 ${workload}; sleep 60`], cols: 120, rows: 40, cwd: os.homedir(), env: process.env } }) + "\n");
  while (performance.now() - quiet < 1000) await Bun.sleep(100);
  const rss = await rssMB(host.pid);
  c.write(JSON.stringify({ t: "stop" }) + "\n"); c.end();
  await Bun.sleep(300); host.kill(); await host.exited;
  return rss;
}

const out: Record<string, Record<V, number[]>> = {};
const put = (k: string, v: V, x: number) => ((out[k] ??= { node: [], bun: [] })[v].push(x));
console.log(`node ${(await $`node --version`.text()).trim()} (${path.basename(nodeDir)})  vs  bun ${Bun.version} (${path.basename(bin)})  ·  ${RUNS} runs, ${MB} MB of terminal output\n`);
for (let i = 0; i < RUNS; i++) {
  for (const v of (i % 2 ? ["bun", "node"] : ["node", "bun"]) as V[]) {
    const s = await startup(v, i);
    put("startup to first page (ms)", v, s.ms); put("office RSS idle (MB)", v, s.office); put("pty host RSS idle (MB)", v, s.ptys);
    const t = await throughput(v, i);
    put("terminal: time for output (ms)", v, t.ms); put("terminal: MB/s", v, t.bytes / 1e6 / (t.ms / 1000));
    put("terminal: pty host CPU (s)", v, t.cpu); put("terminal: pty host peak RSS (MB)", v, t.peak);
    put("10 workers: pty host RSS (MB)", v, await office10(v, i));
  }
  process.stdout.write(".");
}
console.log("\n\n| median | Node | Bun | Bun vs Node |\n|---|---:|---:|---:|");
for (const [k, r] of Object.entries(out)) {
  const n = median(r.node), b = median(r.bun), higherBetter = k.includes("MB/s");
  const ratio = higherBetter ? b / n : n / b;
  console.log(`| ${k} | ${n.toFixed(n < 10 ? 2 : 0)} | ${b.toFixed(b < 10 ? 2 : 0)} | ${ratio >= 1 ? `${ratio.toFixed(2)}x better` : `${(1 / ratio).toFixed(2)}x worse`} |`);
}
rmSync(tmp, { recursive: true, force: true });
