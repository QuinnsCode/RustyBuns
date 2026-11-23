// The room's PA as you hear it from where you stand: every set coming in (pa-line.ts) plays out of the room's real
// speakers, not from everywhere at once. Each speaker is a source with a place, a height and a facing (yaw as a gear
// model's: its front toward +z turned by yaw), and it throws forward: a horn stack is loudest on its axis and quietest
// behind. From each one to your ears the sound loses level by the inverse square of the distance, the air takes off
// its highs the further it goes, and it arrives late at the speed of sound, so the far stack lands after the near one.
// Your head shades a speaker behind you. Then the room: the set goes once into the impulse response sound.ts works out
// for the space (its direct sound taken out, since the speakers are the direct sound), starting when the first stack's
// sound reaches you, so a room rings at its own ring times and out of doors the sky and sand soak nearly all of it up.
//
// Cheap on purpose: per speaker a channel (its side of the stereo set), a gain, a delay, a low-pass and a pan, worked
// out here and moved at body rate (jam.ts BODY_HZ), not every frame, with short glides so nothing clicks.
// `hearSpeaker` and `paSpeakers` are pure, for the test; `PaRoom` is the Web Audio graph.
import { clamp } from "@rustybuns/util";
import { BODY_HZ } from "./jam.ts";
import { thingBox, type StudioDef } from "./room.ts";
import { AIR, impulse } from "./sound.ts";

/** Metres a second. */
export const SOUND_SPEED = 343;
/** How far in front of a speaker it plays at full level, metres: closer doesn't get louder (you're inside the horn's near field). */
export const REF_M = 4;
/** How high the horns' middle stands, and your ears, metres. */
export const HORN_Y = 2, EAR_Y = 1.6;
/** How loud a speaker is straight behind its cabinet, against its front: the bass wraps round, the horns don't. */
export const BACK = 0.15;
/** How loud a speaker straight behind your head is, against one in front: the head's shadow. */
export const HEAD_BACK = 0.7;
/** How loud the room's ring is, against the speakers' direct sound at REF_M (it follows the loudest stack's level, square-rooted). */
export const WET = 0.4;

/** A PA speaker: where it stands on the floor, the way its front faces, which side of the stereo set it plays. */
export interface Speaker { at: [number, number]; yaw: number; side: 0 | 1 }
/** What you hear of one speaker: its level (0 to 1), its delay (s), the air's low-pass (Hz), and its pan (-1 left to 1 right). */
export interface Heard { gain: number; delay: number; cutoff: number; pan: number; m: number }
/** Where you are and which way you face (yaw 0 looks down -z, as jam.ts's). */
export interface Ears { x: number; z: number; yaw: number }

/** The air's loss in dB a metre at 4 kHz (sound.ts AIR, there in nepers of intensity), and how it grows with the square of frequency. */
const AIR_4K_DB = 10 * Math.log10(Math.E) * AIR[5];

/**
 * The room's PA speakers: an open-air party's stacks where it has them, else a stack either side of the DJ table,
 * just past its ends and a little toward the crowd, facing the way the DJ faces. None in a room without decks.
 * Each plays the side of the set it stands on, seen from the floor.
 */
export function paSpeakers(def: StudioDef): Speaker[] {
  const dj = def.spots.find((s) => s.kind === "dj");
  const stacks = def.outdoor?.stacks.map((s) => ({ at: s.at, yaw: s.yaw })) ?? [];
  if (!stacks.length && dj) {
    const b = thingBox(dj), fx = -Math.sin(dj.yaw), fz = -Math.cos(dj.yaw), rx = Math.cos(dj.yaw), rz = -Math.sin(dj.yaw), out = b.hw + 1.2;
    for (const k of [-1, 1]) stacks.push({ at: [b.cx + rx * out * k + fx * 0.5, b.cz + rz * out * k + fz * 0.5], yaw: dj.yaw + Math.PI });
  }
  if (!stacks.length) return [];
  // a stack plays the left of the set when it stands left of the stacks' middle as the crowd sees them
  const mx = stacks.reduce((t, s) => t + s.at[0], 0) / stacks.length, mz = stacks.reduce((t, s) => t + s.at[1], 0) / stacks.length;
  return stacks.map((s) => {
    const rx = Math.cos(s.yaw), rz = -Math.sin(s.yaw); // the crowd's right, facing the speaker
    return { at: s.at, yaw: s.yaw, side: (s.at[0] - mx) * rx + (s.at[1] - mz) * rz < 0 ? 0 : 1 };
  });
}

/** One speaker as heard from `ears`, out of `n` speakers playing the same set (so two stacks together are as loud as one was). */
export function hearSpeaker(sp: Speaker, ears: Ears, n = 1): Heard {
  const dx = ears.x - sp.at[0], dz = ears.z - sp.at[1], flat = Math.hypot(dx, dz), m = Math.hypot(flat, HORN_Y - EAR_Y);
  // the throw: how far off the speaker's axis you stand, from on axis (1) to straight behind it (BACK)
  const onAxis = flat > 1e-6 ? (dx * Math.sin(sp.yaw) + dz * Math.cos(sp.yaw)) / flat : 1;
  const throwK = BACK + (1 - BACK) * ((1 + onAxis) / 2) ** 2;
  // your head: the speaker's direction against the way you face, and to your right
  const fx = -Math.sin(ears.yaw), fz = -Math.cos(ears.yaw), rx = Math.cos(ears.yaw), rz = -Math.sin(ears.yaw);
  const ahead = flat > 1e-6 ? (-dx * fx - dz * fz) / flat : 1, right = flat > 1e-6 ? (-dx * rx - dz * rz) / flat : 0;
  const front = (1 + ahead) / 2, head = HEAD_BACK + (1 - HEAD_BACK) * front;
  // the inverse square law on intensity is one over distance on level
  const gain = Math.min(1, REF_M / m) * throwK * head / Math.sqrt(n);
  // the air: its loss at f grows as f², so it reaches 3 dB at 4 kHz · √(3 / (loss at 4k · m)); behind your head it's duller still
  const cutoff = clamp(4000 * Math.sqrt(3 / (AIR_4K_DB * m)) * (0.55 + 0.45 * front), 800, 20000);
  return { gain, delay: m / SOUND_SPEED, cutoff, pan: clamp(right, -1, 1), m };
}

/** How far out on the floor the set plays at the level it was played at, metres in front of the speakers' middle. */
export const FLOOR_M = 10;

/** What to multiply every speaker by so that the floor's middle, FLOOR_M out in front of them, hears the set at the level it was played at. */
export function floorLevel(speakers: Speaker[]): number {
  if (!speakers.length) return 1;
  const mean = (f: (s: Speaker) => number) => speakers.reduce((t, s) => t + f(s), 0) / speakers.length;
  const fx = mean((s) => Math.sin(s.yaw)), fz = mean((s) => Math.cos(s.yaw)), len = Math.hypot(fx, fz) || 1;
  const x = mean((s) => s.at[0]) + fx / len * FLOOR_M, z = mean((s) => s.at[1]) + fz / len * FLOOR_M;
  // facing them: your yaw looks down -z turned, so toward -(fx, fz)
  const ears = { x, z, yaw: Math.atan2(fx / len, fz / len) };
  return 1 / Math.sqrt(speakers.reduce((t, s) => t + hearSpeaker(s, ears, speakers.length).gain ** 2, 0));
}

/** The ring of the room around the DJ, as stereo samples, with the direct sound taken out (the speakers play that). */
function ring(ctx: BaseAudioContext, def: StudioDef): AudioBuffer {
  const dj = def.spots.find((s) => s.kind === "dj");
  const ir = impulse(def, dj?.id, ctx.sampleRate);
  ir.l[0] = 0; ir.r[0] = 0;
  const buf = ctx.createBuffer(2, ir.l.length, ir.rate);
  buf.copyToChannel(ir.l, 0); buf.copyToChannel(ir.r, 1);
  return buf;
}

interface Voice { sp: Speaker; gain: GainNode; delay: DelayNode; air: BiquadFilterNode; pan: StereoPannerNode }

/** Every set into `input`, out of the room's speakers into `to`. A room with no speakers plays it straight through, everywhere, as before. */
export class PaRoom {
  readonly input: GainNode;
  private voices: Voice[] = [];
  private at: Ears | null = null;
  private moved = -Infinity;
  /** The room's ring: it starts when the first stack's sound reaches you, at a level that follows it. */
  private wet: { delay: DelayNode; gain: GainNode } | null = null;
  private norm = 1;

  constructor(private ctx: BaseAudioContext, def: StudioDef, to: AudioNode) {
    this.input = new GainNode(ctx);
    const speakers = paSpeakers(def);
    if (!speakers.length) { this.input.connect(to); return; }
    this.norm = floorLevel(speakers);
    // a PA's limiter: up against a stack it's louder than the floor, and it mustn't clip
    const limit = new DynamicsCompressorNode(ctx, { threshold: -3, knee: 0, ratio: 20, attack: 0.003, release: 0.1 });
    limit.connect(to); to = limit;
    const split = new ChannelSplitterNode(ctx, { numberOfOutputs: 2 });
    this.input.connect(split);
    for (const sp of speakers) {
      const gain = new GainNode(ctx, { gain: 0 }), delay = new DelayNode(ctx, { maxDelayTime: 1 }), air = new BiquadFilterNode(ctx, { type: "lowpass", frequency: 20000, Q: 0.5 }), pan = new StereoPannerNode(ctx);
      split.connect(gain, sp.side);
      gain.connect(delay).connect(air).connect(pan).connect(to);
      this.voices.push({ sp, gain, delay, air, pan });
    }
    const delay = new DelayNode(ctx, { maxDelayTime: 1 }), gain = new GainNode(ctx, { gain: 0 }), conv = new ConvolverNode(ctx, { disableNormalization: true });
    conv.buffer = ring(ctx, def);
    this.input.connect(delay).connect(conv).connect(gain).connect(to);
    this.wet = { delay, gain };
  }

  /** Where you are and which way you face: the speakers move to match at body rate, however often it's called. */
  listen(x: number, z: number, yaw: number) {
    // the page's clock, not the audio's: a context still waiting for a click doesn't move, and you still walk
    const wall = performance.now();
    if (wall - this.moved < 1000 / BODY_HZ) return;
    const first = !this.at, now = this.ctx.currentTime;
    this.at = { x, z, yaw }; this.moved = wall;
    const n = this.voices.length, k = first ? 0.001 : 1 / BODY_HZ / 2;
    let soonest = Infinity, loudest = 0;
    for (const v of this.voices) {
      const h = hearSpeaker(v.sp, this.at, n);
      soonest = Math.min(soonest, h.delay); loudest = Math.max(loudest, h.gain * this.norm);
      v.gain.gain.setTargetAtTime(h.gain * this.norm, now, k);
      // a glide on the delay as you walk is the Doppler shift you'd hear anyway
      v.delay.delayTime.setTargetAtTime(h.delay, now, first ? 0.001 : 0.1);
      v.air.frequency.setTargetAtTime(h.cutoff, now, k);
      v.pan.pan.setTargetAtTime(h.pan, now, k);
    }
    // the ring falls 3 dB each time the distance doubles where the stacks fall 6: further back, more of what you hear is the room
    if (this.wet) {
      this.wet.delay.delayTime.setTargetAtTime(soonest, now, first ? 0.001 : 0.1);
      this.wet.gain.gain.setTargetAtTime(WET * Math.sqrt(Math.min(1, loudest)), now, k);
    }
  }

  /** The speakers as you hear them now, for the harness. */
  state() {
    return this.voices.map((v) => {
      const h = this.at ? hearSpeaker(v.sp, this.at, this.voices.length) : null;
      return { at: v.sp.at, side: v.sp.side, ...(h ? { m: +h.m.toFixed(1), db: +(20 * Math.log10(h.gain * this.norm)).toFixed(1), ms: +(h.delay * 1000).toFixed(1), hz: Math.round(h.cutoff), pan: +h.pan.toFixed(2) } : {}) };
    });
  }
}
