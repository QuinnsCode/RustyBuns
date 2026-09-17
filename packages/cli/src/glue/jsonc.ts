// JSONC -> JSON: strips // and /* */ comments and trailing commas, but only
// OUTSIDE strings. A regex can't do this (a URL in a comment, a "/" in a
// string, a "*/" inside quotes all break it). Small state machine instead.
export function stripJsonc(src: string): string {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i]!, d = src[i + 1];
    if (c === '"') {                          // string: copy verbatim, honoring escapes
      let j = i + 1;
      while (j < n && src[j] !== '"') { if (src[j] === "\\") j++; j++; }
      out += src.slice(i, j + 1); i = j + 1; continue;
    }
    if (c === "/" && d === "/") { while (i < n && src[i] !== "\n") i++; continue; }
    if (c === "/" && d === "*") { const e = src.indexOf("*/", i + 2); i = e < 0 ? n : e + 2; continue; }
    out += c; i++;
  }
  return out.replace(/,(\s*[}\]])/g, "$1");
}

export function parseJsonc<T = any>(src: string): T {
  return JSON.parse(stripJsonc(src)) as T;
}
