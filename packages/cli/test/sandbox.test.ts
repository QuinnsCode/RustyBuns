import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HOST_FLAGS, hostCommand, hostEnv, seatbeltProfile, wantsSandbox } from "../src/sandbox.ts";

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
