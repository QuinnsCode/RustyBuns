#!/usr/bin/env bun
// 🐳 Agent Office in a box: runs the office in a container that can only touch what a permission set grants.
//
//   bun run office:box plan      print the docker command the permission set makes, run nothing
//   bun run office:box up        build the image if it's missing, start the box, print the link and password
//   bun run office:box status    what's granted, and whether the box and its port are healthy
//   bun run office:box logs      follow the box's log
//   bun run office:box down      stop and remove the box (its home volume, with logins and the office's data, stays)
//   --perms file.json            another permission set (default: sandbox/box.json, else sandbox/box.example.json)
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type Perms = {
  port: number;
  memory?: string; // unset: a fifth of what Docker has
  cpus?: number;
  network: "open" | "offline";
  repos: { path: string; access: "rw" | "ro" }[];
  env: string[];
};

// Open lanes: unless the permission set says otherwise, the box gets a fifth of the CPUs and memory Docker has.
export const SHARE = 0.2;
export type Host = { cpus: number; memBytes: number };
export function limits(p: Perms, host: Host) {
  return {
    cpus: p.cpus ?? Math.max(0.5, Math.round(host.cpus * SHARE * 10) / 10),
    memory: p.memory ?? `${Math.max(512, Math.floor((host.memBytes * SHARE) / 2 ** 20))}m`,
  };
}

export const NAME = "agent-office-box";
const here = path.dirname(fileURLToPath(import.meta.url));

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown, what: string): string => {
  if (typeof v !== "string" || !v) throw new Error(`${what} must be text`);
  return v;
};

// The permission set is whatever the file says, checked field by field; anything missing falls back to the tight default.
export function parsePerms(raw: unknown): Perms {
  if (!isObject(raw)) throw new Error("the permission set must be a JSON object");
  const port = raw.port ?? 4600;
  if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`port ${String(port)} isn't a port`);
  const memory = raw.memory;
  if (memory !== undefined && (typeof memory !== "string" || !/^\d+[mg]$/.test(memory))) throw new Error(`memory ${String(memory)} should look like 512m or 4g`);
  const cpus = raw.cpus;
  if (cpus !== undefined && (typeof cpus !== "number" || !(cpus > 0))) throw new Error("cpus must be a number above 0");
  const network = raw.network ?? "open";
  if (network !== "open" && network !== "offline") throw new Error(`network ${String(network)} should be "open" or "offline"`);
  const repos = (Array.isArray(raw.repos) ? raw.repos : []).map((r: unknown, i) => {
    if (!isObject(r)) throw new Error(`repos[${i}] must be an object`);
    const access = r.access ?? "ro";
    if (access !== "rw" && access !== "ro") throw new Error(`repos[${i}].access should be "rw" or "ro"`);
    return { path: text(r.path, `repos[${i}].path`), access } as const;
  });
  const env = (Array.isArray(raw.env) ? raw.env : []).map((n: unknown, i) => {
    const name = text(n, `env[${i}]`);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error(`env[${i}] ${name} isn't a variable name`);
    return name;
  });
  return { port, memory, cpus, network, repos, env };
}

const expand = (p: string) => (p === "~" || p.startsWith("~/") ? path.join(homedir(), p.slice(1)) : path.resolve(p));
export const mountName = (p: string) => path.basename(expand(p)).replace(/[^A-Za-z0-9_.-]/g, "-");

// Everything the box can reach is on this line: no other mount, no other port, no variable not listed.
// An env name goes in as `-e NAME`, so its value comes from the host's environment and never shows in the command.
export function dockerArgs(p: Perms, host: Host, image = NAME): string[] {
  const lim = limits(p, host);
  const names = p.repos.map((r) => mountName(r.path));
  const floor = p.repos.findIndex((r) => r.access === "rw");
  const dup = names.find((n, i) => names.indexOf(n) !== i);
  if (dup) throw new Error(`two repos are both called ${dup}: they'd land on one path in the box`);
  return [
    "run", "-d", "--name", NAME, "--restart", "unless-stopped",
    "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--read-only",
    "--tmpfs", "/tmp:rw,size=1g", "--pids-limit", "512",
    "--memory", lim.memory, "--cpus", String(lim.cpus),
    "--network", p.network === "offline" ? "none" : "bridge",
    ...(p.network === "offline" ? [] : ["-p", `127.0.0.1:${p.port}:4600`]),
    "-v", `${NAME}-home:/home/office`,
    ...p.repos.flatMap((r, i) => ["-v", `${expand(r.path)}:/work/${names[i]}:${r.access}`]),
    // the first writable repo is the office's floor: it keeps its data in that repo's .agent-office
    ...(floor < 0 ? [] : ["-e", `OFFICE_FLOOR=/work/${names[floor]}`]),
    ...p.env.flatMap((n) => ["-e", n]),
    "-e", "OFFICE_PASSWORD",
    image,
  ];
}

export type Edit =
  | { grant: { path: string; access: "rw" | "ro" } }
  | { revoke: string }
  | { network: "open" | "offline" }
  | { port: number }
  | { env: { name: string; on: boolean } };

// One change to a permission set, checked like a file would be: the result is what parsePerms would have read.
// A mount has to be a folder that exists, so a typo can't become an empty directory Docker creates as root.
export function edit(p: Perms, e: Edit, isDir: (dir: string) => boolean = (d) => { try { return statSync(d).isDirectory(); } catch { return false; } }): Perms {
  const next = structuredClone(p);
  if ("grant" in e) {
    const dir = e.grant.path.trim();
    if (!(dir === "~" || dir.startsWith("~/") || path.isAbsolute(dir))) throw new Error(`${dir || "that path"} should start with / or ~/`);
    if (!isDir(expand(dir))) throw new Error(`${dir} isn't a folder on this machine`);
    const at = next.repos.findIndex((r) => expand(r.path) === expand(dir));
    if (at >= 0) next.repos[at] = { path: next.repos[at]!.path, access: e.grant.access };
    else next.repos.push({ path: dir, access: e.grant.access });
  } else if ("revoke" in e) {
    next.repos = next.repos.filter((r) => expand(r.path) !== expand(e.revoke));
  } else if ("network" in e) {
    next.network = e.network;
  } else if ("port" in e) {
    next.port = e.port;
  } else {
    next.env = next.env.filter((n) => n !== e.env.name);
    if (e.env.on) next.env.push(e.env.name);
  }
  return parsePerms(next);
}

/** Where the permission set is edited and saved: the one in use, or a new sandbox/box.json copied from the example. */
export const permsFile = (dir = here) => path.join(dir, "box.json");
export function savePerms(p: Perms, dir = here) {
  writeFileSync(permsFile(dir), `${JSON.stringify(p, null, 2)}\n`);
}

/** What the box is doing: its state, Docker's health check if it has one, and (when it publishes a port) whether the port answers. */
export async function boxHealth(p: Perms) {
  const state = await docker(["inspect", "-f", "{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}", NAME], { quiet: true });
  if (state.code) return { running: false as const };
  const [status = "", health = ""] = state.out.split(" ");
  const answers = p.network === "open" && await fetch(`http://127.0.0.1:${p.port}/login`, { signal: AbortSignal.timeout(3000) }).then((r) => r.ok, () => false);
  const mounted = (await docker(["inspect", "-f", '{{range .Mounts}}{{.Source}} {{.Destination}} {{.RW}}{{"\\n"}}{{end}}', NAME], { quiet: true })).out
    .split("\n").map((l) => l.split(" ")).filter((l) => l[1]?.startsWith("/work/")).map((l) => `${l[1]!.slice(6)}:${l[2] === "true" ? "rw" : "ro"}`);
  const granted = p.repos.map((r) => `${mountName(r.path)}:${r.access}`);
  const healthy = status === "running" && (p.network !== "open" || answers);
  // grants only reach the box when it's started again, so say when the running one isn't what the file says
  const restart = granted.length !== mounted.length || granted.some((g) => !mounted.includes(g));
  return { running: true as const, status, health, answers, healthy, restart };
}

export function loadPerms(file?: string): { perms: Perms; from: string } {
  const from = file ?? [path.join(here, "box.json"), path.join(here, "box.example.json")].find(existsSync)!;
  return { perms: parsePerms(JSON.parse(readFileSync(from, "utf8"))), from };
}

export async function docker(args: string[], opts: { env?: Record<string, string>; quiet?: boolean } = {}) {
  const p = Bun.spawn(["docker", ...args], { env: { ...process.env, ...opts.env }, stdout: opts.quiet ? "pipe" : "inherit", stderr: opts.quiet ? "pipe" : "inherit" });
  const out = opts.quiet ? await new Response(p.stdout).text() : "";
  return { code: await p.exited, out: out.trim() };
}

export async function hostCapacity(): Promise<Host> {
  const [cpus, memBytes] = (await docker(["info", "--format", "{{.NCPU}} {{.MemTotal}}"], { quiet: true })).out.split(" ").map(Number);
  if (!cpus || !memBytes) throw new Error("docker didn't say how much it has: is it running?");
  return { cpus, memBytes };
}

async function main(argv: string[]) {
  const at = argv.indexOf("--perms");
  const { perms, from } = loadPerms(at >= 0 ? argv[at + 1] : undefined);
  const cmd = argv.find((a, i) => !a.startsWith("--") && (at < 0 || i !== at + 1)) ?? "status";
  if (cmd === "plan") {
    console.log(`# permission set: ${path.relative(process.cwd(), from)}\ndocker ${dockerArgs(perms, await hostCapacity()).map((a) => (/[^\w@%+=:,./-]/.test(a) ? `'${a}'` : a)).join(" ")}`);
  } else if (cmd === "up") {
    const have = await docker(["image", "inspect", NAME], { quiet: true });
    if (have.code) {
      const root = path.resolve(here, "../../..");
      if ((await docker(["build", "-f", path.join(here, "Dockerfile"), "-t", NAME, root])).code) process.exit(1);
    }
    await docker(["rm", "-f", NAME], { quiet: true });
    const password = crypto.randomUUID();
    if ((await docker(dockerArgs(perms, await hostCapacity()), { env: { OFFICE_PASSWORD: password }, quiet: true })).code) process.exit(1);
    console.log(`🐳 the office is starting in ${NAME}\n   http://localhost:${perms.port}   password: ${password}\n   bun run office:box status`);
  } else if (cmd === "status") {
    console.log(`permission set ${path.relative(process.cwd(), from)}:`);
    console.log(`  repos    ${perms.repos.map((r) => `${r.path} (${r.access})`).join(", ") || "none"}`);
    console.log(`  env      ${perms.env.join(", ") || "none"}`);
    console.log(`  network  ${perms.network}   port ${perms.network === "offline" ? "none" : `127.0.0.1:${perms.port}`}   ${(({ memory, cpus }) => `${memory}, ${cpus} cpus`)(limits(perms, await hostCapacity()))}`);
    const h = await boxHealth(perms);
    if (!h.running) { console.log("box      not running (bun run office:box up)"); return; }
    console.log(`box      ${h.status}${h.health ? `, ${h.health}` : ""}${perms.network === "open" ? `; port ${perms.port} ${h.answers ? "answers" : "does not answer"}` : ""}${h.restart ? "\n         the running box has other grants than the file (bun run office:box up)" : ""}`);
    if (!h.healthy) process.exitCode = 1;
  } else if (cmd === "logs") {
    await docker(["logs", "-f", "--tail", "100", NAME]);
  } else if (cmd === "down") {
    await docker(["rm", "-f", NAME]);
  } else {
    throw new Error(`office:box ${cmd}? try plan, up, status, logs or down`);
  }
}

if (import.meta.main) await main(process.argv.slice(2)).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
