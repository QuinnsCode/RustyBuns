// One of scripts/tune.ts's Bun workers: it takes a batch of pairings (ROSTER indices) with the edges of the round,
// plays them on the TS sim, and posts back each pairing's rate. Pairings are independent, so the tuner fans them out.
// A batch of team fights (`teams`, the 2v1 table) plays each with the lone side grown by `grow` (tune.ts Grow).
import { arr, int, num, obj, opt } from "@rustybuns/util/guard";
import { ROSTER } from "../src/roster.ts";
import { rate, rateTeams, teamSides } from "./tune.ts";

declare const self: Worker;

const Side = arr(int(0, 999), 4, { min: 1 });
const Batch = obj({ edges: arr(num(0, 100), 1000), pairs: arr(arr(int(0, 999), 2, { min: 2 }), 100_000), n: int(1, 100_000), teams: opt(arr(arr(Side, 2, { min: 2 }), 100_000)), grow: opt(obj({ up: int(0, 90), hp: num(0.1, 20), edge: num(0.1, 20) })) });

self.onmessage = (e: MessageEvent) => {
  const { edges, pairs, n, teams, grow } = Batch(e.data);
  edges.forEach((edge, i) => { if (ROSTER[i]) ROSTER[i].edge = edge; });
  if (teams) { self.postMessage(teams.map((t) => rateTeams(...teamSides([t[0]!, t[1]!], grow ?? { up: 0, hp: 1, edge: 1 }), n))); return; }
  self.postMessage(pairs.map(([i, j]) => rate(ROSTER[i!]!, ROSTER[j!]!, n)));
};
