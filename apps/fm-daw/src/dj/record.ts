// Recording a set: the mixer's master (`Mixer.stream`, what the room's PA gets) to a file on this computer, with the
// track list: each track and the time it came in (its deck playing with its fader and crossfader side open). Nothing
// leaves the computer: the take is two downloads, the sound and the list. A YouTube deck plays in YouTube's own player,
// outside the mixer, so it is never in the sound; the list names it as left out.
import { faderGain } from "./analyze.ts";
import { xfGain, type ChannelState, type Curve } from "./mixer.ts";

/** A track coming in: seconds into the take, which deck, its name; `tube`: a YouTube deck (not in the sound). */
export interface Cue { at: number; side: 0 | 1; name: string; tube?: boolean }

/** A finished take: the sound, its type, how long it ran, the track list and the name both files share. */
export interface Take { audio: Blob; type: string; seconds: number; cues: Cue[]; list: string; name: string }

/** A deck as the recorder sees it each tick: what's on it, whether it plays, and its channel on the mixer. */
export interface OnAir { name: string | null; playing: boolean; tube: boolean; ch: ChannelState }

/** How far a deck's fader and crossfader side must be open (as a gain) for it to count as in the mix. */
export const IN_GAIN = 0.1;

/** Whether a deck is heard on the master now: a track on, playing, its fader and its side of the crossfader open. */
export function heard(d: OnAir, xfader: number, curve: Curve): boolean {
  return !!d.name && d.playing && faderGain(d.ch.fader) * xfGain(d.ch.xf, xfader, curve) >= IN_GAIN;
}

/** A time in the take as a track list writes it: m:ss, or h:mm:ss past the hour. */
export function stamp(s: number): string {
  const t = Math.max(0, Math.floor(s)), h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, sec = String(t % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/** The track list as a text file: a line per track, its time and deck. */
export function listText(title: string, cues: readonly Cue[], seconds: number): string {
  const lines = cues.map((c) => `${stamp(c.at)}  ${c.side === 0 ? "A" : "B"}  ${c.name}${c.tube ? "  (YouTube: not in the recording)" : ""}`);
  return `${title}\n${stamp(seconds)} long\n\n${lines.length ? lines.join("\n") : "(no tracks came in)"}\n`;
}

/** The take's file name, from when it started: `qdjs-set-2026-11-24-2130`. */
export function takeName(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `qdjs-set-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

/** The type this browser records in: Opus in WebM (Chrome, Firefox), else AAC in MP4 (Safari). */
function pickType(): string {
  for (const t of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4;codecs=mp4a.40.2", "audio/mp4"]) if (MediaRecorder.isTypeSupported(t)) return t;
  return "";
}

/** The tracks coming in, tick by tick: a deck brought in, or a new track on a deck already in. REC and going live both
 *  keep their track list with one. */
export class CueWatch {
  /** What each deck had in the mix at the last tick (null: not heard). */
  private inMix: [string | null, string | null] = [null, null];
  reset() { this.inMix = [null, null]; }
  /** The tracks newly heard now, `at` seconds into the set. */
  tick(decks: readonly [OnAir, OnAir], xfader: number, curve: Curve, at: number): Cue[] {
    const out: Cue[] = [];
    decks.forEach((d, i) => {
      const side = i as 0 | 1, name = heard(d, xfader, curve) ? d.name : null;
      if (name && name !== this.inMix[side]) out.push({ at, side, name, ...(d.tube ? { tube: true } : {}) });
      this.inMix[side] = name;
    });
    return out;
  }
}

/** One take at a time. `start` begins recording `stream`; `tick` (a few times a second) notes each deck coming in. */
export class SetRecorder {
  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private t0 = 0;
  private started = new Date();
  private cues: Cue[] = [];
  private watch = new CueWatch();

  get on(): boolean { return !!this.rec; }
  /** Seconds since the take started (0 when not recording). */
  seconds(now = performance.now()): number { return this.rec ? (now - this.t0) / 1000 : 0; }

  start(stream: MediaStream, now = performance.now()) {
    if (this.rec) return;
    const type = pickType();
    this.rec = new MediaRecorder(stream, type ? { mimeType: type, audioBitsPerSecond: 192_000 } : {});
    this.chunks = [];
    this.rec.ondataavailable = (e) => { if (e.data.size) this.chunks.push(e.data); };
    this.rec.start(1000);
    this.t0 = now; this.started = new Date(); this.cues = []; this.watch.reset();
  }

  /** Each deck now: a track newly heard (a deck brought in, or a new track on a deck already in) goes on the list. */
  tick(decks: readonly [OnAir, OnAir], xfader: number, curve: Curve, now = performance.now()) {
    if (this.rec) this.cues.push(...this.watch.tick(decks, xfader, curve, this.seconds(now)));
  }

  /** Stop: the take, once the last of the sound is written. */
  stop(now = performance.now()): Promise<Take | null> {
    const rec = this.rec;
    if (!rec) return Promise.resolve(null);
    this.rec = null;
    const seconds = (now - this.t0) / 1000, cues = this.cues, name = takeName(this.started);
    return new Promise((done) => {
      rec.onstop = () => {
        const type = rec.mimeType || "audio/webm", audio = new Blob(this.chunks, { type });
        done({ audio, type, seconds, cues, name, list: listText(`QDJs set, ${this.started.toLocaleString()}`, cues, seconds) });
      };
      rec.stop();
    });
  }
}

/** Save a take: the sound and the track list, two downloads named alike. */
export function saveTake(t: Take) {
  const ext = t.type.includes("mp4") ? "m4a" : "webm";
  const down = (blob: Blob, file: string) => {
    const a = document.createElement("a"), url = URL.createObjectURL(blob);
    a.href = url; a.download = file; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };
  down(t.audio, `${t.name}.${ext}`);
  down(new Blob([t.list], { type: "text/plain" }), `${t.name}.txt`);
}
