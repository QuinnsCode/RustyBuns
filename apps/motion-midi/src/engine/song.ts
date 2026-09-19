// Song JSON -> the flat Float32Array both engines read. Layout documented in
// native/crates/motion_midi/src/lib.rs; keep TRACK_FIELDS in sync.
export const VERSION = 1;
export const TRACK_FIELDS = 15;
export const WAVES = { saw: 0, square: 1, sine: 2 } as const;

export interface TrackJson {
  name: string;
  wave: keyof typeof WAVES;
  unison?: number; detune?: number;
  attack: number; decay: number; sustain: number; release: number;
  cutoff: number; reso?: number; envMod?: number;
  pan?: number; gain?: number;
  delay?: { time: number; feedback: number; mix: number };
  /** [startBeat, lengthBeats, midiNote, velocity 0..1] */
  notes: [number, number, number, number][];
}
export interface SongJson { name: string; bpm: number; sampleRate?: number; tracks: TrackJson[] }

export interface CompileOptions { sampleRate?: number; /** force every track's unison (benchmark load) */ unison?: number }

export function compileSong(song: SongJson, opts: CompileOptions = {}): Float32Array {
  const sr = opts.sampleRate ?? song.sampleRate ?? 44100;
  const spb = (60 / song.bpm) * sr;
  const out: number[] = [VERSION, sr, song.tracks.length];
  for (const t of song.tracks) {
    const d = t.delay ?? { time: 0.25, feedback: 0, mix: 0 };
    out.push(
      WAVES[t.wave], opts.unison ?? t.unison ?? 1, t.detune ?? 0,
      t.attack, t.decay, t.sustain, t.release,
      t.cutoff, t.reso ?? 0, t.envMod ?? 0, t.pan ?? 0,
      d.time, t.gain ?? 0.5, d.feedback, d.mix,
    );
    const notes = [...t.notes].sort((a, b) => a[0] - b[0]);
    out.push(notes.length);
    for (const [beat, len, midi, vel] of notes) out.push(Math.round(beat * spb), Math.round(len * spb), midi, vel);
  }
  const f = new Float32Array(out);
  if (f.some((v, i) => i > 2 && v > 16_777_216)) throw new Error("song too long for f32 sample offsets (~6 min at 44.1k)");
  return f;
}
