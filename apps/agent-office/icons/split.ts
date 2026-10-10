// Text cut into runs of plain text and the emoji that have an icon. Pure, so it's tested without a DOM.
import { EMOJI } from "./emoji.ts";

// raw keeps the U+FE0F, since the glyph it measures as is the room the icon gets
export type Run = string | { emoji: string; raw: string };

// longest first, so 🧑‍💻 wins over 🧑; each one with or without its U+FE0F
const keys = Object.keys(EMOJI).sort((a, b) => b.length - a.length);
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const SOURCE = keys.map(k => [...k].map(c => escape(c) + "\\uFE0F?").join("")).join("|");
// two of them: a global regex's test() leaves lastIndex behind, and V8's matchAll starts from it
const ANY = new RegExp(SOURCE, "u");
const ALL = new RegExp(SOURCE, "gu");

export function hasEmoji(text: string): boolean {
  return ANY.test(text);
}

export function split(text: string): Run[] {
  const runs: Run[] = [];
  let at = 0;
  for (const m of text.matchAll(ALL)) {
    if (m.index > at) runs.push(text.slice(at, m.index));
    runs.push({ emoji: m[0].replaceAll("\uFE0F", ""), raw: m[0] });
    at = m.index + m[0].length;
  }
  if (at < text.length) runs.push(text.slice(at));
  return runs;
}
