// Tier 1 of slim borg, free on every PR: build the real dev host (`build desktop --dev`), start
// it on the local twins with a throwaway data dir, and run the whole suite against it.
import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CHECKS, formatResults, runBorg, type Result } from "../src/suite.ts";

setDefaultTimeout(60_000);
const app = join(import.meta.dir, "..");
const home = mkdtempSync(join(tmpdir(), "borg-"));
const token = "borg-local-token";
let host: Bun.Subprocess<"ignore", "pipe", "inherit">;
let results: Result[] = [];

beforeAll(async () => {
  const build = Bun.spawnSync(["bun", "../../packages/cli/src/index.ts", "build", "desktop", "--dev"], { cwd: app, stdout: "pipe", stderr: "pipe" });
  if (build.exitCode !== 0) throw new Error(`build desktop --dev failed:\n${build.stdout}\n${build.stderr}`);
  host = Bun.spawn(["bun", ".rustybuns/dev/desktop.js"], {
    cwd: app, stdout: "pipe", stderr: "inherit",
    env: { ...process.env, HOME: home, RB_NO_BROWSER: "1", RB_TOKEN: token },
  });
  const url = await serving(host.stdout);
  results = await runBorg({ url, headers: { cookie: `rb_token_${new URL(url).port}=${token}` }, queueWaitMs: 5000 });
  console.log(formatResults(results));
});

afterAll(() => { host?.kill(); rmSync(home, { recursive: true, force: true }); });

// The host prints "[borg-slim] serving http://127.0.0.1:<port>" once it listens.
async function serving(out: ReadableStream<Uint8Array>): Promise<string> {
  let seen = "";
  for await (const chunk of out) {
    seen += new TextDecoder().decode(chunk);
    const m = seen.match(/serving (http:\/\/[\d.]+:\d+)/);
    if (m) return m[1]!;
  }
  throw new Error(`host exited before serving:\n${seen}`);
}

for (const check of Object.keys(CHECKS)) {
  test(`local twins: ${check}`, () => {
    const r = results.find((x) => x.check === check);
    expect(r?.ok ? "ok" : r?.detail).toBe("ok");
  });
}
