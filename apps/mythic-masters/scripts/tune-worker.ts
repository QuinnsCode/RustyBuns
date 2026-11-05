// One of scripts/tune.ts's Bun workers: it takes a batch of pairings (ROSTER indices) with the edges of the round,
// plays them on the TS sim, and posts back each pairing's rate. Pairings are independent, so the tuner fans them out.
import { arr, int, num, obj } from "@rustybuns/util/guard";
import { ROSTER } from "../src/roster.ts";
import { rate } from "./tune.ts";

declare const self: Worker;

const Batch = obj({ edges: arr(num(0, 100), 1000), pairs: arr(arr(int(0, 999), 2, { min: 2 }), 100_000), n: int(1, 100_000) });

self.onmessage = (e: MessageEvent) => {
  const { edges, pairs, n } = Batch(e.data);
  edges.forEach((edge, i) => { if (ROSTER[i]) ROSTER[i].edge = edge; });
  self.postMessage(pairs.map(([i, j]) => rate(ROSTER[i!]!, ROSTER[j!]!, n)));
};
