// Whether a plan, deploy or destroy can touch resources that already exist on the account (#1362).
//
// Alchemy names what it makes itself, `<app>-<id>-<stage>-<random>`, unless `targets.edge.adopt`
// is on: then it takes over whatever already has the config's names (databaseName, bucketName,
// queueName, indexName, workerName). Both read "create" in a plan, so the mode is said out loud,
// first and last, and the one that can hurt has to be asked for:
//   FRESH   nothing existing is looked up or changed. `--fresh` forces it, whatever the config says.
//   ADOPT   lists every name it would take over. A first deploy to a stage, and any destroy,
//           asks "are you sure?" and then for the Worker's name; no terminal, or `--adopt-existing`
//           (which answers yes for a script), decides it otherwise.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { workerName, type RustyBunsConfig } from "./config.ts";
import { protectedNames } from "./protect.ts";

export interface IsolationFlags { fresh: boolean; adoptExisting: boolean; ephemeral?: boolean; real?: boolean }

export function isolationFlags(args: string[]): IsolationFlags {
  return {
    fresh: args.includes("--fresh") || args.includes("--ephemeral"),
    adoptExisting: args.includes("--adopt-existing") || args.includes("--real"),
    ephemeral: args.includes("--ephemeral"),
    real: args.includes("--real"),
  };
}

/** Our own flags, which Alchemy would not understand. */
export const ISOLATION_ARGS = ["--fresh", "--adopt-existing", "--ephemeral", "--real"];

/** The config with adoption off, for `--fresh`. */
export function forceFresh(cfg: RustyBunsConfig): RustyBunsConfig {
  const edge = cfg.targets.edge;
  if (!edge?.adopt) return cfg;
  return { ...cfg, targets: { ...cfg.targets, edge: { ...edge, adopt: false } } };
}

/** Every name an adopting deploy would look up on the account, by kind. Empty when adopt is off. */
export function adoptedNames(cfg: Pick<RustyBunsConfig, "name" | "bindings" | "targets">): string[] {
  if (!cfg.targets.edge?.adopt) return [];
  const names = [`Worker ${workerName(cfg)}`];
  for (const b of Object.values(cfg.bindings ?? {})) {
    if (b.type === "d1") names.push(`D1 ${b.databaseName}`);
    else if (b.type === "r2") names.push(`R2 ${b.bucketName}`);
    else if (b.type === "queue") names.push(`Queue ${b.queueName}`);
    else if (b.type === "vectorize") names.push(`Vectorize ${b.indexName}`);
    else if (b.type === "hyperdrive" && b.configName) names.push(`Hyperdrive ${b.configName}`);
  }
  return names;
}

const hasWorkerState = (projectDir: string, app: string, stage: string) =>
  existsSync(join(projectDir, ".alchemy", "state", app, stage, "Worker.json"));

/** What a destroy deletes of the adopted names: all but the `protect`ed ones, which it leaves. */
const destroyed = (cfg: Pick<RustyBunsConfig, "name" | "bindings" | "targets">) => {
  const kept = new Set(protectedNames(cfg));
  return adoptedNames(cfg).filter((n) => !kept.has(n));
};

/** The line to print before and after a plan, deploy or destroy. */
export function modeLine(cfg: RustyBunsConfig, o: { forced?: boolean; offline?: boolean } = {}): string {
  const names = adoptedNames(cfg);
  if (o.offline) return "mode: FRESH (offline): no login, no account read; nothing anywhere is touched.";
  if (!names.length) return `mode: FRESH${o.forced ? " (--fresh)" : ""}: every resource is made new with a name Alchemy picks (<app>-<id>-<stage>-<random>). Nothing that already exists on the account is looked up, changed or deleted.`;
  return `mode: ADOPT: ${names.length} resource${names.length === 1 ? "" : "s"} are taken over by name if they already exist (real ones, not copies): ${names.join(", ")}. Pass --fresh to leave them alone.`;
}

/**
 * What stops a deploy or destroy in ADOPT mode from running unasked. Null when it may go on:
 * FRESH, a plan, `--adopt-existing`, or a deploy to a stage this machine has already deployed.
 */
export function adoptProblem(sub: string, cfg: RustyBunsConfig, projectDir: string, stage: string, flags: IsolationFlags): string | null {
  const names = adoptedNames(cfg);
  if (!names.length || flags.adoptExisting) return null;
  if (sub === "destroy") {
    return `this is ADOPT mode, so a destroy deletes the resources it took over, which may be real ones: ${destroyed(cfg).join(", ")}. ` +
      `Pass --adopt-existing if that is what you want, or --fresh to run against fresh resources only.`;
  }
  if (sub === "deploy" && !hasWorkerState(projectDir, cfg.name, stage)) {
    return `stage ${stage} has never been deployed from here, and this is ADOPT mode: it would take over whatever already has these names: ${names.join(", ")}. ` +
      `Pass --adopt-existing to do that, or --fresh to make new resources instead.`;
  }
  return null;
}

/** The question asked at the terminal when ADOPT mode stops a deploy or destroy. */
export function adoptQuestion(sub: string, cfg: Pick<RustyBunsConfig, "name" | "bindings" | "targets">): string {
  const list = (sub === "destroy" ? destroyed(cfg) : adoptedNames(cfg)).map((n) => `  - ${n}`).join("\n");
  const kept = protectedNames(cfg).map((n) => `  - ${n}`).join("\n");
  return sub === "destroy"
    ? `ADOPT mode: this DELETES these resources, which may be real ones:\n${list}\n${kept ? `and KEEPS these (protect: true):\n${kept}\n` : ""}Are you sure you want to delete them? [y/N] `
    : `ADOPT mode: this takes over, and overwrites, these resources if they already exist (real ones, not copies):\n${list}\nAre you sure you want to overwrite them? [y/N] `;
}

/**
 * Ask twice at the terminal: y or yes, then the Worker's name typed out, so a reflex "y" can't
 * overwrite real resources. Anything else is no. Without a terminal there is no one to ask, so
 * it is no: pass --adopt-existing in a script. `ask` is for tests.
 */
export async function confirmAdopt(question: string, name: string, ask?: (q: string) => Promise<string>): Promise<boolean> {
  if (!ask) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) return false;
    const { createInterface } = await import("node:readline/promises");
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const once = (q: string) => rl.question(q);
    try { return await confirmAdopt(question, name, once); } finally { rl.close(); }
  }
  if (!/^y(es)?$/i.test((await ask(question)).trim())) return false;
  return (await ask(`Really? Type the Worker's name (${name}) to go on: `)).trim() === name;
}
