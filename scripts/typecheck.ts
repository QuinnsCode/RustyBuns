// `bun run typecheck`: the root tsconfig covers packages/; each app has its own
// tsconfig (DOM libs, vite/client, what it can check without generated files),
// so the checker runs once per project. That's `bun check` (Bun >= 1.4.3, what CI
// pins), else tsgo (TypeScript's native compiler, pinned in package.json) on an
// older local Bun. Errors print one line each, cut short (`--full` for all of it).
// Exits non-zero if any project has errors.
import { existsSync, readdirSync } from "node:fs";
import { availableParallelism } from "node:os";
import { compactDiagnostics } from "../packages/cli/src/typecheck.ts";

const bunCheck = Bun.semver.satisfies(Bun.version, ">=1.4.3-0");
const cmd = (p: string) => bunCheck
  ? [process.execPath, "check", "-p", p, "--no-pretty"]
  : ["bunx", "tsgo", "-p", p, "--noEmit", "--pretty", "false"];

// An app imported unchanged keeps its own tsconfig.json for its tools; tsconfig.check.json beside it is what we check.
const tsconfig = (a: string) => [`apps/${a}/tsconfig.check.json`, `apps/${a}/tsconfig.json`].find((p) => existsSync(p));
const projects = ["tsconfig.json", ...readdirSync("apps").sort().flatMap((a) => tsconfig(a) ?? [])];
// At most one checker per core. All 18 at once took the same wall time (median 2.4s vs 2.2s on
// 8 cores, noisy) and more memory (peak ~2.2 GB vs ~1.4 GB), which counts when several worktrees
// type check side by side. packages/cli/bench/concurrency.ts has the measurements.
const limit = availableParallelism();
const queue = [...projects], results: { p: string; code: number; out: string }[] = [];
await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, async () => {
  for (let p; (p = queue.shift()); ) {
    const proc = Bun.spawn(cmd(p), { stdout: "pipe", stderr: "pipe" });
    const out = (await new Response(proc.stdout).text()) + (await new Response(proc.stderr).text());
    results.push({ p, code: await proc.exited, out: out.trim() });
  }
}));
results.sort((a, b) => projects.indexOf(a.p) - projects.indexOf(b.p));
const full = process.argv.includes("--full");
const failed = results.filter((r) => r.code !== 0);
for (const r of failed) console.error(`✗ ${r.p}\n${full ? r.out : compactDiagnostics(r.out)}\n`);
console.log(`typecheck (${bunCheck ? "bun check" : "tsgo"}): ${results.length - failed.length}/${results.length} projects clean${failed.length ? `; failed: ${failed.map((r) => r.p).join(", ")}` : ""}`);
process.exit(failed.length ? 1 : 0);
