// A track's tempo, first beat and hot cues, from what the DJ's own software already wrote, so a deck only listens for the beat
// (analyze.ts detectGrid) when nothing did. Pure: bytes in, a checked `Tempo` out; no DOM, no audio.
//
// In the file itself (`readTempo`):
// - plain tags: ID3v2 TBPM (TBP in v2.2), MP4 `tmpo`, Vorbis/Opus/FLAC comments BPM or TEMPO, and the ID3 chunk
//   of an AIFF or WAV file;
// - the vinyl-emulation program's analysis: ID3 GEOB frames described "Serato Autotags" (the BPM as text) and
//   "Serato BeatGrid" (beat markers, the first one the first beat); in FLAC and Ogg comments SERATO_AUTOTAGS and
//   SERATO_BEATGRID, in MP4 a `----` atom of mean com.serato.dj, base64 either way; its hot cues the CUE entries of
//   "Serato Markers2" (SERATO_MARKERS_V2, markersv2), itself base64 text inside;
// - the four-deck program's ID3 PRIV frame of owner TRAKTOR4: nested chunks (a reversed four-letter id, a length and
//   a child count, little-endian), its BPM a float in the leaf HBPM. Its grid marker lives in a cue list that is
//   only partly decoded in public, so that grid comes from the collection file instead (#5773). MP3 grid positions are taken
//   as written: whether they need the ~26 ms encoder delay taken off is open until a real tagged file is checked.
// From a collection file the DJ drops (`readCollection`), tempos for tracks by file name:
// - the four-deck program's XML collection: ENTRY > LOCATION FILE, TEMPO BPM, CUE_V2 TYPE="4" START (ms) the grid,
//   CUE_V2 TYPE="0" HOTCUE n the hot cues;
// - the club-player maker's XML export: TRACK Location (a file:// URL) with TEMPO Inizio (s) and Bpm, POSITION_MARK
//   Num n Start (s) the hot cues (Num -1 is the memory cue);
// - the same program's per-track analysis file (PMAI, big-endian): PPTH the track's path in UTF-16BE, PQTZ the beat
//   grid (8-byte entries: beat in bar u16, BPM x100 u16, time ms u32), PCOB / PCO2 the cue lists (hot cue 1 is A).
// Only the deck's four hot cues are kept: the programs' hot cues 0 to 3 (A to D).
import { arr, check, nul, num, obj, oneOf, opt, type Of } from "@rustybuns/util/guard";
import type { Grid } from "./analyze.ts";

/** The deck's hot cues. */
const HOTS = 4;
/** Where a tempo came from: a plain tag, or the beat grid DJ software worked out. */
export const Tempo = obj({ bpm: num(30, 300), firstBeat: opt(num(0, 6 * 3600)), source: oneOf(["tag", "grid"]), hot: opt(arr(nul(num(0, 6 * 3600)), HOTS)) });
export type Tempo = Of<typeof Tempo>;
/** What a deck says its tempo came from; "ear" is our own beat finder. */
export type TempoFrom = Tempo["source"] | "ear";
export const FROM_LABEL: Record<TempoFrom, string> = { tag: "tag", grid: "software grid", ear: "found by ear" };

const tempo = (bpm: number, source: Tempo["source"], firstBeat?: number, hot?: Hot): Tempo | null =>
  check(Tempo, { bpm: Math.round(bpm * 100) / 100, firstBeat: firstBeat === undefined ? undefined : Math.max(0, firstBeat), source, hot });
type Hot = (number | null)[] | undefined;
/** Cues as [slot, seconds] into the deck's four, undefined when none lands; a slot's first cue wins. */
function hotList(cues: [number, number][]): Hot {
  const out: (number | null)[] = Array(HOTS).fill(null);
  for (const [i, t] of cues) if (Number.isInteger(i) && i >= 0 && i < HOTS && Number.isFinite(t) && t >= 0 && out[i] === null) out[i] = t;
  return out.some((t) => t !== null) ? out : undefined;
}
const bpmText = (s: string) => { const m = /\d+(?:[.,]\d+)?/.exec(s); return m ? Number(m[0].replace(",", ".")) : NaN; };

/** The best tempo the file carries: a software grid over a plain tag; null when it carries none. */
export function readTempo(bytes: Uint8Array): Tempo | null {
  const found = scan(bytes), t = best(found.grid, found.tag);
  return t && found.hot ? { ...t, hot: found.hot } : t;
}
/** A software grid over a plain one; a grid with a first beat over one without. */
function best(...ts: (Tempo | null | undefined)[]): Tempo | null {
  const ok = ts.filter((t): t is Tempo => !!t);
  return ok.find((t) => t.source === "grid" && t.firstBeat !== undefined) ?? ok.find((t) => t.source === "grid") ?? ok[0] ?? null;
}

/** The file's own tempo against one from a collection the DJ dropped: the file's software grid, else the collection's, else the tag. */
export function pick(file: Tempo | null, known: Tempo | null | undefined): Tempo | null {
  const t = best(file?.source === "grid" ? file : null, known, file), hot = t?.hot ?? file?.hot ?? known?.hot;
  return t && hot ? { ...t, hot } : t;
}

/** A deck's grid from a tempo it was told, else from the beat finder (`heard`, run only when needed); and the hot cues it was told. */
export function settle(told: Tempo | null, heard: () => Grid | null): { grid: Grid | null; from?: TempoFrom; hot?: (number | null)[] } {
  const hot = told?.hot ? { hot: told.hot } : {};
  if (told?.firstBeat !== undefined) return { grid: { bpm: told.bpm, offset: told.firstBeat }, from: told.source, ...hot };
  const h = heard();
  if (told) return { grid: { bpm: told.bpm, offset: h?.offset ?? 0 }, from: told.source, ...hot };
  return h ? { grid: h, from: "ear" } : { grid: null };
}

/** The key a collection files a track under: its file name, lower case, without folders. */
export const fileKey = (path: string) => (path.split(/[\\/:]/).pop() ?? path).trim().toLowerCase();

// ---- the file's own tags

interface Found { tag?: Tempo | null; grid?: Tempo | null; hot?: Hot }
const ascii = (b: Uint8Array, at: number, n: number) => String.fromCharCode(...b.subarray(at, at + n));
const view = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);

function scan(b: Uint8Array): Found {
  if (b.length < 12) return {};
  const head = ascii(b, 0, 4);
  if (ascii(b, 0, 3) === "ID3") return id3(b);
  if (head === "fLaC") return flac(b);
  if (head === "OggS") return ogg(b);
  if (head === "FORM") return chunks(b, 12, false);
  if (head === "RIFF") return chunks(b, 12, true);
  if (ascii(b, 4, 4) === "ftyp") return mp4(b);
  return {};
}

/** AIFF (big-endian sizes) or WAV (little-endian): the ID3 chunk, read as a tag. */
function chunks(b: Uint8Array, at: number, little: boolean): Found {
  const v = view(b);
  while (at + 8 <= b.length) {
    const id = ascii(b, at, 4), size = v.getUint32(at + 4, little);
    if (id === "ID3 " || id === "id3 ") return id3(b.subarray(at + 8, at + 8 + size));
    at += 8 + size + (size & 1);
  }
  return {};
}

const synchsafe = (b: Uint8Array, at: number) => ((b[at]! & 0x7f) << 21) | ((b[at + 1]! & 0x7f) << 14) | ((b[at + 2]! & 0x7f) << 7) | (b[at + 3]! & 0x7f);
/** Undo ID3 unsynchronisation: every FF 00 back to FF. */
function unsync(b: Uint8Array): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < b.length; i++) { out.push(b[i]!); if (b[i] === 0xff && b[i + 1] === 0) i++; }
  return Uint8Array.from(out);
}

/** Text in one of ID3's four encodings, up to its terminator; and where the bytes after it start. */
function id3Text(b: Uint8Array, at: number, enc: number): [string, number] {
  const wide = enc === 1 || enc === 2;
  let end = at;
  if (wide) { while (end + 1 < b.length && (b[end] !== 0 || b[end + 1] !== 0)) end += 2; }
  else while (end < b.length && b[end] !== 0) end++;
  const raw = b.subarray(at, end);
  let s: string;
  if (enc === 3) s = new TextDecoder("utf-8").decode(raw);
  else if (enc === 2) s = new TextDecoder("utf-16be").decode(raw);
  else if (enc === 1) s = raw[0] === 0xfe && raw[1] === 0xff ? new TextDecoder("utf-16be").decode(raw.subarray(2)) : new TextDecoder("utf-16le").decode(raw[0] === 0xff ? raw.subarray(2) : raw);
  else s = String.fromCharCode(...raw);
  return [s, Math.min(b.length, end + (wide ? 2 : 1))];
}

function id3(b: Uint8Array): Found {
  if (b.length < 10 || ascii(b, 0, 3) !== "ID3") return {};
  const ver = b[3]!, flags = b[5]!;
  let body = b.subarray(10, Math.min(b.length, 10 + synchsafe(b, 6)));
  if (ver < 4 && flags & 0x80) body = unsync(body);
  let at = 0;
  if (flags & 0x40) at = ver === 4 ? synchsafe(body, 0) : 4 + view(body).getUint32(0);
  const found: Found = {};
  let auto: number | undefined, grid: { bpm?: number; first?: number } | null = null;
  const idLen = ver === 2 ? 3 : 4, headLen = ver === 2 ? 6 : 10;
  while (at + headLen <= body.length) {
    const id = ascii(body, at, idLen);
    if (!/^[A-Z0-9]+$/.test(id)) break;
    const size = ver === 2 ? (body[at + 3]! << 16) | (body[at + 4]! << 8) | body[at + 5]! : ver === 4 ? synchsafe(body, at + 4) : view(body).getUint32(at + 4);
    let f = body.subarray(at + headLen, at + headLen + size);
    if (ver === 4 && body[at + 9]! & 0x02) f = unsync(f);
    at += headLen + size;
    if (id === "TBPM" || id === "TBP") found.tag = tempo(bpmText(id3Text(f, 1, f[0]!)[0]), "tag") ?? found.tag;
    else if (id === "GEOB") {
      const enc = f[0]!;
      let [, p] = id3Text(f, 1, 0); // MIME type
      [, p] = id3Text(f, p, enc); // file name
      const [desc, q] = id3Text(f, p, enc);
      if (desc === "Serato Autotags") auto = autotags(f.subarray(q)) ?? auto;
      else if (desc === "Serato BeatGrid") grid = beatgrid(f.subarray(q)) ?? grid;
      else if (desc === "Serato Markers2") found.hot = markers2(f.subarray(q)) ?? found.hot;
    } else if (id === "PRIV") {
      const [owner, p] = id3Text(f, 0, 0);
      if (owner === "TRAKTOR4") found.grid = tempo(nestedBpm(f.subarray(p)) ?? NaN, "grid") ?? found.grid;
    }
  }
  const gridBpm = auto ?? grid?.bpm;
  if (gridBpm !== undefined) found.grid = tempo(gridBpm, "grid", grid?.first) ?? found.grid;
  return found;
}

/** "Serato Autotags": version 01 01, then the BPM, auto gain and gain as NUL-ended text. */
function autotags(p: Uint8Array): number | undefined {
  if (p[0] !== 1 || p[1] !== 1) return undefined;
  const n = bpmText(id3Text(p, 2, 0)[0]);
  return Number.isFinite(n) ? n : undefined;
}
/**
 * "Serato BeatGrid": version 01 00, a u32 count of markers (big-endian), then 8 bytes each: a float32 position in
 * seconds and, for every marker but the last, a u32 count of beats to the next; the last holds a float32 BPM.
 */
function beatgrid(p: Uint8Array): { bpm?: number; first?: number } | null {
  if (p.length < 14 || p[0] !== 1 || p[1] !== 0) return null;
  const v = view(p), n = v.getUint32(2);
  if (n < 1 || 6 + n * 8 > p.length) return null;
  const first = v.getFloat32(6), at = 6 + (n - 1) * 8;
  let bpm = v.getFloat32(at + 4);
  if (n > 1) { const beats = v.getUint32(10), next = v.getFloat32(14); if (next > first && beats > 0) bpm = (beats * 60) / (next - first); }
  return { bpm, first };
}

/**
 * "Serato Markers2": version 01 01, then base64 text (in lines, NUL-ended) of version 01 01 and entries: a NUL-ended
 * type, a u32 length (big-endian), the data. A CUE's data: 00, its index, its position in ms (u32), then colour and name.
 */
function markers2(p: Uint8Array): Hot {
  if (p.length < 3 || p[0] !== 1 || p[1] !== 1) return undefined;
  let end = 2;
  while (end < p.length && p[end] !== 0) end++;
  let t = ascii(p, 2, end - 2).replace(/[^A-Za-z0-9+/]/g, "");
  if (t.length % 4 === 1) t = t.slice(0, -1);
  let b: Uint8Array;
  try { b = Uint8Array.from(atob(t + "=".repeat((4 - (t.length % 4)) % 4)), (c) => c.charCodeAt(0)); } catch { return undefined; }
  if (b[0] !== 1 || b[1] !== 1) return undefined;
  const v = view(b), cues: [number, number][] = [];
  for (let at = 2; at < b.length && b[at] !== 0;) {
    let z = at;
    while (z < b.length && b[z] !== 0) z++;
    if (z + 5 > b.length) break;
    const type = ascii(b, at, z - at), len = v.getUint32(z + 1), data = z + 5;
    if (data + len > b.length) break;
    if (type === "CUE" && len >= 6) cues.push([b[data + 1]!, v.getUint32(data + 2) / 1000]);
    at = data + len;
  }
  return hotList(cues);
}

/** The four-deck program's PRIV payload: chunks of id (4), length (u32 LE), children (u32 LE); BPM is the float in leaf HBPM. */
function nestedBpm(p: Uint8Array, depth = 0): number | undefined {
  const v = view(p);
  for (let at = 0; at + 12 <= p.length && depth < 8;) {
    const id = ascii(p, at, 4), len = v.getUint32(at + 4, true), kids = v.getUint32(at + 8, true);
    const body = p.subarray(at + 12, at + 12 + len);
    if (kids > 0) { const got = nestedBpm(body, depth + 1); if (got !== undefined) return got; }
    else if ((id === "HBPM" || id === "MPBH") && body.length >= 4) return view(body).getFloat32(0, true);
    at += 12 + len;
  }
  return undefined;
}

/** Comments as KEY=value (Vorbis, Opus, FLAC): u32 LE vendor length and vendor, a u32 LE count, then each entry. */
function comments(b: Uint8Array, at: number): Found {
  const v = view(b), found: Found = {};
  if (at + 4 > b.length) return found;
  at += 4 + v.getUint32(at, true);
  if (at + 4 > b.length) return found;
  const n = v.getUint32(at, true);
  at += 4;
  let auto: number | undefined, grid: { bpm?: number; first?: number } | null = null;
  for (let i = 0; i < n && at + 4 <= b.length; i++) {
    const len = v.getUint32(at, true), s = new TextDecoder().decode(b.subarray(at + 4, at + 4 + len));
    at += 4 + len;
    const eq = s.indexOf("=");
    if (eq < 0) continue;
    const k = s.slice(0, eq).toUpperCase(), val = s.slice(eq + 1);
    if (k === "BPM" || k === "TEMPO" || k === "TBPM") found.tag = tempo(bpmText(val), "tag") ?? found.tag;
    else if (k === "SERATO_AUTOTAGS") { const p = fromBase64(val, "Serato Autotags"); if (p) auto = autotags(p) ?? auto; }
    else if (k === "SERATO_BEATGRID") { const p = fromBase64(val, "Serato BeatGrid"); if (p) grid = beatgrid(p) ?? grid; }
    else if (k === "SERATO_MARKERS_V2") { const p = fromBase64(val, "Serato Markers2"); if (p) found.hot = markers2(p) ?? found.hot; }
  }
  const gridBpm = auto ?? grid?.bpm;
  if (gridBpm !== undefined) found.grid = tempo(gridBpm, "grid", grid?.first);
  return found;
}

/** A base64 copy of a GEOB payload: "application/octet-stream", NUL, NUL, the description, NUL, then the payload. */
function fromBase64(s: string, desc: string): Uint8Array | null {
  let t = s.replace(/[^A-Za-z0-9+/]/g, "");
  if (t.length % 4 === 1) t = t.slice(0, -1);
  let b: Uint8Array;
  try { b = Uint8Array.from(atob(t), (c) => c.charCodeAt(0)); } catch { return null; }
  const mark = new TextEncoder().encode(desc + "\0");
  for (let i = 0; i + mark.length <= b.length && i < 64; i++) if (mark.every((m, j) => b[i + j] === m)) return b.subarray(i + mark.length);
  return b;
}

/** FLAC: metadata blocks after "fLaC" (a last-block bit and type, then a 24-bit length); type 4 is the comments. */
function flac(b: Uint8Array): Found {
  for (let at = 4; at + 4 <= b.length;) {
    const type = b[at]! & 0x7f, last = b[at]! & 0x80, len = (b[at + 1]! << 16) | (b[at + 2]! << 8) | b[at + 3]!;
    if (type === 4) return comments(b.subarray(at + 4, at + 4 + len), 0);
    if (last) break;
    at += 4 + len;
  }
  return {};
}

/** Ogg: the page bodies of the first pages joined into one stream, and the comment packet found in it. */
function ogg(b: Uint8Array): Found {
  const parts: Uint8Array[] = [];
  let total = 0;
  for (let at = 0; at + 27 <= b.length && total < 1 << 20 && ascii(b, at, 4) === "OggS";) {
    const segs = b[at + 26]!, table = b.subarray(at + 27, at + 27 + segs), size = table.reduce((a, c) => a + c, 0);
    parts.push(b.subarray(at + 27 + segs, at + 27 + segs + size));
    total += size;
    at += 27 + segs + size;
  }
  const s = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { s.set(p, o); o += p.length; }
  for (const [mark, skip] of [["\x03vorbis", 7], ["OpusTags", 8]] as const) {
    const m = new TextEncoder().encode(mark);
    for (let i = 0; i + m.length <= s.length; i++) if (m.every((c, j) => s[i + j] === c)) return comments(s, i + skip);
  }
  return {};
}

/** MP4: moov > udta > meta > ilst; `tmpo` holds a u16 BPM, a `----` atom of mean com.serato.dj the base64 grid. */
function mp4(b: Uint8Array): Found {
  const found: Found = {};
  let auto: number | undefined, grid = null as { bpm?: number; first?: number } | null;
  const walk = (from: number, to: number, path: string) => {
    const v = view(b);
    for (let at = from; at + 8 <= to;) {
      let size = v.getUint32(at), head = 8;
      const type = ascii(b, at + 4, 4);
      if (size === 1) { size = Number(v.getBigUint64(at + 8)); head = 16; } else if (size === 0) size = to - at;
      if (size < head || at + size > to) break;
      const here = `${path}/${type}`, body = b.subarray(at + head, at + size);
      if (here === "/moov" || here === "/moov/udta" || here === "/moov/udta/meta/ilst") walk(at + head, at + size, here);
      else if (here === "/moov/udta/meta") walk(at + head + 4, at + size, here);
      else if (here === "/moov/udta/meta/ilst/tmpo") { const d = atoms(body).get("data"); if (d && d.length >= 10) found.tag = tempo(view(d).getUint16(8), "tag") ?? found.tag; }
      else if (here === "/moov/udta/meta/ilst/----") {
        const a = atoms(body), mean = a.get("mean"), name = a.get("name"), data = a.get("data");
        if (mean && name && data && ascii(mean, 4, mean.length - 4) === "com.serato.dj") {
          const n = ascii(name, 4, name.length - 4), text = new TextDecoder().decode(data.subarray(8));
          if (n === "autotags") { const p = fromBase64(text, "Serato Autotags"); if (p) auto = autotags(p) ?? auto; }
          if (n === "beatgrid") { const p = fromBase64(text, "Serato BeatGrid"); if (p) grid = beatgrid(p) ?? grid; }
          if (n === "markersv2") { const p = fromBase64(text, "Serato Markers2"); if (p) found.hot = markers2(p) ?? found.hot; }
        } else if (name && data && /^(BPM|TEMPO)$/i.test(ascii(name, 4, name.length - 4))) found.tag = tempo(bpmText(new TextDecoder().decode(data.subarray(8))), "tag") ?? found.tag;
      }
      at += size;
    }
  };
  walk(0, b.length, "");
  const gridBpm = auto ?? grid?.bpm;
  if (gridBpm !== undefined) found.grid = tempo(gridBpm, "grid", grid?.first);
  return found;
}
/** An atom's children by type (the first of each). */
function atoms(b: Uint8Array): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>(), v = view(b);
  for (let at = 0; at + 8 <= b.length;) {
    const size = v.getUint32(at);
    if (size < 8 || at + size > b.length) break;
    const type = ascii(b, at + 4, 4);
    if (!out.has(type)) out.set(type, b.subarray(at + 8, at + size));
    at += size;
  }
  return out;
}

// ---- collection files

/** Tempos by `fileKey` from a collection file the DJ dropped (either XML collection, or an analysis file). Empty when it is none of those. */
export function readCollection(bytes: Uint8Array): Map<string, Tempo> {
  const out = new Map<string, Tempo>();
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "PMAI") { const one = analysis(bytes); if (one) out.set(one[0], one[1]); return out; }
  const xml = new TextDecoder().decode(bytes);
  for (const m of xml.matchAll(/<ENTRY\b[^>]*>([\s\S]*?)<\/ENTRY>/g)) {
    const body = m[1]!, loc = attrs(/<LOCATION\b([^>]*)>/.exec(body)?.[1] ?? ""), t = attrs(/<TEMPO\b([^>]*)>/.exec(body)?.[1] ?? "");
    const file = loc.get("FILE"), bpm = Number(t.get("BPM"));
    if (!file) continue;
    let first: number | undefined;
    const cues: [number, number][] = [];
    for (const c of body.matchAll(/<CUE_V2\b([^>]*)>/g)) {
      const a = attrs(c[1]!), type = a.get("TYPE"), at = Number(a.get("START")) / 1000;
      if (type === "4" && first === undefined) first = at;
      else if (type === "0" && a.has("HOTCUE")) cues.push([Number(a.get("HOTCUE")), at]);
    }
    const got = tempo(bpm, "grid", Number.isFinite(first) ? first : undefined, hotList(cues));
    if (got) out.set(fileKey(file), got);
  }
  for (const m of xml.matchAll(/<TRACK\b([^>]*?)(?:\/>|>([\s\S]*?)<\/TRACK>)/g)) {
    const a = attrs(m[1]!), loc = a.get("Location");
    if (!loc) continue;
    const t = attrs(/<TEMPO\b([^>]*)>/.exec(m[2] ?? "")?.[1] ?? "");
    const bpm = Number(t.get("Bpm") ?? a.get("AverageBpm")), first = t.has("Inizio") ? Number(t.get("Inizio")) : undefined;
    let path = loc;
    try { path = decodeURIComponent(loc); } catch { /* keep it as written */ }
    const cues = [...(m[2] ?? "").matchAll(/<POSITION_MARK\b([^>]*)>/g)].map((c): [number, number] => { const p = attrs(c[1]!); return [p.get("Type") === "0" ? Number(p.get("Num")) : -1, Number(p.get("Start"))]; });
    const got = tempo(bpm, "grid", Number.isFinite(first) ? first : undefined, hotList(cues));
    if (got) out.set(fileKey(path), got);
  }
  return out;
}

const ENTITY = new Map([["amp", "&"], ["lt", "<"], ["gt", ">"], ["quot", '"'], ["apos", "'"]]);
/** XML attributes, entities decoded. */
function attrs(s: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of s.matchAll(/([\w:]+)="([^"]*)"/g)) out.set(m[1]!, m[2]!.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) =>
    e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : (ENTITY.get(e.toLowerCase()) ?? "")));
  return out;
}

/** An analysis file (PMAI header, then sections of fourcc, header length, section length, all big-endian): its track and grid. */
function analysis(b: Uint8Array): [string, Tempo] | null {
  const v = view(b);
  let path: string | null = null, got: Tempo | null = null;
  const cues: [number, number][] = [];
  for (let at = v.getUint32(4); at + 12 <= b.length;) {
    const id = ascii(b, at, 4), len = v.getUint32(at + 8);
    if (len < 12 || at + len > b.length) break;
    if (id === "PPTH" && at + 16 <= b.length) {
      const n = v.getUint32(at + 12);
      path = new TextDecoder("utf-16be").decode(b.subarray(at + 16, Math.min(at + 16 + n, at + len))).replace(/\0+$/, "");
    } else if (id === "PQTZ" && at + 32 <= b.length) {
      const beats = v.getUint32(at + 20);
      if (beats > 0) got = tempo(v.getUint16(at + 26) / 100, "grid", v.getUint32(at + 28) / 1000);
    } else if ((id === "PCOB" || id === "PCO2") && at + 20 <= b.length && v.getUint32(at + 12) === 1) {
      // a hot cue list (type 1; 0 is the memory cues): PCPT entries (hot cue u32 at 12, status at 16, ms at 32) or PCP2 (ms at 20)
      const n = v.getUint16(at + (id === "PCOB" ? 18 : 16)), entry = id === "PCOB" ? "PCPT" : "PCP2", ms = id === "PCOB" ? 32 : 20;
      for (let e = at + v.getUint32(at + 4), i = 0; i < n && e + 12 <= at + len; i++) {
        const elen = v.getUint32(e + 8);
        if (ascii(b, e, 4) !== entry || elen < ms + 4 || e + elen > at + len) break;
        if (id === "PCO2" || v.getUint32(e + 16) !== 0) cues.push([v.getUint32(e + 12) - 1, v.getUint32(e + ms) / 1000]);
        e += elen;
      }
    }
    at += len;
  }
  const hot = hotList(cues);
  return path && got ? [fileKey(path), hot ? { ...got, hot } : got] : null;
}
