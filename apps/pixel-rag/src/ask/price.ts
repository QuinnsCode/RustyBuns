// What asking costs, worked out before anything is deployed. Both models bill input tokens only
// (Workers AI model pages, November 2026): Clef $0.24 and Clairic $0.10 per million. An image's
// tokens follow Clef's published rule, and Clairic is counted the same way.
import { MAX_IMAGES } from "./models.ts";

/** Dollars per million input tokens. */
export const PRICE = { clef: 0.24, clairic: 0.1 } as const;

/** Prompt text around the images: the state line, a question per tile, a field. A generous guess. */
const TEXT = { rankCall: 60, perTile: 20, pull: 60, read: 30 } as const;

/**
 * An image's tokens: scaled to between ~65,000 pixels and ~1 megapixel keeping its shape, each
 * side rounded to a multiple of 32, one token per 32 x 32 cell, plus 3 markers, at most 1,024.
 */
export function imageTokens(w: number, h: number): number {
  const px = w * h, s = px < 65_000 ? Math.sqrt(65_000 / px) : px > 1_048_576 ? Math.sqrt(1_048_576 / px) : 1;
  const side = (v: number) => Math.max(32, Math.round((v * s) / 32) * 32);
  return Math.min(1024, (side(w) / 32) * (side(h) / 32) + 3);
}

const dollars = (tokens: number, perM: number) => (tokens * perM) / 1e6;

export interface Cost { calls: number; tokens: number; dollars: number }

/** One question: Clef over `k` tiles, four a call, then Clairic on the winner. */
export function questionCost(k: number, tile = 160): Cost {
  const img = imageTokens(tile, tile), rankCalls = Math.ceil(k / MAX_IMAGES);
  const rank = rankCalls * TEXT.rankCall + k * (img + TEXT.perTile), pull = img + TEXT.pull;
  return { calls: rankCalls + 1, tokens: rank + pull, dollars: dollars(rank, PRICE.clef) + dollars(pull, PRICE.clairic) };
}

/** Reading the words on `tiles` tiles once, one Clairic call each. */
export function indexCost(tiles: number, tile = 160): Cost {
  const tokens = tiles * (imageTokens(tile, tile) + TEXT.read);
  return { calls: tiles, tokens, dollars: dollars(tokens, PRICE.clairic) };
}
