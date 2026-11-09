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
// One app failing never stops the rest. Each build gets 15 minutes. launchd runs it at 05:00 and 17:00 through
// scripts/builder-nightly.sh (scripts/mac/dev.rustybuns.builder-nightly.plist, which builder-setup.sh installs), and
// `bun run builder nightly` on the office Mac prints the last run's failures.
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { arr, bool, num, obj, str, type Of } from "../packages/util/src/guard.ts";

type Job = { app: string; runner: string; target: string; prep: string; build: string };
const Results = obj({ at: str(40), commit: str(40), results: arr(obj({ app: str(200), target: str(200), ok: bool(), seconds: num(0, Infinity), tail: str(Infinity, { min: 0 }) }), 1000) });
type Results = Of<typeof Results>;
type Result = Results["results"][number];

/** The last night's failures out of results.json, for `bun run builder nightly`: one line when all built, a tail per failure. */
export function report(text: string): { text: string; ok: boolean } {
  let r: Results;
  try { r = Results(JSON.parse(text)); } catch (e) { return { text: `no readable results.json (${e instanceof Error ? e.message : e}): has the nightly run yet?`, ok: false }; }
  const failed = r.results.filter((x) => !x.ok);
  const head = `${r.at.slice(0, 16).replace("T", " ")} at ${r.commit}: ${r.results.length - failed.length} of ${r.results.length} built`;
  return { ok: !failed.length, text: [head, ...failed.map((f) => `FAIL ${f.app} ${f.target} ${f.seconds}s\n${f.tail.split("\n").map((l) => `     ${l}`).join("\n")}`)].join("\n") };
}

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
