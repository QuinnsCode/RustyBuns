// Tier 1 of thick borg's keep-the-database story, free on every PR: build the desktop host, start
// it with no DATABASE_URL so it runs PGlite in a throwaway data dir, and run the story against it.
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CHECKS, formatResults, runStory, type Result } from "../src/suite.ts";

setDefaultTimeout(120_000);   // the first build and PGlite's initdb are slow
const app = join(import.meta.dir, "..");
const token = "borg-postgres-token";

describe("desktop on PGlite", () => {
  const data = mkdtempSync(join(tmpdir(), "borg-postgres-"));
  let host: Bun.Subprocess<"ignore", "pipe", "inherit"> | undefined;
  let results: Result[] = [];

  beforeAll(async () => {
    const build = Bun.spawnSync(["bun", "../../packages/cli/src/index.ts", "build", "desktop", "--dev"], { cwd: app, stdout: "pipe", stderr: "pipe" });
    if (build.exitCode !== 0) throw new Error(`build desktop failed:\n${build.stdout}\n${build.stderr}`);
    const env: Record<string, string | undefined> = { ...process.env, HOME: data, RB_NO_BROWSER: "1", RB_TOKEN: token };
    delete env.DATABASE_URL;
    host = Bun.spawn(["bun", ".rustybuns/dev/desktop.js"], { cwd: app, stdout: "pipe", stderr: "inherit", env });
    const url = await serving(host.stdout);
    results = await runStory({ url, headers: { cookie: `rb_token_${new URL(url).port}=${token}` } });
    console.log(formatResults(results));
  });

  afterAll(() => { host?.kill(); rmSync(data, { recursive: true, force: true }); });

  for (const check of Object.keys(CHECKS)) {
    test(`pglite twin: ${check}`, () => {
      const r = results.find((x) => x.check === check);
      expect(r?.ok ? "ok" : r?.detail).toBe("ok");
    });
  }
});

async function serving(out: ReadableStream<Uint8Array>): Promise<string> {
  let seen = "";
  for await (const chunk of out) {
    seen += new TextDecoder().decode(chunk);
    const m = seen.match(/serving http:\/\/[\d.]+:(\d+)/);
    if (m) return `http://127.0.0.1:${m[1]}`;
  }
  throw new Error(`host exited before serving:\n${seen}`);
}
