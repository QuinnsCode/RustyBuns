// The jam room's guitars, the browser half of src/guitar.ts: your input out to each listener who asks, each player's
// in from them, and every guitar (yours too, so you hear what they hear) through its track's amp on Q Amp's audio
// thread, then your mutes, then placed where its player stands. Signals go through the sesh's World (`send`).
import ampWorkletUrl from "../amp/worklet.ts?worker&url";
import type { AmpSettings, ToAmp } from "../amp/messages.ts";
import { lagMs, otherEnd, tuneOpus, type Line, type RtcServer, type Signal } from "../guitar.ts";

/** A public STUN server to find each end's address. No TURN yet: two players behind strict NATs don't connect. */
const ICE: RTCIceServer[] = [{ urls: "stun:stun.cloudflare.com:3478" }];
/** Opus's ceiling for the guitar, bits a second (tuneOpus asks the far end for the same). */
const BITRATE = 128_000;

/** One guitar's sound here: its dry input, the amp, your mute, and where it stands (yours isn't placed). */
interface Chain { src: MediaStreamAudioSourceNode | null; amp: AudioWorkletNode; gain: GainNode; pan: PannerNode | null; settings: string; level: number; tag: HTMLAudioElement | null }
/** One call: your guitar out to `peer`, or theirs in. Candidates that come before the far end's description wait. */
interface Call { pc: RTCPeerConnection; peer: number; line: Line; early: RTCIceCandidateInit[]; held: { delay: number; count: number } }

export type Who = number | "me";

export class GuitarLine {
  private calls = new Map<string, Call>();
  private chains = new Map<Who, Chain>();
  private mine: MediaStream | null = null;
  private ready: Promise<void>;
  /** `to` is where every guitar ends up: the speakers, or a meter in a test. */
  constructor(private ctx: AudioContext, private send: (to: number, line: Line, s: Signal) => void, private to: AudioNode = ctx.destination) {
    this.ready = ctx.audioWorklet.addModule(ampWorkletUrl);
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
  ask(peer: number) { if (!this.hearing(peer)) this.send(peer, "in", { k: "want" }); }
  /** Their guitar came out: its call and its sound go. */
  stopHearing(peer: number) { const c = this.calls.get(key(peer, "in")); if (c) this.hang(c); this.drop(peer); }
  /** They left: every call with them goes. */
  gone(peer: number) { const c = this.calls.get(key(peer, "out")); if (c) this.hang(c); this.stopHearing(peer); }

  /** A signal from the World. The line is the sender's side, so the call here is the other end of it. */
  async signal(m: RtcServer) {
    const { from, s } = m, here = otherEnd(m.line);
    if (s.k === "want") { if (here === "out" && this.mine) await this.callOut(from); return; }
    if (s.k === "sdp" && s.type === "offer" && here === "in") return this.answer(from, s.sdp);
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
    const c = this.chains.get(who), k = JSON.stringify(settings);
    if (!c || c.settings === k) return;
    c.settings = k;
    c.amp.port.postMessage({ t: "set", settings } satisfies ToAmp);
  }
  /** How loud `who` is for you: 0 muted, 1 as played. */
  level(who: Who, g: number) {
    const c = this.chains.get(who);
    if (!c || c.level === g) return;
    c.level = g;
    c.gain.gain.setTargetAtTime(g, this.ctx.currentTime, 0.02);
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
   * How far behind each incoming guitar is, in milliseconds (null while its call connects). The jitter buffer is
   * the samples it held since the last ask, so a slow start to the call stops counting once it's past.
   */
  async lags(): Promise<Map<number, number | null>> {
    const out = new Map<number, number | null>();
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
  state() { return [...this.calls.values()].map((c) => ({ peer: c.peer, line: c.line, state: c.pc.connectionState })); }

  private async callOut(peer: number) {
    const was = this.calls.get(key(peer, "out"));
    if (was) this.hang(was);
    const c = this.call(peer, "out");
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

  private async answer(peer: number, offer: string) {
    const was = this.calls.get(key(peer, "in"));
    if (was) this.hang(was);
    const c = this.call(peer, "in");
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

  private call(peer: number, line: Line): Call {
    const pc = new RTCPeerConnection({ iceServers: ICE });
    const c: Call = { pc, peer, line, early: [], held: { delay: 0, count: 0 } };
    pc.onicecandidate = (e) => this.send(peer, line, { k: "ice", candidate: e.candidate?.candidate ?? "", mid: e.candidate?.sdpMid ?? "", index: e.candidate?.sdpMLineIndex ?? 0 });
    pc.onconnectionstatechange = () => { if (pc.connectionState === "failed" && this.calls.get(key(peer, line)) === c) { this.hang(c); if (line === "in") this.drop(peer); } };
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
    const gain = new GainNode(ctx, { gain: 1 });
    const pan = who === "me" ? null : new PannerNode(ctx, { panningModel: "HRTF", distanceModel: "inverse", refDistance: 1.5, rolloffFactor: 0.7 });
    amp.connect(gain);
    (pan ? gain.connect(pan) : gain).connect(this.to);
    // a remote stream plays into Web Audio only once a media element holds it too (Chrome); the element stays silent
    let tag: HTMLAudioElement | null = null;
    if (who !== "me") { tag = new Audio(); tag.muted = true; tag.srcObject = stream; void tag.play().catch(() => {}); }
    const src = ctx.createMediaStreamSource(stream);
    src.connect(amp);
    this.chains.set(who, { src, amp, gain, pan, settings: "", level: 1, tag });
  }

  private drop(who: Who) {
    const c = this.chains.get(who);
    if (!c) return;
    this.chains.delete(who);
    c.src?.disconnect(); c.amp.disconnect(); c.gain.disconnect(); c.pan?.disconnect();
    if (c.tag) c.tag.srcObject = null;
  }
}

const key = (peer: number, line: Line) => `${peer}:${line}`;
