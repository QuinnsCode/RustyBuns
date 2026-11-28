// What Q Builder's page and its bench thread (worker.ts) say to each other.
import type { BuilderPedal, Retest } from "../circuit/builder.ts";
import type { Edit } from "../circuit/edits.ts";
import type { swing } from "../circuit/builder.ts";
import type { Swaps } from "../circuit/circuits.ts";

/** Play the riff through a pedal (its board with `edits` made) with a scope on `node`, or retest its remake. `id` matches the answer to the ask. */
export type BenchAsk =
  | { t: "play"; id: number; pedal: BuilderPedal; drive: number; swaps: Swaps; edits: Edit[]; node: string }
  | { t: "retest"; id: number; pedal: BuilderPedal; drive: number; swaps: Swaps; edits: Edit[] };

/** An ask before it has its `id`. */
export type Unsent = { [K in BenchAsk["t"]]: Omit<Extract<BenchAsk, { t: K }>, "id"> }[BenchAsk["t"]];

export type BenchReply =
  | { t: "play"; id: number; out: Float32Array; at: Float32Array; swing: ReturnType<typeof swing>; misses: number }
  | { t: "retest"; id: number; retest: Retest }
  | { t: "error"; id: number; why: string };
