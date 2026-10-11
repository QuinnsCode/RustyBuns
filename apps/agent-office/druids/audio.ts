// 🔔 The merge gong rings the game's totem, and the jukebox plays the Ambiance of the Vale.
//
// rustybunsify.ts points two lines of the office's sound code here: its gong (`globalThis.__rbGong`, which falls
// back to the office's synthesized gong until the sample has loaded) and the tune the jukebox builds for a track
// (`globalThis.__rbTune`, for `vale`, the one tune the jukebox now has). Both play through the office's own
// buses, so its volume settings, muting and the jukebox fading with distance all still apply.
import { SOUNDS, soundUrl } from "./assets.ts";

type Vec = { x: number; y: number; z: number };
/** The bits of the office's sound core (a minified class) the gong uses, as its own gong does. */
interface Sound {
  ctx: AudioContext | null;
  unlock(): void;
  count(what: string): void;
  hall?: { gong?: Vec | null } | null;
  listener: Vec;
  panner(at: Vec, ref: number, rolloff: number): AudioNode;
  ambience: AudioNode;
  alerts: AudioNode;
}

// Safari can't decode Opus in WebM, so it gets the AAC copy, as in the game
const ext = new Audio().canPlayType('audio/webm; codecs="opus"') ? "webm" : "m4a";
// an AudioBuffer plays in any context, so these decode before the office has one of its own
const decoder = new OfflineAudioContext(2, 1, 48000);
const loaded = new Map<string, AudioBuffer>();
const loading = new Map<string, Promise<AudioBuffer | null>>();
function load(name: string) {
  let p = loading.get(name);
  if (!p) {
    p = fetch(soundUrl(name, ext))
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`${r.status}`))))
      .then((b) => decoder.decodeAudioData(b))
      .then((b) => (loaded.set(name, b), b))
      .catch((e) => (console.warn(`[druids] ${name} failed to load`, e), null));
    loading.set(name, p);
  }
  return p;
}

const rand = (min: number, max: number) => min + Math.random() * (max - min);

void load(SOUNDS.gong);

/** The office's gong, `why` being `merged`, `hit` (someone banged it) or `queue` (three strikes). False until the
 *  sample is in, so the office rings its own. */
function gong(a: Sound, why: string): boolean {
  const buf = loaded.get(SOUNDS.gong);
  a.unlock();
  const ctx = a.ctx;
  if (!buf || !ctx) return false;
  if (ctx.state === "suspended") void ctx.resume();
  a.count(`gong.${why}`);
  const at = a.hall?.gong ?? { x: a.listener.x, y: a.listener.y + 2, z: a.listener.z };
  const hit = why === "hit";
  const out = hit ? a.panner(at, 4, 0.6) : a.panner(at, 8, 0.45);
  out.connect(hit ? a.ambience : a.alerts);
  const strikes = why === "queue" ? [0.7, 0.85, 1.1] : [why === "merged" ? 1 : rand(0.6, 0.8)];
  strikes.forEach((strength, i) => {
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rand(0.97, 1.03);
    const g = ctx.createGain();
    g.gain.value = 0.7 * strength;
    src.connect(g).connect(out);
    src.start(ctx.currentTime + 0.03 + i * 0.85);
  });
  return true;
}

/** The game's forest, as its AmbienceDirector plays it: three of its beds looping from random points, each
 *  drifting in level on its own, and a creature calling from somewhere every 8 to 25 seconds. */
class Vale {
  private out: GainNode;
  private beds: { src: AudioBufferSourceNode; gain: GainNode; driftAt: number }[] = [];
  private callAt = -1;
  private stopped = false;

  constructor(private ctx: AudioContext, into: AudioNode) {
    this.out = ctx.createGain();
    this.out.gain.setValueAtTime(0, ctx.currentTime);
    this.out.gain.linearRampToValueAtTime(1, ctx.currentTime + 2.5);
    this.out.connect(into);
    for (const c of SOUNDS.creatures) void load(c);
    void Promise.all(SOUNDS.beds.map(load)).then((bufs) => {
      if (this.stopped) return;
      const beds = bufs.filter((b) => b !== null).sort(() => Math.random() - 0.5).slice(0, 3);
      for (const buf of beds) {
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.loop = true;
        // two loops at exactly the same rate phase against each other
        src.playbackRate.value = rand(0.99, 1.01);
        const gain = ctx.createGain();
        gain.gain.value = 0.5 * rand(0.55, 1);
        src.connect(gain).connect(this.out);
        src.start(ctx.currentTime, rand(0, buf.duration));
        this.beds.push({ src, gain, driftAt: 0 });
      }
    });
  }

  /** `t` is seconds since the tune went on, every 150 ms. */
  tick(t: number) {
    if (this.stopped) return;
    for (const bed of this.beds) {
      if (t < bed.driftAt) continue;
      bed.gain.gain.setTargetAtTime(0.5 * rand(0.55, 1), this.ctx.currentTime, 4);
      bed.driftAt = t + rand(18, 48);
    }
    if (this.callAt < 0) this.callAt = t + rand(3, 10);
    if (t < this.callAt) return;
    this.callAt = t + rand(8, 25);
    const calls = SOUNDS.creatures.map((c) => loaded.get(c)).filter((b) => b !== undefined);
    const buf = calls[Math.floor(Math.random() * calls.length)];
    if (!buf) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rand(0.92, 1.08);
    const gain = this.ctx.createGain();
    gain.gain.value = 0.45 * rand(0.6, 1);
    const pan = this.ctx.createStereoPanner();
    pan.pan.value = rand(-0.8, 0.8);
    src.connect(gain).connect(pan).connect(this.out);
    src.start();
  }

  /** How much the jukebox's lights pulse: the forest breathes, slowly. */
  beat(t: number) {
    return 0.25 + 0.15 * Math.sin(t * 0.9);
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    const now = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(now);
    this.out.gain.setValueAtTime(this.out.gain.value, now);
    this.out.gain.linearRampToValueAtTime(0, now + 1.5);
    for (const b of this.beds) b.src.stop(now + 1.6);
  }
}

const g = globalThis as {
  __rbGong?: (a: Sound, why: string) => boolean;
  __rbTune?: (ctx: AudioContext, into: AudioNode, track: string) => Vale | undefined;
};
g.__rbGong = gong;
g.__rbTune = (ctx, into, track) => (track === "vale" ? new Vale(ctx, into) : undefined);
