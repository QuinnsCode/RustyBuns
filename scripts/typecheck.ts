// `bun run typecheck`: the root tsconfig covers packages/; each app has its own
// tsconfig (DOM libs, vite/client, what it can check without generated files),
// so the checker runs once per project. That's `bun check` (Bun >= 1.4.3, what CI
// pins), else tsgo (TypeScript's native compiler, pinned in package.json) on an
// older local Bun. Exits non-zero if any project has errors.
import { existsSync, readdirSync } from "node:fs";

const bunCheck = Bun.semver.satisfies(Bun.version, ">=1.4.3-0");
const cmd = (p: string) => bunCheck
  ? [process.execPath, "check", "-p", p, "--no-pretty"]
  : ["bunx", "tsgo", "-p", p, "--noEmit", "--pretty", "false"];

const projects = ["tsconfig.json", ...readdirSync("apps").sort().map((a) => `apps/${a}/tsconfig.json`).filter((p) => existsSync(p))];
const results = await Promise.all(projects.map(async (p) => {
  const proc = Bun.spawn(cmd(p), { stdout: "pipe", stderr: "pipe" });
  const out = (await new Response(proc.stdout).text()) + (await new Response(proc.stderr).text());
  return { p, code: await proc.exited, out: out.trim() };
}));
const failed = results.filter((r) => r.code !== 0);
for (const r of failed) console.error(`✗ ${r.p}\n${r.out}\n`);
console.log(`typecheck (${bunCheck ? "bun check" : "tsgo"}): ${results.length - failed.length}/${results.length} projects clean${failed.length ? `; failed: ${failed.map((r) => r.p).join(", ")}` : ""}`);
process.exit(failed.length ? 1 : 0);
