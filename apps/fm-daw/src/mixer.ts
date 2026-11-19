// FM DAW's desk: a channel strip per source (each player, instrument and track) with gain, Shape, pan, fader, mute
// and solo, and aux sends to returns. On FM DAW's page (the Mixer tab) it is the sesh's desk, a channel per track
// over the project itself (`seshDesk`, `deskOps`). A return is an effect: FM DAW's Space, or the gear cabled between the desk's
// `aux-send-N` and `aux-return-N` jacks in the gear room (a pedal, Q Tape, Q Spring, run by Q Amp's rig at line
// level), and it comes back on its own fader. Pure, no DOM: the gear room's audio thread runs a `Mixer`, a test runs
// one on buffers.
import { applySettings, LINE_SCALE, type Live } from "./amp/live.ts";
import type { AmpSettings } from "./amp/messages.ts";
import { flatEq, TsEq } from "./engine/eq.ts";
import { AUXES, audible, faderGain, MAX_CHANNELS, newChannel, playerId, RETURNS, UNITY, type Channel, type Desk } from "./desk.ts";
import { P } from "./engine/params.ts";
import { Space } from "./engine/space.ts";
import type { Op, Project } from "./project.ts";

export * from "./desk.ts";

// ---- the sesh's desk: a channel per track and per player, over the project itself ----
// A track's channel is the track: its fader is the engine's level, its pan and its two sends the engine's own, its
// mute, solo and Shape the track's. So an edit on the desk is the same op the rest of FM DAW sends, the sesh keeps
// it with the groove, everyone hears the same mix, and the bounce plays it. The Space return's fader is the
// project's Space amount. A player's channel carries what the live line plays for them (their guitar, mic or
// plugin track, where it doesn't go into a track's amp); its settings and the aux 2 return's are the project's
// `desk` (src/desk.ts), set by a `desk` op. A track has no input gain: its Shape is linear, so its fader is one.

/** A track's channel id on the desk. */
export const trackId = (ti: number) => `track-${ti + 1}`;
const trackOf = (id: string) => { const m = /^track-(\d+)$/.exec(id); return m ? Number(m[1]) - 1 : -1; };
/** An engine level, 0 to 1, as a fader: 1 is the fader's top (+6 dB), a half is 0 dB. */
export const levelFader = (v: number) => (v <= 0 ? 0 : Math.min(1, Math.max(0, UNITY + (20 * Math.log10(v * 2)) / 48)));
/** A fader as an engine level, the other way. */
export const faderLevel = (f: number) => Math.min(1, faderGain(f) / 2);

/** Someone the live line plays sound for: their person id and the name on their strip. */
export interface Player { who: string; name: string }

/** A track as a channel on the desk. */
export function trackChannel(p: Project, ti: number): Channel {
  const t = p.tracks[ti];
  return { id: trackId(ti), name: t.name, source: "track", gain: 0, eq: t.eq ?? flatEq(), pan: t.params[P.PAN], fader: levelFader(t.params[P.GAIN]), mute: t.mute, solo: t.solo, sends: [t.params[P.SEND], t.params[P.SEND2]] };
}
/** A player's channel: as the sesh keeps it, or a new one. */
export function playerChannel(p: Project, pl: Player): Channel {
  const id = playerId(pl.who), kept = p.desk?.players.find((c) => c.id === id);
  return kept ? { ...kept, name: pl.name } : newChannel({ id, name: pl.name, source: "player" });
}

/** The sesh's desk: a channel per track, one per player in `players`, the Space return on the project's Space amount, and the aux 2 return. */
export function seshDesk(p: Project, players: readonly Player[] = []): Desk {
  const aux2 = p.desk?.aux2 ?? RETURNS[1];
  return {
    channels: [...p.tracks.map((_, ti) => trackChannel(p, ti)), ...players.map((pl) => playerChannel(p, pl))].slice(0, MAX_CHANNELS),
    returns: [{ ...RETURNS[0], fader: levelFader(p.space) }, { ...RETURNS[1], fader: aux2.fader, mute: aux2.mute }],
  };
}

const moved = (a: number, b: number) => Math.abs(a - b) > 1e-6;
/** The ops that take the project to the desk `next` (from seshDesk, with some controls moved). */
export function deskOps(p: Project, next: Desk): Op[] {
  const ops: Op[] = [];
  for (const c of next.channels) {
    if (c.source === "player") {
      const was = playerChannel(p, { who: c.id.slice("player-".length), name: c.name });
      if (JSON.stringify(c) !== JSON.stringify(was)) ops.push({ t: "desk", player: c });
      continue;
    }
    const ti = trackOf(c.id);
    if (ti < 0 || ti >= p.tracks.length) continue;
    const was = trackChannel(p, ti);
    if (moved(c.fader, was.fader)) ops.push({ t: "param", track: ti, i: P.GAIN, v: faderLevel(c.fader) });
    if (moved(c.pan, was.pan)) ops.push({ t: "param", track: ti, i: P.PAN, v: c.pan });
    if (moved(c.sends[0] ?? 0, was.sends[0])) ops.push({ t: "param", track: ti, i: P.SEND, v: c.sends[0] ?? 0 });
    if (moved(c.sends[1] ?? 0, was.sends[1])) ops.push({ t: "param", track: ti, i: P.SEND2, v: c.sends[1] ?? 0 });
    if (c.mute !== was.mute || c.solo !== was.solo) ops.push({ t: "track", track: ti, ...(c.mute !== was.mute ? { mute: c.mute } : {}), ...(c.solo !== was.solo ? { solo: c.solo } : {}) });
    if (JSON.stringify(c.eq) !== JSON.stringify(was.eq)) ops.push({ t: "eq", track: ti, bands: c.eq });
  }
  const space = next.returns.find((r) => r.fx === "space");
  if (space && moved(space.fader, levelFader(p.space))) ops.push({ t: "global", space: faderLevel(space.fader) });
  const aux2 = next.returns.find((r) => r.aux === 2), had = p.desk?.aux2 ?? RETURNS[1];
  if (aux2 && (moved(aux2.fader, had.fader) || aux2.mute !== had.mute)) ops.push({ t: "desk", aux2: { fader: aux2.fader, mute: aux2.mute } });
  return ops;
}

/**
 * What the audio thread plays of the sesh's desk: which tracks, and each of these players' channels with every
 * solo already worked out (a solo on any strip, a track's or a player's, leaves only the soloed ones).
 */
export function deskPlays(p: Project, players: readonly Player[]): { mask: boolean[]; players: Channel[] } {
  const d = seshDesk(p, players), on = audible(d);
  return { mask: p.tracks.map((_, ti) => on[ti] ?? false), players: d.channels.flatMap((c, i) => (c.source === "player" ? [{ ...c, mute: !on[i], solo: false }] : [])) };
}

/** An effect on a return: its aux bus in (mono), the wet signal out (stereo, interleaved, written over). */
export interface ReturnFx { process(input: Float32Array, out: Float32Array, frames: number): void }

/** FM DAW's Space as a return: all wet, the dry is the channels' own. */
export class SpaceReturn implements ReturnFx {
  private readonly space: Space;
  private send = new Float32Array(256);
  constructor(sampleRate: number) { this.space = new Space(sampleRate); this.space.setAmount(1); }
  setTempo(bpm: number) { this.space.setTempo(bpm); }
  process(input: Float32Array, out: Float32Array, frames: number) {
    if (this.send.length < frames * 2) this.send = new Float32Array(frames * 2);
    for (let i = 0; i < frames; i++) { this.send[i * 2] = input[i]; this.send[i * 2 + 1] = input[i]; }
    out.fill(0, 0, frames * 2);
    this.space.process(out, this.send, frames);
  }
}

/** The gear cabled into a return (the gear room's `listen().returns`), run by Q Amp's rig at line level. */
export class RigReturn implements ReturnFx {
  private live: Live | null = null;
  private wet = new Float32Array(128);
  constructor(private readonly sampleRate: number, settings: AmpSettings) { this.set(settings); }
  /** New knobs or gear: a machine keeps its echoes unless the chain itself changed. */
  set(settings: AmpSettings) { this.live = applySettings(settings, this.live, this.sampleRate); }
  process(input: Float32Array, out: Float32Array, frames: number) {
    if (this.wet.length < frames) this.wet = new Float32Array(frames);
    const live = this.live;
    if (!live) { out.fill(0, 0, frames * 2); return; }
    live.rig.process(input, this.wet, frames);
    const k = 1 / (live.scale || LINE_SCALE);
    for (let i = 0; i < frames; i++) { const y = this.wet[i] * k; out[i * 2] = y; out[i * 2 + 1] = y; }
  }
}

/**
 * The desk at work. Each channel: its source (mono) times its gain, through its Shape, times its fader, panned
 * (equal power) into the mix; each send takes the channel after its fader into that aux bus. Mute and solo stop a
 * channel and its sends. Each return runs its effect on its bus and comes back into the mix on its own fader.
 * No allocation in `process` once the buffers have grown to the block size.
 */
export class Mixer {
  private desk: Desk = { channels: [], returns: [] };
  private readonly eqs = new Map<string, TsEq>();
  private readonly fx: (ReturnFx | null)[] = Array.from({ length: AUXES }, () => null);
  private strip = new Float32Array(256);
  private bus = Array.from({ length: AUXES }, () => new Float32Array(128));
  private wet = new Float32Array(256);
  constructor(private readonly sampleRate: number) {}

  set(desk: Desk) {
    this.desk = desk;
    for (const c of desk.channels) {
      let eq = this.eqs.get(c.id);
      if (!eq) { eq = new TsEq(this.sampleRate); this.eqs.set(c.id, eq); }
      eq.set(c.eq);
    }
    for (const id of this.eqs.keys()) if (!desk.channels.some((c) => c.id === id)) this.eqs.delete(id);
  }

  /** The effect on aux `aux` (1-based), or null for none (the return is silent). */
  setReturn(aux: number, fx: ReturnFx | null) { if (aux >= 1 && aux <= AUXES) this.fx[aux - 1] = fx; }
  returnFx(aux: number): ReturnFx | null { return this.fx[aux - 1] ?? null; }

  /**
   * Each channel's source by its id (mono, `frames` long; a missing one is silence) into `out`, interleaved stereo, written over.
   * `buses` runs once the channels have sent, before the returns play: each aux bus (mono), to read or add to
   * (the sesh's audio thread adds the tracks' aux 2 sends, and takes the players' Space sends).
   */
  process(inputs: ReadonlyMap<string, Float32Array>, out: Float32Array, frames: number, buses?: (bus: readonly Float32Array[]) => void) {
    if (this.strip.length < frames * 2) { this.strip = new Float32Array(frames * 2); this.wet = new Float32Array(frames * 2); this.bus = this.bus.map(() => new Float32Array(frames)); }
    out.fill(0, 0, frames * 2);
    for (const b of this.bus) b.fill(0, 0, frames);
    const on = audible(this.desk);
    this.desk.channels.forEach((c, ci) => {
      const src = inputs.get(c.id);
      if (!src || !on[ci]) return;
      const g = 10 ** (c.gain / 20), s = this.strip;
      for (let i = 0; i < frames; i++) { const x = (src[i] ?? 0) * g; s[i * 2] = x; s[i * 2 + 1] = x; }
      this.eqs.get(c.id)?.process(s, frames);
      const f = faderGain(c.fader), a = ((c.pan + 1) * Math.PI) / 4, pl = Math.cos(a) * Math.SQRT2, pr = Math.sin(a) * Math.SQRT2;
      for (let i = 0; i < frames; i++) {
        const l = s[i * 2] * f, r = s[i * 2 + 1] * f;
        out[i * 2] += l * pl; out[i * 2 + 1] += r * pr;
        const m = (l + r) * 0.5;
        for (let k = 0; k < AUXES; k++) if (c.sends[k]) this.bus[k][i] += m * c.sends[k];
      }
    });
    buses?.(this.bus);
    for (const r of this.desk.returns) {
      const fx = this.fx[r.aux - 1];
      if (!fx || r.mute) continue;
      fx.process(this.bus[r.aux - 1], this.wet, frames);
      const f = faderGain(r.fader);
      for (let i = 0; i < frames * 2; i++) out[i] += this.wet[i] * f;
    }
  }
}
