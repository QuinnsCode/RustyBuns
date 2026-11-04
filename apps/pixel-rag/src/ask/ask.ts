// Asking in words, end to end: the question's words find tiles in the local index, Clef says
// which of them shows the answer (or that none does), and Clairic pulls the answer out of the
// winner. Every paid call takes one from today's budget first; the caller supplies the model
// runner (Workers AI's env.AI.run in a Worker), the pixels and the budget, so tests run it with
// fakes and nothing here knows where it runs.
import { pulled, pullRequest, rankRequests, ranked, readRequest, readWords, winner, type ClairicInput, type ClefInput, type Ranked, type Shot } from "./models.ts";
import type { WordIndex } from "./words.ts";

export interface AskDeps {
  /** One Workers AI call. */
  run(input: ClefInput | ClairicInput): Promise<unknown>;
  /** Whether today's budget has room for one more paid call (and takes it). */
  take(): Promise<boolean>;
  /** A tile's pixels as a data URL. */
  image(row: number): Promise<string>;
}

export interface Asked {
  /** The tiles the words found, with Clef's probability each (empty when it never ran). */
  ranked: Ranked[];
  /** The tile Clef picked, if any was more likely yes than no. */
  tile?: number;
  answer?: string | null;
  guess?: string | null;
  confidence?: number;
  /** Why it stopped short: no tile shares a word, none answers, or the budget ran out. */
  stop?: "no words match" | "no tile answers" | "daily budget spent";
}

/** Reads each tile's words once into `index`, a Clairic call a tile; stops when the budget does. */
export async function readTiles(rows: number[], index: WordIndex, deps: AskDeps): Promise<{ read: number; kept: number; stop?: "daily budget spent" }> {
  let read = 0, kept = 0;
  for (const row of rows) {
    if (!(await deps.take())) return { read, kept, stop: "daily budget spent" };
    const words = readWords(await deps.run(readRequest(await deps.image(row))));
    read++;
    if (index.add(row, words)) kept++;
  }
  return { read, kept };
}

/** One question, the `k` best word matches ranked by Clef, the winner read by Clairic. */
export async function askInWords(question: string, index: WordIndex, deps: AskDeps, o: { k?: number; floor?: number; model?: ClefInput["model"] } = {}): Promise<Asked> {
  const hits = index.find(question, o.k ?? 10);
  if (!hits.length) return { ranked: [], stop: "no words match" };
  const shots: Shot[] = await Promise.all(hits.map(async (h) => ({ row: h.row, image: await deps.image(h.row) })));
  const replies: unknown[] = [];
  for (const req of rankRequests(question, shots, o.model)) {
    if (!(await deps.take())) return { ranked: [], stop: "daily budget spent" };
    replies.push(await deps.run(req));
  }
  const r = ranked(shots, replies), best = winner(r, o.floor);
  if (!best) return { ranked: r, stop: "no tile answers" };
  if (!(await deps.take())) return { ranked: r, tile: best.row, stop: "daily budget spent" };
  const shot = shots.find((s) => s.row === best.row)!;
  return { ranked: r, tile: best.row, ...pulled(await deps.run(pullRequest(question, shot.image))) };
}
