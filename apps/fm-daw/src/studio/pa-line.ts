// The room's PA: one player's set (the DJ decks' master, src/dj/) out to everyone in the sesh, in stereo, by WebRTC,
// and everyone else's set in. The player says so on the live line ({ t: "pa", on }), each listener asks for a call
// (`want`), and the player calls them with the stream, Opus at 256 kb/s in stereo with no silence suppression, so a
// breakdown's quiet stays music. A set comes in through a media element (Chrome only lets a remote stream into Web
// Audio once one holds it), then its level (your mute, the room's PA level), into `to`: it plays everywhere in the room
// at once, the way a PA covers a floor, not from one spot. You hear your own set from the decks, not from here.
// Signals go through the sesh's World (`send`), on the lines `pa-out` (the player's side) and `pa-in` (a listener's).
import { otherEnd, tuneOpus, type IceServer, type Line, type RtcServer, type Signal } from "../guitar.ts";

/** Opus's ceiling for a set, bits a second: a stereo mix wants twice a guitar's. */
export const PA_BITRATE = 256_000;

interface Call { pc: RTCPeerConnection; peer: number; line: Line; early: RTCIceCandidateInit[] }
interface Heard { tag: HTMLAudioElement; src: MediaStreamAudioSourceNode; gain: GainNode; name: string }

export class PaLine {
  private mine: MediaStream | null = null;
  private calls = new Map<string, Call>();
  private heard = new Map<number, Heard>();
  /** Who says they're playing a set, and what's on. */
  private live = new Map<number, string>();
  private levels = new Map<number, number>();
  /** The room's PA level for every set coming in (0 to 1). */
  private master = 1;

  constructor(private ctx: AudioContext, private to: AudioNode, private send: (to: number, line: Line, s: Signal) => void, private ice: () => Promise<IceServer[]>) {}

  /** Play `stream` to the room: anyone who asks gets a call. Calls already up carry on with the new stream. */
  start(stream: MediaStream) {
    this.mine = stream;
    for (const c of this.calls.values()) if (c.line === "pa-out") for (const s of c.pc.getSenders()) { const t = stream.getAudioTracks()[0]; if (t) void s.replaceTrack(t); }
  }
  /** Stop playing to the room: every call carrying it hangs up. */
  stop() {
    this.mine = null;
    for (const c of [...this.calls.values()]) if (c.line === "pa-out") this.hang(c);
  }
  playing() { return !!this.mine; }

  /** `peer` says they're playing a set (or stopped): ask them for it, or let it go. */
  heardSay(peer: number, on: boolean, name = "") {
    if (on) { const had = this.live.has(peer); this.live.set(peer, name); if (!had || !this.heard.has(peer)) this.send(peer, "pa-in", { k: "want" }); }
    else { this.live.delete(peer); this.drop(peer); }
  }
  /** They left: every call with them goes. */
  gone(peer: number) { this.live.delete(peer); this.drop(peer); for (const l of ["pa-out", "pa-in"] as const) { const c = this.calls.get(key(peer, l)); if (c) this.hang(c); } }
  /** How loud `peer`'s set is for you (0 muted, 1 as played). */
  level(peer: number, v: number) { this.levels.set(peer, v); this.apply(peer); }
  /** The room's PA level, for every set. */
  setMaster(v: number) { this.master = Math.max(0, Math.min(1, v)); for (const p of this.heard.keys()) this.apply(p); }
  private apply(peer: number) { const h = this.heard.get(peer); if (h) h.gain.gain.setTargetAtTime(this.master * (this.levels.get(peer) ?? 1), this.ctx.currentTime, 0.02); }

  /** A signal from the World on a PA line. The line is the sender's side, so the call here is the other end of it. */
  async signal(m: RtcServer) {
    const ice = await this.ice();
    const { from, s } = m, here = otherEnd(m.line);
    if (s.k === "want") { if (here === "pa-out" && this.mine) await this.callOut(from, ice); return; }
    if (s.k === "sdp" && s.type === "offer" && here === "pa-in") return this.answer(from, s.sdp, ice);
    const c = this.calls.get(key(from, here));
    if (!c) return;
    if (s.k === "sdp" && s.type === "answer" && here === "pa-out") {
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

  /** The sets as data, for the harness: who's on and what, and each call's state. */
  state() {
    return {
      playing: !!this.mine,
      live: [...this.live].map(([peer, name]) => ({ peer, name, heard: this.heard.has(peer) })),
      calls: [...this.calls.values()].map((c) => ({ peer: c.peer, line: c.line, state: c.pc.connectionState })),
    };
  }

  private async callOut(peer: number, ice: IceServer[]) {
    const was = this.calls.get(key(peer, "pa-out"));
    if (was) this.hang(was);
    const c = this.call(peer, "pa-out", ice);
    for (const t of this.mine?.getAudioTracks() ?? []) {
      const tx = c.pc.addTransceiver(t, { direction: "sendonly", streams: [this.mine!] });
      const p = tx.sender.getParameters();
      if (p.encodings?.length) { p.encodings[0].maxBitrate = PA_BITRATE; p.encodings[0].priority = "high"; }
      await tx.sender.setParameters(p).catch(() => {});
    }
    const offer = await c.pc.createOffer();
    const sdp = tuneOpus(offer.sdp ?? "", { stereo: true, bitrate: PA_BITRATE });
    await c.pc.setLocalDescription({ type: "offer", sdp });
    this.send(peer, "pa-out", { k: "sdp", type: "offer", sdp });
  }
  private async answer(peer: number, offer: string, ice: IceServer[]) {
    const was = this.calls.get(key(peer, "pa-in"));
    if (was) this.hang(was);
    const c = this.call(peer, "pa-in", ice);
    c.pc.ontrack = (e) => this.hear(peer, e.streams[0] ?? new MediaStream([e.track]));
    await c.pc.setRemoteDescription({ type: "offer", sdp: offer });
    for (const x of c.early.splice(0)) await c.pc.addIceCandidate(x).catch(() => {});
    const a = await c.pc.createAnswer();
    const sdp = tuneOpus(a.sdp ?? "", { stereo: true, bitrate: PA_BITRATE });
    await c.pc.setLocalDescription({ type: "answer", sdp });
    this.send(peer, "pa-in", { k: "sdp", type: "answer", sdp });
  }
  private hear(peer: number, stream: MediaStream) {
    this.drop(peer);
    const tag = new Audio(); tag.muted = true; tag.srcObject = stream; void tag.play().catch(() => {});
    const src = this.ctx.createMediaStreamSource(stream), gain = new GainNode(this.ctx, { gain: 0 });
    src.connect(gain).connect(this.to);
    this.heard.set(peer, { tag, src, gain, name: this.live.get(peer) ?? "" });
    this.apply(peer);
  }
  private drop(peer: number) {
    const h = this.heard.get(peer);
    if (!h) return;
    h.src.disconnect(); h.gain.disconnect(); h.tag.srcObject = null;
    this.heard.delete(peer);
    const c = this.calls.get(key(peer, "pa-in"));
    if (c) this.hang(c);
  }
  private call(peer: number, line: Line, iceServers: IceServer[]): Call {
    const pc = new RTCPeerConnection({ iceServers });
    const c: Call = { pc, peer, line, early: [] };
    pc.onicecandidate = (e) => this.send(peer, line, { k: "ice", candidate: e.candidate?.candidate ?? "", mid: e.candidate?.sdpMid ?? "", index: e.candidate?.sdpMLineIndex ?? 0 });
    pc.onconnectionstatechange = () => {
      if (this.calls.get(key(peer, line)) !== c) return;
      // a listener whose call drops asks again while the set is still on: a blip on the network doesn't end the night
      if (pc.connectionState === "failed") { this.hang(c); if (line === "pa-in" && this.live.has(peer)) { this.drop(peer); setTimeout(() => { if (this.live.has(peer)) this.send(peer, "pa-in", { k: "want" }); }, 1500); } }
    };
    this.calls.set(key(peer, line), c);
    return c;
  }
  private hang(c: Call) {
    if (this.calls.get(key(c.peer, c.line)) === c) this.calls.delete(key(c.peer, c.line));
    c.pc.ontrack = null; c.pc.onicecandidate = null; c.pc.onconnectionstatechange = null;
    c.pc.close();
  }
}

const key = (peer: number, line: Line) => `${peer}:${line}`;
