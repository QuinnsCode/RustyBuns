// `bun run typecheck`: the root tsconfig covers packages/; each app has its own
// tsconfig (DOM libs, vite/client, what it can check without generated files),
// so tsc runs once per project. Exits non-zero if any project has errors.
import { existsSync, readdirSync } from "node:fs";

const projects = ["tsconfig.json", ...readdirSync("apps").sort().map((a) => `apps/${a}/tsconfig.json`).filter((p) => existsSync(p))];
const results = await Promise.all(projects.map(async (p) => {
  const proc = Bun.spawn(["bunx", "tsc", "-p", p, "--noEmit", "--pretty", "false"], { stdout: "pipe", stderr: "pipe" });
  const out = (await new Response(proc.stdout).text()) + (await new Response(proc.stderr).text());
  return { p, code: await proc.exited, out: out.trim() };
}));
const failed = results.filter((r) => r.code !== 0);
for (const r of failed) console.error(`✗ ${r.p}\n${r.out}\n`);
console.log(`typecheck: ${results.length - failed.length}/${results.length} projects clean${failed.length ? `; failed: ${failed.map((r) => r.p).join(", ")}` : ""}`);
process.exit(failed.length ? 1 : 0);
