// Files brought onto a track: a sound file decoded to mono for a take, or a MIDI file's notes (src/midi-file.ts).
// `useImports` lands them, from the add menu or a drop on a track row. A picked or dropped file is untrusted: its
// size is bounded before it is read, and only a take's worth is kept.
import { useEffect, useRef, useState } from "react";
import { MAX_TAKE_SECONDS, MAX_TAKES, TAKE_RATE, soundIds } from "../take.ts";
import { barsFor, landMidi, MAX_MIDI_BYTES, readMidi, type MidiPlan, type MidiSong } from "../midi-file.ts";
import { BEATS_PER_BAR, loopBeats, type Op, type Project } from "../project.ts";

/** The biggest sound file read: a few minutes of wav, far more as mp3; only MAX_TAKE_SECONDS of it is kept. */
export const MAX_AUDIO_BYTES = 64 * 1024 * 1024;
export const AUDIO_ACCEPT = "audio/*,.wav,.mp3,.m4a,.aac,.ogg,.oga,.opus,.flac,.aif,.aiff,.webm";
export const MIDI_ACCEPT = ".mid,.midi,.smf,audio/midi,audio/x-midi";

/** What a file is by its name and type: MIDI, sound, or neither. */
export function fileKind(f: { name: string; type: string }): "midi" | "audio" | null {
  if (/\.(mid|midi|smf)$/i.test(f.name) || /midi/i.test(f.type)) return "midi";
  if (f.type.startsWith("audio/") || f.type === "video/webm" || /\.(wav|mp3|m4a|aac|ogg|oga|opus|flac|aiff?|webm|caf)$/i.test(f.name)) return "audio";
  return null;
}

export interface Decoded { pcm: Float32Array; rate: number; seconds: number; cut: boolean }

/** A sound file as one channel (its channels mixed), cut to the longest take. Throws a plain-words Error. */
export async function decodeAudio(file: File): Promise<Decoded> {
  if (file.size > MAX_AUDIO_BYTES) throw new Error(`${file.name} is too big to import (over ${MAX_AUDIO_BYTES >> 20} MB)`);
  const data = await file.arrayBuffer();
  // decoded straight at the take's rate: no audio needs to be on, and nothing more than a take is kept
  const ctx = new OfflineAudioContext(1, 1, TAKE_RATE);
  let buf: AudioBuffer;
  try { buf = await ctx.decodeAudioData(data); } catch { throw new Error(`${file.name} isn't a sound this browser can read (try wav, mp3, m4a, ogg or flac)`); }
  const frames = Math.min(buf.length, Math.floor(MAX_TAKE_SECONDS * buf.sampleRate));
  const pcm = new Float32Array(frames);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const x = buf.getChannelData(c);
    for (let i = 0; i < frames; i++) pcm[i] += x[i] / buf.numberOfChannels;
  }
  return { pcm, rate: buf.sampleRate, seconds: buf.duration, cut: buf.length > frames };
}

/** A MIDI file's notes. Throws a plain-words Error. */
export async function decodeMidi(file: File): Promise<MidiSong> {
  if (file.size > MAX_MIDI_BYTES) throw new Error(`${file.name} is too big for a MIDI file (over ${MAX_MIDI_BYTES >> 20} MB)`);
  return readMidi(new Uint8Array(await file.arrayBuffer()));
}

/** The one file a drop carries that can be imported, or null. */
export function droppedFile(e: { dataTransfer: DataTransfer | null }): File | null {
  const files = [...(e.dataTransfer?.files ?? [])];
  return files.find((f) => fileKind(f) !== null) ?? null;
}

/** What the desk lends the imports: the groove now, whether this page may edit it, and how an edit and a take go in. */
export interface ImportDesk {
  project(): Project;
  mayEdit(): boolean;
  commit(op: Op, opts: { group: string }): void;
  landTake(track: number, beat: number, pcm: Float32Array, rate: number): void;
  select(track: number): void;
}

/**
 * Importing onto a track: a sound file as its take, a MIDI file's notes (asking first when there is a choice), and a
 * file dropped on a track row. `note` is what the bar says about the last one (and Record audio's pass, via `say`).
 */
export function useImports(desk: ImportDesk) {
  const [note, say] = useState<string | null>(null);
  const [ask, setAsk] = useState<{ song: MidiSong; file: string; track: number; at: number } | null>(null);
  const [dropOn, setDropOn] = useState<number | null>(null);
  const d = useRef(desk);
  d.current = desk;
  const barOf = (beat: number) => Math.floor(beat / BEATS_PER_BAR) + 1;

  /** A MIDI file's parts onto the tracks, as one undo step. */
  function land(plan: MidiPlan, bpm: number | null, file: string) {
    const p = d.current.project(), got = landMidi(p, plan, bpm), group = `import:${performance.now()}`;
    for (const op of got.ops) d.current.commit(op, { group });
    setAsk(null);
    const onto = got.ops.flatMap((o) => (o.t === "notes" ? [p.tracks[o.track].name] : []));
    const notes = plan.parts.slice(0, onto.length).reduce((n, x) => n + x.notes.length, 0) - got.cut;
    say(`${file}: ${notes} notes onto ${onto.join(", ")}${got.cut ? `; ${got.cut} past the loop left out` : ""}${got.spare ? `; ${got.spare} more parts had no track below` : ""}.`);
  }

  /** `file` onto `track` from beat `from` (the view's start; beat 0 when that is past the loop). */
  async function importFile(kind: "audio" | "midi", file: File, track: number, from: number) {
    say(null);
    setAsk(null);
    if (!d.current.mayEdit()) return say("Only people who may edit the groove can import into this sesh.");
    const p = d.current.project(), name = p.tracks[track]?.name ?? "the track";
    const at = from >= 0 && from < loopBeats(p) ? from : 0;
    try {
      if (kind === "audio") {
        if (soundIds({ tracks: p.tracks.filter((_, i) => i !== track) }).size >= MAX_TAKES)
          return say(`${MAX_TAKES} tracks already hold audio, the most a sesh keeps. Clear the take on one of them, then import again.`);
        say(`Reading ${file.name}…`);
        const got = await decodeAudio(file);
        d.current.landTake(track, at, got.pcm, got.rate);
        say(`${file.name} is on ${name} from bar ${barOf(at)}${got.cut ? `, cut to its first ${MAX_TAKE_SECONDS} seconds (it is ${Math.round(got.seconds)}): the longest a take can be` : ""}.`);
        return;
      }
      const song = await decodeMidi(file);
      const plain = song.parts.length === 1 && barsFor(song.parts, at) <= p.bars && (song.bpm === null || Math.round(song.bpm) === p.bpm);
      if (plain) land({ parts: song.parts, track, at, grow: false, tempo: false }, song.bpm, file.name);
      else setAsk({ song, file: file.name, track, at });
    } catch (e) { say(e instanceof Error ? e.message : String(e)); }
  }

  // a file dropped off the tracks would open in place of the desk
  useEffect(() => {
    const keep = (e: DragEvent) => { if (e.dataTransfer?.types.includes("Files")) e.preventDefault(); };
    window.addEventListener("dragover", keep);
    window.addEventListener("drop", keep);
    return () => { window.removeEventListener("dragover", keep); window.removeEventListener("drop", keep); };
  }, []);

  /** A track row's drop target: a file dropped on it is imported onto that track. */
  const dropProps = (track: number, from: number) => ({
    onDragOver(e: React.DragEvent) { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; setDropOn(track); } },
    onDragLeave() { setDropOn((x) => (x === track ? null : x)); },
    onDrop(e: React.DragEvent) {
      e.preventDefault();
      setDropOn(null);
      const f = droppedFile(e), kind = f && fileKind(f);
      if (!f || !kind) return say("Drop a sound file (wav, mp3, m4a, ogg, flac) or a MIDI file (.mid) on a track.");
      d.current.select(track);
      void importFile(kind, f, track, from);
    },
  });

  return { note, say, ask, cancel: () => setAsk(null), land, importFile, dropProps, dropOn };
}
