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
import { airAbsorption, banks, levelAt, MILD_FIELD, screenPath, source, speedOfSound, stackSources, stackWidth, system, systemSound, type Field, type RigPlan, type Source, type System } from "@rustybuns/gear";
import { BODY_HZ } from "./jam.ts";
import { thingBox, type Outdoor, type RoomPa, type StudioDef } from "./room.ts";
import { AIR, impulse } from "./sound.ts";

/** Metres a second, indoors (out of doors the field's air sets it: roomField). */
export const SOUND_SPEED = 343;
/** How far in front of a speaker it plays at full level, metres: closer doesn't get louder (you're inside the horn's near field). */
export const REF_M = 4;
/** How high the horns' middle stands, and your ears, metres. */
export const HORN_Y = 2, EAR_Y = 1.6;
/** The box a speaker plays as when it brings none of its own: the horn stack's mid-high horn. */
export const DEFAULT_TOP = "stack-mid-high";
/** How loud a speaker straight behind your head is, against one in front: the head's shadow. */
export const HEAD_BACK = 0.7;
/** How loud the room's ring is, against the speakers' direct sound at REF_M (it follows the loudest stack's level, square-rooted). */
export const WET = 0.4;

/** A PA speaker: where it stands on the floor, the way its front faces, which side of the stereo set it plays ("mono": both,
 *  summed), its horizontal pattern in degrees (the full width 6 dB down, from its top's sheet; 90 when left out), and the
 *  boxes in it that carry the mids and highs as @rustybuns/gear sources (stackSources: placed, aimed, splayed, pinned; one
 *  DEFAULT_TOP at HORN_Y when left out). How loud it is anywhere is gear's `levelAt` over them: the coverage map's sum.
 *  Out of doors each carries the room's field (roomField), so its level, its highs and its delay cross the same air and land. */
export interface Speaker { at: [number, number]; yaw: number; side: 0 | 1 | "mono"; spread?: number; boxes?: Source[]; field?: Field }

/** The field an open-air room's sound crosses (@rustybuns/gear field.ts): its air (a mild evening when left out), what
 *  the crowd stands on and its banks as the land's heights. None indoors: a room's floor is flat and its air still. */
export function roomField(def: StudioDef): Field | undefined {
  const out = def.outdoor;
  if (!out) return undefined;
  return { tempC: out.air?.tempC ?? MILD_FIELD.tempC, humidity: out.air?.humidity ?? MILD_FIELD.humidity, ground: out.ground ?? MILD_FIELD.ground, terrain: out.banks?.length ? banks(out.banks) : undefined };
}

/** The PA you placed: an open-air party's, else an indoor room's own (none: the club stacks either side of the decks). */
export const roomPa = (def: StudioDef): RoomPa | undefined => def.outdoor ?? def.pa;

/** The room's rig, if it has stacks: the rig asked for, else the horn stack. */
export function roomRig(def: StudioDef): System {
  return system(roomPa(def)?.rig);
}

/**
 * The stacks where they stand for the rig: the room lays each block of stacks (a wall, or one side of the floor) out in
 * a line at one spacing, and a rig whose boxes are wider or narrower spreads or closes each block about its own middle,
 * so its columns stay shoulder to shoulder and the gap between the sides stays where the room put it.
 */
export function rigStacks(def: StudioDef): Outdoor["stacks"] {
  const stacks = roomPa(def)?.stacks ?? [];
  const w = stackWidth(roomRig(def)) + 0.02;
  return stackBlocks(stacks).flatMap((block) => {
    if (block.length < 2) return block;
    const mx = block.reduce((t, s) => t + s.at[0], 0) / block.length, mz = block.reduce((t, s) => t + s.at[1], 0) / block.length;
    const gap = Math.min(...block.slice(1).map((s, i) => Math.hypot(s.at[0] - block[i]!.at[0], s.at[1] - block[i]!.at[1])));
    const k = gap > 1e-6 ? w / gap : 1;
    return block.map((s) => ({ ...s, at: [mx + (s.at[0] - mx) * k, mz + (s.at[1] - mz) * k] as [number, number] }));
  });
}
/** Stacks further apart than this, metres, stand as separate blocks (the two sides of a floor), not one wall. */
export const STACK_CLUSTER_M = 2.5;
/** The stacks in their blocks, in the room's order: a new block starts wherever the next stack is past STACK_CLUSTER_M. */
export function stackBlocks<S extends { at: [number, number] }>(stacks: readonly S[]): S[][] {
  const out: S[][] = [];
  stacks.forEach((s, i) => {
    const prev = stacks[i - 1];
    if (prev && Math.hypot(s.at[0] - prev.at[0], s.at[1] - prev.at[1]) <= STACK_CLUSTER_M) out[out.length - 1]!.push(s);
    else out.push([s]);
  });
  return out;
}
/** What you hear of one speaker: its level (0 to 1), its delay (s), the air's low-pass (Hz), and its pan (-1 left to 1 right). */
export interface Heard { gain: number; delay: number; cutoff: number; pan: number; m: number }
/** Where you are and which way you face (yaw 0 looks down -z, as jam.ts's). */
export interface Ears { x: number; z: number; yaw: number }

/** The air's loss in dB a metre at 4 kHz (sound.ts AIR, there in nepers of intensity), and how it grows with the square of frequency. */
const AIR_4K_DB = 10 * Math.log10(Math.E) * AIR[5];

/**
 * The room's PA speakers: an open-air party's stacks where it has them, else a stack either side of the DJ table,
 * just past its ends and a little toward the crowd, facing the way the DJ faces. None in a room without decks.
 * Each plays the side of the set it stands on, seen from the floor, or all the same mono sum where the party's rig is mono.
 */
export function paSpeakers(def: StudioDef): Speaker[] {
  const dj = def.spots.find((s) => s.kind === "dj");
  const spread = roomPa(def)?.stacks.length ? systemSound(roomRig(def)).coverage.h : undefined, rig = roomRig(def);
  const stacks: { at: [number, number]; yaw: number; boxes: Source[] }[] = rigStacks(def).map((s) => ({ at: s.at, yaw: s.yaw, boxes: stackSources(rig, s) }));
  if (!stacks.length && dj) {
    const b = thingBox(dj), fx = -Math.sin(dj.yaw), fz = -Math.cos(dj.yaw), rx = Math.cos(dj.yaw), rz = -Math.sin(dj.yaw), out = b.hw + 1.2;
    for (const k of [-1, 1]) {
      const at: [number, number] = [b.cx + rx * out * k + fx * 0.5, b.cz + rz * out * k + fz * 0.5], yaw = dj.yaw + Math.PI;
      // a club stack's powered top, its horn about head high (open-air.ts clubStack)
      stacks.push({ at, yaw, boxes: [source("top-12-powered", { x: at[0], y: HORN_Y, z: at[1] }, { yaw })] });
    }
  }
  if (!stacks.length) return [];
  const field = roomField(def);
  if (roomPa(def)?.mono) return stacks.map((s) => ({ ...s, side: "mono" as const, spread, field }));
  // a stack plays the left of the set when it stands left of the stacks' middle as the crowd sees them
  const mx = stacks.reduce((t, s) => t + s.at[0], 0) / stacks.length, mz = stacks.reduce((t, s) => t + s.at[1], 0) / stacks.length;
  return stacks.map((s) => {
    const rx = Math.cos(s.yaw), rz = -Math.sin(s.yaw); // the crowd's right, facing the speaker
    return { ...s, side: (s.at[0] - mx) * rx + (s.at[1] - mz) * rz < 0 ? 0 : 1, spread, field };
  });
}

/** Every box the room's PA plays the floor from, as @rustybuns/gear sources: what the builder's coverage map adds up. */
export const paSources = (def: StudioDef): Source[] => paSpeakers(def).flatMap(boxesOf);
/** The PA's boxes as both harnesses show them (qrooms.pa() and qjam.state().pa, #6020): where each stands and points, and how loud it goes. */
export const paBoxes = (def: StudioDef) => paSources(def).map((s) => ({ at: [s.pos.x, s.pos.y, s.pos.z].map((v) => +v.toFixed(2)), yaw: +s.yaw.toFixed(3), pitch: +s.pitch.toFixed(3), maxSpl: s.speaker.maxSpl }));
const boxesOf = (sp: Speaker): Source[] => sp.boxes ?? [source(DEFAULT_TOP, { x: sp.at[0], y: HORN_Y, z: sp.at[1] }, { yaw: sp.yaw })];

/** An open-air room's rig as @rustybuns/gear plans one (its power, its gear list): the stacks where they stand, the sub
 *  block, the booth monitors, the generator and the DJ's desk. Indoors, the stacks you placed and the desk (the power
 *  check picks the set that would hold them). Null in a room with no PA of its own. */
export function rigPlan(def: StudioDef): RigPlan | null {
  const out = def.outdoor;
  const pa = roomPa(def);
  if (!pa || (!out && !pa.stacks.length)) return null;
  const dj = def.spots.find((s) => s.kind === "dj");
  return {
    system: roomRig(def), stacks: rigStacks(def), subs: out?.subs, monitors: out?.monitors,
    generator: out?.generator ? { at: out.generator.at, set: out.generator.set } : undefined,
    desk: dj ? [thingBox(dj).cx, thingBox(dj).cz] : undefined,
  };
}

/** Each speaker's sound at (x, z), ears high: how much later it lands than the first speaker's (ms) and how far under the
 *  loudest it is (dB), in the order paSpeakers gives them. What the builder's delay view reads. */
export function arrivals(def: StudioDef, x: number, z: number): { ms: number; down: number }[] {
  const sp = paSpeakers(def), ears = { x, z, yaw: 0 };
  // the head's shadow is a listener's, not the room's: hear every speaker as if facing it
  const heard = sp.map((s) => hearSpeaker(s, { ...ears, yaw: Math.atan2(x - s.at[0], z - s.at[1]) }));
  const first = Math.min(...heard.map((h) => h.delay)), loud = Math.max(...heard.map((h) => h.gain));
  return heard.map((h) => ({ ms: (h.delay - first) * 1000, down: 20 * Math.log10(loud / Math.max(h.gain, 1e-9)) }));
}

/** How far a speaker under the loudest can be and still smear what you hear when it lands late, dB. */
export const SMEAR_DB = 10;
/** The spread in arrival at (x, z), ms: from the first to the last of the speakers within SMEAR_DB of the loudest.
 *  Past ~10 ms you hear it as a smear, past ~30 ms as an echo: where a delay tower would go. */
export function arrivalSpread(def: StudioDef, x: number, z: number): number {
  const ms = arrivals(def, x, z).filter((h) => h.down <= SMEAR_DB).map((h) => h.ms);
  return ms.length ? Math.max(...ms) - Math.min(...ms) : 0;
}

/** One speaker as heard from `ears`, out of `n` speakers playing the same set (so two stacks together are as loud as one was). */
export function hearSpeaker(sp: Speaker, ears: Ears, n = 1): Heard {
  const f = sp.field, land = f?.terrain ?? (() => 0);
  const horn = { x: sp.at[0], y: HORN_Y + land(sp.at[0], sp.at[1]), z: sp.at[1] }, ear = { x: ears.x, y: EAR_Y + land(ears.x, ears.z), z: ears.z };
  const dx = ears.x - sp.at[0], dz = ears.z - sp.at[1], flat = Math.hypot(dx, dz), m = Math.hypot(flat, horn.y - ear.y);
  // the throw: @rustybuns/gear's level from the speaker's boxes where your ears are (distance and off-axis loss, as the
  // coverage map works it out), against straight in front at REF_M; never louder than that (the horn's near field)
  const boxes = boxesOf(sp), ref = { x: sp.at[0] + Math.sin(sp.yaw) * REF_M, y: EAR_Y, z: sp.at[1] + Math.cos(sp.yaw) * REF_M };
  const throwK = Math.min(1, 10 ** ((levelAt(boxes, { x: ears.x, y: EAR_Y, z: ears.z }, "high", 63, f) - levelAt(boxes, ref, "high", 63, f)) / 20));
  const onAxis = flat > 1e-6 ? (dx * Math.sin(sp.yaw) + dz * Math.cos(sp.yaw)) / flat : 1;
  // your head: the speaker's direction against the way you face, and to your right
  const fx = -Math.sin(ears.yaw), fz = -Math.cos(ears.yaw), rx = Math.cos(ears.yaw), rz = -Math.sin(ears.yaw);
  const ahead = flat > 1e-6 ? (-dx * fx - dz * fz) / flat : 1, right = flat > 1e-6 ? (-dx * rx - dz * rz) / flat : 0;
  const front = (1 + ahead) / 2, head = HEAD_BACK + (1 - HEAD_BACK) * front;
  const gain = throwK * head / Math.sqrt(n);
  // the air: its loss at f grows as f², so it reaches 3 dB at 4 kHz · √(3 / (loss at 4k · m)); behind your head it's duller still
  // (out of doors the loss at 4k is the field's air's, ISO 9613-1: a dry night dulls the far stack sooner)
  const air4k = f ? airAbsorption(4000, f.tempC, f.humidity, f.kPa) : AIR_4K_DB;
  const air = 4000 * Math.sqrt(3 / (air4k * m)) * (0.55 + 0.45 * front);
  // a bank in the way: over its crest the highs don't bend (the level already lost its share, gear's fieldLoss); the
  // further the sound must bend to reach you, the lower it rolls off
  const over = f?.terrain ? screenPath(f.terrain, horn, ear) : 0, screen = over > 0 ? 2000 / Math.sqrt(1 + 20 * over) : 20000;
  // the horn's pattern: inside it the highs hold; past its edge they fall away (a horn beams its highs, the bass wraps
  // round), so walking off a narrow rig's axis dulls it sooner than a wide one's
  const edge = ((sp.spread ?? 90) / 2) * Math.PI / 180, off = Math.acos(clamp(onAxis, -1, 1));
  const beam = off <= edge ? 20000 : 20000 * (edge / off) ** 3;
  const cutoff = clamp(Math.min(air, beam, screen), 800, 20000);
  return { gain, delay: m / (f ? speedOfSound(f.tempC) : SOUND_SPEED), cutoff, pan: clamp(right, -1, 1), m };
}

/** How far out on the floor the set plays at the level it was played at, metres in front of the speakers' middle. */
export const FLOOR_M = 10;

/** The floor's middle, FLOOR_M out in front of the speakers' middle the way they face on the whole, facing them. */
export function floorMiddle(speakers: readonly Speaker[]): Ears {
  const mean = (f: (s: Speaker) => number) => speakers.reduce((t, s) => t + f(s), 0) / Math.max(1, speakers.length);
  const fx = mean((s) => Math.sin(s.yaw)), fz = mean((s) => Math.cos(s.yaw)), len = Math.hypot(fx, fz) || 1;
  // facing them: your yaw looks down -z turned, so toward -(fx, fz)
  return { x: mean((s) => s.at[0]) + fx / len * FLOOR_M, z: mean((s) => s.at[1]) + fz / len * FLOOR_M, yaw: Math.atan2(fx / len, fz / len) };
}

/** What to multiply every speaker by so that the floor's middle, FLOOR_M out in front of them, hears the set at the level it was played at. */
export function floorLevel(speakers: Speaker[]): number {
  if (!speakers.length) return 1;
  const ears = floorMiddle(speakers);
  return 1 / Math.sqrt(speakers.reduce((t, s) => t + hearSpeaker(s, ears, speakers.length).gain ** 2, 0));
}

/**
 * How loud the set is where `ears` stand, against the floor's middle (1 there and at the stacks, which a limiter holds),
 * for a sound the PA can't carry (a YouTube deck: room-tube.ts sets each listener's own player by it). 1 in a room with no speakers.
 */
export function roomLevel(speakers: Speaker[], ears: Ears): number {
  if (!speakers.length) return 1;
  const norm = floorLevel(speakers);
  return Math.min(1, Math.sqrt(speakers.reduce((t, s) => t + (hearSpeaker(s, ears, speakers.length).gain * norm) ** 2, 0)));
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
  /** The set after the rig's low end and voicing, or nothing indoors (the input as it is). */
  private voiced: AudioNode | null = null;

  constructor(private ctx: BaseAudioContext, def: StudioDef, to: AudioNode) {
    this.input = new GainNode(ctx);
    const speakers = paSpeakers(def);
    if (!speakers.length) { this.input.connect(to); return; }
    // the rig's own sound before it reaches any box: its low end (the sub's -10 dB point) and its family's voicing
    if (def.outdoor) {
      const rig = systemSound(roomRig(def)), chain: AudioNode[] = [new BiquadFilterNode(ctx, { type: "highpass", frequency: rig.lowCut, Q: 0.7 })];
      for (const b of rig.voicing) chain.push(new BiquadFilterNode(ctx, { type: "peaking", frequency: b.hz, gain: b.db, Q: b.q }));
      const voiced = chain.reduce((a, n) => (a.connect(n), n), this.input as AudioNode);
      this.voiced = voiced;
    }
    const from = this.voiced ?? this.input;
    this.norm = floorLevel(speakers);
    // a PA's limiter: up against a stack it's louder than the floor, and it mustn't clip
    const limit = new DynamicsCompressorNode(ctx, { threshold: -3, knee: 0, ratio: 20, attack: 0.003, release: 0.1 });
    limit.connect(to); to = limit;
    const split = new ChannelSplitterNode(ctx, { numberOfOutputs: 2 });
    from.connect(split);
    // the mono sum: one channel, so the stereo set mixes down into it (left and right, half each)
    const mono = new GainNode(ctx, { channelCount: 1, channelCountMode: "explicit", channelInterpretation: "speakers" });
    from.connect(mono);
    for (const sp of speakers) {
      const gain = new GainNode(ctx, { gain: 0 }), delay = new DelayNode(ctx, { maxDelayTime: 1 }), air = new BiquadFilterNode(ctx, { type: "lowpass", frequency: 20000, Q: 0.5 }), pan = new StereoPannerNode(ctx);
      if (sp.side === "mono") mono.connect(gain); else split.connect(gain, sp.side);
      gain.connect(delay).connect(air).connect(pan).connect(to);
      this.voices.push({ sp, gain, delay, air, pan });
    }
    const delay = new DelayNode(ctx, { maxDelayTime: 1 }), gain = new GainNode(ctx, { gain: 0 }), conv = new ConvolverNode(ctx, { disableNormalization: true });
    conv.buffer = ring(ctx, def);
    from.connect(delay).connect(conv).connect(gain).connect(to);
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
