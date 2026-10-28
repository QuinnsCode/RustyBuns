#!/usr/bin/env bun
// Builds every app's desktop binaries on the builder Mac and says which ones failed, so nobody rebuilds them on every
// test run and a broken app is fixed on its own. Runs from a clone of the repo on the builder (builder-nightly.sh pulls
// main first); it reads the same build table desktop-drop.yml does (scripts/ci-apps.ts) and takes the jobs this Mac can
// do: the ones for macos-latest (its own arm64 build, native code included) and the ones that cross-compile every
// target from one host ("all"). Linux, Windows and Intel Mac jobs stay on GitHub's runners.
//
//   bun scripts/builder-nightly.ts             build them all, write ~/builder/nightly/results.json, exit 1 if any failed
//   bun scripts/builder-nightly.ts hono-example,fm-daw     only these apps
//
// One app failing never stops the rest. Each build gets 15 minutes.
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

type Job = { app: string; runner: string; target: string; prep: string; build: string };
type Result = { app: string; target: string; ok: boolean; seconds: number; tail: string };

/** The build jobs this Mac does out of desktop-drop's matrix. */
export function mine(matrix: unknown, only: string[] = []): Job[] {
  const include = typeof matrix === "object" && matrix !== null && "include" in matrix && Array.isArray(matrix.include) ? matrix.include : [];
  const jobs: Job[] = [];
  for (const e of include) {
    if (typeof e !== "object" || e === null) continue;
    const { app, runner, target, prep, build } = e as Record<string, unknown>;
    if (typeof app !== "string" || typeof runner !== "string" || typeof target !== "string" || typeof build !== "string") continue;
    if (only.length && !only.includes(app)) continue;
    if (runner !== "macos-latest" && target !== "all") continue;
    jobs.push({ app, runner, target, prep: typeof prep === "string" ? prep : "", build });
  }
  return jobs;
}

async function run(job: Job, root: string): Promise<Result> {
  const t0 = performance.now();
  const cmd = [job.prep, job.build].filter(Boolean).join(" && ");
  const p = Bun.spawn(["sh", "-c", cmd], { cwd: path.join(root, "apps", job.app), stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => p.kill(), 15 * 60_000);
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  const code = await p.exited;
  clearTimeout(timer);
  return { app: job.app, target: job.target, ok: code === 0, seconds: Math.round((performance.now() - t0) / 1000), tail: (err + out).trim().split("\n").slice(-6).join("\n") };
}

if (import.meta.main) {
  const root = path.dirname(import.meta.dir);
  const only = (process.argv[2] ?? "").split(",").filter(Boolean);
  const table = await Bun.$`bun scripts/ci-apps.ts drop all`.cwd(root).text();
  const line = table.split("\n").find((l) => l.startsWith("build="));
  if (!line) throw new Error("ci-apps.ts printed no build matrix");
  const jobs = mine(JSON.parse(line.slice("build=".length)), only);
  await Bun.$`bun install --frozen-lockfile`.cwd(root).quiet();
  const results: Result[] = [];
  for (const job of jobs) {
    const r = await run(job, root);
    results.push(r);
    console.log(`${r.ok ? "ok  " : "FAIL"} ${job.app} ${job.target} ${r.seconds}s`);
    if (!r.ok) console.log(r.tail.split("\n").map((l) => `     ${l}`).join("\n"));
  }
  const out = path.join(homedir(), "builder", "nightly");
  mkdirSync(out, { recursive: true });
  writeFileSync(path.join(out, "results.json"), JSON.stringify({ at: new Date().toISOString(), commit: (await Bun.$`git rev-parse --short HEAD`.cwd(root).text()).trim(), results }, null, 2));
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length} of ${results.length} built${failed.length ? `; failed: ${failed.map((f) => f.app).join(", ")}` : ""}`);
  process.exit(failed.length ? 1 : 0);
}
