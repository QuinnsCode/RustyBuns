// Layout: the road every change takes (branch, coordinate, Mervin, Ester's test lanes, yours) and the three places an AI hooks in
/**
 * The pipeline: the road every change takes, an agent's or a person's, from a branch to your code. The
 * stops are deterministic: they do the logistics (where a branch lives, whose edit lands first, what merges,
 * which tests run), so nobody spends tokens or minutes on them. The AI goes on the real work, and it is
 * welcome at three hook points on the way, where a yay or a nay is a judgement call:
 *
 *   branch       Artifacts         a git repo per branch, made in milliseconds
 *   coordinate   Durable Objects   each file's lines live in one place, so edits land in order and nobody's copy drifts
 *   mervin       Mervin            merges by line id; real clashes become waves or a card
 *     hook  after-mervin           an AI or a person looks at the merged change before it goes on
 *     hook  before-ester           the last word before the tests spend anything
 *   ester        Ester             queues the lanes this change calls for; a PR with red CI waits
 *     hook  after-ester            green: does anyone still want a say?
 *   yours        you               your code from here: ship it, deploy it, release it
 *
 * A hook is `off` (carry on), `ai` (an AI reads it and says yay or nay; a nay stops it, with the reason) or `ask`
 * (a person says yay or nay). A test lane has a cadence: `always` (every change that touches it), `often` (every
 * Nth change, and at a release), `release` (only at a release: the iOS app two days before the preview) or `bus`
 * (no tests per change: the changes ride along until it's full or a release is cut, then one big pass, an AI's
 * when the lane has no command) or `train` (with the fresh_main check setting, main moving reruns the open
 * branches as one car per merge-plan wave, main with the whole wave in, rather than one run per branch: train.ts).
 *
 * A repo writes its hooks and lanes in `codesplitter.pipeline.json` at the top of main (PIPELINE_FILE); plan()
 * says what one change does, and tally() carries the lanes' counts to the next one (kept per repo in D1, and
 * the checks queue goes by the same calls: pipeline-lanes.ts). It is pure, so the API
 * (GET .../pipeline, POST /api/pipeline), the MCP tool, the CLI and the /concepts page all give the same answer.
 */

import { arr, int, obj, oneOf, opt, str, type Of } from "@rustybuns/util/guard";
import { glob } from "./util.ts";

export const PIPELINE_FILE = "codesplitter.pipeline.json";

export const STOPS = ["branch", "coordinate", "mervin", "ester", "yours"] as const;
export type Stop = (typeof STOPS)[number];
export const HOOKS = ["after-mervin", "before-ester", "after-ester"] as const;
export type Hook = (typeof HOOKS)[number];
export const HOOK_MODES = ["off", "ai", "ask"] as const;
export type HookMode = (typeof HOOK_MODES)[number];
export const CADENCES = ["always", "often", "release", "bus", "train"] as const;
export type Cadence = (typeof CADENCES)[number];

/** Who runs each stop and what it does, in road order. */
export const STOP_INFO: Record<Stop, { who: string; does: string }> = {
  branch: { who: "Artifacts", does: "a git repo per branch, made in milliseconds, for an agent or a person" },
  coordinate: { who: "Durable Objects", does: "each file's lines in one place: edits land in order, nobody waits on anyone's copy" },
  mervin: { who: "Mervin", does: "merges by line id; real clashes go into waves or come back as a card" },
  ester: { who: "Ester", does: "queues the checks of the lanes this change calls for; a PR with red CI waits" },
  yours: { who: "you", does: "your code from here: ship, deploy, release" },
};
/** The stop each hook comes after. */
export const HOOK_AFTER: Record<Hook, Stop> = { "after-mervin": "mervin", "before-ester": "mervin", "after-ester": "ester" };

const Lane = obj({
  name: str(60, { re: /^[\w.-]+$/ }),
  cadence: oneOf(CADENCES),
  /** `.gitattributes`-style patterns (at most two `**` each: the regex they compile to stays near-linear); a lane without them covers every file. */
  paths: opt(arr(str(200, { re: /^(?:[^*]|\*(?!\*))*(?:\*\*(?:[^*]|\*(?!\*))*){0,2}$/ }), 50)),
  /** The command it runs. A bus lane without one departs into an AI pass. */
  run: opt(str(500)),
  /** often: run on every this-many changes that touch it (default 5). */
  every: opt(int(1, 1000)),
  /** bus: leave once this many changes are aboard (default 10). */
  seats: opt(int(1, 1000)),
});
export type Lane = Of<typeof Lane>;
const Hooks = obj({ "after-mervin": opt(oneOf(HOOK_MODES)), "before-ester": opt(oneOf(HOOK_MODES)), "after-ester": opt(oneOf(HOOK_MODES)) });
/** A repo's `codesplitter.pipeline.json`: throws `Bad`, naming the field, when it isn't one. */
export const Pipeline = obj({ hooks: opt(Hooks), lanes: opt(arr(Lane, 50)) });
export type Pipeline = Of<typeof Pipeline>;

/** A repo with no pipeline file: no hooks, one lane that tests every change. */
export const DEFAULT_PIPELINE: Pipeline = { lanes: [{ name: "tests", cadence: "always" }] };

/** The one each cadence is, shown on /concepts and in the docs. */
export const EXAMPLE_PIPELINE: Pipeline = {
  hooks: { "after-mervin": "off", "before-ester": "ai", "after-ester": "ask" },
  lanes: [
    { name: "unit", cadence: "always", paths: ["src/**", "test/**"] },
    { name: "stress", cadence: "often", every: 5, paths: ["src/**"] },
    { name: "ios", cadence: "release", paths: ["ios/**"] },
    { name: "docs", cadence: "bus", seats: 10, paths: ["**/*.md"] },
  ],
};

/** One change on the road: the files it touches, whether it cuts a release, and each lane's count since it last ran. */
export interface Change { files: string[]; release?: boolean; counts?: Record<string, number> }

/** What a lane does with this change: run its tests, skip them (with why), take a seat on the bus, or send the bus off. */
export interface LaneCall { lane: string; cadence: Cadence; go: "run" | "skip" | "board" | "depart"; why: string; run?: string; ai?: true; owed?: true }

export type Step =
  | { kind: "stop"; at: Stop; who: string; does: string; lanes?: LaneCall[] }
  | { kind: "hook"; at: Hook; mode: "ai" | "ask"; does: string };

const touches = (lane: Lane, files: string[]) => {
  if (!lane.paths?.length) return files.length ? files[0]! : "";
  const res = lane.paths.map(glob);
  return files.find((f) => res.some((re) => re.test(f))) ?? null;
};

/** What `lane` does with `change`. */
export function laneCall(lane: Lane, change: Change): LaneCall {
  const base = { lane: lane.name, cadence: lane.cadence, ...(lane.run && { run: lane.run }) };
  const hit = touches(lane, change.files), n = (change.counts?.[lane.name] ?? 0) + 1;
  const on = hit ? `touches ${hit}` : "";
  switch (lane.cadence) {
    case "always":
      return hit !== null ? { ...base, go: "run", why: on || "covers every change" } : { ...base, go: "skip", why: "touches none of its paths" };
    case "release":
      return change.release ? { ...base, go: "run", why: "a release is being cut" } : { ...base, go: "skip", why: "runs at a release only" };
    case "often": {
      const every = lane.every ?? 5;
      if (change.release) return { ...base, go: "run", why: "a release is being cut" };
      if (hit === null) return { ...base, go: "skip", why: "touches none of its paths" };
      return n >= every ? { ...base, go: "run", why: `change ${n} of every ${every}` } : { ...base, go: "skip", owed: true, why: `change ${n} of every ${every}: owed, not run` };
    }
    case "train":
      return hit !== null ? { ...base, go: "run", why: `${on || "covers every change"}: in its wave's merge-train car, one run for the wave` } : { ...base, go: "skip", why: "touches none of its paths" };
    case "bus": {
      const seats = lane.seats ?? 10, pass = lane.run ? {} : { ai: true as const };
      if (change.release) return { ...base, ...pass, go: "depart", why: "a release is being cut: one pass over everything aboard" };
      if (hit === null) return { ...base, go: "skip", why: "touches none of its paths" };
      return n >= seats ? { ...base, ...pass, go: "depart", why: `full (${seats} aboard): one pass over them all` } : { ...base, go: "board", why: `seat ${n} of ${seats}` };
    }
  }
}

const HOOK_DOES: Record<"ai" | "ask", string> = { ai: "an AI says yay or nay; a nay stops it, with the reason", ask: "a person says yay or nay" };

/** The road `change` takes under `p`, in order: every stop, the hooks that are on, and Ester's call on each lane. */
export function plan(p: Pipeline, change: Change): Step[] {
  const stop = (at: Stop, lanes?: LaneCall[]): Step => ({ kind: "stop", at, ...STOP_INFO[at], ...(lanes && { lanes }) });
  const steps: Step[] = [];
  for (const at of STOPS) {
    steps.push(stop(at, at === "ester" ? (p.lanes ?? DEFAULT_PIPELINE.lanes!).map((l) => laneCall(l, change)) : undefined));
    for (const h of HOOKS) {
      const mode = p.hooks?.[h] ?? "off";
      if (HOOK_AFTER[h] === at && mode !== "off") steps.push({ kind: "hook", at: h, mode, does: HOOK_DOES[mode] });
    }
  }
  return steps;
}

/** Each lane's count for the next change: a lane that ran (or a bus that left) starts again at 0, one that owed a run or took a seat counts this change. */
export function tally(counts: Record<string, number>, calls: LaneCall[]): Record<string, number> {
  const out = { ...counts };
  for (const c of calls) {
    if (c.go === "run" || c.go === "depart") out[c.lane] = 0;
    else if (c.go === "board" || c.owed) out[c.lane] = (out[c.lane] ?? 0) + 1;
  }
  return out;
}
