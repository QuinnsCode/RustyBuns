import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const cli = join(import.meta.dir, "../src/index.ts");

test("plan in an app that deploys with wrangler says how to preview it, and exits 0; deploy still stops", () => {
  const dir = mkdtempSync(join(tmpdir(), "no-plan-"));
  try {
    writeFileSync(join(dir, "wrangler.jsonc"), "{}");
    writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: { deploy: "wrangler deploy" } }));
    const run = (cmd: string) => Bun.spawnSync([process.execPath, cli, cmd], { cwd: dir, env: { ...process.env, RUSTYBUNS_NO_VERSION_CHECK: "1" } });
    const plan = run("plan");
    expect(plan.exitCode).toBe(0);
    expect(plan.stdout.toString()).toContain("wrangler deploy --dry-run");
    expect(plan.stdout.toString()).toContain("deploy    bun run deploy");
    expect(run("deploy").exitCode).not.toBe(0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
