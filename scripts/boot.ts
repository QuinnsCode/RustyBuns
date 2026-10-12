// Borg tier 1 for any app, free on every PR: build its dev host (`build desktop --dev`), start it on
// the local twins with a throwaway data dir, and check what every desktop app must do. Run it in
// apps/<name>; apps.yml runs it for each app with `boot: true` in scripts/ci-apps.ts.
//
//   1. no token: 403            2. with the token: / is 200
//   3. cross-origin isolated (COOP same-origin, COEP require-corp or credentialless), so SharedArrayBuffer works
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const cli = join(import.meta.dir, "../packages/cli/src/index.ts");
const token = "boot-check-token";
const home = mkdtempSync(join(tmpdir(), "boot-"));
const t0 = performance.now();
const ms = () => `${Math.round(performance.now() - t0)}ms`;

const build = Bun.spawnSync(["bun", cli, "build", "desktop", "--dev"], { stdout: "inherit", stderr: "inherit" });
if (build.exitCode !== 0) { console.error("boot: build desktop --dev failed"); process.exit(1); }
console.log(`boot: dev host built in ${ms()}`);

const host = Bun.spawn(["bun", ".rustybuns/dev/desktop.js"], {
  stdout: "pipe", stderr: "inherit",
  env: { ...process.env, HOME: home, RB_NO_BROWSER: "1", RB_TOKEN: token },
});
const fails: string[] = [];
try {
  const url = await Promise.race([serving(host.stdout), Bun.sleep(30_000).then(() => { throw new Error("not serving after 30s"); })]);
  console.log(`boot: serving ${url} at ${ms()}`);
  const bare = await fetch(url + "/");
  if (bare.status !== 403) fails.push(`no token: HTTP ${bare.status}, want 403`);
  const page = await fetch(url + "/", { headers: { cookie: `rb_token_${new URL(url).port}=${token}` } });
  if (page.status !== 200) fails.push(`with the token: HTTP ${page.status}, want 200`);
  // credentialless isolates too: apps that load CDN assets without CORP headers set it.
  const coep = page.headers.get("cross-origin-embedder-policy") ?? "";
  if (page.headers.get("cross-origin-opener-policy") !== "same-origin" || !["require-corp", "credentialless"].includes(coep))
    fails.push(`not cross-origin isolated (COOP ${page.headers.get("cross-origin-opener-policy")}, COEP ${coep || "missing"})`);
} catch (e) {
  fails.push(e instanceof Error ? e.message : String(e));
} finally {
  host.kill();
  rmSync(home, { recursive: true, force: true });
}
for (const f of fails) console.error(`boot: ✗ ${f}`);
console.log(fails.length ? `boot: failed at ${ms()}` : `boot: ✓ token gate, page and isolation in ${ms()}`);
process.exit(fails.length ? 1 : 0);

// The host prints "[<name>...] serving http://127.0.0.1:<port>" once it listens.
async function serving(out: ReadableStream<Uint8Array>): Promise<string> {
  let seen = "";
  for await (const chunk of out) {
    seen += new TextDecoder().decode(chunk);
    process.stdout.write(chunk);
    const m = seen.match(/serving (http:\/\/[\d.]+:\d+)/);
    if (m) return m[1]!;
  }
  throw new Error("host exited before serving");
}
