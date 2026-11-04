// Translations for a `content/` folder. The source language's files sit in `content/*.json`; a translation is
// `content/<lang>/<same name>.json` with the same shape (`content/es/landing.json`). Nothing in a translation can
// change the shape: `localize` walks the source and only takes a translated string or list where the source has
// one, so a line nobody has translated yet (missing, or left blank) reads in the source language. Numbers always
// come from the source. Imports nothing, so a build script or a page can use it.

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

function overlay(source: unknown, tr: unknown, keepBlank: boolean): unknown {
  if (typeof source === "string") return typeof tr === "string" && (keepBlank || tr.trim() !== "") ? tr : keepBlank ? "" : source;
  if (isStrings(source)) return isStrings(tr) && (keepBlank || tr.length > 0) ? tr : keepBlank ? [] : source;
  if (Array.isArray(source)) return source.map((v, i) => overlay(v, Array.isArray(tr) ? tr[i] : undefined, keepBlank));
  if (isRecord(source)) return Object.fromEntries(Object.entries(source).map(([k, v]) => [k, overlay(v, isRecord(tr) ? tr[k] : undefined, keepBlank)]));
  return source;
}

/** The source with every translated line swapped in; a missing or blank one stays in the source language. */
export const localize = <T>(source: T, translation: unknown): T => overlay(source, translation, false) as T;

/** A translation file as the editor keeps it: the source's shape, with "" (or []) where nothing is translated yet. */
export const translationOf = (source: unknown, translation: unknown): unknown => overlay(source, translation, true);

/** How many of the source's lines (strings and lists) a translation fills, for the editor's "12 of 40". */
export function progressOf(source: unknown, translation: unknown): { done: number; total: number } {
  const t = { done: 0, total: 0 };
  const walk = (s: unknown, tr: unknown) => {
    if (typeof s === "string" || isStrings(s)) {
      t.total++;
      if (typeof tr === "string" ? tr.trim() !== "" : isStrings(tr) && tr.length > 0) t.done++;
    } else if (Array.isArray(s)) s.forEach((v, i) => walk(v, Array.isArray(tr) ? tr[i] : undefined));
    else if (isRecord(s)) for (const [k, v] of Object.entries(s)) walk(v, isRecord(tr) ? tr[k] : undefined);
  };
  walk(source, translation);
  return t;
}

/** A folder name that is a language tag (`es`, `pt-BR`, `zh-Hant`), so `content/<lang>/` can't be `../` or a stray dir. */
export const isLocale = (s: string): boolean => /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(s);

/** The first language the reader wants that we have, by exact tag and then by its base (`es-MX` reads `es`).
 *  Self-contained, so a build can write it into a page with `pickLocale.toString()`. */
export function pickLocale(wanted: readonly (string | null | undefined)[], have: readonly string[], fallback: string): string {
  const lower = have.map((h) => h.toLowerCase());
  for (const w of wanted) {
    if (!w) continue;
    const i = lower.indexOf(w.toLowerCase());
    if (i >= 0) return have[i]!;
    const j = lower.indexOf(w.toLowerCase().split("-")[0]!);
    if (j >= 0) return have[j]!;
  }
  return fallback;
}

/** Writes `next` into `into` where both have the same shape, so whoever already holds `into` (or a list inside it) reads `next`. */
function graft(into: Record<string, unknown> | unknown[], next: unknown): void {
  if (Array.isArray(into)) {
    if (!Array.isArray(next)) return;
    if (isStrings(into)) { if (isStrings(next)) into.splice(0, into.length, ...next); return; }
    into.forEach((v, i) => { if (isRecord(v) || Array.isArray(v)) graft(v, next[i]); });
    return;
  }
  if (!isRecord(next)) return;
  for (const [k, v] of Object.entries(into)) {
    if (typeof v === "string") { if (typeof next[k] === "string") into[k] = next[k]; }
    else if (isRecord(v) || Array.isArray(v)) graft(v, next[k]);
  }
}

/** A game whose sim imports its `content/*.json` straight in: pick the reader's language once, at boot, and write that
 *  language's lines into the very objects the sim imported, so a module holding them (or a list out of them) reads the
 *  translation. `files` are the translations by path, ending `<lang>/<name>.json` (Vite's `import.meta.glob`), and
 *  `sources` the originals by name. Run it before the sim reads a line (the entry's first import), never per tick, so a
 *  replay stays a replay. Returns the language it picked. */
export function localizeContent(sources: Record<string, object>, files: Record<string, unknown>, wanted: readonly (string | null | undefined)[], fallback = "en"): string {
  const byLang: Record<string, Record<string, unknown>> = {};
  for (const [path, file] of Object.entries(files)) {
    const m = /([^/\\]+)[/\\]([^/\\]+)\.json$/.exec(path);
    if (m && isLocale(m[1]!)) (byLang[m[1]!] ??= {})[m[2]!] = file;
  }
  const lang = pickLocale(wanted, [fallback, ...Object.keys(byLang)], fallback);
  for (const [name, source] of Object.entries(sources)) {
    const tr = byLang[lang]?.[name];
    if (tr !== undefined && (isRecord(source) || Array.isArray(source))) graft(source, localize(source, tr));
  }
  return lang;
}
