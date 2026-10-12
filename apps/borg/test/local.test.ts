// Tier 1 of slim borg, free on every PR: build each real host (`build desktop --dev`, and the box
// host test/build-box.ts builds), start it on the local twins with a throwaway data dir, and run
// the whole suite against it. Then go over each edge limit and pin which ones the twins enforce.
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CHECKS, formatResults, LIMITS, runBorg, type Result, type Target } from "../src/suite.ts";

setDefaultTimeout(60_000);
const app = join(import.meta.dir, "..");
const token = "borg-local-token";

// The edge limits each host refuses today (✓ in the limits grid). The rest it accepts, looser
// than the edge. Tighten a twin and add its limit here.
const ENFORCED: string[] = [];

const HOSTS = [
  {
    name: "desktop",
    build: ["../../packages/cli/src/index.ts", "build", "desktop", "--dev"],
    run: ".rustybuns/dev/desktop.js",
    env: (data: string) => ({ HOME: data, RB_NO_BROWSER: "1", RB_TOKEN: token }),
    target: (url: string): Target => ({ url, headers: { cookie: `rb_token_${new URL(url).port}=${token}` } }),
  },
  {
    name: "box",
    build: ["test/build-box.ts"],
    run: ".rustybuns/railway/box.js",
    env: (data: string) => ({ DATA_DIR: data, PORT: "0" }),
    target: (url: string): Target => ({ url }),
  },
];

for (const h of HOSTS) {
  describe(h.name, () => {
    const data = mkdtempSync(join(tmpdir(), `borg-${h.name}-`));
    let host: Bun.Subprocess<"ignore", "pipe", "inherit"> | undefined;
    let results: Result[] = [];
    let limits: Result[] = [];

    beforeAll(async () => {
      const build = Bun.spawnSync(["bun", ...h.build], { cwd: app, stdout: "pipe", stderr: "pipe" });
      if (build.exitCode !== 0) throw new Error(`${h.build.join(" ")} failed:\n${build.stdout}\n${build.stderr}`);
      host = Bun.spawn(["bun", h.run], { cwd: app, stdout: "pipe", stderr: "inherit", env: { ...process.env, ...h.env(data) } });
      const t = { ...h.target(await serving(host.stdout)), queueWaitMs: 5000 };
      results = await runBorg(t);
      limits = await runBorg(t, LIMITS);
      console.log(`${h.name} host\n${formatResults(results)}\nlimits\n${formatResults(limits)}`);
    });

    afterAll(() => { host?.kill(); rmSync(data, { recursive: true, force: true }); });

    for (const check of Object.keys(CHECKS)) {
      test(`local twins: ${check}`, () => {
        const r = results.find((x) => x.check === check);
        expect(r?.ok ? "ok" : r?.detail).toBe("ok");
      });
    }

    test("local twins: the edge limits they enforce", () => {
      expect(limits.map((r) => r.check)).toEqual(Object.keys(LIMITS));
      expect(limits.filter((r) => r.ok).map((r) => r.check)).toEqual(ENFORCED);
    });
  });
}

// A host prints "[borg-slim] serving http://<addr>:<port>" once it listens. The box binds 0.0.0.0.
async function serving(out: ReadableStream<Uint8Array>): Promise<string> {
  let seen = "";
  for await (const chunk of out) {
    seen += new TextDecoder().decode(chunk);
    const m = seen.match(/serving http:\/\/[\d.]+:(\d+)/);
    if (m) return `http://127.0.0.1:${m[1]}`;
  }
  throw new Error(`host exited before serving:\n${seen}`);
}
