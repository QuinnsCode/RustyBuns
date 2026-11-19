// The audio thread. Owns one FmEngine (TS, or Rust compiled to wasm) and the
// sequencer that drives it. The page talks to it only through messages; the
// worklet keeps a mirror of every param so it can swap engines mid-groove.
import { TsEngine, sendTrackEq, type FmEngine } from "./engine.ts";
import { WasmEngine, WasmEq, WasmRemote, instantiateFm, type Exports } from "./wasm.ts";
import { TsRemote, type RemoteLine } from "./remote.ts";
import { TsEq, flatEq, withEqLane, type EqBand, type EqDoc, type EqListen, type EqStage } from "./eq.ts";
import { Delay, LinearEq } from "./linear.ts";
import { BEND, REPEAT, Sequencer } from "./sequencer.ts";
import { Space } from "./space.ts";
import { Squash } from "./squash.ts";
import { TRACKS, NPARAMS, P } from "./params.ts";
import { PluginRoute } from "./plugin-route.ts";
import { TAKE_RATE, TakeCapture, TakeDeck } from "../take.ts";
import { SOUND_FRAMES, gridBeatAt } from "../clock.ts";
import { AmpInserts } from "../amp/insert.ts";
import type { TrackAmp } from "../amp/track-amp.ts";
import { Mixer, RigReturn } from "../mixer.ts";
import type { FromWorklet, ToWorklet } from "./messages.ts";
import type { Lane } from "../project.ts";

declare const sampleRate: number;
declare class AudioWorkletProcessor { readonly port: MessagePort }
declare function registerProcessor(name: string, ctor: unknown): void;

const REPORT_EVERY = 1 / 30; // seconds

class FmProcessor extends AudioWorkletProcessor {
  private params = new Float64Array(TRACKS * NPARAMS);
  private muted = new Array<boolean>(TRACKS).fill(false);
  private master = 0;
  private engine: FmEngine = new TsEngine(sampleRate);
  private kind: "ts" | "rust" = "ts";
  /** Plugin tracks: their notes go to the host, their sound comes back in blocks (src/engine/plugin-route.ts). */
  private plugins = new PluginRoute(sampleRate);
  private seq = new Sequencer(this.wrapped(this.engine), sampleRate);
  private space = new Space(sampleRate);
  private squash = new Squash(sampleRate);
  /** The EQ as saved, and as it plays right now (with its automation on). */
  private eqDoc: EqDoc = flatEq();
  private eqPlayed: EqDoc = this.eqDoc;
  /** What the page was last told plays (null: the EQ as saved), so it hears only changes. */
  private eqShown: EqDoc | null = null;
  private eq: EqStage = new TsEq(sampleRate);
  /** Each track's Shape, the insert inside the engine, as saved. */
  private trackEq: EqDoc[] = Array.from({ length: TRACKS }, flatEq);
  private trackLast: EqBand[][] = Array.from({ length: TRACKS }, () => []);
  /** Shape's minimum-phase stage (TS or Rust) is kept while linear phase plays, so switching back is instant. */
  private minEq: EqStage = this.eq;
  private linear: LinearEq | null = null;
  /** Space's send, held back as long as the linear EQ holds the mix. */
  private sendDelay: Delay | null = null;
  private listening: EqListen | null = null;
  /** The output's own latency, from the page; the sequencer's is this plus the EQ's. */
  private outLatency = 0;
  private buf = new Float32Array(256);
  private send = new Float32Array(256);
  /** Each amped track's synth, tapped out of the engine for its amp (FmEngine.render's `taps`). */
  private taps = new Float32Array(256 * TRACKS);
  private meter = new Float32Array(4);
  private sinceReport = 0;
  /** The tracks' takes, played after the engine; and the input, recorded onto `armed` while recording. */
  private deck = new TakeDeck(TRACKS, sampleRate);
  private capture = new TakeCapture(sampleRate);
  private amps = new AmpInserts(TRACKS, sampleRate);
  /** The input heard through the armed track's amp: off until the player turns it on. */
  private monitor = false;
  private armed = -1;
  private inLatency = 0;
  private capturing = false;
  /** Whole passes recorded since Rec went on: once there is one, a pass cut short by Stop doesn't replace it. */
  private passes = 0;
  private mono = new Float32Array(256);
  /** The shared clock: sound at context time `gridCtx` is heard on `gridBeat` (NaN: none, the transport runs free). */
  private gridCtx = 0;
  private gridBeat = NaN;
  /** Frames rendered, for the context's time where the platform gives none (tests). */
  private frames = 0;
  /** Each other player's sound coming in, on its beats, one line per player and track (a guitar and a plugin apart). */
  private remotes = new Map<string, { line: RemoteLine; peer: number; track: number }>();
  private wasm: Exports | null = null;
  private far = new Float32Array(256);
  /** The sesh's desk beyond its tracks: the players' channels (by live-line number) and the aux 2 return, with its bus from the engine. */
  private desk = new Mixer(sampleRate);
  private deskOf = new Map<number, string>();
  private deskIn = new Map<string, Float32Array>();
  private deskFed = false;
  private deskOut = new Float32Array(256);
  private rig: RigReturn | null = null;
  private send2 = new Float32Array(256);
  private readonly buses = (bus: readonly Float32Array[]) => {
    const n = this.blockFrames, space = bus[0], aux2 = bus[1];
    if (this.deskFed) for (let f = 0; f < n; f++) { this.send[f * 2] += space[f]; this.send[f * 2 + 1] += space[f]; }
    if (this.rig) for (let f = 0; f < n; f++) aux2[f] += (this.send2[f * 2] + this.send2[f * 2 + 1]) * 0.5;
  };
  private blockFrames = 0;
  private blockBeat = 0;
  private blockBpf = 0;
  /** The remote sound bound for amped tracks, as the Amp inserts ask for it. */
  private remoteIn = {
    has: (t: number) => { for (const r of this.remotes.values()) if (r.track === t) return true; return false; },
    add: (t: number, dry: Float32Array, n: number) => { this.remoteInto(t, dry, n, this.blockBeat, this.blockBpf); },
  };
  /** Your input going out in slices, each stamped with its beat. */
  private sending = false;
  private sendLatency = 0;
  private input = new Slicer();
  /** Plugin tracks whose sound goes to the sesh too, at their fader, cut the same way (src/studio/plugin-line.ts). */
  private pluginOut = new Map<number, Slicer>();

  constructor() {
    super();
    this.engine.setMaster(0);
    this.seq.onRecord = (r) => this.port.postMessage({ t: "rec", ...r });
    this.seq.onMove = (r) => this.port.postMessage({ t: "move", ...r });
    this.seq.onEq = (i, v) => { const d = withEqLane(this.eqPlayed, i, v); if (d !== this.eqPlayed) { this.eqPlayed = d; this.eq.set(d); } };
    this.port.onmessage = (e: MessageEvent<ToWorklet>) => { void this.handle(e.data); };
  }

  private async handle(m: ToWorklet) {
    const s = this.seq;
    switch (m.t) {
      case "load":
        m.params.forEach((v, i) => { this.params[i] = v; this.engine.setParam((i / NPARAMS) | 0, i % NPARAMS, v); });
        m.notes.forEach((n, t) => s.setNotes(t, n));
        m.auto.forEach((a, t) => s.setAuto(t, a));
        s.bpm = m.bpm; s.setSwing(m.swing); s.setLoopBeats(m.loopBeats);
        this.setAudible(m.audible);
        this.space.setTempo(m.bpm); this.space.setAmount(m.space);
        this.squash.setAmount(m.squash);
        this.setEq(m.eq, m.eqAuto);
        m.trackEq.forEach((d, t) => this.setTrackEq(t, d));
        this.setLinear(m.eqLinear);
        m.amps.forEach((a, t) => this.setAmp(t, a));
        m.plugins.forEach((on, t) => this.plugins.set(t, on));
        break;
      case "param":
        this.params[m.track * NPARAMS + m.i] = m.v;
        this.engine.setParam(m.track, m.i, m.v);
        break;
      case "plugin": this.plugins.set(m.track, m.on); break;
      case "pluginParam": this.plugins.param(m.track, m.id, m.v); break;
      case "pluginBlock": this.plugins.push(m.track, m.pcm, m.ok); break;
      case "notes": s.setNotes(m.track, m.notes); break;
      case "auto": s.setAuto(m.track, m.lanes); break;
      case "audible": this.setAudible(m.mask); break;
      case "tempo": s.bpm = m.bpm; s.setSwing(m.swing); s.setLoopBeats(m.loopBeats); this.space.setTempo(m.bpm); break;
      case "space": this.space.setAmount(m.amount); break;
      case "squash": this.squash.setAmount(m.amount); break;
      case "eq": this.setEq(m.bands, m.lanes); break;
      case "trackEq": this.setTrackEq(m.track, m.bands); break;
      case "eqListen": this.listening = m.band; this.eq.listen(m.band); break;
      case "eqPhase": this.setLinear(m.linear); break;
      case "master": this.master = m.gain; this.engine.setMaster(m.gain); break;
      case "play": s.play(m.countIn); break;
      case "stop": this.endTake(); s.stop(); this.engine.allOff(); this.plugins.allOff(); break;
      case "rec": s.recording = m.on; this.endTake(); this.passes = 0; if (!m.on) s.untouch(); break;
      case "take": this.deck.set(m.track, m.pcm, m.beat); break;
      case "amp": this.setAmp(m.track, m.amp); break;
      case "monitor": this.monitor = m.on; break;
      case "arm": this.endTake(); this.passes = 0; this.monitor = false; this.armed = m.track; this.inLatency = m.inLatency; break;
      case "metro": s.metronome = m.on; break;
      case "latency": this.outLatency = m.seconds; this.setLatency(); break;
      case "on": s.liveOn(m.track, m.midi, m.vel, m.rec ?? true); break;
      case "off": s.liveOff(m.track, m.midi); break;
      case "panic": s.stop(); s.setRepeat(0); this.engine.panic(); this.plugins.allOff(); this.space.reset(); this.squash.reset(); this.eq.reset(); this.sendDelay?.reset(); break;
      case "bend": s.liveBend(m.track, m.semis); break;
      case "repeat": s.setRepeat(m.beats); break;
      case "move": s.move(m.track, m.i, m.v, m.was); break;
      case "engine": await this.swap(m); break;
      case "grid": this.gridCtx = m.ctx; this.gridBeat = m.beat ?? NaN; if (m.beat === null) s.sync(NaN); break;
      case "due": s.liveAt(m.at, m.track, m.midi, m.vel); break;
      case "dueBend": s.liveAt(m.at, m.track, BEND, m.semis); break;
      case "dueRepeat": s.liveAt(m.at, 0, REPEAT, m.beats); break;
      case "sound": this.hearSound(m.peer, m.track, m.at, m.pcm); break;
      case "desk": this.setDesk(m); break;
      case "quiet": this.quiet(m.peer, m.track); break;
      case "send": this.sending = m.on; this.sendLatency = m.inLatency; this.input.reset(); break;
      case "pluginSend": if (!m.on) this.pluginOut.delete(m.track); else if (!this.pluginOut.has(m.track)) this.pluginOut.set(m.track, new Slicer(m.track)); break;
    }
  }

  /** Samples a beat at TAKE_RATE, at the sesh's tempo: what a remote line plays at before it fits the far end. */
  private nominal() { return (TAKE_RATE * 60) / this.seq.bpm; }

  private hearSound(peer: number, track: number, at: number, pcm: Float32Array) {
    const key = `${peer}:${track}`;
    let r = this.remotes.get(key);
    if (!r) { r = { line: this.newRemote(), peer, track }; this.remotes.set(key, r); }
    r.line.setNominal(this.nominal());
    r.line.push(at, pcm);
  }
  /** Their sound into `track` stopped (every track's, with none): what's buffered goes. */
  private quiet(peer: number, track?: number) {
    for (const [k, r] of this.remotes) if (r.peer === peer && (track === undefined || r.track === track)) { r.line.free?.(); this.remotes.delete(k); }
  }
  private newRemote(): RemoteLine { return this.wasm ? new WasmRemote(this.wasm, this.nominal()) : new TsRemote(this.nominal()); }

  /** Where the shared clock says this block is heard, abs beats; NaN with no clock. */
  private gridNow(): number {
    if (!Number.isFinite(this.gridBeat)) return NaN;
    const t = Reflect.get(globalThis, "currentTime");
    const now = typeof t === "number" ? t : this.frames / sampleRate;
    return gridBeatAt(this.gridBeat, this.gridCtx, now, this.seq.bpm);
  }

  /** The engine as the sequencer plays it: plugin tracks' notes to their plugins, and a lane's moves kept, so a plugin track's strip follows them. */
  private wrapped(engine: FmEngine): FmEngine {
    return this.plugins.wrap(engine, (t, i, v) => { if (t >= 0 && t < TRACKS && i >= 0 && i < NPARAMS) this.params[t * NPARAMS + i] = v; });
  }

  private fader = (t: number) => this.muted[t] ? 0 : this.params[t * NPARAMS + P.GAIN];
  /** A plugin track's strip: the track's own fader (under the room's master), PAN and SEND. */
  private strip = {
    gain: (t: number) => this.fader(t) * this.master,
    pan: (t: number) => this.params[t * NPARAMS + P.PAN],
    send: (t: number) => this.params[t * NPARAMS + P.SEND],
  };

  /** Each plugin track down its strip into the mix and the Space send, then asks the host for what comes next. */
  private mixPlugins(frames: number, beat0: number, bpf: number) {
    const fader = this.fader;
    // a track going to the sesh too: its sound at its fader, on the beat it's heard on here (nobody played it in late)
    const tap = this.pluginOut.size ? (t: number, mono: Float32Array, n: number) => this.pluginOut.get(t)?.push(mono, fader(t), n, beat0, bpf, this.port) : undefined;
    this.plugins.mix(this.buf, frames, this.strip, this.send, tap);
    for (const a of this.plugins.asks()) this.port.postMessage({ t: "pluginAsk", ...a } satisfies FromWorklet);
  }

  /** The page's own plugins (Web Audio Modules, src/ui/wam.ts), each already at its track's fader, under the room's master. */
  private mixWeb(bus: Float32Array[] | undefined, frames: number) {
    const l = bus?.[0], r = bus?.[1] ?? l;
    if (!l || !r) return;
    for (let f = 0; f < frames; f++) { this.buf[f * 2] += l[f] * this.master; this.buf[f * 2 + 1] += r[f] * this.master; }
  }

  /** The players' channels and the aux 2 return as the page worked them out; a new rig only when gear is first cabled in. */
  private setDesk(m: Extract<ToWorklet, { t: "desk" }>) {
    this.desk.set({ channels: m.players.map((p) => p.channel), returns: [{ aux: 2, name: "Aux 2", fx: "cabled", fader: m.aux2.fader, mute: m.aux2.mute }] });
    this.deskOf.clear();
    for (const p of m.players) this.deskOf.set(p.peer, p.channel.id);
    for (const id of this.deskIn.keys()) if (!m.players.some((p) => p.channel.id === id)) this.deskIn.delete(id);
    for (const p of m.players) if (!this.deskIn.has(p.channel.id)) this.deskIn.set(p.channel.id, new Float32Array(this.far.length));
    if (!m.aux2.gear) this.rig = null;
    else if (this.rig) this.rig.set(m.aux2.gear);
    else this.rig = new RigReturn(sampleRate, m.aux2.gear);
    this.desk.setReturn(2, this.rig);
  }

  /**
   * Everyone else's sound for this block, from beat `beat0`: through its track's amp when it has one, else onto its
   * player's channel on the desk (or straight in, for a player the desk has no channel for yet).
   */
  private mixRemote(frames: number, beat0: number, bpf: number) {
    this.deskFed = false;
    for (const [id, b] of this.deskIn) { if (b.length < frames) this.deskIn.set(id, new Float32Array(frames)); else b.fill(0, 0, frames); }
    if (!this.remotes.size) return;
    if (this.far.length < frames) this.far = new Float32Array(frames);
    for (const r of this.remotes.values()) {
      if ((r.track >= 0 && (this.muted[r.track] || this.amps.has(r.track)))) continue;
      const id = this.deskOf.get(r.peer), strip = id === undefined ? undefined : this.deskIn.get(id);
      if (strip) { r.line.mix(strip, frames, beat0, bpf, this.master); this.deskFed = true; continue; }
      this.far.fill(0, 0, frames);
      r.line.mix(this.far, frames, beat0, bpf, this.master);
      for (let f = 0; f < frames; f++) { this.buf[f * 2] += this.far[f]; this.buf[f * 2 + 1] += this.far[f]; }
    }
  }
  /** The desk beyond the tracks into the mix: the players' channels, their sends into Space, and the aux 2 return over the tracks' sends and theirs. */
  private mixDesk(frames: number) {
    if (!this.deskFed && !this.rig) return;
    if (this.deskOut.length < frames * 2) this.deskOut = new Float32Array(frames * 2);
    this.blockFrames = frames;
    this.desk.process(this.deskIn, this.deskOut, frames, this.buses);
    for (let f = 0; f < frames * 2; f++) this.buf[f] += this.deskOut[f];
  }
  /** The remote sound bound for track `t`'s amp, added into its dry input. */
  private remoteInto(t: number, dry: Float32Array, frames: number, beat0: number, bpf: number) {
    for (const r of this.remotes.values()) if (r.track === t) r.line.mix(dry, frames, beat0, bpf, 1);
  }

  /** Your input into slices of SOUND_FRAMES (at TAKE_RATE), each stamped with the beat you heard as you played it. */
  private sendSlices(input: Float32Array[] | undefined, frames: number, beat0: number, bpf: number) {
    const back = (this.seq.latency + this.sendLatency) * (this.seq.bpm / 60);
    this.input.push(this.downmix(input, frames), 1, frames, beat0 - back, bpf, this.port);
  }

  /** The pass recorded so far goes to the page, which puts it on the track. */
  private endTake(whole = false) {
    const pcm = this.capture.take();
    this.capturing = false;
    if (whole) this.passes++;
    else if (this.passes > 0) return;
    if (pcm && this.armed >= 0) this.port.postMessage({ t: "taken", track: this.armed, beat: this.capture.beat, pcm, rate: sampleRate }, [pcm.buffer]);
  }

  /** The input onto the armed track: from the beat the player heard when it came in, one loop's pass at a time. */
  private record(input: Float32Array[] | undefined, frames: number, pos: number) {
    const s = this.seq, L = s.loopBeats;
    const mono = this.downmix(input, frames);
    if (!this.capturing) {
      this.capturing = true;
      const back = (s.latency + this.inLatency) * (s.bpm / 60);
      this.capture.beat = (((pos - back) % L) + L) % L;
    }
    if (this.capture.push(mono, frames, (L * 60) / s.bpm)) this.endTake(true);
  }

  /** The input's channels as one, in `mono`. */
  private downmix(input: Float32Array[] | undefined, frames: number): Float32Array {
    if (this.mono.length < frames) this.mono = new Float32Array(frames);
    const mono = this.mono;
    mono.fill(0, 0, frames);
    const chans = input?.length ?? 0;
    for (let c = 0; c < chans; c++) { const x = input![c]; for (let f = 0; f < frames; f++) mono[f] += x[f] / chans; }
    return mono;
  }

  private setAudible(mask: boolean[]) {
    for (let t = 0; t < TRACKS; t++) this.muted[t] = !mask[t];
    this.seq.setAudible(mask);
  }

  /** A new EQ or new lanes: play it as saved until the lanes move it on the next tick. */
  private setEq(doc: EqDoc, lanes: Lane[]) {
    this.eqDoc = this.eqPlayed = doc;
    this.eq.set(doc);
    this.seq.setEqAuto(lanes);
  }

  private setTrackEq(t: number, doc: EqDoc) {
    if (t < 0 || t >= TRACKS) return;
    this.trackEq[t] = doc;
    sendTrackEq(this.engine, t, doc, this.trackLast[t]);
    this.plugins.shape(t, doc);
  }

  /**
   * Linear phase on or off. It runs in TypeScript whichever engine plays; the delay
   * changes, so the old tail is dropped rather than doubled.
   */
  private setLinear(on: boolean) {
    if (on === !!this.linear) return;
    if (on) {
      const lin = new LinearEq(sampleRate);
      lin.set(this.eqPlayed); lin.listen(this.listening); lin.reset();
      this.linear = lin; this.eq = lin;
      this.sendDelay = new Delay(lin.latency);
    } else {
      this.linear = null; this.sendDelay = null;
      this.eq = this.minEq;
      this.eq.set(this.eqPlayed); this.eq.listen(this.listening); this.eq.reset();
    }
    this.space.reset();
    this.setLatency();
  }

  /** What the player hears is late by the output and the EQ: a key played along lands where they heard it. */
  /** A track's amp, and its synth tapped out of the engine's sum to play through it. */
  private setAmp(t: number, amp: TrackAmp | null) {
    this.amps.set(t, amp);
    this.engine.setTap(t, this.amps.has(t));
  }

  private setLatency() { this.seq.latency = this.outLatency + (this.eq.latency ?? 0) / sampleRate; }

  private async swap(m: Extract<ToWorklet, { t: "engine" }>) {
    try {
      // the engine and Shape come from the same wasm instance, or are both TypeScript
      const x = m.kind === "rust" && m.bytes ? await instantiateFm(m.bytes) : null;
      const next: FmEngine = x ? new WasmEngine(x, sampleRate) : new TsEngine(sampleRate);
      const eq: EqStage = x ? new WasmEq(x, sampleRate) : new TsEq(sampleRate);
      eq.set(this.eqPlayed);
      eq.listen(this.listening);
      for (let i = 0; i < this.params.length; i++) next.setParam((i / NPARAMS) | 0, i % NPARAMS, this.params[i]);
      for (let t = 0; t < TRACKS; t++) { next.setMute(t, this.muted[t]); next.setBend(t, this.seq.bends[t]); next.setTap(t, this.amps.has(t)); }
      next.setMaster(this.master);
      // a new engine starts with every insert where it is now, not fading in
      this.trackEq.forEach((d, t) => sendTrackEq(next, t, d, []));
      next.panic();
      const old = this.engine;
      this.engine = next;
      this.seq.engine = this.wrapped(next);
      this.seq.resendAuto();
      this.kind = m.kind;
      this.wasm = x;
      // every remote line starts again in the new engine (a moment of their sound is lost)
      for (const r of this.remotes.values()) r.line.free?.();
      this.remotes.clear();
      old.panic();
      old.free?.();
      const oldEq = this.minEq;
      this.minEq = eq;
      if (!this.linear) this.eq = eq;
      oldEq.free?.();
      this.port.postMessage({ t: "engine", kind: this.kind });
    } catch (e) {
      this.port.postMessage({ t: "engine", kind: this.kind, error: String((e as Error)?.message ?? e) });
    }
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0];
    const L = out[0], R = out[1] ?? out[0];
    const frames = L.length;
    if (this.buf.length < frames * 2) { this.buf = new Float32Array(frames * 2); this.send = new Float32Array(frames * 2); this.send2 = new Float32Array(frames * 2); this.taps = new Float32Array(frames * TRACKS); }
    try {
      const grid = this.gridNow();
      if (Number.isFinite(grid)) this.seq.sync(grid);
      const pos = this.seq.pos, playing = this.seq.playing, abs0 = this.seq.abs;
      const bpf = (this.seq.bpm / 60 / sampleRate) * this.seq.rate;
      // with no amp on any track, no taps: every track stays in the engine's sum
      const taps = this.amps.any ? this.taps : undefined;
      this.seq.process(this.buf, frames, this.send, taps, this.rig ? this.send2 : undefined);
      const hear = this.monitor && this.armed >= 0 && this.amps.has(this.armed) ? { track: this.armed, input: this.downmix(inputs[0], frames) } : undefined;
      this.blockBeat = abs0; this.blockBpf = bpf;
      this.amps.mix(this.deck, this.buf, frames, pos, this.seq.bpm, this.seq.loopBeats, (t) => !this.muted[t], this.master, playing, hear, taps, this.remotes.size ? this.remoteIn : undefined);
      this.mixRemote(frames, abs0, bpf);
      this.mixDesk(frames);
      if (this.plugins.any) this.mixPlugins(frames, abs0, bpf);
      this.mixWeb(inputs[1], frames);
      if (this.sending) this.sendSlices(inputs[0], frames, abs0, bpf);
      if (playing && this.seq.recording && this.armed >= 0) this.record(inputs[0], frames, pos);
      this.eq.process(this.buf, frames);
      this.sendDelay?.process(this.send, frames);
      this.squash.process(this.buf, frames);
      this.space.process(this.buf, this.send, frames);
    } catch (e) {
      // A trapped wasm engine: fall back to TS rather than go silent for good.
      this.buf.fill(0);
      if (this.kind === "rust") void this.swap({ t: "engine", kind: "ts" });
      this.port.postMessage({ t: "engine", kind: "ts", error: `engine crashed: ${String((e as Error)?.message ?? e)}` });
    }
    for (let f = 0; f < frames; f++) { L[f] = this.buf[f * 2]; R[f] = this.buf[f * 2 + 1]; }
    this.frames += frames;
    this.sinceReport += frames / sampleRate;
    if (this.sinceReport >= REPORT_EVERY) {
      this.sinceReport = 0;
      this.engine.meter(this.meter);
      this.port.postMessage({
        t: "tick", pos: this.seq.pos, abs: this.seq.abs, synced: this.seq.synced, late: [...this.remotes.values()].reduce((n, r) => n + r.line.late, 0), playing: this.seq.playing, countIn: this.seq.countIn,
        peakL: this.meter[0], peakR: this.meter[1], minGain: this.meter[2], nans: this.meter[3], ampMisses: this.amps.misses, pluginMisses: this.plugins.misses,
      });
      const shown = this.eqPlayed === this.eqDoc ? null : this.eqPlayed;
      if (shown !== this.eqShown) { this.eqShown = shown; this.port.postMessage({ t: "eqPlayed", doc: shown }); }
    }
    return true;
  }
}

/**
 * Sound for the sesh cut into slices of SOUND_FRAMES (at TAKE_RATE), each stamped with the beat its first frame is
 * heard on: your input (no track), or a plugin track's own sound (its track, so the page knows which line it is).
 */
class Slicer {
  private slice = new Float32Array(0);
  private len = 0;
  private beat = 0;
  constructor(private readonly track?: number) {}
  reset() { this.len = 0; }
  push(mono: Float32Array, gain: number, frames: number, beat0: number, bpf: number, port: MessagePort) {
    const want = Math.round((SOUND_FRAMES * sampleRate) / TAKE_RATE);
    if (this.slice.length !== want) { this.slice = new Float32Array(want); this.len = 0; }
    for (let f = 0; f < frames; f++) {
      if (this.len === 0) this.beat = beat0 + f * bpf;
      this.slice[this.len++] = mono[f] * gain;
      if (this.len === want) {
        const pcm = this.slice;
        port.postMessage({ t: "sound", beat: this.beat, pcm, rate: sampleRate, ...(this.track === undefined ? {} : { track: this.track }) } satisfies FromWorklet, [pcm.buffer]);
        this.slice = new Float32Array(want);
        this.len = 0;
      }
    }
  }
}

registerProcessor("fm-daw", FmProcessor);
