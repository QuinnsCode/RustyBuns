// Which kind of environment a plan, deploy or destroy is aimed at, said before anything else:
//   EPHEMERAL  made new (names Alchemy picks), touches nothing already on the account, and
//              `destroy --stage <it>` removes all of it. Previews, trials, agents' stages.
//   REAL       may hold customer data: it takes over existing resources (adopt), keeps some
//              (protect: true), or is a stage named like production. Destroying it is asked about.
// codeSplitter's Ship panel uses the same two words, and its Environment switch is `--real` / `--ephemeral`.

import type { RustyBunsConfig } from "./config.ts";
import { destroyedNames, protectedNames, protectReport } from "./protect.ts";

export type Environment = "ephemeral" | "real";

/** Stage names that mean "the live one", whatever the config says. */
export const REAL_STAGE = /^(prod|production|live|main|master)$/i;

type Cfg = Pick<RustyBunsConfig, "bindings" | "targets">;

/** Why this environment is REAL. Empty means EPHEMERAL. */
export function realReasons(cfg: Cfg, stage: string): string[] {
  const why: string[] = [];
  if (REAL_STAGE.test(stage)) why.push(`stage "${stage}" is named like production`);
  if (cfg.targets.edge?.adopt) why.push("ADOPT mode takes over resources that already exist, by name");
  const kept = protectedNames(cfg).length;
  if (kept) why.push(`${kept} protected resource${kept === 1 ? "" : "s"} (protect: true)`);
  return why;
}

export const environmentOf = (cfg: Cfg, stage: string): Environment => (realReasons(cfg, stage).length ? "real" : "ephemeral");

/** The block that opens every plan, deploy and destroy: the environment, why, and what is kept or removed. */
export function environmentBanner(cfg: Cfg, stage: string, sub: string): string {
  const why = realReasons(cfg, stage);
  const head = why.length
    ? `environment: REAL (stage ${stage}): this can hold customer data.\n${why.map((w) => `  because ${w}`).join("\n")}\n  ${sub === "destroy" ? "destroy" : "deploy"} only with a plan you have read; the report below says what survives a destroy.`
    : `environment: EPHEMERAL (stage ${stage}): everything is made new with names Alchemy picks, nothing already on the account is looked up or changed, and \`rustybuns destroy --stage ${stage}\` removes it all.`;
  const report = protectReport(cfg, sub);
  return report ? `${head}\n${report}` : head;
}

/** `--ephemeral` is a promise: refused when the environment is REAL, so a typo'd stage can't reach production. */
export function ephemeralProblem(cfg: Cfg, stage: string): string | null {
  const why = realReasons(cfg, stage);
  return why.length ? `--ephemeral was passed, but this environment is REAL: ${why.join("; ")}. Pick another --stage, or drop --ephemeral.` : null;
}

/**
 * A destroy of a stage named like production that would delete data (and isn't already asked about by ADOPT mode):
 * refused unless `--real` / `--adopt-existing`, or confirmed at the terminal.
 */
export function realDestroyProblem(sub: string, cfg: Cfg, stage: string, adoptExisting: boolean): string | null {
  if (sub !== "destroy" || adoptExisting || cfg.targets.edge?.adopt || !REAL_STAGE.test(stage)) return null;
  const gone = destroyedNames(cfg);
  if (!gone.length) return null;
  return `stage ${stage} is a REAL environment and this destroy deletes, with their data: ${gone.join(", ")}. Pass --real if that is what you want, or set protect: true on them and deploy once.`;
}

export function realDestroyQuestion(cfg: Cfg): string {
  const list = destroyedNames(cfg).map((n) => `  - ${n}`).join("\n");
  const kept = protectedNames(cfg).map((n) => `  - ${n}`).join("\n");
  return `REAL environment: this DELETES these, with their data:\n${list}\n${kept ? `and KEEPS these (protect: true):\n${kept}\n` : ""}Are you sure you want to delete them? [y/N] `;
}
