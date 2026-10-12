// The noodle monsters: a file's type guards (`isRecord(x): x is Record<…>` and
// friends), found when the walls are built, so the game can turn each one into
// a boss made of its own lines. `isRecord` is the big one; any other guard is a
// weaker cousin, sized by its line count.

export interface Noodle { name: string; start: number; end: number; lines: string[]; record: boolean }

const MAX_NOODLE_LINES = 30;

// `function isX(…): x is` or `const isX = (…): x is`, with optional export/async/generics.
const GUARD = /(?:\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)|\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(?:function\b\s*)?)\s*(?:<[^()]*>)?\s*\(([^()]*(?:\([^()]*\)[^()]*)*)\)\s*:\s*(?:asserts\s+)?[A-Za-z_$][\w$]*\s+is\s+/g;

/** Where the guard ends: the close of its `{…}` body, or its one expression. */
function endOf(text: string, from: number): number {
  let depth = 0, i = from, last = "|";
  // Skip the guarded type (which can have its own braces) to the body or the arrow.
  for (; i < text.length; i++) {
    const c = text[i]!;
    if (c === "=" && text[i + 1] === ">") { i++; if (depth === 0) { i++; break; } continue; }
    // A `{` at depth 0 after a finished type is the body; after `|`, `&` or nothing, it's more type.
    if (c === "{" && depth === 0 && !"|&".includes(last)) break;
    if (c === ";" && depth === 0) return i;
    if ("<[({".includes(c)) depth++;
    else if (">])}".includes(c)) depth--;
    if (!/\s/.test(c)) last = c;
  }
  while (/\s/.test(text[i] ?? "")) i++;
  if (text[i] !== "{") {
    // An arrow with one expression: up to the `;` (or the line break) at depth 0.
    for (depth = 0; i < text.length; i++) {
      const c = text[i];
      if ("[({".includes(c)) depth++;
      else if ("])}".includes(c)) { if (--depth < 0) return i; }
      else if (depth === 0 && c === ";") return i;
      // A line break ends it, unless an operator on either side carries it on.
      else if (depth === 0 && c === "\n" && !/(&&|\|\||[?:+\-*/=<>!])\s*$/.test(text.slice(Math.max(0, i - 40), i)) && !/^\s*(&&|\|\||[?:.+\-*/])/.test(text.slice(i + 1, i + 40))) return i;
    }
    return i;
  }
  for (depth = 0; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}" && --depth === 0) return i;
  }
  return i;
}

/** Every type guard in `text`, with its 1-based line range and its lines (tabs as two spaces, clipped to `width`). */
export function noodles(text: string, width = 90): Noodle[] {
  const out: Noodle[] = [];
  const lineAt = (i: number) => text.slice(0, i).split("\n").length;
  for (const m of text.matchAll(GUARD)) {
    const name = m[1] ?? m[2]!;
    const start = lineAt(m.index!), end = lineAt(endOf(text, m.index! + m[0].length));
    const lines = text.split("\n").slice(start - 1, Math.min(end, start - 1 + MAX_NOODLE_LINES)).map((l) => l.replace(/\t/g, "  ").slice(0, width));
    out.push({ name, start, end, lines, record: /^is(Plain)?Record$/i.test(name) });
  }
  return out;
}
