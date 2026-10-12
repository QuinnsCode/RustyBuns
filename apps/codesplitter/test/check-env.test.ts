import { expect, test } from "bun:test";
import { checkEnv, sandboxUser, spawnAs } from "../src/check-env.ts";

test("a check keeps only PATH and the locale: no logins, its own HOME and TMPDIR, the owner's package caches (#1010)", () => {
  const from = { PATH: "/usr/bin", LANG: "en_US.UTF-8", HOME: "/Users/me", CLOUDFLARE_API_TOKEN: "x", GH_TOKEN: "y", SSH_AUTH_SOCK: "/s", CODESPLITTER_TOKEN: "cst_z" };
  expect(checkEnv(from, "/t/home", "/t/tmp")).toEqual({
    PATH: "/usr/bin", LANG: "en_US.UTF-8", HOME: "/t/home", TMPDIR: "/t/tmp", CI: "1",
    BUN_INSTALL_CACHE_DIR: "/Users/me/.bun/install/cache", npm_config_cache: "/Users/me/.npm",
  });
  // A sandbox user can't read the owner's caches, so it doesn't get pointed at them.
  expect(checkEnv(from, "/t/home", "/t/tmp", "cs-checks")).toEqual({ PATH: "/usr/bin", LANG: "en_US.UTF-8", HOME: "/t/home", TMPDIR: "/t/tmp", CI: "1" });
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
