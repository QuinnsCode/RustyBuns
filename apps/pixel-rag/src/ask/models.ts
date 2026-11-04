// The two paid calls, as Workers AI inputs and checked replies. Clef (@cf/cloudflare/clef) looks
// at up to four tiles a call and says, per tile, how likely it shows the answer: a probability,
// so "none of them" is a real outcome. Clairic (@cf/cloudflare/clairic) reads a tile: once at
// index time for its words, and once a question for the answer itself. Both bill input tokens
// only; price.ts has the sums.
import { check, nul, num, obj, oneOf, opt, raw, rec, str } from "@rustybuns/util/guard";

/** A tile picked out for a model: its row in the index and its pixels as a PNG/JPEG/WebP data URL. */
export interface Shot { row: number; image: string }

/** Both models take at most four images a call. */
export const MAX_IMAGES = 4;

export interface ClefInput { model: "clef" | "clef-flash"; state: string; images: string[]; questions: Record<string, { type: "noul"; instructions: string }> }
export interface ClairicInput { model: "clairic"; state: string; images: string[]; fields: Record<string, { type: "text"; instructions: string }> }

/** One Clef call per four tiles, a yes-or-no question per tile. */
export function rankRequests(question: string, shots: Shot[], model: ClefInput["model"] = "clef"): ClefInput[] {
  const out: ClefInput[] = [];
  for (let i = 0; i < shots.length; i += MAX_IMAGES) {
    const group = shots.slice(i, i + MAX_IMAGES);
    out.push({
      model,
      state: `Each image is one tile cut from a screenshot of a web page or an app. Someone asked: "${question}"`,
      images: group.map((s) => s.image),
      questions: Object.fromEntries(group.map((s, j) => [`t${s.row}`, { type: "noul" as const, instructions: `Does image ${j + 1} show what answers the question?` }])),
    });
  }
  return out;
}

const Noul = obj({ type: oneOf(["noul"]), noul: num(0, 1) });
const ClefReply = obj({ answers: rec(raw) });

export interface Ranked { row: number; p: number }

/**
 * The tiles by Clef's probability, best first. A reply that isn't Clef's shape throws; a tile
 * whose answer is missing or malformed counts as a no (p = 0) rather than sinking the rest.
 */
export function ranked(shots: Shot[], replies: unknown[]): Ranked[] {
  const answers: Record<string, unknown> = {};
  for (const r of replies) Object.assign(answers, ClefReply(r).answers);
  return shots.map((s) => ({ row: s.row, p: check(Noul, answers[`t${s.row}`])?.noul ?? 0 })).sort((a, b) => b.p - a.p || a.row - b.row);
}

/** The best tile if Clef thinks it more likely yes than no, else none. */
export const winner = (r: Ranked[], floor = 0.5): Ranked | undefined => (r[0] && r[0].p >= floor ? r[0] : undefined);

/** Clairic reading every word on one tile, for the index. */
export const readRequest = (image: string): ClairicInput => ({
  model: "clairic",
  state: "",
  images: [image],
  fields: { words: { type: "text", instructions: "Every word you can read in the image, in reading order" } },
});

/** Clairic pulling the answer to `question` out of the winning tile. */
export const pullRequest = (question: string, image: string): ClairicInput => ({
  model: "clairic",
  state: "",
  images: [image],
  fields: { answer: { type: "text", instructions: question } },
});

const Text = obj({ value: nul(raw), guess: opt(raw), confidence: opt(num(0, 1)), p_null: opt(num(0, 1)) });
const ClairicReply = obj({ answers: rec(Text), state_text: opt(str(Infinity, { min: 0 })), truncated: opt(raw) });

const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

/** The words Clairic read; its own transcript of the image when the field came back empty. */
export function readWords(reply: unknown): string {
  const r = ClairicReply(reply);
  return text(r.answers.words?.value) ?? text(r.state_text) ?? "";
}

export interface Pulled { answer: string | null; guess: string | null; confidence: number }

/** The answer, or null when the tile doesn't settle it (then `guess` is Clairic's best try, if any). */
export function pulled(reply: unknown): Pulled {
  const a = ClairicReply(reply).answers.answer;
  return { answer: text(a?.value), guess: text(a?.guess), confidence: a?.confidence ?? 0 };
}
