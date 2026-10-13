// `bun scripts/smoke-adopt.ts [--dry] [--sweep]`: the FRESH / ADOPT guard (#1362) against a real
// Cloudflare account, sections A-G of #1365's checklist (the Divco-sized stack, H, stays by hand).
// It prints pass or fail per box, with the command and output of each failure, then sweeps for
// leftovers. Costs cents: a Worker, a D1, an R2 bucket and a queue, all named `smoke-1362-*`.
//
//   --dry     print the steps and touch nothing (no login, no account)
//   --local   only the boxes that touch no account (offline plan, no-terminal refusals); needs no login
//   --sweep   only list, and with --delete remove, `smoke-1362-*` leftovers; no tests
//
// Real runs need SMOKE_CLOUDFLARE=1 and `wrangler whoami` already pointing at a disposable account.
// Local only otherwise: the prompts are driven through `script(1)` so they see a terminal.
import { existsSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const CLI = resolve(import.meta.dir, "../packages/cli/src/index.ts");
const CONFIG = resolve(import.meta.dir, "../packages/cli/src/config.ts");
const MODULES = resolve(import.meta.dir, "../apps/park-hide-seek/node_modules");
const PREFIX = "smoke-1362-";
const APP = `${PREFIX}app`;
const DB = `${PREFIX}db`, BUCKET = `${PREFIX}bucket`, QUEUE = `${PREFIX}queue`;

const argv = process.argv.slice(2);
const dry = argv.includes("--dry"), sweepOnly = argv.includes("--sweep"), del = argv.includes("--delete"), local = argv.includes("--local");

const sh = (cmd: string[], o: { cwd?: string; input?: string; timeout?: number } = {}) => {
  const p = Bun.spawnSync(cmd, { cwd: o.cwd, stdin: o.input === undefined ? "ignore" : new TextEncoder().encode(o.input), stdout: "pipe", stderr: "pipe", timeout: o.timeout ?? 600_000, env: { ...process.env, RUSTYBUNS_NO_UPDATE_CHECK: "1", CI: "" } });
  return { code: p.exitCode ?? 1, out: p.stdout.toString() + p.stderr.toString() };
};
const wrangler = (...a: string[]) => sh(["bunx", "wrangler", ...a]);

// --- sweep -------------------------------------------------------------------------------------
function leftovers(): { kind: string; name: string }[] {
  const found: { kind: string; name: string }[] = [];
  const grab = (kind: string, out: string, re: RegExp) => { for (const m of out.matchAll(re)) found.push({ kind, name: m[1] }); };
  grab("d1", wrangler("d1", "list", "--json").out, /"name":\s*"([^"]*smoke-1362-[^"]*)"/g);
  grab("r2", wrangler("r2", "bucket", "list").out, /name:\s*(\S*smoke-1362-\S*)/g);
  grab("queue", wrangler("queues", "list").out, /(\S*smoke-1362-\S*)/g);
  grab("vectorize", wrangler("vectorize", "list", "--json").out, /"name":\s*"([^"]*smoke-1362-[^"]*)"/g);
  grab("worker", sh(["bunx", "wrangler", "deployments", "list", "--name", APP]).out, /(smoke-1362-app)/g);
  return found;
}
function sweep() {
  const left = leftovers();
  console.log(left.length ? `leftovers:\n${left.map((l) => `  ${l.kind} ${l.name}`).join("\n")}` : "sweep: nothing named smoke-1362-* is left (workers, D1, R2, queues, Vectorize).");
  if (del) for (const l of left) {
    const cmd = { d1: ["d1", "delete", l.name, "-y"], r2: ["r2", "bucket", "delete", l.name], queue: ["queues", "delete", l.name], vectorize: ["vectorize", "delete", l.name, "--force"], worker: ["delete", "--name", l.name, "--force"] }[l.kind]!;
    console.log(`  delete ${l.kind} ${l.name}: ${wrangler(...cmd).code === 0 ? "ok" : "failed"}`);
  }
  return left.length;
}

if (sweepOnly) {
  if (dry) { console.log("dry: would list smoke-1362-* Workers, D1, R2 buckets, queues and Vectorize indexes"); process.exit(0); }
  process.exit(sweep() && !del ? 1 : 0);
}

// --- a throwaway app ---------------------------------------------------------------------------
const config = (o: { adopt?: boolean; stage?: boolean } = {}) => `import { defineConfig } from "${CONFIG}";
export default defineConfig(${JSON.stringify({
  name: APP,
  worker: { main: "src/worker.ts", compatibilityDate: "2026-06-01", compatibilityFlags: ["nodejs_compat"] },
  bindings: { DB: { type: "d1", databaseName: DB }, FILES: { type: "r2", bucketName: BUCKET }, JOBS: { type: "queue", queueName: QUEUE, consumer: false } },
  targets: { edge: { provider: "cloudflare", adopt: !!o.adopt } },
  ...(o.stage ? { stages: { alt: { bindings: { DB: { type: "d1", databaseName: `${DB}-alt` } } } } } : {}),
}, null, 2)});\n`;

function makeApp(o: { adopt?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "rb-smoke-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: APP, dependencies: {} }));
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "src/worker.ts"), "export default { fetch: () => new Response('smoke') };\n");
  writeFileSync(join(dir, "rustybuns.config.ts"), config(o));
  if (existsSync(MODULES)) symlinkSync(MODULES, join(dir, "node_modules"), "dir");
  return dir;
}
const setAdopt = (dir: string, adopt: boolean) => writeFileSync(join(dir, "rustybuns.config.ts"), config({ adopt }));
const rb = (dir: string, ...a: string[]) => sh([process.execPath, CLI, ...a], { cwd: dir, input: "" });
/** Runs under a pseudo-terminal (`script`), answering the prompts in order. */
const rbTty = (dir: string, answers: string[], ...a: string[]) =>
  sh(["script", "-q", "/dev/null", process.execPath, CLI, ...a], { cwd: dir, input: answers.map((x) => x + "\n").join("") });

// --- the boxes ---------------------------------------------------------------------------------
const results: { box: string; ok: boolean; detail: string }[] = [];
function check(box: string, ok: boolean, cmd: string, out: string) {
  if (!ok && process.env.SMOKE_DEBUG) console.log(out);
  results.push({ box, ok, detail: ok ? "" : `${cmd}\n${out.trim().split("\n").slice(-12).join("\n")}` });
  console.log(`${ok ? "pass" : "FAIL"}  ${box}`);
}
// Said at both ends: twice, identical, ahead of the profile footer.
const modeFirstAndLast = (out: string, mode: string) => {
  const lines = out.split("\n").filter((l) => l.startsWith(`mode: ${mode}`));
  return lines.length >= 2 && lines[0] === lines.at(-1);
};

const steps: [string, () => void][] = [
  ["F. plan --offline says FRESH (offline), reads no account", () => {
    const d = makeApp(); const r = rb(d, "plan", "--offline");
    check("F plan --offline banner", r.code === 0 && r.out.includes("mode: FRESH (offline)") && modeFirstAndLast(r.out, "FRESH (offline)"), "plan --offline", r.out);
  }],
  ["C. no terminal refuses ADOPT deploy, naming --adopt-existing", () => {
    const d = makeApp({ adopt: true }); const r = rb(d, "deploy", "--yes");
    check("C deploy < /dev/null in ADOPT", r.code !== 0 && r.out.includes("--adopt-existing"), "deploy --yes < /dev/null", r.out);
  }],
  ["C. --adopt-existing in FRESH mode does nothing", () => {
    const d = makeApp(); const r = rb(d, "plan", ...(local ? ["--offline"] : []), "--adopt-existing");
    check("C --adopt-existing in FRESH", r.code === 0 && r.out.includes("mode: FRESH"), "plan --adopt-existing", r.out);
  }],
  ["F. plan never prompts, in ADOPT mode with a terminal", () => {
    const d = makeApp({ adopt: true }); const r = rbTty(d, [], "plan");
    check("F plan shows ADOPT without a prompt", r.out.includes("mode: ADOPT") && !r.out.includes("[y/N]"), "plan (tty)", r.out);
  }],
  ["B. prompts: n, empty and yep refuse; y then a wrong name refuses", () => {
    const d = makeApp({ adopt: true });
    for (const [label, answers] of [["n", ["n"]], ["empty", [""]], ["yep", ["yep"]], ["y + wrong name", ["y", "nope"]]] as const) {
      const r = rbTty(d, [...answers], "deploy", "--yes");
      check(`B deploy answered "${label}" refuses`, r.code !== 0 && r.out.includes("[y/N]"), `deploy --yes (tty, ${label})`, r.out);
    }
  }],
  ["A. FRESH: pre-created names are never touched", () => {
    const d = makeApp();
    wrangler("d1", "create", DB); wrangler("r2", "bucket", "create", BUCKET);
    wrangler("d1", "execute", DB, "--remote", "--command", "create table t(x); insert into t values (1)");
    const before = wrangler("d1", "info", DB).out;
    const plan = rb(d, "plan"); check("A plan opens and ends with mode: FRESH", modeFirstAndLast(plan.out, "FRESH"), "plan", plan.out);
    const dep = rb(d, "deploy", "--yes"); check("A deploy --yes", dep.code === 0 && !dep.out.includes(`Worker ${APP}`), "deploy --yes", dep.out);
    const after = wrangler("d1", "info", DB).out;
    const row = wrangler("d1", "execute", DB, "--remote", "--command", "select x from t").out;
    check("A pre-created D1 untouched (same info, row kept)", before === after && row.includes("1"), "d1 info / select", before + after + row);
    const des = rb(d, "destroy"); check("A destroy: no prompt, exit 0", des.code === 0 && !des.out.includes("[y/N]"), "destroy", des.out);
    const stays = wrangler("d1", "info", DB);
    check("A pre-created D1 survives destroy", stays.code === 0, "d1 info", stays.out);
  }],
  ["B/E. ADOPT: take over, redeploy without asking, destroy asks", () => {
    const d = makeApp({ adopt: true });
    wrangler("queues", "create", QUEUE);
    const y = rbTty(d, ["y", APP], "deploy", "--yes");
    check("B y + right name goes on", y.code === 0, "deploy --yes (tty, y + name)", y.out);
    const row = wrangler("d1", "execute", DB, "--remote", "--command", "select x from t").out;
    check("B row survived the take-over", row.includes("1"), "d1 select", row);
    const again = rbTty(d, [], "deploy", "--yes");
    check("E second deploy does not ask", again.code === 0 && !again.out.includes("[y/N]"), "deploy --yes (tty)", again.out);
    const des = rbTty(d, ["y", "wrong"], "destroy");
    check("E destroy asks with DELETES and needs the name", des.code !== 0 && des.out.includes("DELETES"), "destroy (tty, y + wrong)", des.out);
    const gone = rb(d, "destroy", "--adopt-existing");
    check("C destroy --adopt-existing skips the prompts", gone.code === 0, "destroy --adopt-existing", gone.out);
  }],
  ["D. --fresh over an adopt config", () => {
    const d = makeApp({ adopt: true });
    wrangler("d1", "create", DB); wrangler("d1", "execute", DB, "--remote", "--command", "create table t(x); insert into t values (1)");
    const dep = rbTty(d, [], "deploy", "--yes", "--fresh");
    check("D deploy --fresh never prompts", dep.code === 0 && !dep.out.includes("[y/N]") && dep.out.includes("mode: FRESH (--fresh)"), "deploy --yes --fresh", dep.out);
    const des = rb(d, "destroy", "--fresh");
    check("D destroy --fresh removes only the new ones", des.code === 0, "destroy --fresh", des.out);
    check("D pre-created D1 untouched", wrangler("d1", "execute", DB, "--remote", "--command", "select x from t").out.includes("1"), "d1 select", "");
  }],
];

if (dry) {
  console.log(`dry run, nothing touched. Steps (all names ${PREFIX}*):`);
  for (const [name] of steps) console.log(`  ${name}`);
  console.log("  then: sweep for leftovers");
  process.exit(0);
}

if (local) {
  for (const [name, run] of steps.slice(0, 3)) { console.log(`# ${name}`); run(); }
  process.exit(results.some((r) => !r.ok) ? 1 : 0);
}

if (process.env.SMOKE_CLOUDFLARE !== "1") {
  console.error("This deploys to a real Cloudflare account. Check `wrangler whoami` is a disposable one, then rerun with SMOKE_CLOUDFLARE=1.");
  process.exit(2);
}
console.log(wrangler("whoami").out.trim() + "\n");
for (const [name, run] of steps) {
  console.log(`\n# ${name}`);
  try { run(); } catch (e) { check(name, false, "script error", String(e)); }
}
console.log("\n# sweep");
const left = sweep();
const failed = results.filter((r) => !r.ok);
for (const f of failed) console.log(`\nFAIL ${f.box}\n${f.detail}`);
console.log(`\n${results.length - failed.length}/${results.length} passed, ${left} leftover${left === 1 ? "" : "s"}. Not covered here: E worktree/stray-state, F --usage/--no-check, G wrapping at 80 columns, H (Divco-sized).`);
process.exit(failed.length || left ? 1 : 0);
