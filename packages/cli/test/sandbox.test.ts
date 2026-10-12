import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildEnv, emptyHome, HOST_FLAGS, hostCommand, hostEnv, seatbeltProfile, wantsSandbox } from "../src/sandbox.ts";

test("buildEnv drops the deploy's logins and keeps what a build reads (#1114)", () => {
  const env = buildEnv({
    PATH: "/bin", HOME: "/h", NODE_ENV: "production", VITE_API: "u", NPM_TOKEN: "n", GITHUB_SHA: "abc", JEKYLL_ENV: "production",
    CLOUDFLARE_API_TOKEN: "x", CLOUDFLARE_ACCOUNT_ID: "x", CF_API_TOKEN: "x", ALCHEMY_PASSWORD: "x", WRANGLER_API_TOKEN: "x",
    HCLOUD_TOKEN: "x", RAILWAY_API_TOKEN: "x", OP_SERVICE_ACCOUNT_TOKEN: "x", GITHUB_TOKEN: "x", GH_TOKEN: "x",
    AWS_SECRET_ACCESS_KEY: "x", AWS_ACCESS_KEY_ID: "x", GONE: undefined,
  });
  expect(Object.keys(env).sort()).toEqual(["GITHUB_SHA", "HOME", "JEKYLL_ENV", "NODE_ENV", "NPM_TOKEN", "PATH", "VITE_API"]);
});

test("emptyHome swaps HOME, keeps the caches that exist and drops pointers at real config (#1128)", () => {
  const real = new Set(["/Users/me/.npm", "/Users/me/.bun", "/Users/me/.bun/install/cache", "/Users/me/.rbenv", "/Users/me/.cache"]);
  const env = emptyHome({
    PATH: "/bin", HOME: "/Users/me", NODE_ENV: "production", XDG_CONFIG_HOME: "/Users/me/.config", DOCKER_CONFIG: "/Users/me/.docker",
    NPM_CONFIG_USERCONFIG: "/Users/me/.npmrc", CARGO_HOME: "/opt/cargo",
  }, "/app/.rustybuns/home", "/Users/me", (p) => real.has(p));
  expect(env).toEqual({
    PATH: "/bin", NODE_ENV: "production", CARGO_HOME: "/opt/cargo",
    HOME: "/app/.rustybuns/home", XDG_CONFIG_HOME: "/app/.rustybuns/home/.config", GH_CONFIG_DIR: "/app/.rustybuns/home/.config/gh",
    npm_config_cache: "/Users/me/.npm", BUN_INSTALL: "/Users/me/.bun", BUN_INSTALL_CACHE_DIR: "/Users/me/.bun/install/cache",
    RBENV_ROOT: "/Users/me/.rbenv", XDG_CACHE_HOME: "/Users/me/.cache",
    GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "credential.helper", GIT_CONFIG_VALUE_0: "", GIT_TERMINAL_PROMPT: "0",
  });
  // an existing GIT_CONFIG_* list keeps its entries
  const more = emptyHome({ GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "safe.directory", GIT_CONFIG_VALUE_0: "*" }, "/h", "/Users/me", () => false);
  expect([more.GIT_CONFIG_COUNT, more.GIT_CONFIG_KEY_0, more.GIT_CONFIG_KEY_1, more.GIT_CONFIG_VALUE_1]).toEqual(["2", "safe.directory", "credential.helper", ""]);
});

test("a build under emptyHome sees the empty HOME, not the real one", () => {
  const home = mkdtempSync(join(tmpdir(), "home-"));
  try {
    const r = Bun.spawnSync(["sh", "-c", 'echo "$HOME"; ls -A ~'], { env: emptyHome(buildEnv(process.env), home), stdout: "pipe" });
    expect(r.stdout.toString()).toBe(`${home}\n`);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("hostEnv drops credentials and keeps what a host runs on", () => {
  const env = hostEnv({
    PATH: "/bin", HOME: "/h", LANG: "en", TMPDIR: "/t", USER: "me",
    RB_TOKEN: "launch", RB_LISTEN: "127.0.0.1:1", SSH_AUTH_SOCK: "/s", GIT_SSH_COMMAND: "ssh",
    CLOUDFLARE_API_TOKEN: "x", CLOUDFLARE_ACCOUNT_ID: "x", GITHUB_TOKEN: "x", GH_TOKEN: "x", AWS_SECRET_ACCESS_KEY: "x",
    ANTHROPIC_API_KEY: "x", OP_SERVICE_ACCOUNT_TOKEN: "x", NPM_TOKEN: "x", MY_PASSWORD: "x", STRIPE_KEY: "x", GONE: undefined,
  });
  expect(Object.keys(env).sort()).toEqual(["GIT_SSH_COMMAND", "HOME", "LANG", "PATH", "RB_LISTEN", "RB_TOKEN", "SSH_AUTH_SOCK", "TMPDIR", "USER"]);
});

test("hostCommand: Bun's locks always, Seatbelt only when asked", () => {
  expect(hostCommand("h.js", ["--listen", "x"])).toEqual(["bun", ...HOST_FLAGS, "h.js", "--listen", "x"]);
  expect(HOST_FLAGS).toEqual(["--no-env-file", "--no-install"]);
  const jailed = hostCommand("h.js", [], { sandbox: true });
  expect(jailed.slice(-HOST_FLAGS.length - 2)).toEqual(["bun", ...HOST_FLAGS, "h.js"]);
});

test("wantsSandbox takes --sandbox or RB_SANDBOX=1 and strips the flag", () => {
  expect(wantsSandbox(["--sandbox", "--listen", "x"], {})).toEqual({ on: true, args: ["--listen", "x"] });
  expect(wantsSandbox([], { RB_SANDBOX: "1" })).toEqual({ on: true, args: [] });
  expect(wantsSandbox(["--join", "p"], {})).toEqual({ on: false, args: ["--join", "p"] });
});

test("the profile denies home credentials and the project's secret files, up to the repo root", () => {
  const root = mkdtempSync(join(tmpdir(), "sb-"));
  try {
    mkdirSync(join(root, "apps/a"), { recursive: true });
    writeFileSync(join(root, ".git"), "gitdir: elsewhere"); // a worktree's .git is a file
    const p = seatbeltProfile(join(root, "apps/a"), "/Users/me");
    expect(p).toStartWith("(version 1)\n(allow default)\n(deny file-read* file-write*");
    for (const s of ["/Users/me/.ssh", "/Users/me/.aws", "/Users/me/.config/gh", "/Users/me/.alchemy", "/Users/me/Library/Keychains"])
      expect(p).toContain(`(subpath "${s}")`);
    for (const d of ["apps/a/.env", "apps/a/.dev.vars", ".env", ".alchemy"]) expect(p).toMatch(new RegExp(`subpath ".*/${d.replace(".", "\\.")}"`));
    expect(p).not.toContain(".env.schema");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test.if(process.platform === "darwin")("under Seatbelt a host can't read a denied file but can read its own", () => {
  const dir = mkdtempSync(join(tmpdir(), "sb-"));
  try {
    writeFileSync(join(dir, ".env"), "SECRET=1");
    writeFileSync(join(dir, "ok.txt"), "fine");
    const cmd = hostCommand("-e", [`const f = require("fs"); let r = "open"; try { f.readFileSync(".env") } catch { r = "denied" } console.log(r, f.readFileSync("ok.txt", "utf8"))`], { sandbox: true, cwd: dir });
    if (cmd[0] !== "/usr/bin/sandbox-exec") return; // no Seatbelt here (nested inside one): nothing to check
    const r = Bun.spawnSync(cmd, { cwd: dir, stdout: "pipe", stderr: "pipe" });
    expect(r.stdout.toString().trim()).toBe("denied fine");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
