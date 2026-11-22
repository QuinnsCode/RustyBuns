// A Standard MIDI File (.mid) read into notes, and laid onto a project's tracks. Formats 0 and 1, running status,
// the first tempo, note-off and note-on at velocity 0 both ending a note. Ticks become beats as they are (ticks / PPQ,
// floats, no quantizing): a tempo change moves the seconds, not the beats. A file is untrusted, so its size, its
// tracks and its notes are bounded, and a broken one says what is wrong. No DOM, no Bun.
import { BEATS_PER_BAR, MAX_BARS, MAX_NOTES, type Note, type Op, type Project } from "./project.ts";

/** The biggest file read: a whole song of notes is well under this. */
export const MAX_MIDI_BYTES = 4 * 1024 * 1024;
/** The most tracks a file may say it has, and the most parts (a track's notes on one channel) kept from it. */
export const MAX_MIDI_TRACKS = 256;
export const MAX_PARTS = 64;

/** One instrument's notes from the file: a track's notes on one channel. */
export interface MidiPart { name: string; channel: number; notes: Note[] }
export interface MidiSong { format: 0 | 1; ppq: number; bpm: number | null; parts: MidiPart[]; beats: number }

export class MidiError extends Error {}
const fail = (why: string): never => { throw new MidiError(why); };

/** The file's notes, or a MidiError saying why it can't be read. */
export function readMidi(bytes: Uint8Array): MidiSong {
  if (bytes.length > MAX_MIDI_BYTES) fail("That MIDI file is too big (over 4 MB)");
  let at = 0;
  const need = (n: number) => { if (at + n > bytes.length) fail("That MIDI file ends too soon"); };
  const u8 = () => { need(1); return bytes[at++]; };
  const u16 = () => { need(2); const v = (bytes[at] << 8) | bytes[at + 1]; at += 2; return v; };
  const u32 = () => { need(4); const v = ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0; at += 4; return v; };
  const tag = () => { need(4); const s = String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]); at += 4; return s; };
  const vlq = () => { let v = 0; for (let i = 0; i < 4; i++) { const b = u8(); v = v * 128 + (b & 0x7f); if (!(b & 0x80)) return v; } return fail("That MIDI file has a broken number in it"); };

  if (tag() !== "MThd") fail("That isn't a MIDI file");
  const hlen = u32();
  if (hlen < 6) fail("That MIDI file's header is broken");
  const format = u16(), ntrks = u16(), division = u16();
  at += hlen - 6;
  if (format === 2) fail("That MIDI file holds separate patterns (format 2), which can't be read here");
  if (format !== 0 && format !== 1) fail("That MIDI file's format isn't one of 0 or 1");
  if (division & 0x8000) fail("That MIDI file counts time in SMPTE frames, which can't be read here");
  const ppq = division;
  if (ppq === 0) fail("That MIDI file's beat has no ticks");
  if (ntrks > MAX_MIDI_TRACKS) fail(`That MIDI file has over ${MAX_MIDI_TRACKS} tracks`);

  let bpm: number | null = null, total = 0, last = 0;
  const parts: MidiPart[] = [];
  for (let ti = 0; ti < ntrks && at < bytes.length; ti++) {
    const id = tag(), len = u32();
    if (len > bytes.length - at) fail("That MIDI file ends too soon");
    const end = at + len;
    if (id !== "MTrk") { at = end; ti--; continue; } // an unknown chunk is skipped, as the format says
    let tick = 0, status = 0, name = "";
    const byCh = new Map<number, Note[]>();
    // the notes sounding, per channel and key, oldest first: an off ends the oldest
    const open = new Map<number, { s: number; v: number }[]>();
    const close = (ch: number, key: number, endTick: number) => {
      const q = open.get(ch * 128 + key);
      const on = q?.shift();
      if (!on) return;
      const notes = byCh.get(ch) ?? [];
      byCh.set(ch, notes);
      if (total >= MAX_NOTES * 4) fail("That MIDI file has too many notes");
      total++;
      notes.push({ s: on.s / ppq, l: Math.max((endTick - on.s) / ppq, 1 / 64), m: key, v: on.v });
      last = Math.max(last, endTick / ppq);
    };
    while (at < end) {
      tick += vlq();
      let b = bytes[at];
      if (b & 0x80) { at++; if (b < 0xf0) status = b; }
      else if (!status) fail("That MIDI file has data with no message before it");
      else b = status; // running status: the last message's kind, its first data byte already here
      if (b === 0xff) {
        const type = u8(), n = vlq();
        need(n);
        if (type === 0x51 && n === 3 && bpm === null) {
          const us = (bytes[at] << 16) | (bytes[at + 1] << 8) | bytes[at + 2];
          if (us > 0) bpm = 60_000_000 / us;
        } else if (type === 0x03 && !name) name = new TextDecoder().decode(bytes.subarray(at, at + n)).replace(/[\x00-\x1f]/g, "").trim().slice(0, 24);
        at += n;
        if (type === 0x2f) break;
        continue;
      }
      if (b === 0xf0 || b === 0xf7) { const n = vlq(); need(n); at += n; continue; }
      if (b >= 0xf0) fail("That MIDI file has a message it can't have in a track");
      const kind = b & 0xf0, ch = b & 0x0f;
      const d1 = u8() & 0x7f, d2 = kind === 0xc0 || kind === 0xd0 ? 0 : u8() & 0x7f;
      if (kind === 0x90 && d2 > 0) {
        const k = ch * 128 + d1, q = open.get(k) ?? [];
        open.set(k, q);
        q.push({ s: tick, v: d2 / 127 });
      } else if (kind === 0x80 || kind === 0x90) close(ch, d1, tick);
    }
    // notes never let go end where the track does
    for (const [k, q] of open) while (q.length) close(k >> 7, k & 127, Math.max(tick, q[0].s + 1));
    at = end;
    const chans = [...byCh.keys()].sort((a, b) => a - b);
    for (const ch of chans) {
      if (parts.length >= MAX_PARTS) break;
      const label = name || `Track ${ti + 1}`;
      parts.push({ name: chans.length > 1 ? `${label} ch ${ch + 1}`.slice(0, 24) : label, channel: ch, notes: byCh.get(ch)!.sort((a, b) => a.s - b.s || a.m - b.m) });
    }
  }
  if (!parts.length) fail("That MIDI file has no notes in it");
  return { format: format === 0 ? 0 : 1, ppq, bpm: bpm === null ? null : Math.round(bpm * 100) / 100, parts, beats: last };
}

/** How an import lands: which parts, onto which track first (the rest go down from it), from which beat. */
export interface MidiPlan { parts: MidiPart[]; track: number; at: number; grow: boolean; tempo: boolean }
export interface MidiLanding {
  /** The edits, in order: commit them as one undo step. */
  ops: Op[];
  /** The loop length the notes need (bars), whether or not it grew to it. */
  needBars: number;
  /** Notes left out: past the loop (not grown) or past MAX_BARS. */
  cut: number;
  /** Parts with no track left to land on. */
  spare: number;
}

/** The bars a part's notes need from beat `at`, at most MAX_BARS. */
export const barsFor = (parts: MidiPart[], at: number) =>
  Math.min(MAX_BARS, Math.max(1, Math.ceil((at + Math.max(0, ...parts.flatMap((p) => p.notes.map((n) => n.s + n.l)))) / BEATS_PER_BAR - 1e-9)));

/**
 * The edits that lay `plan.parts` on the project: each part onto its track, replacing the notes the part spans and
 * keeping the rest; the loop grown to fit when `grow` (never shrunk); the file's tempo when `tempo`.
 */
export function landMidi(p: Project, plan: MidiPlan, bpm: number | null): MidiLanding {
  const ops: Op[] = [];
  const room = Math.max(0, p.tracks.length - plan.track);
  const parts = plan.parts.slice(0, room), spare = plan.parts.length - parts.length;
  const needBars = barsFor(parts, plan.at);
  const bars = plan.grow ? Math.max(p.bars, needBars) : p.bars;
  const global: Extract<Op, { t: "global" }> = { t: "global" };
  if (bars !== p.bars) global.bars = bars;
  if (plan.tempo && bpm !== null) global.bpm = Math.min(240, Math.max(40, Math.round(bpm)));
  if (global.bars !== undefined || global.bpm !== undefined) ops.push(global);
  const L = bars * BEATS_PER_BAR;
  let cut = 0;
  parts.forEach((part, i) => {
    const track = plan.track + i, was = p.tracks[track]?.notes ?? [];
    const moved = part.notes.map((n) => ({ ...n, s: n.s + plan.at }));
    const kept = moved.filter((n) => n.s < L).map((n) => ({ ...n, l: Math.min(n.l, L - n.s) }));
    cut += moved.length - kept.length;
    const from = plan.at, to = Math.max(from, ...kept.map((n) => n.s + n.l));
    const others = was.filter((n) => n.s < from || n.s >= to);
    const notes = [...others, ...kept].slice(0, MAX_NOTES);
    cut += others.length + kept.length - notes.length;
    ops.push({ t: "notes", track, notes });
  });
  return { ops, needBars, cut, spare };
}
