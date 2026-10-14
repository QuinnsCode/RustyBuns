// `rustybuns containers`: the app's Dockerfiles as a workflow (#818). list / build / run / smoke,
// a Docker preflight shared with deploy and `build box`, and staleness (a hash of each binding's
// context) kept under .rustybuns/containers/. Docker is the only thing outside this file.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import type { RustyBunsConfig } from "./config.ts";
import { refusedSummary } from "./egress-gate.ts";
import { ENV_SCHEMA } from "./wheel.ts";

export interface ContainerBinding {
  name: string;
  className: string;
  dockerfile: string;
  /** The Dockerfile's directory, as Alchemy builds it (gen/alchemy.ts). */
  context: string;
  maxInstances: number;
  instanceType: string;
  /** The egress module and host list `--prod-like` gates with (config.ts). */
  egress?: { module: string; hosts: string[] };
}

export const STATE_DIR = ".rustybuns/containers";
/** What a container answers on: the port Cloudflare Containers' servers listen on. */
export const PORT = 8080;

export function containerBindings(cfg: RustyBunsConfig): ContainerBinding[] {
  return Object.entries(cfg.bindings ?? {}).flatMap(([name, b]) => {
    if (b.type !== "container") return [];
    const at = b.dockerfile.lastIndexOf("/");
    return [{ name, className: b.className, dockerfile: b.dockerfile, context: at < 0 ? "." : b.dockerfile.slice(0, at), maxInstances: b.maxInstances ?? 1, instanceType: b.instanceType ?? "lite", egress: b.egress }];
  });
}

/** BINDING arguments to bindings: all of them when none are named, an error for a name the app doesn't have. */
export function pick(all: ContainerBinding[], names: string[]): ContainerBinding[] {
  if (!names.length) return all;
  const missing = names.filter((n) => !all.some((b) => b.name === n));
  if (missing.length) throw new Error(`no container binding ${missing.join(", ")}. This app has: ${all.map((b) => b.name).join(", ") || "none"}`);
  return all.filter((b) => names.includes(b.name));
}

// ---- Docker preflight ----

export const dockerUp = () => Bun.spawnSync(["docker", "info"], { stdout: "ignore", stderr: "ignore" }).exitCode === 0;

/** The one message every command that needs the daemon gives: `why` is a sentence about what needs it. */
export const dockerDown = (why: string) => `Docker isn't running. ${why} Start Docker Desktop and run this again.`;

export function needDocker(why: string, up: () => boolean = dockerUp): void {
  if (!up()) throw new Error(dockerDown(why));
}

export const bindingsWhy = (n: number) => `This app has ${n} container binding${n === 1 ? "" : "s"}, and deploy builds their images locally.`;

// ---- staleness ----

const SKIP = new Set(["node_modules", ".git", ".DS_Store"]);

/** A hash of the context folder (the Dockerfile is in it) by file name and content. */
export function contextHash(context: string): string {
  const h = createHash("sha256");
  const walk = (dir: string) => {
    for (const e of readdirSync(dir).sort()) {
      if (SKIP.has(e)) continue;
      const p = join(dir, e);
      if (statSync(p).isDirectory()) walk(p);
      else h.update(relative(context, p)).update("\0").update(readFileSync(p)).update("\0");
    }
  };
  walk(context);
  return h.digest("hex");
}

export interface Built { hash: string; size: number; at: number; dockerfile: string }
type Ledger = Record<string, Built>;

const ledgerPath = (dir: string) => join(dir, STATE_DIR, "built.json");
export function readLedger(dir = "."): Ledger {
  try { return JSON.parse(readFileSync(ledgerPath(dir), "utf8")); } catch { return {}; }
}
export function writeLedger(l: Ledger, dir = "."): void {
  mkdirSync(join(dir, STATE_DIR), { recursive: true });
  writeFileSync(ledgerPath(dir), JSON.stringify(l, null, 2));
}

export type Freshness = "not built" | "stale" | "built";
export function freshness(b: ContainerBinding, l: Ledger, hash: string): Freshness {
  const e = l[b.name];
  return !e || e.dockerfile !== b.dockerfile ? "not built" : e.hash === hash ? "built" : "stale";
}

export const mb = (bytes: number) => `${Math.round(bytes / 1e6)} MB`;
export const ago = (ms: number) => { const s = Math.round(ms / 1000); return s < 90 ? `${s}s ago` : s < 5400 ? `${Math.round(s / 60)}m ago` : s < 129600 ? `${Math.round(s / 3600)}h ago` : `${Math.round(s / 86400)}d ago`; };

export function listText(bs: ContainerBinding[], l: Ledger, hashOf: (b: ContainerBinding) => string, now = Date.now()): string {
  if (!bs.length) return "no container bindings in rustybuns.config.ts";
  const w = (f: (b: ContainerBinding) => string) => Math.max(...bs.map((b) => f(b).length));
  const nw = w((b) => b.name), dw = w((b) => b.dockerfile);
  return bs.map((b) => {
    const f = freshness(b, l, hashOf(b)), e = l[b.name];
    const state = f === "not built" ? "not built" : f === "stale" ? "stale (context changed)" : `built ${ago(now - e!.at)} · ${mb(e!.size)}`;
    return `  ${b.name.padEnd(nw)}   ${b.dockerfile.padEnd(dw)}   ${`${b.instanceType} ×${b.maxInstances}`.padEnd(10)}   ${state}`;
  }).join("\n");
}

// ---- building ----

export const imageTag = (app: string, b: ContainerBinding) => `rustybuns-${app}-${b.name}:local`.toLowerCase().replace(/[^a-z0-9_.:-]/g, "-");

/** One BuildKit plain-progress line as "step n/m, what", or null for the noise between. */
export function progressLine(line: string): { step: number; of: number; what: string } | null {
  const m = /^#\d+ \[(?:[\w.-]+ )?(\d+)\/(\d+)\] (.+)/.exec(line);
  return m ? { step: Number(m[1]), of: Number(m[2]), what: m[3]!.trim().slice(0, 60) } : null;
}

const decode = new TextDecoder();
async function lines(s: ReadableStream<Uint8Array>, on: (line: string) => void) {
  let rest = "";
  for await (const c of s) {
    rest += decode.decode(c, { stream: true });
    const parts = rest.split("\n"); rest = parts.pop()!;
    parts.forEach(on);
  }
  if (rest) on(rest);
}

const imageSize = (tag: string) => Number(Bun.spawnSync(["docker", "image", "inspect", "-f", "{{.Size}}", tag]).stdout.toString().trim()) || 0;

/**
 * BuildKit's GitHub Actions layer cache, one scope per image (#1693): the flags that read and write it. `--load`
 * puts the result in the local image store, which the docker-container driver (setup-buildx-action) doesn't do by default.
 */
export function ghaCacheArgs(app: string, b: ContainerBinding): string[] {
  const scope = `${app}-${b.name}`.toLowerCase();
  return ["--load", "--cache-from", `type=gha,scope=${scope}`, "--cache-to", `type=gha,mode=max,scope=${scope}`];
}

export async function buildOne(app: string, b: ContainerBinding, opts: { verbose?: boolean; log?: (s: string) => void; dir?: string; ghaCache?: boolean } = {}): Promise<{ tag: string; size: number; prevSize?: number; ms: number }> {
  const log = opts.log ?? console.log, tag = imageTag(app, b), t0 = performance.now();
  const hash = contextHash(b.context);
  const p = Bun.spawn(["docker", "build", "--platform", "linux/amd64", "--progress=plain", ...(opts.ghaCache ? ghaCacheArgs(app, b) : []), "-f", b.dockerfile, "-t", tag, b.context], { stdout: "pipe", stderr: "pipe" });
  const tail: string[] = [];
  const tty = process.stdout.isTTY && !opts.verbose;
  const onLine = (l: string) => {
    tail.push(l); if (tail.length > 30) tail.shift();
    if (opts.verbose) { log(`${b.name}: ${l}`); return; }
    const s = progressLine(l);
    if (s) {
      const out = `  ${b.name}  step ${s.step}/${s.of}  ${s.what}  ${((performance.now() - t0) / 1000).toFixed(0)}s`;
      if (tty) process.stdout.write(`\r\x1b[K${out}`); else log(out);
    }
  };
  await Promise.all([lines(p.stdout, onLine), lines(p.stderr, onLine)]);
  if (tty) process.stdout.write("\r\x1b[K");
  if ((await p.exited) !== 0) throw new Error(`building ${b.name} (${b.dockerfile}) failed. The last lines:\n${tail.slice(-30).join("\n")}`);
  const size = imageSize(tag), led = readLedger(opts.dir), prevSize = led[b.name]?.size;
  led[b.name] = { hash, size, at: Date.now(), dockerfile: b.dockerfile };
  writeLedger(led, opts.dir);
  return { tag, size, prevSize, ms: performance.now() - t0 };
}

export function sizeTable(rows: { name: string; size: number; prevSize?: number; ms: number }[]): string {
  const w = Math.max(...rows.map((r) => r.name.length));
  return rows.map((r) => {
    const d = r.prevSize === undefined ? "new" : `${r.size >= r.prevSize ? "+" : "-"}${mb(Math.abs(r.size - r.prevSize))}`;
    return `  ${r.name.padEnd(w)}   ${mb(r.size).padStart(8)}   ${d.padStart(8)}   ${(r.ms / 1000).toFixed(0)}s`;
  }).join("\n");
}

// ---- running ----

/** Names in .env.schema (the file that names them; values are never read here). */
export function schemaNames(dir = "."): string[] {
  const p = join(dir, ENV_SCHEMA);
  if (!existsSync(p)) return [];
  return [...readFileSync(p, "utf8").matchAll(/^\s*([A-Z][A-Z0-9_]*)\s*=/gm)].map((m) => m[1]!);
}

/** `--env NAME=VALUE` (repeatable) and `--env-file path`: the only values a container gets. */
export function envFlags(args: string[]): { env: Record<string, string>; file?: string; rest: string[] } {
  const env: Record<string, string> = {}, rest: string[] = [];
  let file: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--env") {
      const kv = args[++i] ?? "", eq = kv.indexOf("=");
      if (eq < 1) throw new Error(`--env takes NAME=VALUE, got ${JSON.stringify(kv)}`);
      env[kv.slice(0, eq)] = kv.slice(eq + 1);
    } else if (a === "--env-file") file = args[++i];
    else rest.push(a);
  }
  return { env, file, rest };
}

export function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const s = createServer();
    s.once("error", rej);
    s.listen(0, "127.0.0.1", () => { const { port } = s.address() as { port: number }; s.close(() => res(port)); });
  });
}

/** Any HTTP answer on the port counts: the server is up. Null when the container exits first or time runs out. */
export async function waitReady(port: number, alive: () => boolean, timeoutMs = 60_000): Promise<number | null> {
  const t0 = performance.now();
  while (alive() && performance.now() - t0 < timeoutMs) {
    try { const r = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(2000) }); await r.body?.cancel(); return performance.now() - t0; } catch { await Bun.sleep(250); }
  }
  return null;
}

export function runArgs(tag: string, name: string, port: number, o: { env: Record<string, string>; file?: string; detach?: boolean; shell?: boolean }): string[] {
  return [
    "docker", "run", "--rm", "--platform", "linux/amd64", "--name", name, "-p", `127.0.0.1:${port}:${PORT}`,
    ...(o.shell ? ["-it", "--entrypoint", "sh"] : o.detach ? ["-d"] : []),
    ...(o.file ? ["--env-file", o.file] : []),
    ...Object.entries(o.env).flatMap(([k, v]) => ["-e", `${k}=${v}`]),
    tag,
  ];
}

// ---- --prod-like ----

/** Where the runtime puts its CA, which each image's CMD trusts at start. */
export const CA_PATH = "/etc/cloudflare/certs/cloudflare-containers-ca.crt";
const GATE_IMAGE = "oven/bun:1";

/** `--prod-like` and `--prod-like=false` aside, the args without it. */
export const prodLikeFlag = (args: string[]) => ({ prodLike: args.includes("--prod-like"), rest: args.filter((a) => a !== "--prod-like") });

export interface ProdLike { port: number; alive: () => boolean; logs: () => string[]; stop: () => string }

/**
 * The image under production's conditions: on a Docker network with no route out, whose one neighbour is the
 * egress gate (egress-gate.ts, running the app's own `allowed`), with a per-session CA at the runtime's path.
 * The CA and its key live in a temp directory deleted on stop. `stop` returns the gate's refused-host summary.
 */
export async function startProdLike(app: string, b: ContainerBinding, tag: string, flags: { env: Record<string, string>; file?: string; dir?: string }): Promise<ProdLike> {
  if (!b.egress) throw new Error(`${b.name} declares no egress list, so --prod-like has nothing to gate it with. Add egress: { module, hosts } to its binding in rustybuns.config.ts.`);
  const id = `${app}-${b.name}-${process.pid}`.toLowerCase().replace(/[^a-z0-9_.-]/g, "-");
  const net = `rb-net-${id}`, cname = `rb-${id}`, gname = `rb-gate-${id}`, tmp = mkdtempSync(join(tmpdir(), "rb-ca-"));
  const docker = (...a: string[]) => Bun.spawnSync(["docker", ...a], { stdout: "pipe", stderr: "pipe" });
  const mod = resolve(flags.dir ?? ".", b.egress.module), port = await freePort();
  const gateSrc = new URL("./egress-gate.ts", import.meta.url).pathname;
  const ssl = Bun.spawnSync(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=rustybuns local gate", "-keyout", join(tmp, "ca.key"), "-out", join(tmp, "ca.crt")], { stdout: "ignore", stderr: "pipe" });
  if (ssl.exitCode !== 0) { rmSync(tmp, { recursive: true, force: true }); throw new Error(`--prod-like needs openssl to make this session's CA: ${ssl.stderr.toString().trim().split("\n").pop()}`); }
  const cleanup = () => { kill(cname); kill(gname); docker("network", "rm", net); rmSync(tmp, { recursive: true, force: true }); };
  const fail = (what: string, r: { stderr: Buffer }) => { cleanup(); throw new Error(`${what}: ${r.stderr.toString().trim().split("\n")[0]}`); };
  const made = docker("network", "create", "--internal", net);
  if (made.exitCode !== 0) fail("creating the container's network", made);
  const proxy = `http://${gname}:3128`;
  const proxyEnv = ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"].flatMap((k) => ["-e", `${k}=${proxy}`]);
  const c = docker("run", "-d", "--rm", "--platform", "linux/amd64", "--name", cname, "--network", net, "-v", `${join(tmp, "ca.crt")}:${CA_PATH}:ro`, ...proxyEnv, "-e", `NO_PROXY=${cname},localhost,127.0.0.1`,
    ...(flags.file ? ["--env-file", flags.file] : []), ...Object.entries(flags.env).flatMap(([k, v]) => ["-e", `${k}=${v}`]), tag);
  if (c.exitCode !== 0) fail("starting the container", c);
  const g = docker("run", "-d", "--rm", "--name", gname, "-p", `127.0.0.1:${port}:9000`, "-v", `${gateSrc}:/gate/egress-gate.ts:ro`, "-v", `${mod}:/gate/egress.ts:ro`,
    "-e", "GATE_MODULE=/gate/egress.ts", "-e", `GATE_HOSTS=${JSON.stringify(b.egress.hosts)}`, "-e", `FORWARD=${cname}:${PORT}`, GATE_IMAGE, "bun", "/gate/egress-gate.ts");
  if (g.exitCode !== 0) fail("starting the egress gate", g);
  const joined = docker("network", "connect", "--alias", gname, net, gname);
  if (joined.exitCode !== 0) fail("joining the gate to the container's network", joined);
  const running = (n: string) => docker("inspect", "-f", "{{.State.Running}}", n).stdout.toString().trim() === "true";
  const logs = () => { const r = docker("logs", gname); return (r.stdout.toString() + r.stderr.toString()).split("\n").filter((l) => l.startsWith("egress")); };
  return { port, alive: () => running(cname), logs, stop() { const sum = refusedSummary(logs(), b.name); cleanup(); return sum; } };
}

const kill = (name: string) => Bun.spawnSync(["docker", "rm", "-f", name], { stdout: "ignore", stderr: "ignore" });

export async function runOne(app: string, b: ContainerBinding, flags: { env: Record<string, string>; file?: string; shell?: boolean; verbose?: boolean; dir?: string; prodLike?: boolean }): Promise<void> {
  const led = readLedger(flags.dir);
  if (freshness(b, led, contextHash(b.context)) !== "built") { console.log(`${b.name}: ${led[b.name] ? "stale" : "not built"}, building`); await buildOne(app, b, flags); }
  const tag = imageTag(app, b), name = `rb-${app}-${b.name}-${process.pid}`.toLowerCase();
  const empty = schemaNames(flags.dir).filter((n) => !(n in flags.env));
  const port = await freePort();
  if (flags.shell) {
    const argv = runArgs(tag, name, port, { ...flags, shell: true });
    console.log(`$ ${argv.join(" ")}`);
    await Bun.spawn(argv, { stdio: ["inherit", "inherit", "inherit"] }).exited;
    return;
  }
  if (flags.prodLike) return runProdLike(app, b, tag, empty, flags);
  const argv = runArgs(tag, name, port, flags);
  console.log(`$ ${argv.join(" ")}`);
  const p = Bun.spawn(argv, { stdout: "pipe", stderr: "pipe" });
  let done = false;
  const stop = () => { kill(name); };
  process.once("SIGINT", () => { stop(); });
  void p.exited.then(() => { done = true; });
  const pre = `${b.name} | `;
  void Promise.all([lines(p.stdout, (l) => console.log(pre + l)), lines(p.stderr, (l) => console.error(pre + l))]);
  const ms = await waitReady(port, () => !done);
  if (ms === null) { stop(); throw new Error(`${b.name} did not answer on :${PORT} (${done ? "the container exited" : "timed out after 60s"}). Its logs are above.`); }
  console.log(`\n${b.name} ready in ${(ms / 1000).toFixed(1)}s: http://127.0.0.1:${port}  (Ctrl-C stops and removes it)`);
  if (empty.length) console.log(`not set (pass --env NAME=VALUE or --env-file): ${empty.join(", ")}`);
  await p.exited;
  stop();
}

/** `run --prod-like`: the gate and the container, the gate's log lines as they come, its refused-host summary at Ctrl-C. */
async function runProdLike(app: string, b: ContainerBinding, tag: string, empty: string[], flags: { env: Record<string, string>; file?: string; dir?: string }) {
  const g = await startProdLike(app, b, tag, flags);
  let seen = 0, stopped = false, summary = "";
  const end = () => { if (!stopped) { stopped = true; summary = g.stop(); } };
  process.once("SIGINT", end);
  const ms = await waitReady(g.port, g.alive);
  if (ms === null) { const out = g.logs().join("\n"); end(); throw new Error(`${b.name} did not answer on :${PORT} under the gate.\n${out}\n${summary}`); }
  console.log(`\n${b.name} ready in ${(ms / 1000).toFixed(1)}s, prod-like (no route out but the gate): http://127.0.0.1:${g.port}  (Ctrl-C stops and removes it)`);
  if (empty.length) console.log(`not set (pass --env NAME=VALUE or --env-file): ${empty.join(", ")}`);
  while (!stopped && g.alive()) {
    const all = g.logs(); all.slice(seen).forEach((l) => console.log(l)); seen = all.length;
    await Bun.sleep(1000);
  }
  end();
  console.log(summary);
}

export async function smokeOne(app: string, b: ContainerBinding, flags: { env: Record<string, string>; file?: string; verbose?: boolean; dir?: string; prodLike?: boolean }): Promise<{ ok: boolean; note: string }> {
  const led = readLedger(flags.dir);
  try { if (freshness(b, led, contextHash(b.context)) !== "built") await buildOne(app, b, flags); } catch (e) { return { ok: false, note: `build failed: ${(e as Error).message.split("\n")[0]}` }; }
  if (flags.prodLike) {
    const g = await startProdLike(app, b, imageTag(app, b), flags);
    const ms = await waitReady(g.port, g.alive);
    const out = g.logs().join("\n"), sum = g.stop();
    return ms !== null ? { ok: true, note: `answered on :${PORT} in ${(ms / 1000).toFixed(1)}s under the gate\n${out}\n${sum}` } : { ok: false, note: `never answered under the gate\n${out}\n${sum}` };
  }
  const tag = imageTag(app, b), name = `rb-smoke-${app}-${b.name}-${process.pid}`.toLowerCase(), port = await freePort();
  const start = Bun.spawnSync(runArgs(tag, name, port, { ...flags, detach: true }));
  if (start.exitCode !== 0) return { ok: false, note: start.stderr.toString().trim().split("\n").pop() ?? "docker run failed" };
  const running = () => Bun.spawnSync(["docker", "inspect", "-f", "{{.State.Running}}", name]).stdout.toString().trim() === "true";
  try {
    const ms = await waitReady(port, running);
    if (ms !== null) return { ok: true, note: `answered on :${PORT} in ${(ms / 1000).toFixed(1)}s` };
    const logs = Bun.spawnSync(["docker", "logs", "--tail", "10", name]);
    return { ok: false, note: `${running() ? "never answered" : "exited"}\n${(logs.stdout.toString() + logs.stderr.toString()).trim()}` };
  } finally { kill(name); }
}

export const CONTAINERS_USAGE = `usage: rustybuns containers [list] | build [BINDING…] [--verbose] | run BINDING [--shell] [--prod-like] [--env NAME=VALUE]… [--env-file path] | smoke [BINDING…] [--prod-like]`;
