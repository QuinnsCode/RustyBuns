// A deck reads a track's tempo from what the DJ's software wrote (src/dj/tags.ts): each file kind is built here byte
// by byte, as small as its format allows, and read back (hot cues too); then the collection files a DJ drops on the library.
import { expect, test } from "bun:test";
import { pick, readCollection, readTempo, settle, type Tempo } from "../src/dj/tags.ts";

const te = new TextEncoder();
const cat = (...parts: (Uint8Array | number[] | string)[]) => {
  const bs = parts.map((p) => (typeof p === "string" ? Uint8Array.from(p, (c) => c.charCodeAt(0)) : Uint8Array.from(p)));
  const out = new Uint8Array(bs.reduce((a, b) => a + b.length, 0));
  let o = 0;
  for (const b of bs) { out.set(b, o); o += b.length; }
  return out;
};
const u32be = (n: number) => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u32le = (n: number) => u32be(n).reverse();
const u16be = (n: number) => [n >>> 8, n & 255];
const f32 = (x: number, little = false) => { const b = new Uint8Array(4); new DataView(b.buffer).setFloat32(0, x, little); return b; };
const safe = (n: number) => [(n >> 21) & 127, (n >> 14) & 127, (n >> 7) & 127, n & 127];

/** An ID3v2.3 or 2.4 tag of these frames. */
function id3(ver: 3 | 4, frames: [string, Uint8Array][]) {
  const body = cat(...frames.flatMap(([id, f]) => [id, ver === 4 ? safe(f.length) : u32be(f.length), [0, 0], f]));
  return cat("ID3", [ver, 0, 0], safe(body.length), body);
}
const text = (s: string) => cat([0], s);
const geob = (desc: string, payload: Uint8Array) => cat([0], "application/octet-stream\0", "\0", desc + "\0", payload);
const autotags = (bpm: string) => cat([1, 1], `${bpm}\0`, "-3.257\0", "0.000\0");
/** Two markers: the first beat, 64 beats on to the second, and the tempo held after it. */
const beatgrid = (first: number, bpm: number) => cat([1, 0], u32be(2), f32(first), u32be(64), f32(first + (64 * 60) / bpm), f32(bpm), [0]);
/** "Serato Markers2": a colour entry, then hot cues as [index, ms], base64 in lines without padding, the way it writes them. */
const markers2 = (...cues: [number, number][]) => {
  const entry = (type: string, data: Uint8Array) => cat(type + "\0", u32be(data.length), data);
  const inner = cat([1, 1], entry("COLOR", cat([0, 255, 255, 255])), ...cues.map(([i, ms]) => entry("CUE", cat([0, i], u32be(ms), [0, 204, 0, 0, 0, 0], "drop\0"))), [0]);
  const text = btoa(String.fromCharCode(...inner)).replace(/=+$/, "").replace(/.{72}/g, "$&\n");
  return cat([1, 1], text, [0]);
};
const b64 = (desc: string, payload: Uint8Array) => btoa(String.fromCharCode(...cat("application/octet-stream\0\0", desc + "\0", payload)));
const chunk = (id: string, kids: Uint8Array[] | Uint8Array) => {
  const body = Array.isArray(kids) ? cat(...kids) : kids;
  return cat(id, u32le(body.length), u32le(Array.isArray(kids) ? kids.length : 0), body);
};
const atom = (type: string, ...body: (Uint8Array | number[] | string)[]) => { const b = cat(...body); return cat(u32be(b.length + 8), type, b); };
const mp4 = (...items: Uint8Array[]) => cat(atom("ftyp", "M4A ", [0, 0, 0, 0]), atom("moov", atom("udta", atom("meta", [0, 0, 0, 0], atom("ilst", ...items)))), atom("mdat", [1, 2, 3]));
const vorbis = (...kv: string[]) => cat(u32le(1), "x", u32le(kv.length), ...kv.flatMap((s) => [u32le(te.encode(s).length), te.encode(s)]));
const flac = (...kv: string[]) => { const c = vorbis(...kv); return cat("fLaC", [0, 0, 0, 34], new Uint8Array(34), [0x84, c.length >> 16, (c.length >> 8) & 255, c.length & 255], c); };
const page = (body: Uint8Array) => { const segs: number[] = []; let n = body.length; while (n >= 255) { segs.push(255); n -= 255; } segs.push(n); return cat("OggS", [0, 0], new Uint8Array(20), [segs.length], segs, body); };
const ogg = (...kv: string[]) => cat(page(cat([1], "vorbis", new Uint8Array(23))), page(cat([3], "vorbis", vorbis(...kv), [1])));
const wav = (tag: Uint8Array) => { const rest = cat("WAVE", "fmt ", u32le(16), new Uint8Array(16), "data", u32le(2), [0, 0], "id3 ", u32le(tag.length), tag, tag.length & 1 ? [0] : []); return cat("RIFF", u32le(rest.length), rest); };
const aiff = (tag: Uint8Array) => { const rest = cat("AIFF", "COMM", u32be(18), new Uint8Array(18), "ID3 ", u32be(tag.length), tag, tag.length & 1 ? [0] : []); return cat("FORM", u32be(rest.length), rest); };

/** The four-deck program's cue list: [type (0 cue, 4 grid), ms, hot cue (-1 none)] each, names left empty. */
const cuep = (...cues: [number, number, number][]) => {
  const f64 = (x: number) => { const b = new Uint8Array(8); new DataView(b.buffer).setFloat64(0, x, true); return b; };
  return chunk("PEUC", cat(u32le(cues.length), ...cues.map(([type, ms, hot]) => cat(u32le(1), u32le(0), u32le(0), u32le(type), f64(ms), f64(0), u32le(-1 >>> 0), u32le(hot >>> 0)))));
};
const traktor = (bpm: number, ...cues: [number, number, number][]) => ["PRIV", cat("TRAKTOR4\0", chunk("DMRT", [chunk("ATAD", [chunk("MPBH", f32(bpm, true))]), cuep(...cues)]))] as [string, Uint8Array];
/**
 * An MP3's first frame (MPEG 1 Layer III, stereo): bare audio, or an Info frame whose tag is LAME's (its CRC good or
 * zeroed) or FFmpeg's. The CRC is LAME's own: CRC-16/ARC over the frame up to it.
 */
function mp3(hz: 44100 | 48000, info?: "lame" | "zero crc" | "lavc") {
  const head = [0xff, 0xfb, hz === 44100 ? 0x90 : 0x94, 0x44];
  if (!info) return cat(head, new Uint8Array(413));
  const f = cat(head, new Uint8Array(32), "Info", u32be(0), info === "lavc" ? "Lavc62.11" : "LAME3.100", new Uint8Array(27), new Uint8Array(200));
  if (info === "lame") {
    let c = 0;
    for (const b of f.subarray(0, 4 + 32 + 8 + 34)) { c ^= b; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xa001 : c >>> 1; }
    f.set(u16be(c), 4 + 32 + 8 + 34);
  }
  return f;
}
const frame = (hz: number) => 1152 / hz;

const round = (t: Tempo | null): Tempo | null => t && { ...t, firstBeat: t.firstBeat === undefined ? undefined : Math.round(t.firstBeat * 1000) / 1000 };

const files: [string, Uint8Array, Tempo | null][] = [
  ["an mp3's ID3v2.3 TBPM", id3(3, [["TIT2", text("Night Drive")], ["TBPM", text("128")]]), { bpm: 128, source: "tag" }],
  ["ID3v2.4, a decimal tempo", id3(4, [["TBPM", text("93.5")]]), { bpm: 93.5, source: "tag" }],
  ["the vinyl-emulation program's GEOB grid wins over TBPM", id3(4, [["TBPM", text("126")], ["GEOB", geob("Serato Autotags", autotags("125.98"))], ["GEOB", geob("Serato BeatGrid", beatgrid(0.512, 125.98))]]), { bpm: 125.98, firstBeat: 0.512, source: "grid" }],
  ["its hot cues: index 0 to 3 onto the deck's four, 4 to 7 left off", id3(4, [["GEOB", geob("Serato Autotags", autotags("125.98"))], ["GEOB", geob("Serato BeatGrid", beatgrid(0.512, 125.98))], ["GEOB", geob("Serato Markers2", markers2([0, 512], [2, 30_250], [5, 60_000]))]]), { bpm: 125.98, firstBeat: 0.512, source: "grid", hot: [0.512, null, 30.25, null] }],
  ["its hot cues with only a plain tempo", id3(3, [["TBPM", text("120")], ["GEOB", geob("Serato Markers2", markers2([1, 1000]))]]), { bpm: 120, source: "tag", hot: [null, 1, null, null] }],
  ["its auto tags alone: a tempo, no first beat", id3(3, [["GEOB", geob("Serato Autotags", autotags("140.00"))]]), { bpm: 140, source: "grid" }],
  ["the four-deck program's PRIV frame", id3(3, [["PRIV", cat("TRAKTOR4\0", chunk("DMRT", [chunk("ATAD", [chunk("MPBH", f32(124.5, true))])]))]]), { bpm: 124.5, source: "grid" }],
  ["its cue list: the grid marker and hot cues (0 is the first; a loop and a cue with none left off)", id3(3, [traktor(120, [5, 1000, 2], [0, 30_000, 1], [4, 500, -1], [0, 2500, 0], [0, 9000, -1])]), { bpm: 120, firstBeat: 0.5, source: "grid", hot: [2.5, 30, null, null] }],
  // An MP3's positions, onto the timeline the browser decodes: the four-deck program's stay when it reads the info frame...
  ["its grid on an MP3 with a good LAME tag", cat(id3(3, [traktor(120, [4, 500, -1])]), mp3(44100, "lame")), { bpm: 120, firstBeat: 0.5, source: "grid" }],
  ["its grid on a bare MP3", cat(id3(3, [traktor(120, [4, 500, -1])]), mp3(44100)), { bpm: 120, firstBeat: 0.5, source: "grid" }],
  // ...and run a frame late when it plays that frame as sound
  ["its grid on an MP3 whose LAME tag has no CRC", cat(id3(3, [traktor(120, [4, 500, -1], [0, 2500, 0])]), mp3(44100, "zero crc")), { bpm: 120, firstBeat: 0.474, source: "grid", hot: [2.5 - frame(44100), null, null, null] }],
  ["its grid on an MP3 FFmpeg made", cat(id3(4, [traktor(120, [4, 500, -1])]), mp3(48000, "lavc")), { bpm: 120, firstBeat: 0.476, source: "grid" }],
  // the vinyl-emulation program's always do; a cue at the very start stays at the start
  ["the vinyl-emulation program's grid and cues on an MP3", cat(id3(4, [["GEOB", geob("Serato BeatGrid", beatgrid(0.512, 120))], ["GEOB", geob("Serato Markers2", markers2([0, 0], [1, 2512]))]]), mp3(48000, "lame")), { bpm: 120, firstBeat: 0.488, source: "grid", hot: [0, 2.512 - frame(48000), null, null] }],
  ["an m4a's tmpo", mp4(atom("tmpo", atom("data", u32be(21), u32be(0), u16be(140)))), { bpm: 140, source: "tag" }],
  ["an m4a's base64 grid", mp4(atom("----", atom("mean", [0, 0, 0, 0], "com.serato.dj"), atom("name", [0, 0, 0, 0], "beatgrid"), atom("data", u32be(1), u32be(0), b64("Serato BeatGrid", beatgrid(0.2, 122))))), { bpm: 122, firstBeat: 0.2, source: "grid" }],
  ["a FLAC's BPM comment", flac("TITLE=x", "BPM=97"), { bpm: 97, source: "tag" }],
  ["a FLAC's base64 grid and hot cues", flac("bpm=96", `SERATO_BEATGRID=${b64("Serato BeatGrid", beatgrid(1.25, 174))}`, `SERATO_MARKERS_V2=${b64("Serato Markers2", markers2([3, 2500]))}`), { bpm: 174, firstBeat: 1.25, source: "grid", hot: [null, null, null, 2.5] }],
  ["an m4a's base64 hot cues", mp4(atom("tmpo", atom("data", u32be(21), u32be(0), u16be(140))), atom("----", atom("mean", [0, 0, 0, 0], "com.serato.dj"), atom("name", [0, 0, 0, 0], "markersv2"), atom("data", u32be(1), u32be(0), b64("Serato Markers2", markers2([0, 750]))))), { bpm: 140, source: "tag", hot: [0.75, null, null, null] }],
  ["an Ogg Vorbis TEMPO", ogg("TEMPO=110"), { bpm: 110, source: "tag" }],
  ["a WAV's id3 chunk", wav(id3(3, [["TBPM", text("120")]])), { bpm: 120, source: "tag" }],
  ["an AIFF's ID3 chunk", aiff(id3(4, [["TBPM", text("85")]])), { bpm: 85, source: "tag" }],
  ["no tempo in it", id3(3, [["TIT2", text("x")]]), null],
  ["a tempo that isn't one", id3(3, [["TBPM", text("fast")]]), null],
  ["a tempo out of any range", flac("BPM=9999"), null],
  ["a tag cut short", id3(3, [["TBPM", text("128")]]).subarray(0, 16), null],
  ["not a sound file", te.encode("hello, this is not audio at all"), null],
];
test.each(files)("%s", (_, bytes, want) => {
  expect(round(readTempo(bytes))).toEqual(want);
});

/** A per-track analysis file: header, the track's path, the beat grid, and a hot cue list of [hot cue (1 is A), ms]. */
function analysis(path: string, beats: [number, number, number][], hot: [number, number][] = []) {
  const p = Uint8Array.from([...path, "\0"].flatMap((c) => u16be(c.charCodeAt(0)))), ppth = cat("PPTH", u32be(16), u32be(16 + p.length), u32be(p.length), p);
  const pqtz = cat("PQTZ", u32be(24), u32be(24 + beats.length * 8), u32be(0), u32be(0x00800000), u32be(beats.length), ...beats.map(([n, bpm, ms]) => cat(u16be(n), u16be(bpm * 100), u32be(ms))));
  const pcpt = hot.map(([n, ms]) => cat("PCPT", u32be(28), u32be(56), u32be(n), u32be(1), u32be(0x10000), u16be(0xffff), u16be(0xffff), [1, 0, 0, 0], u32be(ms), u32be(0xffffffff), new Uint8Array(16)));
  const pcob = cat("PCOB", u32be(24), u32be(24 + pcpt.length * 56), u32be(1), u16be(0), u16be(pcpt.length), u32be(0xffffffff), ...pcpt);
  const body = cat(ppth, pqtz, pcob);
  return cat("PMAI", u32be(28), u32be(28 + body.length), new Uint8Array(16), body);
}

test("the collection files a DJ drops fill tempos by file name, first beat and all", () => {
  const fourDeck = `<?xml version="1.0" encoding="UTF-8" standalone="no" ?><NML VERSION="19"><COLLECTION ENTRIES="2">
    <ENTRY TITLE="Night Drive"><LOCATION DIR="/:Users/:dj/:Music/:" FILE="Night Drive.mp3" VOLUME="Mac"></LOCATION><TEMPO BPM="122.000061" BPM_QUALITY="100.000000"></TEMPO>
      <CUE_V2 NAME="n.n." TYPE="0" START="9000" LEN="0" HOTCUE="1"></CUE_V2><CUE_V2 NAME="far" TYPE="0" START="1000" LEN="0" HOTCUE="6"></CUE_V2><CUE_V2 NAME="AutoGrid" TYPE="4" START="312.5" LEN="0"></CUE_V2></ENTRY>
    <ENTRY TITLE="Dawn"><LOCATION FILE="Dawn &amp; Dusk.flac"></LOCATION><TEMPO BPM="174"></TEMPO></ENTRY>
    <ENTRY TITLE="no tempo"><LOCATION FILE="x.mp3"></LOCATION></ENTRY></COLLECTION></NML>`;
  const club = `<?xml version="1.0" encoding="UTF-8"?><DJ_PLAYLISTS Version="1.0.0"><COLLECTION Entries="1">
    <TRACK TrackID="1" Name="Sun Up" AverageBpm="128.00" Location="file://localhost/Users/dj/Music/Sun%20Up.mp3"><TEMPO Inizio="0.098" Bpm="128.00" Metro="4/4" Battito="1"/><TEMPO Inizio="60.098" Bpm="127.00" Metro="4/4" Battito="1"/><POSITION_MARK Name="" Type="0" Start="0.098" Num="-1"/><POSITION_MARK Name="drop" Type="0" Start="30.098" Num="0" Red="40" Green="226" Blue="20"/><POSITION_MARK Name="" Type="4" Start="45.000" End="46.875" Num="2"/></TRACK>
    </COLLECTION><PLAYLISTS><NODE Type="0" Name="ROOT"><TRACK Key="1"/></NODE></PLAYLISTS></DJ_PLAYLISTS>`;
  const all = (b: Uint8Array) => Object.fromEntries([...readCollection(b)].map(([k, t]) => [k, round(t)]));
  expect(all(te.encode(fourDeck))).toEqual({ "night drive.mp3": { bpm: 122, firstBeat: 0.313, source: "grid", hot: [null, 9, null, null] }, "dawn & dusk.flac": { bpm: 174, firstBeat: undefined, source: "grid" } });
  expect(all(te.encode(club))).toEqual({ "sun up.mp3": { bpm: 128, firstBeat: 0.098, source: "grid", hot: [30.098, null, null, null] } });
  expect(all(analysis("/Contents/dj/Deep Cut.wav", [[1, 120.5, 250], [2, 120.5, 748]], [[1, 250], [3, 64_000]]))).toEqual({ "deep cut.wav": { bpm: 120.5, firstBeat: 0.25, source: "grid", hot: [0.25, null, 64, null] } });
  expect(all(te.encode("<playlist><item>nothing here</item></playlist>"))).toEqual({});
});

test("a deck takes a software grid, else a dropped collection's, else a tag; and listens only for what it wasn't told", () => {
  const tag: Tempo = { bpm: 128, source: "tag" }, grid: Tempo = { bpm: 127.9, firstBeat: 0.4, source: "grid" }, known: Tempo = { bpm: 127.95, firstBeat: 0.41, source: "grid" };
  expect([pick(tag, known), pick(grid, known), pick(tag, undefined), pick(null, null)]).toEqual([known, grid, tag, null]);
  // hot cues come along with whichever grid wins, else from the other side
  const cued: Tempo = { ...tag, hot: [1, null, null, null] };
  expect(pick(cued, known)).toEqual({ ...known, hot: [1, null, null, null] });
  expect(settle(cued, () => null)).toEqual({ grid: { bpm: 128, offset: 0 }, from: "tag", hot: [1, null, null, null] });
  let heard = 0;
  const ear = () => { heard++; return { bpm: 64, offset: 0.12 }; };
  expect(settle(grid, ear)).toEqual({ grid: { bpm: 127.9, offset: 0.4 }, from: "grid" });
  expect(heard).toBe(0);
  expect(settle(tag, ear)).toEqual({ grid: { bpm: 128, offset: 0.12 }, from: "tag" });
  expect(settle(null, ear)).toEqual({ grid: { bpm: 64, offset: 0.12 }, from: "ear" });
  expect(settle(null, () => null)).toEqual({ grid: null });
});
