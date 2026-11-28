// `rustybuns deploy` plans first and says what it replaces or deletes before Alchemy does it (plan-summary.ts).
import { expect, setDefaultTimeout, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

setDefaultTimeout(30_000);

test("deploy --yes names what goes before Alchemy deploys, and stays quiet when nothing does", () => {
  const dir = mkdtempSync(join(tmpdir(), "rb-alarm-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "alarm", dependencies: { vite: "*" } }));
  writeFileSync(join(dir, "rustybuns.config.ts"), `import { defineConfig } from "${resolve(import.meta.dir, "../src/config.ts")}";
export default defineConfig({ name: "alarm", state: "project", worker: { main: "src/worker.ts", compatibilityDate: "2026-06-01", compatibilityFlags: [] }, bindings: {}, targets: { edge: { provider: "cloudflare" } } });\n`);
  mkdirSync(join(dir, "src")); writeFileSync(join(dir, "src/worker.ts"), "export default {};\n");
  // A stage that has deployed before: only that has anything to lose.
  mkdirSync(join(dir, ".alchemy/state/alarm/s1"), { recursive: true });
  // The stub's plan prints plan.log and, like Alchemy's, refuses --yes.
  mkdirSync(join(dir, "node_modules/.bin"), { recursive: true });
  writeFileSync(join(dir, "node_modules/.bin/alchemy"), `#!/bin/sh
if [ "$1" = plan ]; then case "$*" in *--yes*) exit 1;; esac; cat plan.log; else echo "STUB deploying"; fi
`);
  chmodSync(join(dir, "node_modules/.bin/alchemy"), 0o755);
  const deploy = (log: string) => {
    writeFileSync(join(dir, "plan.log"), log);
    const r = Bun.spawnSync([process.execPath, resolve(import.meta.dir, "../src/index.ts"), "deploy", "--yes", "--no-check", "--stage", "s1"], {
      cwd: dir, stdout: "pipe", stderr: "pipe",
      env: { ...process.env, CLOUDFLARE_API_TOKEN: "fake", CLOUDFLARE_ACCOUNT_ID: "fake", RUSTYBUNS_NO_UPDATE_CHECK: "1", RUSTYBUNS_NO_LOGIN_CHECK: "1" },
    });
    expect(r.exitCode).toBe(0);
    return { out: r.stdout.toString(), err: r.stderr.toString() };
  };

  const lost = deploy("[DB] replace\n[FILES] delete\n[Worker] update\n").out;
  expect(lost).toContain("STOP: DB is replaced, FILES is deleted.");
  expect(lost.indexOf("STOP:")).toBeLessThan(lost.indexOf("STUB deploying"));
  expect(lost).not.toContain("[DB] replace"); // the plan's own log stays out of the way

  const safe = deploy("[DB] noop\n[Worker] update\n");
  expect(safe.out).not.toContain("STOP:");
  expect(safe.err).not.toContain("couldn't check");

  const unread = deploy("something else\n");
  expect(unread.err).toContain("couldn't check what this deploy replaces or deletes");
  expect(unread.out).toContain("STUB deploying");
  rmSync(dir, { recursive: true, force: true });
});
