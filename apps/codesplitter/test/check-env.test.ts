import { expect, test } from "bun:test";
import { NO_KEYCHAIN, checkEnv, sandboxUser, spawnAs } from "../src/check-env.ts";

test("a check keeps only PATH and the locale: no logins, its own HOME and TMPDIR, the owner's package caches (#1010)", () => {
  const from = { PATH: "/usr/bin", LANG: "en_US.UTF-8", HOME: "/Users/me", CLOUDFLARE_API_TOKEN: "x", GH_TOKEN: "y", SSH_AUTH_SOCK: "/s", CODESPLITTER_TOKEN: "cst_z" };
  expect(checkEnv(from, "/t/home", "/t/tmp")).toEqual({
    PATH: "/usr/bin", LANG: "en_US.UTF-8", HOME: "/t/home", TMPDIR: "/t/tmp", CI: "1", ...NO_KEYCHAIN,
    BUN_INSTALL_CACHE_DIR: "/Users/me/.bun/install/cache", npm_config_cache: "/Users/me/.npm",
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
