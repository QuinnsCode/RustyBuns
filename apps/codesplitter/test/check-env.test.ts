import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NO_KEYCHAIN, checkEnv, sandboxUser, spawnAs } from "../src/check-env.ts";
import { localMachine } from "../src/ci-runner.ts";

test("a check keeps only PATH and the locale: no logins, its own HOME and TMPDIR, package caches apart from the owner's (#1010)", () => {
  const from = { PATH: "/usr/bin", LANG: "en_US.UTF-8", HOME: "/Users/me", TMPDIR: "/var/folders/x/T/", BUN_INSTALL_CACHE_DIR: "/Users/me/.bun/install/cache", CLOUDFLARE_API_TOKEN: "x", GH_TOKEN: "y", SSH_AUTH_SOCK: "/s", CODESPLITTER_TOKEN: "cst_z" };
  expect(checkEnv(from, "/t/home", "/t/tmp")).toEqual({
    PATH: "/usr/bin", LANG: "en_US.UTF-8", HOME: "/t/home", TMPDIR: "/t/tmp", CI: "1", ...NO_KEYCHAIN,
    BUN_INSTALL_CACHE_DIR: "/var/folders/x/T/codesplitter-check-cache/bun", npm_config_cache: "/var/folders/x/T/codesplitter-check-cache/npm",
  });
  // A sandbox user can't read the owner's caches, so it doesn't get pointed at them.
  expect(checkEnv(from, "/t/home", "/t/tmp", "cs-checks")).toEqual({ PATH: "/usr/bin", LANG: "en_US.UTF-8", HOME: "/t/home", TMPDIR: "/t/tmp", CI: "1", ...NO_KEYCHAIN });
});

test("as a sandbox user, a command goes through sudo -n with only its env and umask 000 (#1010)", () => {
  const env = { PATH: "/usr/bin", HOME: "/t/home", CI: "1" };
  expect(spawnAs(["sh", "-c", "bun test"], env)).toEqual({ cmd: ["sh", "-c", "bun test"], env });
  expect(spawnAs(["sh", "-c", "bun test"], env, "cs-checks")).toEqual({
    cmd: ["sudo", "-n", "-u", "cs-checks", "--", "/usr/bin/env", "-i", "PATH=/usr/bin", "HOME=/t/home", "CI=1", "/bin/sh", "-c", 'umask 000; exec "$@"', "sh", "sh", "-c", "bun test"],
    env: { PATH: "/usr/bin" },
  });
  expect(sandboxUser(undefined)).toBeUndefined();
  expect(sandboxUser("cs-checks")).toBe("cs-checks");
  expect(() => sandboxUser("root")).toThrow("not a sandbox user name");
  expect(() => sandboxUser("-u root")).toThrow("not a sandbox user name");
});

test("git under a check's empty HOME never asks the keychain: macOS would pop Keychain Not Found", () => {
  const vars = checkEnv({ PATH: process.env.PATH }, "/nonexistent-home", "/tmp");
  const git = Bun.spawnSync(["git", "config", "--get-all", "credential.helper"], { env: vars });
  // An empty value resets the helper list, so whatever macOS set before it never runs.
  expect(git.stdout.toString().split("\n").at(-2)).toBe("");
});

test.skipIf(process.platform !== "darwin")("run as the owner, a check reads and writes nothing in the owner's home but the tools on PATH", async () => {
  const home = mkdtempSync(join(tmpdir(), "cs-owner-home-"));
  writeFileSync(join(home, ".npmrc"), "//registry.npmjs.org/:_authToken=owner-secret");
  mkdirSync(join(home, "bin"));
  writeFileSync(join(home, "bin", "hello"), "#!/bin/sh\necho hi from a tool\n", { mode: 0o755 });
  const was = { HOME: process.env.HOME, PATH: process.env.PATH };
  process.env.HOME = home;
  process.env.PATH = `${home}/bin:${was.PATH}`;
  const m = await localMachine(undefined);
  process.env.HOME = was.HOME;
  process.env.PATH = was.PATH;
  try {
    let out = "";
    const run = async (sh: string) => { out = ""; return m.exec(["sh", "-c", sh], (s) => { out += s; }); };
    expect(await run(`cat '${home}/.npmrc'`)).not.toBe(0);
    expect(out).not.toContain("owner-secret");
    expect(await run(`echo x > '${home}/planted'`)).not.toBe(0);
    expect(await run("hello")).toBe(0);
    expect(out).toContain("hi from a tool");
    expect(await run("echo ok > made && cat made")).toBe(0);
    expect(out).toContain("ok");
    expect(await run('echo "$BUN_INSTALL_CACHE_DIR"')).toBe(0);
    expect(out.startsWith(home)).toBe(false);
  } finally {
    await m.dispose();
    rmSync(home, { recursive: true, force: true });
  }
  // With the real home held off, a check's own tools still work: bun installs and git commits.
  const real = await localMachine(undefined);
  try {
    await real.write({ "package.json": JSON.stringify({ name: "held", version: "1.0.0" }) });
    expect(await real.exec(["bun", "install"], () => {})).toBe(0);
    expect(await real.exec(["sh", "-c", "git init -q && git -c user.name=c -c user.email=c@x commit -q --allow-empty -m one"], () => {})).toBe(0);
  } finally {
    await real.dispose();
  }
});
