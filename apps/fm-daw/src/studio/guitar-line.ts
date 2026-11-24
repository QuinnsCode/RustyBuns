// The jam room's guitars, the browser half of src/guitar.ts: your input out to each listener who asks, each player's
// in from them, and every guitar (yours too, so you hear what they hear) through its track's amp on Q Amp's audio
// thread, then your mutes, then placed where its player stands. Signals go through the sesh's World (`send`).
// Over budget (src/guitar.ts sendWet), a guitar coming in is asked for wet: its player swaps their amp's output onto
// that call (replaceTrack, no new offer) and its amp here is bypassed.
// A call plays outside FM DAW's audio thread, where the sesh's desk is. So each guitar's chain follows its player's
// channel on that desk from here: `desk` sets its level (gain, fader, mute, solo), and `sendsTo` taps it after that
// level into the audio thread's aux buses, where Space and the aux 2 return play what the channel sends them.
import ampWorkletUrl from "../amp/worklet.ts?worker&url";
import shapeWorkletUrl from "./shape-worklet.ts?worker&url";
import type { EqDoc } from "../engine/eq.ts";
import type { AmpSettings, ToAmp } from "../amp/messages.ts";
import { getJson } from "@rustybuns/util/http";
import { check, num, obj, oneOf } from "@rustybuns/util/guard";
import { limiter, PEER_DEFAULT } from "./limiter.ts";
import { IceReply, lagMs, otherEnd, OVER_S, sendWet, STUN, tuneOpus, type IceServer, type Lag, type Line, type RtcServer, type Signal } from "../guitar.ts";

/**
 * The servers a call may use, from the Worker's GET /ice: STUN to find each end's address, and a TURN relay for two
 * players whose networks both refuse a direct path. No answer (the desktop host has no /ice), STUN alone.
 */
export const askIce = async (): Promise<IceReply> => (await getJson("/ice", IceReply)) ?? { iceServers: STUN, ttl: 0 };
/** Opus's ceiling for the guitar, bits a second (tuneOpus asks the far end for the same). */
const BITRATE = 128_000;

/**
 * One guitar's sound here: its dry input, the amp, its level (your mute times its channel on the desk), its aux sends
 * taken after that level, and where it stands (yours isn't placed).
 */
interface Chain { src: MediaStreamAudioSourceNode | null; amp: AudioWorkletNode; shape: AudioWorkletNode; gain: GainNode; sends: GainNode[]; pan: PannerNode | null; limit: ReturnType<typeof limiter> | null; settings: string; asked: AmpSettings | null; level: number; strip: Strip; tag: HTMLAudioElement | null; tap: MediaStreamAudioDestinationNode | null }
/** A channel as a call plays it (src/desk.ts `callStrip`): its level, each aux send 0 to 1, and its Shape (left out: flat). */
export interface Strip { level: number; sends: number[]; eq?: EqDoc }
const PLAIN: Strip = { level: 1, sends: [] };
/** The part of an amp's meter (src/amp/messages.ts FromAmp) the budget reads: its share of the audio thread. */
const Meter = obj({ t: oneOf(["meter"]), load: num(0, Infinity) });
/** One call: your guitar out to `peer`, or theirs in. Candidates that come before the far end's description wait. */
interface Call { pc: RTCPeerConnection; peer: number; line: Line; early: RTCIceCandidateInit[]; held: { delay: number; count: number } }

export type Who = number | "me";

export class GuitarLine {
  private calls = new Map<string, Call>();
  private chains = new Map<Who, Chain>();
  private mine: MediaStream | null = null;
  /** Whose guitar's call couldn't get through (no path between the two networks): asked again when they plug in again. */
  private failed = new Set<number>();
  private ready: Promise<void>;
  /** The servers for new calls, and when to ask for them again (a TURN pass runs out; a call already up keeps going). */
  private ice: Promise<IceServer[]> | null = null;
  private iceUntil = 0;
  /** Each amp's share of the audio thread here, its incoming guitars heard as their player's amp output, and since when it's been over. */
  private loads = new Map<Who, number>();
  private wet = new Set<number>();
  private overSince: number | null = null;
  /** Where every chain's aux sends go: one input of the desk's audio thread, a channel per aux. Null: no desk, no sends. */
  private buses: ChannelMergerNode | null = null;
  /** Each player's channel as last set, kept for a chain that comes up after it (a call still connecting). */
  private strips = new Map<Who, Strip>();
  /** `to` is where every guitar ends up: the speakers, or a meter in a test. `servers` says which servers a call may use. */
  /** The listener's ceiling for anyone else's guitar, dBFS (limiter.ts). */
  private peerDb = PEER_DEFAULT;
  constructor(private ctx: AudioContext, private send: (to: number, line: Line, s: Signal) => void, private to: AudioNode = ctx.destination, private servers: () => Promise<IceReply> = askIce) {
    this.ready = Promise.all([ctx.audioWorklet.addModule(ampWorkletUrl), ctx.audioWorklet.addModule(shapeWorkletUrl)]).then(() => {});
    void this.iceServers();
  }

  /** Asked once and kept until half its pass is gone; a reply with no ttl (STUN alone) is asked again in a minute. */
  private iceServers(): Promise<IceServer[]> {
    if (!this.ice || Date.now() > this.iceUntil) {
      this.iceUntil = Date.now() + 60_000;
      this.ice = this.servers().then((r) => {
        if (r.ttl > 0) this.iceUntil = Date.now() + (r.ttl * 1000) / 2;
        return r.iceServers;
      }, () => STUN);
    }
    return this.ice;
  }

  /**
   * The aux sends of every guitar go into `node`'s input `input`, a channel per aux in order (FM DAW's audio thread,
   * src/ui/audio.ts CALL_SENDS). Each is the guitar after its level, so a muted channel sends nothing.
   */
  sendsTo(node: AudioNode, input: number, auxes: number) {
    this.buses = new ChannelMergerNode(this.ctx, { numberOfInputs: auxes });
    this.buses.connect(node, 0, input);
  }
  /** `who`'s channel on the desk: how loud its chain plays, and what it sends to each aux. */
  desk(who: Who, strip: Strip) {
    const was = this.strips.get(who);
    if (was && was.level === strip.level && was.sends.join() === strip.sends.join() && JSON.stringify(was.eq) === JSON.stringify(strip.eq)) return;
    this.strips.set(who, strip);
    const c = this.chains.get(who);
    if (c) this.play(c, strip);
  }
  private play(c: Chain, strip: Strip) {
    if (JSON.stringify(c.strip.eq) !== JSON.stringify(strip.eq) || c.strip === PLAIN) c.shape.port.postMessage(strip.eq ?? []);
    c.strip = strip;
    c.gain.gain.setTargetAtTime(c.level * strip.level, this.ctx.currentTime, 0.02);
    c.sends.forEach((s, i) => s.gain.setTargetAtTime(strip.sends[i] ?? 0, this.ctx.currentTime, 0.02));
  }

  get plugged() { return !!this.mine; }
  /** Whether a call bringing `peer`'s guitar in is up or on its way. */
  hearing(peer: number) { return this.calls.has(key(peer, "in")); }

  /** Your guitar in: you hear it here through its amp, and anyone who asks gets a call. */
  async plugIn(stream: MediaStream) {
    this.unplug();
    this.mine = stream;
    await this.chain("me", stream);
  }
  /** Your guitar out: every call carrying it hangs up. */
  unplug() {
    for (const c of [...this.calls.values()]) if (c.line === "out") this.hang(c);
    this.drop("me");
    for (const t of this.mine?.getTracks() ?? []) t.stop();
    this.mine = null;
  }
  /** Ask `peer` (who said their guitar is in) to call you. */
  ask(peer: number) { if (!this.hearing(peer)) { this.failed.delete(peer); this.send(peer, "in", { k: "want" }); } }
  /** Their guitar came out: its call and its sound go. */
  stopHearing(peer: number) { const c = this.calls.get(key(peer, "in")); if (c) this.hang(c); this.drop(peer); this.wet.delete(peer); }
  /** Hear `peer`'s guitar as their amp's output: they run the circuit, and its amp here stands aside. */
  wetFrom(peer: number) {
    if (this.wet.has(peer) || !this.hearing(peer)) return;
    this.wet.add(peer);
    this.send(peer, "in", { k: "wet" });
    const c = this.chains.get(peer);
    if (c?.asked) { c.settings = ""; this.set(peer, c.asked); }
  }
  /** They left: every call with them goes. */
  gone(peer: number) { const c = this.calls.get(key(peer, "out")); if (c) this.hang(c); this.stopHearing(peer); }

  /** A signal from the World. The line is the sender's side, so the call here is the other end of it. */
  async signal(m: RtcServer) {
    // every signal waits on the same answer, so they keep their order: a call is set up before its candidates arrive
    const ice = await this.iceServers();
    const { from, s } = m, here = otherEnd(m.line);
    if (s.k === "want") { if (here === "out" && this.mine) await this.callOut(from, ice); return; }
    if (s.k === "wet") { if (here === "out") await this.goWet(from); return; }
    if (s.k === "sdp" && s.type === "offer" && here === "in") return this.answer(from, s.sdp, ice);
    const c = this.calls.get(key(from, here));
    if (!c) return;
    if (s.k === "sdp" && s.type === "answer" && here === "out") {
      await c.pc.setRemoteDescription({ type: "answer", sdp: s.sdp });
      for (const x of c.early.splice(0)) await c.pc.addIceCandidate(x).catch(() => {});
      return;
    }
    if (s.k === "ice") {
      const cand: RTCIceCandidateInit = { candidate: s.candidate, sdpMid: s.mid || null, sdpMLineIndex: s.index };
      if (c.pc.remoteDescription) await c.pc.addIceCandidate(cand).catch(() => {});
      else c.early.push(cand);
    }
  }

  /** What `who`'s guitar plays through (a new amp or knob is sent on; the same settings are not). */
  set(who: Who, settings: AmpSettings) {
    const c = this.chains.get(who);
    if (!c) return;
    c.asked = settings;
    // a guitar coming in wet went through its player's amp already
    const run = typeof who === "number" && this.wet.has(who) ? { ...settings, bypass: true } : settings, k = JSON.stringify(run);
    if (c.settings === k) return;
    c.settings = k;
    c.amp.port.postMessage({ t: "set", settings: run } satisfies ToAmp);
  }
  /** The loudest anyone else's guitar may be for you, dBFS: each one's own limiter, after its level. */
  ceiling(db: number) {
    this.peerDb = db;
    for (const c of this.chains.values()) c.limit?.set(db);
  }
  /** How loud `who` is for you: 0 muted, 1 as played. */
  level(who: Who, g: number) {
    const c = this.chains.get(who);
    if (!c || c.level === g) return;
    c.level = g;
    c.gain.gain.setTargetAtTime(g * c.strip.level, this.ctx.currentTime, 0.02);
  }
  /** Where `who` stands (x, z, the floor's metres; their guitar at waist height). */
  place(who: Who, x: number, z: number) {
    const p = this.chains.get(who)?.pan;
    if (!p) return;
    p.positionX.value = x; p.positionY.value = 1; p.positionZ.value = z;
  }
  /** Where you are and which way you face (yaw 0 looks down -z). */
  listen(x: number, z: number, yaw: number) {
    const l = this.ctx.listener;
    if (!l.positionX) return;
    l.positionX.value = x; l.positionY.value = 1.6; l.positionZ.value = z;
    l.forwardX.value = -Math.sin(yaw); l.forwardY.value = 0; l.forwardZ.value = -Math.cos(yaw);
    l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0;
  }

  /**
   * How far behind each incoming guitar is, in milliseconds (null while its call connects, "failed" when it couldn't). The jitter buffer is
   * the samples it held since the last ask, so a slow start to the call stops counting once it's past.
   */
  async lags(): Promise<Map<number, Lag>> {
    const out = new Map<number, Lag>();
    for (const p of this.failed) out.set(p, "failed");
    for (const c of this.calls.values()) {
      if (c.line !== "in") continue;
      let rtt: number | undefined, jitterBuffer: number | undefined;
      const stats = await c.pc.getStats().catch(() => null);
      stats?.forEach((r: unknown) => {
        if (!r || typeof r !== "object" || !("type" in r)) return;
        if (r.type === "candidate-pair" && "nominated" in r && r.nominated && "currentRoundTripTime" in r && typeof r.currentRoundTripTime === "number") rtt = r.currentRoundTripTime * 1000;
        if (r.type === "inbound-rtp" && "jitterBufferDelay" in r && "jitterBufferEmittedCount" in r && typeof r.jitterBufferDelay === "number" && typeof r.jitterBufferEmittedCount === "number") {
          const delay = r.jitterBufferDelay - c.held.delay, count = r.jitterBufferEmittedCount - c.held.count;
          if (count > 0) jitterBuffer = (delay / count) * 1000;
          c.held = { delay: r.jitterBufferDelay, count: r.jitterBufferEmittedCount };
        }
      });
      out.set(c.peer, lagMs({ rtt, jitterBuffer }));
    }
    return out;
  }
  /** The calls as data, for the harness: each one's peer, side and connection state. */
  state() { return [...this.calls.values()].map((c) => ({ peer: c.peer, line: c.line, state: c.pc.connectionState, wet: c.line === "in" && this.wet.has(c.peer) })); }

  /** An amp's meter: over budget for OVER_S, the heaviest guitar coming in still dry goes wet. */
  private metered(who: Who, v: unknown) {
    const m = check(Meter, v);
    if (!m || !this.chains.has(who)) return;
    this.loads.set(who, m.load);
    const now = this.ctx.currentTime, pick = sendWet(this.loads, this.wet);
    if (pick === null) { this.overSince = null; return; }
    this.overSince ??= now;
    if (now - this.overSince < OVER_S) return;
    this.overSince = null;
    this.wetFrom(pick);
  }
  /** A listener asked for your amp's output: it goes out on their call in place of your dry input. */
  private async goWet(peer: number) {
    const c = this.calls.get(key(peer, "out")), me = this.chains.get("me");
    if (!c || !me) return;
    if (!me.tap) {
      me.tap = new MediaStreamAudioDestinationNode(this.ctx, { channelCount: 1, channelCountMode: "explicit" });
      me.amp.connect(me.tap);
    }
    const track = me.tap.stream.getAudioTracks()[0];
    for (const tx of c.pc.getSenders()) if (tx.track?.kind === "audio") await tx.replaceTrack(track).catch(() => {});
  }

  private async callOut(peer: number, ice: IceServer[]) {
    const was = this.calls.get(key(peer, "out"));
    if (was) this.hang(was);
    const c = this.call(peer, "out", ice);
    for (const t of this.mine?.getAudioTracks() ?? []) {
      const tx = c.pc.addTransceiver(t, { direction: "sendonly", streams: [this.mine!] });
      const p = tx.sender.getParameters();
      if (p.encodings?.length) { p.encodings[0].maxBitrate = BITRATE; p.encodings[0].priority = "high"; p.encodings[0].networkPriority = "high"; }
      await tx.sender.setParameters(p).catch(() => {});
    }
    const offer = await c.pc.createOffer();
    const sdp = tuneOpus(offer.sdp ?? "");
    await c.pc.setLocalDescription({ type: "offer", sdp });
    this.send(peer, "out", { k: "sdp", type: "offer", sdp });
  }

  private async answer(peer: number, offer: string, ice: IceServer[]) {
    const was = this.calls.get(key(peer, "in"));
    if (was) this.hang(was);
    const c = this.call(peer, "in", ice);
    // a new call from them starts dry
    this.wet.delete(peer);
    c.pc.ontrack = (e) => {
      // as little waiting as the network lets it: the jitter buffer is most of the lag on a good line
      for (const f of ["jitterBufferTarget", "playoutDelayHint"]) if (f in e.receiver) Reflect.set(e.receiver, f, 0);
      void this.chain(peer, e.streams[0] ?? new MediaStream([e.track]));
    };
    await c.pc.setRemoteDescription({ type: "offer", sdp: offer });
    for (const x of c.early.splice(0)) await c.pc.addIceCandidate(x).catch(() => {});
    const a = await c.pc.createAnswer();
    const sdp = tuneOpus(a.sdp ?? "");
    await c.pc.setLocalDescription({ type: "answer", sdp });
    this.send(peer, "in", { k: "sdp", type: "answer", sdp });
  }

  private call(peer: number, line: Line, iceServers: IceServer[]): Call {
    const pc = new RTCPeerConnection({ iceServers });
    const c: Call = { pc, peer, line, early: [], held: { delay: 0, count: 0 } };
    pc.onicecandidate = (e) => this.send(peer, line, { k: "ice", candidate: e.candidate?.candidate ?? "", mid: e.candidate?.sdpMid ?? "", index: e.candidate?.sdpMLineIndex ?? 0 });
    pc.onconnectionstatechange = () => {
      if (pc.connectionState !== "failed" || this.calls.get(key(peer, line)) !== c) return;
      this.hang(c);
      if (line === "in") { this.drop(peer); this.failed.add(peer); }
    };
    this.calls.set(key(peer, line), c);
    return c;
  }

  private hang(c: Call) {
    if (this.calls.get(key(c.peer, c.line)) === c) this.calls.delete(key(c.peer, c.line));
    c.pc.ontrack = null; c.pc.onicecandidate = null; c.pc.onconnectionstatechange = null;
    c.pc.close();
  }

  private async chain(who: Who, stream: MediaStream) {
    await this.ready;
    this.drop(who);
    const ctx = this.ctx;
    const amp = new AudioWorkletNode(ctx, "q-amp", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 1, channelCountMode: "explicit" });
    // an amp whose audio thread threw plays silence and says nothing else: say it, so a silent guitar has a reason
    amp.onprocessorerror = (e) => console.error(`Q Amp stopped on ${who === "me" ? "your" : `player ${who}'s`} guitar`, e);
    const gain = new GainNode(ctx, { gain: 1 });
    const pan = who === "me" ? null : new PannerNode(ctx, { panningModel: "HRTF", distanceModel: "inverse", refDistance: 1.5, rolloffFactor: 0.7 });
    amp.port.onmessage = (e: MessageEvent<unknown>) => this.metered(who, e.data);
    // the channel's Shape after the amp, as the desk's audio thread runs it on a player's channel (shape-worklet.ts)
    const shape = new AudioWorkletNode(ctx, "q-shape", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
    amp.connect(shape).connect(gain);
    // someone else's guitar through the listener's limiter, so a cranked amp or fader can't blow past the band
    const limit = who === "me" ? null : limiter(ctx, this.peerDb);
    const out = limit ? gain.connect(limit.node) : gain;
    (pan ? out.connect(pan) : out).connect(this.to);
    // each aux send: the guitar after its level, as one channel, into that aux's bus on the desk's audio thread
    const buses = this.buses, sends = buses ? Array.from({ length: buses.numberOfInputs }, (_, i) => {
      const s = new GainNode(ctx, { gain: 0, channelCount: 1, channelCountMode: "explicit" });
      gain.connect(s).connect(buses, 0, i);
      return s;
    }) : [];
    // a remote stream plays into Web Audio only once a media element holds it too (Chrome); the element stays silent
    let tag: HTMLAudioElement | null = null;
    if (who !== "me") { tag = new Audio(); tag.muted = true; tag.srcObject = stream; void tag.play().catch(() => {}); }
    const src = ctx.createMediaStreamSource(stream);
    src.connect(amp);
    const c: Chain = { src, amp, shape, gain, sends, pan, limit, settings: "", asked: null, level: 1, strip: PLAIN, tag, tap: null };
    this.chains.set(who, c);
    this.play(c, this.strips.get(who) ?? PLAIN);
  }

  private drop(who: Who) {
    const c = this.chains.get(who);
    if (!c) return;
    this.chains.delete(who);
    this.loads.delete(who);
    c.amp.port.onmessage = null;
    for (const t of c.tap?.stream.getTracks() ?? []) t.stop();
    c.src?.disconnect(); c.amp.disconnect(); c.shape.disconnect(); c.gain.disconnect(); c.limit?.node.disconnect(); c.pan?.disconnect();
    for (const s of c.sends) s.disconnect();
    if (c.tag) c.tag.srcObject = null;
  }
}

const key = (peer: number, line: Line) => `${peer}:${line}`;
