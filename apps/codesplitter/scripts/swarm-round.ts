// The recorded merge round the swarm week plays at the git wall (src/swarm-round.json, notes/FAKE_SWARM_REPLAY.md step 6):
// the five real conflicted merges of #1097 (merge-replay.ts CASES), run through the app, as a round the Mervin replay (mervin-replay.ts) plays.
//
//   bun scripts/swarm-round.ts [--out src/swarm-round.json]
//
// Each replayed merge is one stage; each file is a tier: git conflicted and Mervin settled it ("mervin": the fix's own
// text, or the same lines in another order), settled to other text ("differ"), or left as a card for a person.
import { CASES, replay, type Outcome, type Replay } from "./merge-replay.ts";
import type { Round, Tier } from "../src/mervin-replay.ts";

const TIER: Record<Outcome, Tier> = { exact: "agree", reordered: "agree", differs: "differ", cards: "card", blob: "card", deleted: "agree", missing: "card" };

/** A round from replayed merges (each with its PR number), in the order given, three to a wave. */
export function roundOf(replays: (Replay & { pr: number })[]): Round {
  const prs = replays.map((r) => ({ ...r, n: r.pr })), titles = new Map(prs.map((r) => [r.n, `merge main into the branch (${r.commit})`]));
  return {
    board: {
      stages: prs.map((r) => ({
        pr: r.n,
        title: titles.get(r.n),
        files: r.files.map((f) => ({ path: f.path, tier: f.gitConflict && TIER[f.outcome] === "agree" ? "mervin" : TIER[f.outcome], why: f.gitConflict ? "git conflicts here" : "" })),
      })),
    },
    verdicts: prs.map((r, i) => ({ pr: r.n, title: titles.get(r.n), go: true, wave: 1 + Math.floor(i / 3), why: i < 3 ? "first wave" : `after #${prs[Math.floor(i / 3) * 3 - 1]!.n}` })),
  };
}

if (import.meta.main) {
  const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
  const out: (Replay & { pr: number })[] = [];
  for (const c of CASES) out.push({ ...(await replay(c.commit, c.pr)), pr: c.pr });
  const dest = arg("--out") ?? `${import.meta.dir}/../src/swarm-round.json`;
  await Bun.write(dest, JSON.stringify(roundOf(out)));
  console.log(`${dest}: ${out.length} merges`);
}
