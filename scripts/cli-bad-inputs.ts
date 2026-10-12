// `bun scripts/cli-bad-inputs.ts [out.json]`: run the CLI against a corpus of plausible mistakes
// (a hand- or agent-edited rustybuns.config.ts, a missing flag value) in throwaway app dirs, and
// record how each one fails: exit code, how much it printed, and whether it named the field. A
// case that exits 0 slipped through. Two more columns say whether a type check would have caught
// it instead: `types` checks the config against defineConfig's types (an editor would show it),
// `stack` checks the generated alchemy.run.ts the way `plan` does. Local only, no network.
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { stackTsconfig } from "../packages/cli/src/typecheck.ts";

const CLI = resolve(import.meta.dir, "../packages/cli/src/index.ts");
const CONFIG = resolve(import.meta.dir, "../packages/cli/src/config.ts");
// Any app that has alchemy and effect installed, for the stack check.
const MODULES = resolve(import.meta.dir, "../apps/park-hide-seek/node_modules");

const base = () => ({
  name: "demo-app",
  worker: { main: "src/worker.ts", compatibilityDate: "2026-06-01", compatibilityFlags: ["nodejs_compat"] },
  bindings: { DB: { type: "d1", databaseName: "demo-db" }, KV: { type: "kv" } } as Record<string, unknown>,
  targets: { edge: { provider: "cloudflare" } } as Record<string, unknown>,
});
type Cfg = ReturnType<typeof base> & Record<string, any>;
const edit = (f: (c: Cfg) => void) => { const c = base() as Cfg; f(c); return `export default defineConfig(${JSON.stringify(c, null, 2)});\n`; };

interface Case { name: string; field?: string; config?: string; args: string[] }
const cases: Case[] = [
  { name: "valid config", config: edit(() => {}), args: ["generate"] },
  { name: "no targets", field: "targets", config: edit((c) => { delete (c as any).targets; }), args: ["generate"] },
  { name: "no bindings", field: "bindings", config: edit((c) => { delete (c as any).bindings; }), args: ["generate"] },
  { name: "binding type typo", field: "KV", config: edit((c) => { c.bindings.KV = { type: "kvv" }; }), args: ["generate"] },
  { name: "d1 without databaseName", field: "databaseName", config: edit((c) => { c.bindings.DB = { type: "d1" }; }), args: ["generate"] },
  { name: "r2 without bucketName", field: "bucketName", config: edit((c) => { c.bindings.FILES = { type: "r2" }; }), args: ["generate"] },
  { name: "durable_object without className", field: "className", config: edit((c) => { c.bindings.ROOM = { type: "durable_object" }; }), args: ["generate"] },
  { name: "no compatibilityFlags", field: "compatibilityFlags", config: edit((c) => { delete (c.worker as any).compatibilityFlags; }), args: ["generate"] },
  { name: "compatibilityDate not a date", field: "compatibilityDate", config: edit((c) => { c.worker.compatibilityDate = "June 1st"; }), args: ["generate"] },
  { name: "cpuMs as a string", field: "cpuMs", config: edit((c) => { (c.worker as any).cpuMs = "50"; }), args: ["generate"] },
  { name: "bad cron", field: "crons", config: edit((c) => { (c.worker as any).crons = ["every minute"]; }), args: ["generate"] },
  { name: "ratelimit period 30", field: "period", config: edit((c) => { c.bindings.RL = { type: "ratelimit", namespaceId: "1001", simple: { limit: 10, period: 30 } }; }), args: ["generate"] },
  { name: "queue batchSize 500", field: "batchSize", config: edit((c) => { c.bindings.JOBS = { type: "queue", queueName: "jobs", consumer: { batchSize: 500 } }; }), args: ["generate"] },
  { name: "vectorize dimensions as string", field: "dimensions", config: edit((c) => { c.bindings.VEC = { type: "vectorize", indexName: "v", dimensions: "384" }; }), args: ["generate"] },
  { name: "var value a number", field: "value", config: edit((c) => { c.bindings.LIMIT = { type: "var", value: 5 }; }), args: ["generate"] },
  { name: "edge provider typo", field: "provider", config: edit((c) => { c.targets.edge = { provider: "cloudfare" }; }), args: ["generate"] },
  { name: "box provider typo", field: "provider", config: edit((c) => { c.targets.box = { provider: "hetzer" }; }), args: ["generate"] },
  { name: "box port as string", field: "port", config: edit((c) => { c.targets.box = { provider: "railway", port: "8080" }; }), args: ["generate"] },
  { name: "worker name with spaces", field: "name", config: edit((c) => { c.name = "My Demo App!"; }), args: ["generate"] },
  { name: "state typo", field: "state", config: edit((c) => { c.state = "shard"; }), args: ["generate"] },
  { name: "no default export", field: "default", config: "export const config = {};\n", args: ["generate"] },
  { name: "config syntax error", config: "export default { name: 'x', \n", args: ["generate"] },
  { name: "prof --seconds without a value", field: "--seconds", config: edit(() => {}), args: ["prof", "--seconds"] },
  { name: "prof --seconds not a number", field: "--seconds", config: edit(() => {}), args: ["prof", "--seconds", "ten"] },
  { name: "login unknown provider", field: "provider", args: ["login", "aws"] },
  { name: "unknown command", args: ["deploi"] },
];

const results = [];
for (const c of cases) {
  const dir = mkdtempSync(join(tmpdir(), "rb-bad-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "demo-app", dependencies: { vite: "*" } }));
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "src/worker.ts"), "export default { fetch: () => new Response('hi') };\n");
  if (c.config) writeFileSync(join(dir, "rustybuns.config.ts"), `import { defineConfig } from "${CONFIG}";\n${c.config}`);
  const p = Bun.spawnSync([process.execPath, CLI, ...c.args], { cwd: dir, env: { ...process.env, RUSTYBUNS_NO_UPDATE_CHECK: "1", CI: "1" }, stdout: "pipe", stderr: "pipe" });
  const out = (p.stdout.toString() + p.stderr.toString()).trim();
  const check = (tsconfig: string, json: string) => {
    writeFileSync(join(dir, tsconfig), json);
    return Bun.spawnSync([process.execPath, "check", "-p", join(dir, tsconfig), "--no-pretty"], { cwd: dir, stdout: "ignore", stderr: "ignore" }).exitCode !== 0;
  };
  let types: boolean | null = null, stack: boolean | null = null;
  if (c.config) {
    symlinkSync(MODULES, join(dir, "node_modules"), "dir");
    types = check("tsconfig.config.json", JSON.stringify({ compilerOptions: { strict: true, noEmit: true, skipLibCheck: true, allowImportingTsExtensions: true, types: [] }, files: ["rustybuns.config.ts"] }));
    if (p.exitCode === 0 && existsSync(join(dir, ".rustybuns/alchemy.run.ts"))) stack = check(".rustybuns/tsconfig.stack.json", stackTsconfig());
  }
  rmSync(dir, { recursive: true, force: true });
  const caught = p.exitCode !== 0 || c.name === "valid config";
  results.push({
    name: c.name, exit: p.exitCode, chars: out.length, out,
    caught, types, stack, namesField: c.field ? out.includes(c.field) : null,
    first: out.split("\n").find((l) => l.trim())?.slice(0, 160) ?? "",
  });
}

const yn = (b: boolean | null) => (b === null ? "-" : b ? "y" : "n");
const pad = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s.padEnd(n));
for (const r of results)
  console.log(`${r.caught ? (r.namesField === false ? "~" : "✓") : "✗"} ${pad(r.name, 32)} exit ${String(r.exit).padStart(3)} ${String(r.chars).padStart(5)}ch  types ${yn(r.types)} stack ${yn(r.stack)}  ${r.first}`);
const missed = results.filter((r) => !r.caught), vague = results.filter((r) => r.caught && r.namesField === false).length;
console.log(`\n${results.length} cases: ${missed.length} slipped through the CLI (exit 0), ${vague} failed without naming the field.`);
console.log(`Of those that slipped: types would catch ${missed.filter((r) => r.types).length}, the stack check ${missed.filter((r) => r.stack).length}, neither ${missed.filter((r) => !r.types && !r.stack).length}.`);
if (process.argv[2]) await Bun.write(process.argv[2], JSON.stringify(results, null, 2));
