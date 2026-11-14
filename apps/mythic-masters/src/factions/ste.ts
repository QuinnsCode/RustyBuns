// The factions speak Simplified Technical English (ASD-STE100): the way a maintenance manual is written, which is
// where the comedy comes from. This is the part of it a script can check: short sentences, no contractions, none of
// the punctuation a manual does without. Voice, tense and "one word, one meaning" are the writer's (docs/FACTIONS.md).

/** Words a sentence may have: STE's limit for a procedure, kept for every line. */
export const MAX_WORDS = 20;
const CONTRACTION = /\b(?:\w+n['’]t|i['’]m|\w+['’](?:re|ll|ve|d)|(?:it|that|there|here|he|she|what|who|let|where|how)['’]s)\b/i;
const LABEL = /^(?:WARNING|CAUTION|NOTE):\s*/;

/** A line cut into its sentences. A label ("WARNING:") is not part of the sentence it opens. */
export function sentences(text: string): string[] {
  return text.split(/(?<=[.?])\s+|\n+/).map((s) => s.trim().replace(LABEL, "")).filter(Boolean);
}
const words = (s: string) => s.split(/\s+/).filter((w) => /[\p{L}\p{N}{]/u.test(w)).length;

/** What is wrong with `text` as a faction's line; empty when it reads like the manual. */
export function lint(text: string): string[] {
  const out: string[] = [];
  for (const s of sentences(text)) if (words(s) > MAX_WORDS) out.push(`${words(s)} words in one sentence (${MAX_WORDS} at most): "${s}"`);
  const c = CONTRACTION.exec(text);
  if (c) out.push(`a contraction: "${c[0]}"`);
  const p = /[;()!…]|\.\.\./.exec(text);
  if (p) out.push(`"${p[0]}" is not in the manual`);
  return out;
}
