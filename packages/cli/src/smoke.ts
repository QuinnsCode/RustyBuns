// `rustybuns smoke [dir]`: does this Vite or Bun app run on Rusty Buns, without touching it or any account?
// It works on a throwaway copy: installs, runs init, builds the dev host, boots it on the local twins
// and GETs / with the launch token. The copy, its data and its fake secrets are deleted afterwards.
//
// Nothing real reaches the app: no .env or .dev.vars (the copy has none), fakes for every secret it
// names, an empty HOME, no deploy logins in the environment, and the host in Seatbelt on macOS.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { buildEnv, emptyHome, hostCommand, hostEnv, withLocalBins } from "./sandbox.ts";
import { declaredSecrets, fakeSecret, removeCommittedSecrets } from "./fake-secrets.ts";
import { workspaceRoot } from "./glue/deploy-deps.ts";

export type SmokeStage = "copy" | "install" | "init" | "build" | "boot" | "request" | "works";
export type SmokeResult = { stage: SmokeStage; mode?: string; status?: number; ms: number; error?: string; kept?: string };

const SKIP = /(^|\/)(node_modules|\.git|\.rustybuns|\.alchemy|\.wrangler|\.output|\.vercel|dist)$/;

/** The package manager the lockfile names; Bun when there is none (a Bun app, or any app, installs with it). */
export function packageManager(dir: string): "bun" | "pnpm" | "yarn" | "npm" {
  for (const [f, pm] of [["bun.lock", "bun"], ["bun.lockb", "bun"], ["pnpm-lock.yaml", "pnpm"], ["yarn.lock", "yarn"], ["package-lock.json", "npm"]] as const)
    if (existsSync(join(dir, f))) return pm;
  return "bun";
}

/** Copies the app at `src` into `dest`, skipping node_modules, .git, build output and committed secrets. A
 *  workspace member brings its whole workspace (its siblings and the root lockfile, or `workspace:*` fails to
 *  resolve): `top` is where the copy installs, `dir` the member's folder in it, where init and the host run. */
export function copyApp(src: string, dest: string): { top: string; dir: string } {
  const app = resolve(src), ws = workspaceRoot(app);
  cpSync(ws ?? app, dest, { recursive: true, filter: (p) => !SKIP.test(p) });
  removeCommittedSecrets(dest);
  return { top: dest, dir: ws ? join(dest, relative(ws, app)) : dest };
}

/** Installs the copy at `top` with the package manager its lockfile names (npm falls back to Bun). */
export function installApp(top: string, env: Record<string, string>): { ok: boolean; pm: ReturnType<typeof packageManager>; tail: string } {
  const pm = packageManager(top);
  const run = (cmd: string[]) => {
    const p = Bun.spawnSync(cmd, { cwd: top, env, stdout: "pipe", stderr: "pipe", timeout: 600_000 });
    return { ok: p.exitCode === 0, tail: (p.stdout.toString() + p.stderr.toString()).trim().split("\n").slice(-8).join("\n") };
  };
  let r = run(pm === "yarn" ? ["npx", "-y", "yarn@1", "install"] : [pm, "install"]);
  if (!r.ok && pm === "npm") r = run(["bun", "install"]);
  return { ...r, pm };
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

export async function smoke(src: string, o: { keep?: boolean; edgeLike?: boolean; version: string; cli: string; log?: (line: string) => void }): Promise<SmokeResult> {
  const say = o.log ?? (() => {});
  const t0 = performance.now(), ms = () => Math.round(performance.now() - t0);
  const root = mkdtempSync(join(tmpdir(), "rb-smoke-"));
  const copy = join(root, "app"), home = join(root, "home"), data = join(root, "data");
  mkdirSync(home);
  let dir = copy;
  const fail = (stage: SmokeStage, error: string, mode?: string): SmokeResult => ({ stage, error, mode, ms: ms(), ...(o.keep ? { kept: dir } : {}) });
  try {
    say("copy: the app without node_modules, .git or any .env");
    const { top, dir: member } = copyApp(src, copy);
    dir = member;
    if (top !== dir) say(`copy: the whole workspace, ${relative(top, dir)} in it`);
    if (!existsSync(join(dir, "package.json"))) return fail("copy", `no package.json in ${resolve(src)}`);

    // fakes for every secret the app names: enough to boot logged-out, never real
    const fakes: Record<string, string> = {};
    for (const n of declaredSecrets(dir)) { const v = fakeSecret(n); if (v) fakes[n] = v; }
    const lines = Object.entries(fakes).map(([k, v]) => `${k}=${v}`).join("\n") + "\n";
    if (Object.keys(fakes).length) { writeFileSync(join(dir, ".env"), lines); writeFileSync(join(dir, ".dev.vars"), lines); say(`fake secrets: ${Object.keys(fakes).join(" ")}`); }

    const base = { ...emptyHome(buildEnv(process.env), home), ...fakes };
    say(`install: ${packageManager(top)}`);
    const inst = installApp(top, base);
    if (!inst.ok) return fail("install", inst.tail);
    const pm = inst.pm;
    // after the install, so the member's and the workspace root's node_modules/.bin are both there to find
    const env = withLocalBins(base, dir);
    const run = (cmd: string[], timeout: number) => {
      const p = Bun.spawnSync(cmd, { cwd: dir, env, stdout: "pipe", stderr: "pipe", timeout });
      const out = p.stdout.toString() + p.stderr.toString();
      return { ok: p.exitCode === 0, out, tail: out.trim().split("\n").slice(-8).join("\n") };
    };

    let s: ReturnType<typeof run>;

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
        cwd: dir, stdout: "pipe", stderr: "pipe", env: { ...hostEnv(env), ...fakes, HOME: home, RB_NO_BROWSER: "1", ...(o.edgeLike ? { RB_EDGE_LIKE: "1" } : {}) },
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
