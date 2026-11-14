// What GET /__rb/helpers answers, as one guard: the office (triage/server.ts) writes `x satisfies HelpersReply`, and
// Ester's card (ester/index.ts) and the wall screens (screens/index.ts) read it through the same guard. No Bun or DOM
// here, so both ends import it.
import { arr, int, maybe, nul, num, obj, oneOf, opt, str, type Of } from "@rustybuns/util/guard";

export const EsterPhase = oneOf(["idle", "running", "green", "red", "error"]);
export type EsterPhase = Of<typeof EsterPhase>;

const IDLE = { phase: "idle", lines: [], hold: [] } as const;

/** One helper's run: what it printed, the PRs it says to hold back, when it ran. Anything that isn't one reads as idle. */
export const EsterState = (v: unknown) => maybe(obj({
  phase: EsterPhase,
  /** The tail of what the check printed. */
  lines: arr(str(10_000, { min: 0 }), 1000, { drop: true }),
  /** The PRs she says to hold back (`Ester says hold: #1, #2`). */
  hold: arr(int(1, 1e9), 500, { drop: true }),
  startedAt: maybe(num(0, Number.MAX_SAFE_INTEGER)),
  endedAt: maybe(num(0, Number.MAX_SAFE_INTEGER)),
  error: opt(str(5000)),
}))(v) ?? { ...IDLE, lines: [], hold: [] };
export type EsterState = Of<typeof EsterState>;

/** Mervin's running tally of conflicts avoided, summed from his tally file. */
export const Tally = obj({ prs: num(0, 1e9, 0), avoided: num(0, 1e9, 0), total: num(0, 1e9), since: num(0, Number.MAX_SAFE_INTEGER, 0) });
export type Tally = Of<typeof Tally>;

export const HelpersReply = obj({
  ester: EsterState,
  mervin: EsterState,
  dexter: EsterState,
  /** null until a tally is kept. */
  tally: maybe(nul(Tally)),
  /** The release rings' lines (scripts/rings.ts). */
  rings: arr(str(500, { min: 0 }), 20, { drop: true }),
});
export type HelpersReply = Of<typeof HelpersReply>;
