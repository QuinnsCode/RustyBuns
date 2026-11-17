// The DJ booth's decks as a sound source: two tracks of our own, synthesised like the house loop (play.ts) at two tempos
// so a mix is heard, each on a deck you start and stop, nudge in pitch, and bring up on its mixer channel's fader and
// across the crossfader. The state and the mix are plain numbers (a test reads them); `deckSound` turns them into a
// WebAudio node that play.ts plays through every fed speaker in place of the house loop, so the mix is heard by where
// you stand. A turntable with no ground wire hums on its channel; a media player into a phono input distorts.
import { clamp } from "@rustybuns/util";
import { houseLoop } from "./play.ts";

/** The two tracks: their tempo, the bass line and the stab's chord. */
export const TRACKS = [
  { name: "Warehouse", bpm: 124, bass: [55, 55, 65.41, 49, 55, 55, 73.42, 49], chord: [220, 261.63, 329.63] },
  { name: "Sunrise", bpm: 128, bass: [61.74, 61.74, 73.42, 55, 61.74, 82.41, 73.42, 55], chord: [246.94, 293.66, 369.99] },
] as const;

/** A track runs this many beats (six minutes at its tempo, near enough), then the deck stops at its end. */
export const TRACK_BEATS = 128 * 6;
/** The pitch fader's range, per cent either way. */
export const PITCH_RANGE = 8;

export type Deck = { playing: boolean; pitch: number; beat: number };
export type Decks = {
  deck: [Deck, Deck];
  /** Channel faders 1 to 4, 0 (down) to 1 (up). */
  fader: [number, number, number, number];
  /** The crossfader, -1 (all A: channels 1 and 2) to 1 (all B: channels 3 and 4). */
  cross: number;
};

export const newDecks = (): Decks => ({
  deck: [{ playing: false, pitch: 0, beat: 0 }, { playing: false, pitch: 0, beat: 0 }],
  fader: [0.8, 0.8, 0.8, 0.8],
  cross: 0,
});

const deckOf = (d: Decks, n: number) => d.deck[clamp(Math.round(n), 1, 2) - 1]!;
export const play = (d: Decks, n: number, on = true) => void (deckOf(d, n).playing = on);
export const setFader = (d: Decks, ch: number, v: number) => void (d.fader[clamp(Math.round(ch), 1, 4) - 1] = clamp(v, 0, 1));
export const setCross = (d: Decks, v: number) => void (d.cross = clamp(v, -1, 1));
export const setPitch = (d: Decks, n: number, pct: number) => void (deckOf(d, n).pitch = clamp(pct, -PITCH_RANGE, PITCH_RANGE));

/** A deck's tempo now: its track's, moved by the pitch fader. */
export const bpmOf = (d: Decks, n: number) => TRACKS[n - 1]!.bpm * (1 + deckOf(d, n).pitch / 100);

/** The clock runs: playing decks move through their tracks, and stop at the end. */
export function tickDecks(d: Decks, dt: number) {
  d.deck.forEach((k, i) => {
    if (!k.playing) return;
    k.beat += (bpmOf(d, i + 1) / 60) * dt;
    if (k.beat >= TRACK_BEATS) Object.assign(k, { beat: TRACK_BEATS, playing: false });
  });
}

/** The crossfader's two sides at constant power: centred, each at -3 dB; at one end, that side only. */
export function crossGains(cross: number): { a: number; b: number } {
  const t = ((clamp(cross, -1, 1) + 1) * Math.PI) / 4;
  return { a: Math.cos(t), b: Math.sin(t) };
}

/** What each deck sends to the master (by deck key), and each channel's meter, 0 to 1. */
export type Mix = { gain: Record<string, number>; meter: [number, number, number, number]; hum: Record<string, number> };

/**
 * The mix: a deck plays out when it is playing, wired into a channel (`routing`, deck key -> channel), at that channel's
 * fader and its side of the crossfader. A humming deck's channel hums whenever its fader is up, playing or not.
 */
export function mix(d: Decks, keys: readonly [string, string], routing: Readonly<Record<string, number>>, hum: readonly string[] = []): Mix {
  const side = crossGains(d.cross), gain: Record<string, number> = {}, buzz: Record<string, number> = {};
  const meter: Mix["meter"] = [0, 0, 0, 0];
  keys.forEach((key, i) => {
    const ch = routing[key];
    if (!ch) return (gain[key] = 0), undefined;
    const g = d.fader[ch - 1]! * (ch <= 2 ? side.a : side.b);
    gain[key] = d.deck[i]!.playing ? g : 0;
    // The channel meter is pre-crossfader, as on a real mixer: the fader, and the signal under it.
    const pre = d.fader[ch - 1]!;
    meter[ch - 1] = Math.max(meter[ch - 1]!, d.deck[i]!.playing ? pre : 0, hum.includes(key) ? pre * 0.3 : 0);
    if (hum.includes(key)) buzz[key] = g;
  });
  const r = (n: number) => Math.round(n * 1000) / 1000;
  return { gain: Object.fromEntries(Object.entries(gain).map(([k, v]) => [k, r(v)])), meter: meter.map(r) as Mix["meter"], hum: buzz };
}

/** How loud the cued deck is in the headphones (a linear gain). */
export const CUE_GAIN = 0.4;
/** The mains hum, Hz: the outlets here are 120 V, 60 Hz. */
export const HUM_HZ = 60;

/**
 * The decks in WebAudio: each track a looping buffer, started at its deck's place when it plays, its rate the pitch; a
 * gain per deck from the mix, a waveshaper that clips a deck that is overloading its input, and a hum per deck.
 */
export function deckSound(ctx: AudioContext) {
  const out = ctx.createGain();
  const lanes = TRACKS.map((t) => {
    const data = houseLoop(ctx.sampleRate, t);
    const buf = ctx.createBuffer(1, data.length, ctx.sampleRate);
    buf.copyToChannel(data, 0);
    const clip = ctx.createWaveShaper();
    clip.curve = new Float32Array(256).map((_, i) => Math.tanh(((i / 255) * 2 - 1) * 9) * 0.6);
    const dry = ctx.createGain(), wet = ctx.createGain(), gain = ctx.createGain();
    wet.gain.value = 0;
    gain.gain.value = 0;
    dry.connect(gain);
    clip.connect(wet).connect(gain);
    gain.connect(out);
    const hum = ctx.createOscillator(), humGain = ctx.createGain(), shape = ctx.createWaveShaper();
    // The hum is 60 Hz with its buzzy odd harmonics, as a ground loop sounds.
    shape.curve = new Float32Array(64).map((_, i) => Math.tanh(((i / 63) * 2 - 1) * 3));
    hum.frequency.value = HUM_HZ;
    humGain.gain.value = 0;
    hum.connect(shape).connect(humGain).connect(out);
    hum.start();
    // The headphone cue: the deck before its fader, straight to your ears and not through any speaker.
    const cue = ctx.createGain();
    cue.gain.value = 0;
    dry.connect(cue).connect(ctx.destination);
    return { buf, beatS: 60 / t.bpm, dry, clip, wet, gain, cue, hum, humGain, src: null as AudioBufferSourceNode | null };
  });
  return {
    node: out as AudioNode,
    /** `cue` is the deck in the headphones (1 or 2), or 0 for none. */
    update(d: Decks, m: Mix, keys: readonly [string, string], distort: readonly string[], cue = 0) {
      const t = ctx.currentTime;
      lanes.forEach((l, i) => {
        const k = d.deck[i]!;
        if (k.playing && !l.src) {
          const s = ctx.createBufferSource();
          s.buffer = l.buf;
          s.loop = true;
          s.connect(l.dry);
          s.connect(l.clip);
          s.start(0, (k.beat * l.beatS) % l.buf.duration);
          l.src = s;
        } else if (!k.playing && l.src) {
          l.src.stop();
          l.src.disconnect();
          l.src = null;
        }
        if (l.src) l.src.playbackRate.setTargetAtTime(1 + k.pitch / 100, t, 0.05);
        const bad = distort.includes(keys[i]!);
        l.dry.gain.setTargetAtTime(bad ? 0 : 1, t, 0.02);
        l.wet.gain.setTargetAtTime(bad ? 1 : 0, t, 0.02);
        l.gain.gain.setTargetAtTime(m.gain[keys[i]!] ?? 0, t, 0.03);
        l.cue.gain.setTargetAtTime(cue === i + 1 ? CUE_GAIN : 0, t, 0.02);
        l.humGain.gain.setTargetAtTime((m.hum[keys[i]!] ?? 0) * 0.25, t, 0.05);
      });
    },
    stop() {
      for (const l of lanes) l.src?.stop(), l.hum.stop(), l.cue.disconnect();
      out.disconnect();
    },
  };
}
export type DeckSound = ReturnType<typeof deckSound>;
