import { expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Effect } from "effect";
import { Stopped, runScoped, spawnScoped } from "../src/lifecycle.ts";
import { lockState, noteChild } from "../src/state.ts";

const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const waitFor = async (f: () => boolean, ms = 5000) => { const end = Date.now() + ms; while (!f() && Date.now() < end) await Bun.sleep(20); return f(); };

test("a signal interrupts the command: children stop first, then the lock goes, then Stopped", async () => {
  const order: string[] = [];
  let held = false;
  const run = runScoped(Effect.gen(function* () {
    yield* Effect.acquireRelease(Effect.void, () => Effect.sync(() => order.push("lock released")));
    yield* Effect.acquireRelease(Effect.sync(() => { held = true; }), () => Effect.sync(() => order.push("child stopped")));
    yield* Effect.never;
  }));
  expect(await waitFor(() => held)).toBe(true);
  process.emit("SIGTERM" as never);
  const e = await run.catch((x) => x);
  expect(e).toBeInstanceOf(Stopped);
  expect((e as Stopped).exitCode).toBe(143);
  expect(order).toEqual(["child stopped", "lock released"]);
}, 10_000);

test("an error ends the scope the same way, and comes out as thrown", async () => {
  let released = false;
  const e = await runScoped(Effect.gen(function* () {
    yield* Effect.acquireRelease(Effect.void, () => Effect.sync(() => { released = true; }));
    throw new Error("guard said no");
  })).catch((x) => x);
  expect((e as Error).message).toBe("guard said no");
  expect(released).toBe(true);
});

test("spawnScoped: an interrupted child gets SIGINT and is waited for", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rb-life-"));
  const script = join(dir, "child.js");
  // "ready" once the SIGINT handler is on: a SIGINT before that kills it without the clean write (#1160).
  writeFileSync(script, `process.on("SIGINT", () => setTimeout(() => { require("fs").writeFileSync("${dir}/clean", "1"); process.exit(130); }, 100)); setInterval(() => {}, 1000); require("fs").writeFileSync("${dir}/ready", "1");`);
  let pid = 0;
  const run = runScoped(spawnScoped([process.execPath, script], { stdio: ["inherit", "inherit", "inherit"] }, (p) => { pid = p; }));
  expect(await waitFor(() => pid > 0 && existsSync(join(dir, "ready")), 20_000)).toBe(true);
  process.emit("SIGHUP" as never);
  expect(await run.catch((x) => x)).toBeInstanceOf(Stopped);
  expect(alive(pid)).toBe(false);
  expect(existsSync(join(dir, "clean"))).toBe(true);
  rmSync(dir, { recursive: true, force: true });
}, 30_000);

test("the lock stays held while the alchemy a dead rustybuns started still runs", async () => {
  const base = mkdtempSync(join(tmpdir(), "rb-lock-"));
  const orphan = Bun.spawn(["sleep", "5"]);
  // As a SIGKILLed rustybuns leaves it: its own pid gone, its child's still running.
  writeFileSync(join(base, "lock"), JSON.stringify({ pid: 999_999, cwd: "/elsewhere", what: "deploy", child: orphan.pid }));
  expect(() => lockState(base, "deploy")).toThrow(`(pid ${orphan.pid}, in /elsewhere) is still running`);
  orphan.kill(); await orphan.exited;
  const release = lockState(base, "deploy");
  noteChild(base, 4242);
  expect(JSON.parse(readFileSync(join(base, "lock"), "utf8"))).toMatchObject({ pid: process.pid, child: 4242 });
  release();
  expect(existsSync(join(base, "lock"))).toBe(false);
  rmSync(base, { recursive: true, force: true });
});

test("deploy stopped by SIGTERM: alchemy finishes its write and exits, the lock is freed", async () => {
  const dir = mkdtempSync(join(tmpdir(), "rb-life-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "life", dependencies: { vite: "*" } }));
  writeFileSync(join(dir, "rustybuns.config.ts"), `import { defineConfig } from "${resolve(import.meta.dir, "../src/config.ts")}";
export default defineConfig({ name: "life", worker: { main: "src/worker.ts", compatibilityDate: "2026-06-01", compatibilityFlags: [] }, bindings: {}, targets: { edge: { provider: "cloudflare" } } });\n`);
  mkdirSync(join(dir, "src")); writeFileSync(join(dir, "src/worker.ts"), "export default {};\n");
  mkdirSync(join(dir, "node_modules/.bin"), { recursive: true });
  // The pid file comes last, once the SIGINT handler is on, and whole: a rename, so the test
  // never reads it empty (Number("") is 0, and kill(0, 0) is this test's own group, #1160).
  writeFileSync(join(dir, "node_modules/.bin/alchemy"), `#!${process.execPath}
const fs = require("fs");
const t = setInterval(() => {}, 50);
process.on("SIGINT", () => { clearInterval(t); setTimeout(() => { fs.writeFileSync("${dir}/clean", "1"); process.exit(130); }, 100); });
fs.writeFileSync("${dir}/alchemy.pid.tmp", String(process.pid)); fs.renameSync("${dir}/alchemy.pid.tmp", "${dir}/alchemy.pid");
`);
  chmodSync(join(dir, "node_modules/.bin/alchemy"), 0o755);
  Bun.spawnSync(["git", "init", "-q"], { cwd: dir });
  const cli = Bun.spawn([process.execPath, resolve(import.meta.dir, "../src/index.ts"), "deploy", "--yes", "--no-check"], {
    cwd: dir, stdout: "pipe", stderr: "pipe",
    env: { ...process.env, CLOUDFLARE_API_TOKEN: "fake", CLOUDFLARE_ACCOUNT_ID: "fake", RUSTYBUNS_NO_UPDATE_CHECK: "1", CI: "1" },
  });
  expect(await waitFor(() => existsSync(join(dir, "alchemy.pid")), 20_000)).toBe(true);
  const child = Number(readFileSync(join(dir, "alchemy.pid"), "utf8"));
  expect(child).toBeGreaterThan(0);
  expect(alive(child)).toBe(true);
  cli.kill("SIGTERM");
  expect(await cli.exited).toBe(143);
  expect(await new Response(cli.stderr).text()).toContain("✗ [Stopped] stopped by SIGTERM");
  expect(alive(child)).toBe(false);
  expect(existsSync(join(dir, "clean"))).toBe(true);
  expect(existsSync(join(dir, ".git/rustybuns/alchemy/lock"))).toBe(false);
  rmSync(dir, { recursive: true, force: true });
}, 30_000);
