// `rustybuns smoke [dir]`: does this Vite or Bun app run on Rusty Buns, without touching it or any account?
// It works on a throwaway copy: installs, runs init, builds the dev host, boots it on the local twins
// and GETs / with the launch token. The copy, its data and its fake secrets are deleted afterwards.
//
// Nothing real reaches the app: no .env or .dev.vars (the copy has none), fakes for every secret it
// names, an empty HOME, no deploy logins in the environment, and the host in Seatbelt on macOS.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { buildEnv, emptyHome, hostCommand, hostEnv, withLocalBins } from "./sandbox.ts";
import { declaredSecrets, fakeSecret, removeCommittedSecrets } from "./fake-secrets.ts";

export type SmokeStage = "copy" | "install" | "init" | "build" | "boot" | "request" | "works";
export type SmokeResult = { stage: SmokeStage; mode?: string; status?: number; ms: number; error?: string; kept?: string };

const SKIP = /(^|\/)(node_modules|\.git|\.rustybuns|\.alchemy|\.wrangler|\.output|\.vercel|dist)$/;

/** The package manager the lockfile names; Bun when there is none (a Bun app, or any app, installs with it). */
export function packageManager(dir: string): "bun" | "pnpm" | "yarn" | "npm" {
  for (const [f, pm] of [["bun.lock", "bun"], ["bun.lockb", "bun"], ["pnpm-lock.yaml", "pnpm"], ["yarn.lock", "yarn"], ["package-lock.json", "npm"]] as const)
    if (existsSync(join(dir, f))) return pm;
  return "bun";
}

/** The config init wrote, with this run's data dir and, for "worker", the app's own Worker build on the desktop. */
export function withMode(cfg: string, mode: "spa" | "worker", dataDir: string): string {
  let s = cfg.replace(/\n\s*"dataDir": "[^"]*",?/, "").replace(/("desktop": \{)/, `$1\n      "dataDir": ${JSON.stringify(dataDir)},`);
  if (mode === "worker") s = s.replace(/"mode": "spa"/, `"mode": "worker"`).replace(/\n\s*"client(Build|Dir)": "[^"]*",?/g, "");
  return s;
}

/** The host prints a URL with the launch token once it listens. */
async function servingUrl(host: ReturnType<typeof Bun.spawn>, buf: () => string): Promise<string | undefined> {
  for (let i = 0; i < 240 && host.exitCode === null; i++) {
    await Bun.sleep(250);
    const url = buf().match(/https?:\/\/\S+token=[\w-]+/)?.[0];
    if (url) return url;
  }
}

export async function smoke(src: string, o: { keep?: boolean; version: string; cli: string; log?: (line: string) => void }): Promise<SmokeResult> {
  const say = o.log ?? (() => {});
  const t0 = performance.now(), ms = () => Math.round(performance.now() - t0);
  const root = mkdtempSync(join(tmpdir(), "rb-smoke-"));
  const dir = join(root, "app"), home = join(root, "home"), data = join(root, "data");
  mkdirSync(home);
  const fail = (stage: SmokeStage, error: string, mode?: string): SmokeResult => ({ stage, error, mode, ms: ms(), ...(o.keep ? { kept: dir } : {}) });
  try {
    say("copy: the app without node_modules, .git or any .env");
    cpSync(resolve(src), dir, { recursive: true, filter: (p) => !SKIP.test(p) });
    removeCommittedSecrets(dir);
    if (!existsSync(join(dir, "package.json"))) return fail("copy", `no package.json in ${resolve(src)}`);

    // fakes for every secret the app names: enough to boot logged-out, never real
    const fakes: Record<string, string> = {};
    for (const n of declaredSecrets(dir)) { const v = fakeSecret(n); if (v) fakes[n] = v; }
    const lines = Object.entries(fakes).map(([k, v]) => `${k}=${v}`).join("\n") + "\n";
    if (Object.keys(fakes).length) { writeFileSync(join(dir, ".env"), lines); writeFileSync(join(dir, ".dev.vars"), lines); say(`fake secrets: ${Object.keys(fakes).join(" ")}`); }

    const env = withLocalBins({ ...emptyHome(buildEnv(process.env), home), ...fakes }, dir);
    const run = (cmd: string[], timeout: number) => {
      const p = Bun.spawnSync(cmd, { cwd: dir, env, stdout: "pipe", stderr: "pipe", timeout });
      const out = p.stdout.toString() + p.stderr.toString();
      return { ok: p.exitCode === 0, out, tail: out.trim().split("\n").slice(-8).join("\n") };
    };

    const pm = packageManager(dir);
    say(`install: ${pm}`);
    let s = run(pm === "yarn" ? ["npx", "-y", "yarn@1", "install"] : [pm, "install"], 600_000);
    if (!s.ok && pm === "npm") s = run(["bun", "install"], 600_000);
    if (!s.ok) return fail("install", s.tail);

    // Rusty Buns itself: this checkout when the CLI runs from one, the matching release otherwise
    const checkout = join(dirname(o.cli), "../..");
    if (existsSync(join(checkout, "shell-bun/src"))) {
      mkdirSync(join(dir, "node_modules/@rustybuns"), { recursive: true });
      for (const p of ["cli", "shell-bun"]) { rmSync(join(dir, "node_modules/@rustybuns", p), { recursive: true, force: true }); symlinkSync(join(checkout, p), join(dir, "node_modules/@rustybuns", p)); }
    } else {
      s = run(pm === "npm" ? ["npm", "i", "-D", `@rustybuns/cli@${o.version}`, `@rustybuns/shell-bun@${o.version}`] : [pm === "yarn" ? "npx" : pm, ...(pm === "yarn" ? ["-y", "yarn@1"] : []), "add", "-D", `@rustybuns/cli@${o.version}`, `@rustybuns/shell-bun@${o.version}`], 300_000);
      if (!s.ok) return fail("install", s.tail);
    }

    const cli = ["bun", o.cli];
    say("init");
    s = run([...cli, "init", "--force"], 120_000);
    if (!s.ok) return fail("init", s.tail);
    say(s.out.match(/^detected: .*$/m)?.[0] ?? "detected: nothing it recognises");
    const cfgPath = join(dir, "rustybuns.config.ts"), initCfg = readFileSync(cfgPath, "utf8");
    const initMode = initCfg.match(/"mode": "(\w+)"/)?.[1];
    // the mode init chose first, then the app's own Worker build if it has one
    const modes = [initMode === "worker" ? "worker" : "spa", ...(initMode !== "worker" && /"builtMain"/.test(initCfg) ? ["worker"] : [])] as ("spa" | "worker")[];

    let last = fail("build", "no mode to try");
    for (const mode of modes) {
      writeFileSync(cfgPath, withMode(initCfg, mode, data));
      say(`build: ${mode} mode`);
      if (mode === "spa" && !existsSync(join(dir, "vite.desktop.config.ts"))) {
        s = run([...cli, "add", "desktop"], 300_000);
        if (!s.ok) { last = fail("build", s.tail, mode); continue; }
      }
      s = run([...cli, "build", "desktop", "--dev"], 600_000);
      if (!s.ok) { last = fail("build", s.tail, mode); continue; }

      say("boot: on the local twins");
      const host = Bun.spawn(hostCommand(".rustybuns/dev/desktop.js", [], { sandbox: true, cwd: dir }), {
        cwd: dir, stdout: "pipe", stderr: "pipe", env: { ...hostEnv(env), ...fakes, HOME: home, RB_NO_BROWSER: "1" },
      });
      let buf = "";
      for (const stream of [host.stdout, host.stderr]) void (async () => { for await (const c of stream) buf += new TextDecoder().decode(c); })();
      try {
        const url = await servingUrl(host, () => buf);
        if (!url) { last = fail("boot", buf.replace(/token=[\w-]+/g, "token=<redacted>").trim().split("\n").slice(-8).join("\n") || "no token URL within 60s", mode); continue; }
        const cookie = ((await fetch(url, { redirect: "manual" })).headers.get("set-cookie") ?? "").split(";")[0]!;
        const r = await fetch(new URL("/", url), { headers: { cookie }, redirect: "manual" });
        if (r.status >= 400) { last = fail("request", `GET / answered ${r.status}`, mode); last.status = r.status; continue; }
        return { stage: "works", mode, status: r.status, ms: ms(), ...(o.keep ? { kept: dir } : {}) };
      } finally {
        Bun.spawnSync(["pkill", "-P", String(host.pid)]); host.kill(); await host.exited;
      }
    }
    return last;
  } finally {
    if (!o.keep) rmSync(root, { recursive: true, force: true });
  }
}
