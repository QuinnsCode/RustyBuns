// bun fatty.ts [app...] [--run]: fatty borg (#857), the chunky examples through build, deploy and teardown.
// Without --run it only lists the steps it would take. With --run it builds, then (for an edge app)
// plans, checks the cost cap, deploys to a throwaway stage, smoke-checks, and destroys, even when a
// step failed, then sweeps for what destroy left (CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID).
// Timings and sizes print against the last run, kept in .fatty/last.json.
// It costs money: run it on demand or weekly, never per PR.
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { overCap, sweep } from "./src/edge.ts";
import { APPS, builtPaths, deployBlocker, fattyStage, formatRun, type FattyApp, type Measure, type Run } from "./src/fatty.ts";

const argv = process.argv.slice(2);
const live = argv.includes("--run");
const names = argv.filter((a) => !a.startsWith("--"));
const picked = names.length ? APPS.filter((a) => names.includes(a.name)) : APPS;
if (!picked.length) { console.error(`usage: bun fatty.ts [${APPS.map((a) => a.name).join("|")}...] [--run]`); process.exit(2); }

const root = resolve(import.meta.dir, "../..");
const lastFile = resolve(import.meta.dir, ".fatty/last.json");
const last: Run | null = existsSync(lastFile) ? JSON.parse(readFileSync(lastFile, "utf8")) : null;

if (!live) {
  for (const a of picked) console.log(`${a.name}  (${a.note})\n${a.steps.map((s) => `  ${s.label}${s.cmd ? `: ${s.cmd.join(" ")}` : ""}`).join("\n")}`);
  console.log("\nnothing ran. Add --run to build, deploy to a throwaway stage and destroy it (costs money).");
  process.exit(0);
}

const sh = async (cwd: string, cmd: string[], env: Record<string, string> = {}) => {
  const p = Bun.spawn(cmd, { cwd, env: { ...process.env, ...env }, stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { code, out: out + err };
};

async function runApp(app: FattyApp): Promise<Measure[]> {
  const cwd = resolve(root, app.dir), stage = fattyStage(), got: Measure[] = [];
  const time = async (label: string, f: () => Promise<{ ok: boolean; bytes?: number | null }>) => {
    const t = performance.now();
    const r = await f().catch((e) => { console.error(`${app.name} ${label}: ${e.message}`); return { ok: false, bytes: null }; });
    got.push({ step: label, ok: r.ok, ms: Math.round(performance.now() - t), bytes: r.bytes ?? null });
    return r.ok;
  };
  let deployed = false, good = true;
  try {
    for (const s of app.steps) {
      if (!good && s.kind !== "destroy") break;
      if (s.kind === "build") {
        good = await time(s.label, async () => {
          const r = await sh(cwd, s.cmd!);
          const sizes = builtPaths(r.out).map((p) => { try { return statSync(resolve(cwd, p)).size; } catch { return 0; } });
          if (r.code) console.error(r.out.slice(-2000));
          return { ok: r.code === 0, bytes: sizes.length ? sizes.reduce((a, b) => a + b, 0) : null };
        });
      } else if (s.kind === "plan") {
        const cfg = (await import(resolve(cwd, "rustybuns.config.ts"))).default;
        const why = deployBlocker(cfg.targets?.edge, cfg.stages, stage);
        good = await time(s.label, async () => {
          const r = await sh(cwd, [...s.cmd!, "--stage", stage]);
          if (r.code) return { ok: false };
          const problems = [...(why ? [why] : []), ...overCap(r.out, { maxResources: Number(process.env.FATTY_MAX_RESOURCES || 40), allowPaid: process.env.FATTY_ALLOW_PAID === "1" })];
          if (problems.length) { console.error(`${app.name}: no deploy:\n  ${problems.join("\n  ")}`); return { ok: false }; }
          return { ok: true };
        });
      } else if (s.kind === "deploy") {
        deployed = true;   // a failed deploy may still have made resources
        good = await time(s.label, async () => ({ ok: (await sh(cwd, [...s.cmd!, "--stage", stage])).code === 0 }));
      } else if (s.kind === "smoke") {
        good = await time(s.label, async () => {
          const url = JSON.parse(readFileSync(resolve(cwd, `.alchemy/state/${app.name}/${stage}/Worker.json`), "utf8"))?.attr?.url;
          for (let i = 0; i < 30; i++) { const r = await fetch(url).catch(() => null); if (r && r.status < 500) return { ok: true }; await Bun.sleep(2000); }
          return { ok: false };
        });
      } else if (s.kind === "destroy" && deployed) {
        await time(s.label, async () => ({ ok: (await sh(cwd, [...s.cmd!, "--stage", stage])).code === 0 }));
      }
    }
  } finally {
    const { CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: accountId } = process.env;
    if (deployed && token && accountId) {
      const left = await sweep({ token, accountId, stage, app: app.name, prefix: "fatty" }).catch((e: Error) => { console.error(`${app.name}: leftover check failed: ${e.message}`); return null; });
      const ok = left !== null && left.length === 0;
      got.push({ step: "nothing left", ok, ms: 0, bytes: null });
      if (left?.length) console.error(`${app.name}: destroy left these behind (the sweeper deleted them):\n${left.map((s) => `  ${s.kind} ${s.name}${s.error ? `  NOT deleted: ${s.error}` : ""}`).join("\n")}`);
    } else if (deployed) console.error(`${app.name}: can't check for leftovers without CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID`);
  }
  return got;
}

const run: Run = { at: new Date().toISOString(), apps: {} };
for (const a of picked) run.apps[a.name] = await runApp(a);
console.log(formatRun(run, last));
const ok = Object.values(run.apps).every((ms) => ms.every((m) => m.ok));
if (ok) { mkdirSync(resolve(import.meta.dir, ".fatty"), { recursive: true }); writeFileSync(lastFile, JSON.stringify({ at: run.at, apps: { ...last?.apps, ...run.apps } }, null, 2) + "\n"); }
process.exit(ok ? 0 : 1);
