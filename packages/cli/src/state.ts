// Where the generated stack's Alchemy state lives.
//
// Alchemy.localState() writes to `.alchemy/state` under the working directory,
// so a git worktree's state goes when the worktree does, and the next plan
// rediscovers (or duplicates) everything. With `state: "shared"` (the default)
// `.alchemy/state` is a symlink into the repo's common git dir, keyed by the
// app's path in the repo, so every worktree of the repo and the main checkout
// see one state per app. A lock beside it keeps two of them from running
// Alchemy against it at once.

import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, readlinkSync, renameSync, rmSync, symlinkSync, writeSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { RustyBunsConfig } from "./config.ts";

/** `<git common dir>/rustybuns/alchemy/<app path in repo>`, or null outside git. */
export function sharedStateBase(projectDir: string): string | null {
  const git = (...args: string[]) => {
    const r = Bun.spawnSync(["git", "-C", projectDir, "rev-parse", ...args], { stderr: "ignore" });
    return r.exitCode === 0 ? r.stdout.toString().trim() : null;
  };
  const common = git("--path-format=absolute", "--git-common-dir");
  const prefix = git("--show-prefix");
  if (!common || prefix === null) return null;
  return join(common, "rustybuns", "alchemy", prefix.replace(/\/$/, "") || ".");
}

/**
 * Point `<projectDir>/.alchemy/state` at the shared dir. A real state dir left
 * from before moves there when the shared one is empty; otherwise this refuses
 * rather than pick one of two states. Returns the shared base, or null when the
 * state stays in the project.
 */
export function linkSharedState(projectDir: string): string | null {
  const base = sharedStateBase(projectDir);
  if (!base) return null;
  const shared = join(base, "state");
  const local = join(projectDir, ".alchemy", "state");
  const stat = lstatSync(local, { throwIfNoEntry: false });
  if (stat?.isSymbolicLink()) {
    if (resolve(dirname(local), readlinkSync(local)) === shared) { mkdirSync(shared, { recursive: true }); return base; }
    rmSync(local);
  } else if (stat) {
    if (existsSync(shared) && readdirSync(shared).length)
      throw new Error(`${local} and the shared state in ${shared} both exist. Keep one: move the one you want to ${shared}, delete the other, then run again. Or set \`state: "project"\` in rustybuns.config.ts.`);
    mkdirSync(base, { recursive: true });
    rmSync(shared, { recursive: true, force: true });
    renameSync(local, shared);
    console.log(`moved .alchemy/state to ${shared}, shared by every worktree of this repo`);
  }
  mkdirSync(shared, { recursive: true });
  mkdirSync(dirname(local), { recursive: true });
  symlinkSync(shared, local, "dir");
  return base;
}

/** Turn a shared-state symlink back into a project-local dir (`state: "project"`). */
export function unlinkSharedState(projectDir: string) {
  const local = join(projectDir, ".alchemy", "state");
  if (!lstatSync(local, { throwIfNoEntry: false })?.isSymbolicLink()) return;
  rmSync(local);
  console.log(`.alchemy/state no longer points at the shared state; it starts empty here (the shared one is kept in ${sharedStateBase(projectDir)}/state)`);
}

const alive = (pid: number) => {
  try { process.kill(pid, 0); return true; } catch (e: any) { return e?.code === "EPERM"; }
};

/**
 * Take `<base>/lock` for this process, or throw naming who holds it. A lock
 * whose process is gone is taken over. Returns the release function.
 */
export function lockState(base: string, what: string): () => void {
  const file = join(base, "lock");
  mkdirSync(base, { recursive: true });
  for (let tries = 0; tries < 2; tries++) {
    let fd: number;
    try {
      fd = openSync(file, "wx");
    } catch (e: any) {
      if (e?.code !== "EEXIST") throw e;
      let held: { pid?: number; cwd?: string; what?: string } = {};
      try { held = JSON.parse(readFileSync(file, "utf8")); } catch { /* half-written: treat as stale */ }
      if (held.pid && held.pid !== process.pid && alive(held.pid))
        throw new Error(`another \`rustybuns ${held.what ?? "deploy"}\` (pid ${held.pid}, in ${held.cwd ?? "?"}) is using this app's shared Alchemy state. Wait for it, or stop it.`);
      rmSync(file, { force: true });
      continue;
    }
    writeSync(fd, JSON.stringify({ pid: process.pid, cwd: process.cwd(), what }));
    closeSync(fd);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      try { if (JSON.parse(readFileSync(file, "utf8")).pid === process.pid) rmSync(file, { force: true }); } catch { /* gone */ }
    };
    process.on("exit", release);
    return release;
  }
  throw new Error(`could not take the state lock ${file}`);
}

/** The stage Alchemy will use: `--stage`, else $ALCHEMY_STAGE, else `live_$USER`. */
export function alchemyStage(args: string[], env: Record<string, string | undefined> = process.env): string {
  const at = args.findIndex((a) => a === "--stage" || a.startsWith("--stage="));
  if (at >= 0) return args[at].includes("=") ? args[at].slice("--stage=".length) : args[at + 1] ?? "";
  return env.ALCHEMY_STAGE || `live_${env.USER ?? ""}`;
}

/**
 * With `targets.edge.adopt` and no Worker in this stage's state, Alchemy's plan
 * says `create` for resources it will take over by name. Say so, naming them,
 * so the plan isn't read as a fresh install. Null when there's nothing to say.
 */
export function adoptNote(projectDir: string, cfg: Pick<RustyBunsConfig, "name" | "bindings" | "targets">, stage: string): string | null {
  if (!cfg.targets.edge?.adopt) return null;
  const dir = join(projectDir, ".alchemy", "state", cfg.name, stage);
  if (existsSync(join(dir, "Worker.json"))) return null;
  const names = [`Worker ${cfg.name}`];
  for (const b of Object.values(cfg.bindings ?? {})) {
    if (b.type === "d1") names.push(`D1 ${b.databaseName}`);
    if (b.type === "r2") names.push(`R2 ${b.bucketName}`);
  }
  return `no Alchemy state for stage ${stage} yet, and targets.edge.adopt is on: where the plan says \`create\` for ${names.join(", ")}, ` +
    `a deploy takes over the one already there by that name, if there is one. Anything else marked \`create\` is new.`;
}
