#!/usr/bin/env bun
// 🥐 JIT vs AOT Agent Office, side by side (#5555). After `bun run desktop:build -- --aot`:
//
//   bun bench/aot.ts [runs]      default 3 runs of each binary
//
// Each run starts the binary on a throwaway floor, as desktop:smoke does, and records how long it took to answer,
// then, after SETTLE_S seconds idle, the office's and its pty host's memory (RSS) and the CPU time each has used.
// Prints a table of medians and the binary sizes. Everything lives in a temp dir; both processes are stopped.
import { $ } from "bun";
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { aotName } from "../scripts/aot.ts";

const SETTLE_S = 20;
const runs = Number(process.argv[2] ?? 3);
const root = path.dirname(import.meta.dir);
const jit = path.join(root, "dist", `agent-office-${process.platform}-${process.arch}`);
const bins = { jit, aot: aotName(jit) };
for (const b of Object.values(bins)) if (!existsSync(b)) throw new Error(`no ${path.relative(root, b)}: bun run desktop:build -- --aot first`);

type Run = { readyMs: number; officeMb: number; ptyMb: number; officeCpuS: number; ptyCpuS: number };

/** RSS in MB and CPU seconds of one process, from ps. */
async function usage(pid: number): Promise<{ mb: number; cpuS: number }> {
  const [rss, time] = (await $`ps -o rss=,time= -p ${pid}`.nothrow().text()).trim().split(/\s+/);
  // ps time is [[dd-]hh:]mm:ss.cc
  const cpuS = (time ?? "0").split(/[-:]/).map(Number).reduce((a, n) => a * 60 + n, 0);
  return { mb: Math.round(Number(rss ?? 0) / 1024), cpuS: Math.round(cpuS * 100) / 100 };
}

async function once(bin: string): Promise<Run> {
  const tmp = mkdtempSync(path.join(tmpdir(), "rb-aot-"));
  const floor = path.join(tmp, "floor");
  mkdirSync(floor);
  await $`git init -q && git -c user.name=bench -c user.email=bench@localhost commit -q --allow-empty -m init`.cwd(floor);
  const port = 4700 + Math.floor(Math.random() * 800);
  const base = `http://localhost:${port}`;
  const password = crypto.randomUUID();
  const t0 = performance.now();
  const office = Bun.spawn([bin, floor, "--port", String(port), "--password", password, "--no-open"], {
    env: { ...process.env, AGENT_OFFICE_HOME: path.join(tmp, "home"), XDG_CACHE_HOME: path.join(tmp, "cache") },
    stdin: "ignore", stdout: "ignore", stderr: "ignore",
  });
  let ptyPid = 0;
  try {
    await until(async () => (await fetch(`${base}/api/login`).catch(() => null))?.ok);
    const readyMs = Math.round(performance.now() - t0);
    const login = await fetch(`${base}/api/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }) });
    const cookie = login.headers.get("set-cookie")?.split(";")[0] ?? "";
    await until(async () => {
      const mem = await (await fetch(`${base}/__rb/mem`, { headers: { cookie } })).json() as { ptyHosts: { mem: { pid: number } | null }[] };
      ptyPid = mem.ptyHosts[0]?.mem?.pid ?? 0;
      return ptyPid > 0;
    });
    await Bun.sleep(SETTLE_S * 1000);
    const o = await usage(office.pid), p = await usage(ptyPid);
    return { readyMs, officeMb: o.mb, ptyMb: p.mb, officeCpuS: o.cpuS, ptyCpuS: p.cpuS };
  } finally {
    office.kill("SIGINT");
    await office.exited;
    if (ptyPid) try { process.kill(ptyPid); } catch {}
    rmSync(tmp, { recursive: true, force: true });
  }
}

async function until(ok: () => Promise<boolean | undefined>, ms = 60_000) {
  for (const end = Date.now() + ms; Date.now() < end; await Bun.sleep(100)) if (await ok().catch(() => false)) return;
  throw new Error("timed out waiting for the office");
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
const rows: Record<string, Run[]> = { jit: [], aot: [] };
// alternate the two so a busy moment on the machine doesn't land on one side only
for (let i = 0; i < runs; i++) for (const [name, bin] of Object.entries(bins)) {
  const r = await once(bin);
  rows[name]!.push(r);
  console.log(`   ${name} run ${i + 1}: ${JSON.stringify(r)}`);
}
console.log(`\n${process.platform}-${process.arch}, Bun ${Bun.version}, ${runs} runs each, medians, after ${SETTLE_S}s idle`);
console.log("        size MB  ready ms  office MB  pty host MB  office CPU s  pty host CPU s");
for (const [name, bin] of Object.entries(bins)) {
  const rs = rows[name]!, m = (k: keyof Run) => median(rs.map((r) => r[k]));
  console.log(`${name.padEnd(8)}${String(Math.round(statSync(bin).size / 1e6)).padStart(7)}  ${String(m("readyMs")).padStart(8)}  ` +
    `${String(m("officeMb")).padStart(9)}  ${String(m("ptyMb")).padStart(11)}  ${String(m("officeCpuS")).padStart(12)}  ${String(m("ptyCpuS")).padStart(14)}`);
}
