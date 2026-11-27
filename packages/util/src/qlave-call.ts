// Copied from Qlave (QuinnsCode/clave, src/sdk/qlaveCall.ts) for @rustybuns/util/voice; fix it there first, then here.
// The one change: each kind of frame off the socket goes through its own guard before use, instead of `any`.
//
// Headless Qlave call engine. No React, no DOM beyond WebRTC + WebSocket.
// The /s/:code page, the widget and any other app (eqosys games, qbear3) drive
// calls through this one class, so signaling fixes land everywhere at once.
//
//   const call = new QlaveCall({ signalingUrl, iceServers, localStream, name });
//   call.addEventListener("peer-stream", e => attach(e.detail.peerId, e.detail.stream));
//   await call.join();
//
// Negotiation model: the peer that joins later initiates to everyone already in
// the room and owns the m-lines (one audio + one video transceiver, recvonly if
// it has no such track). The answerer attaches its tracks to those transceivers,
// so mute / screen share are replaceTrack calls with no renegotiation. ICE
// restarts use perfect negotiation (polite = lower peer id) to survive glare.

import { arr, bool, check, field, int, maybe, obj, oneOf, opt, or, rec, str, type Of } from "./guard.ts";

export type CallState = "idle" | "connecting" | "joined" | "reconnecting" | "left" | "error";

export interface RemotePeer {
  peerId: string;
  name: string;
  /** eqosys id, in voice rooms. */
  sub?: string;
  stream: MediaStream;
  audioMuted: boolean;
  videoMuted: boolean;
  connection: RTCPeerConnectionState;
}

export interface QlaveCallOptions {
  /** Full ws(s):// URL to /__qlave/<sessionId>, including its auth query (roomCode or ticket). */
  signalingUrl: string;
  iceServers?: RTCIceServer[];
  /** Optional: may have zero, one or both kinds. Without tracks you still receive. */
  localStream?: MediaStream | null;
  name?: string;
  peerId?: string;
  /** Reconnect attempts for the signaling socket before giving up (default 10). */
  maxReconnects?: number;
}

/** A socket-shaped handle that always points at the live signaling socket, across reconnects. */
export interface SignalingHandle {
  readonly readyState: number;
  send(data: string): void;
}

// Each kind of frame the call reads has its own guard; a kind it does not know goes on as it came.
const Id = str(200, { min: 1 });
const IceServer = obj({
  urls: (v: unknown): string | string[] => (typeof v === "string" ? str(2000)(v) : arr(str(2000), 20)(v)),
  username: opt(str(500)),
  credential: opt(str(500)),
});
const Description = obj({ type: oneOf(["offer", "answer", "pranswer", "rollback"]), sdp: opt(str(500_000, { min: 0 })) });
const Candidate = obj({
  candidate: str(5000, { min: 0 }),
  sdpMid: maybe(str(200, { min: 0 })),
  sdpMLineIndex: maybe(int(0, 1000)),
  usernameFragment: maybe(str(500, { min: 0 })),
});
/** The room taking us in: who is already there, their names and eqosys ids, and maybe the ICE servers to use. */
const Joined = obj({
  peers: or(arr(Id, 10_000, { drop: true }), []),
  peerNames: maybe(rec(str(200, { min: 0 }))),
  peerSubs: maybe(rec(str(200, { min: 0 }))),
  iceServers: or(arr(IceServer, 20, { drop: true }), []),
});
const PeerJoined = obj({ peerId: Id, name: maybe(str(200)), sub: maybe(str(200)) });
const PeerLeft = obj({ peerId: Id });
/** An offer or answer from one peer, or one of its ICE candidates. */
const Sdp = obj({ type: oneOf(["offer", "answer"]), from: Id, sdp: Description });
const IceCandidate = obj({ type: oneOf(["ice-candidate"]), from: Id, candidate: Candidate });
type Negotiation = Of<typeof Sdp> | Of<typeof IceCandidate>;
const MuteState = obj({ from: Id, audioMuted: or(bool(), false), videoMuted: or(bool(), false) });
/** A server error: its message, if it gave one. */
const ServerError = obj({ message: maybe(str(500, { min: 0 })) });

interface PeerEntry {
  pc: RTCPeerConnection;
  info: RemotePeer;
  initiator: boolean;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  queue: Promise<void>;
  restartTimer?: ReturnType<typeof setTimeout>;
}

const DEFAULT_ICE: RTCIceServer[] = [{ urls: ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"] }];
const DISCONNECT_GRACE_MS = 4000;

export class QlaveCall extends EventTarget {
  readonly peerId: string;
  name: string;
  state: CallState = "idle";

  private opts: QlaveCallOptions;
  private iceServers: RTCIceServer[];
  private localStream: MediaStream | null;
  private screenTrack: MediaStreamTrack | null = null;
  private ws: WebSocket | null = null;
  private peers = new Map<string, PeerEntry>();
  private reconnects = 0;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private everJoined = false;
  private audioMuted = false;
  private videoMuted = false;

  readonly socket: SignalingHandle;

  constructor(opts: QlaveCallOptions) {
    super();
    this.opts = opts;
    this.peerId = opts.peerId ?? crypto.randomUUID();
    this.name = opts.name ?? "Guest";
    this.iceServers = opts.iceServers?.length ? opts.iceServers : DEFAULT_ICE;
    this.localStream = opts.localStream ?? null;
    const self = this;
    this.socket = {
      get readyState() { return self.ws?.readyState ?? WebSocket.CLOSED; },
      send(data: string) { if (self.ws?.readyState === WebSocket.OPEN) self.ws.send(data); },
    };
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /** Where the next reconnect goes (e.g. a resume ticket that replaces a single-use one). */
  setSignalingUrl(url: string): void {
    this.opts = { ...this.opts, signalingUrl: url };
  }

  /** The peer connection to a remote peer, for stats (audio levels and the like). */
  peerConnection(peerId: string): RTCPeerConnection | null {
    return this.peers.get(peerId)?.pc ?? null;
  }

  get remotePeers(): RemotePeer[] {
    return [...this.peers.values()].map(p => p.info);
  }

  join(): Promise<void> {
    if (this.state !== "idle" && this.state !== "left" && this.state !== "error") return Promise.resolve();
    this.setState("connecting");
    return new Promise((resolve, reject) => {
      const onJoined = () => { cleanup(); resolve(); };
      const onError = (e: Event) => { cleanup(); reject(new Error(e instanceof CustomEvent && typeof e.detail?.message === "string" ? e.detail.message : "join failed")); };
      const cleanup = () => {
        this.removeEventListener("joined", onJoined);
        this.removeEventListener("fatal", onError);
      };
      this.addEventListener("joined", onJoined);
      this.addEventListener("fatal", onError);
      this.openSocket();
    });
  }

  leave(): void {
    clearTimeout(this.reconnectTimer);
    this.send({ type: "leave" });
    if (this.ws) {
      this.ws.onclose = null;
      try { this.ws.close(1000, "left"); } catch { /* closed */ }
      this.ws = null;
    }
    for (const id of [...this.peers.keys()]) this.dropPeer(id);
    this.screenTrack?.stop();
    this.screenTrack = null;
    this.setState("left");
  }

  /** Send an app/plugin message (e.g. captions) through the room. */
  send<M extends { readonly type: string }>(msg: M): void {
    this.socket.send(JSON.stringify(msg));
  }

  setAudioEnabled(enabled: boolean): void {
    this.localStream?.getAudioTracks().forEach(t => { t.enabled = enabled; });
    this.audioMuted = !enabled;
    this.announceMute();
  }

  setVideoEnabled(enabled: boolean): void {
    this.localStream?.getVideoTracks().forEach(t => { t.enabled = enabled; });
    this.videoMuted = !enabled;
    this.announceMute();
  }

  /** Swap the outgoing video for a screen track (from getDisplayMedia). Pass null to go back to the camera. */
  async setScreenTrack(track: MediaStreamTrack | null): Promise<void> {
    if (this.screenTrack && this.screenTrack !== track) this.screenTrack.stop();
    this.screenTrack = track;
    const outgoing = track ?? this.localStream?.getVideoTracks()[0] ?? null;
    await Promise.all([...this.peers.values()].map(p => this.attachTrack(p, "video", outgoing)));
  }

  // ── Signaling socket ───────────────────────────────────────────────────────

  private openSocket(): void {
    const url = new URL(this.opts.signalingUrl);
    url.searchParams.set("peerId", this.peerId);
    const ws = new WebSocket(url.toString());
    this.ws = ws;

    ws.onopen = () => {
      this.reconnects = 0;
      ws.send(JSON.stringify({ type: "join", name: this.name }));
    };
    ws.onmessage = (e) => {
      let raw: unknown;
      try { raw = JSON.parse(typeof e.data === "string" ? e.data : ""); } catch { return; }
      const type = field(raw, "type");
      if (typeof type === "string") this.onSignal(type, raw);
    };
    ws.onclose = (e) => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.state === "left") return;
      // 4xxx = server refused us (bad ticket, room full); don't hammer it.
      if (e.code >= 4000 && e.code < 5000) {
        this.fail(e.reason || `Refused (${e.code})`, e.code);
        return;
      }
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    const max = this.opts.maxReconnects ?? 10;
    if (this.reconnects >= max) { this.fail("Lost connection to the room", 0); return; }
    this.setState("reconnecting");
    const delay = Math.min(15000, 500 * 2 ** this.reconnects) * (0.75 + Math.random() * 0.5);
    this.reconnects++;
    this.reconnectTimer = setTimeout(() => this.openSocket(), delay);
  }

  private fail(message: string, code = 0): void {
    this.setState("error");
    this.dispatchEvent(new CustomEvent("fatal", { detail: { message, code } }));
    this.dispatchEvent(new CustomEvent("error", { detail: { message, code } }));
  }

  private setState(s: CallState): void {
    if (this.state === s) return;
    this.state = s;
    this.dispatchEvent(new CustomEvent("state", { detail: { state: s } }));
  }

  // ── Signal handling ────────────────────────────────────────────────────────

  /** One frame off the socket: its `type`, and the frame as it came, read through that kind's guard. */
  private onSignal(type: string, raw: unknown): void {
    switch (type) {
      case "joined": {
        const room = check(Joined, raw);
        if (!room) return;
        const rejoin = this.everJoined;
        this.everJoined = true;
        // After a signaling reconnect, others saw us leave and tore down; start clean.
        if (rejoin) for (const id of [...this.peers.keys()]) this.dropPeer(id);
        // The room may hand out ICE servers (voice rooms do), before any peer connection exists.
        if (room.iceServers.length) this.iceServers = room.iceServers;
        for (const pid of room.peers) {
          if (pid === this.peerId) continue;
          this.ensurePeer(pid, room.peerNames?.[pid] ?? "Guest", true, room.peerSubs?.[pid]);
        }
        this.setState("joined");
        this.announceMute();
        // Apps read their own fields off the room (voice: self, serverMuted, resume), so it goes on whole.
        this.dispatchEvent(new CustomEvent("joined", { detail: { peerId: this.peerId, room: raw } }));
        return;
      }
      case "peer-joined": {
        const m = check(PeerJoined, raw);
        if (!m || m.peerId === this.peerId) return;
        // A peer that rejoins after a blip gets a fresh connection from its side.
        if (this.peers.has(m.peerId)) this.dropPeer(m.peerId);
        this.ensurePeer(m.peerId, m.name ?? "Guest", false, m.sub);
        this.announceMute();
        return;
      }
      case "peer-left": {
        const m = check(PeerLeft, raw);
        if (m) this.dropPeer(m.peerId);
        return;
      }
      case "offer":
      case "answer":
      case "ice-candidate": {
        const m: Negotiation | null = type === "ice-candidate" ? check(IceCandidate, raw) : check(Sdp, raw);
        if (!m) return;
        const entry = this.peers.get(m.from) ?? this.ensurePeer(m.from, "Guest", false);
        // Serialize per peer: a candidate must never race the description it belongs to.
        entry.queue = entry.queue.then(() => this.handleNegotiation(entry, m)).catch(err => {
          console.warn("[qlave] negotiation error", type, err);
        });
        return;
      }
      case "mute-state": {
        const m = check(MuteState, raw);
        const entry = m && this.peers.get(m.from);
        if (!m || !entry) return;
        entry.info = { ...entry.info, audioMuted: m.audioMuted, videoMuted: m.videoMuted };
        this.emitPeer("peer-updated", entry);
        return;
      }
      case "error":
        console.warn("[qlave] server:", check(ServerError, raw)?.message);
        this.dispatchEvent(new CustomEvent("server-error", { detail: raw }));
        return;
      default:
        // captions and anything else apps put on the wire, as it came
        this.dispatchEvent(new CustomEvent("message", { detail: raw }));
    }
  }

  private async handleNegotiation(entry: PeerEntry, msg: Negotiation): Promise<void> {
    const { pc } = entry;
    if (pc.signalingState === "closed") return;

    if (msg.type === "ice-candidate") {
      const { candidate, sdpMid, sdpMLineIndex, usernameFragment } = msg.candidate;
      try { await pc.addIceCandidate({ candidate, sdpMid: sdpMid ?? null, sdpMLineIndex: sdpMLineIndex ?? null, usernameFragment: usernameFragment ?? null }); }
      catch (e) { if (!entry.ignoreOffer) throw e; }
      return;
    }

    const description: RTCSessionDescriptionInit = msg.sdp.sdp === undefined ? { type: msg.sdp.type } : { type: msg.sdp.type, sdp: msg.sdp.sdp };
    const collision = description.type === "offer" && (entry.makingOffer || pc.signalingState !== "stable");
    entry.ignoreOffer = !entry.polite && collision;
    if (entry.ignoreOffer) return;

    await pc.setRemoteDescription(description);
    if (description.type === "offer") {
      if (!entry.initiator) await this.adoptRemoteTransceivers(entry);
      await pc.setLocalDescription();
      this.send({ type: "answer", to: entry.info.peerId, sdp: pc.localDescription });
    }
  }

  // ── Peer connections ───────────────────────────────────────────────────────

  private ensurePeer(peerId: string, name: string, initiator: boolean, sub?: string): PeerEntry {
    const existing = this.peers.get(peerId);
    if (existing) return existing;

    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    const entry: PeerEntry = {
      pc,
      initiator,
      polite: this.peerId < peerId,
      makingOffer: false,
      ignoreOffer: false,
      queue: Promise.resolve(),
      info: {
        peerId, name, ...(sub ? { sub } : {}),
        stream: new MediaStream(),
        audioMuted: false, videoMuted: false,
        connection: pc.connectionState,
      },
    };
    this.peers.set(peerId, entry);

    pc.ontrack = (e) => {
      const stream = entry.info.stream;
      for (const t of stream.getTracks()) if (t.kind === e.track.kind && t !== e.track) stream.removeTrack(t);
      if (!stream.getTracks().includes(e.track)) stream.addTrack(e.track);
      // New MediaStream identity so <video> elements and React re-render reliably.
      entry.info = { ...entry.info, stream: new MediaStream(stream.getTracks()) };
      this.emitPeer("peer-stream", entry);
    };

    pc.onicecandidate = (e) => {
      if (e.candidate) this.send({ type: "ice-candidate", to: peerId, candidate: e.candidate.toJSON() });
    };

    pc.onnegotiationneeded = async () => {
      // The answerer only renegotiates for ICE restarts; m-lines belong to the initiator.
      if (!entry.initiator && pc.remoteDescription === null) return;
      try {
        entry.makingOffer = true;
        await pc.setLocalDescription();
        this.send({ type: "offer", to: peerId, sdp: pc.localDescription });
      } catch (err) {
        console.warn("[qlave] offer failed", err);
      } finally {
        entry.makingOffer = false;
      }
    };

    pc.onconnectionstatechange = () => {
      entry.info = { ...entry.info, connection: pc.connectionState };
      this.emitPeer("peer-updated", entry);
      clearTimeout(entry.restartTimer);
      if (pc.connectionState === "failed") {
        pc.restartIce();
      } else if (pc.connectionState === "disconnected") {
        // Usually a network blip that heals on its own; restart ICE only if it doesn't.
        entry.restartTimer = setTimeout(() => {
          if (pc.connectionState === "disconnected") pc.restartIce();
        }, DISCONNECT_GRACE_MS);
      }
    };

    if (initiator) {
      // One audio + one video m-line, sendrecv if we have the track, recvonly otherwise.
      for (const kind of ["audio", "video"] as const) {
        const track = this.outgoingTrack(kind);
        if (track && this.localStream) {
          pc.addTransceiver(track, { direction: "sendrecv", streams: [this.localStream] });
        } else {
          pc.addTransceiver(kind, { direction: "recvonly" });
        }
      }
    }

    this.emitPeer("peer-joined", entry);
    return entry;
  }

  /** Answerer: put our tracks on the transceivers the initiator created. */
  private async adoptRemoteTransceivers(entry: PeerEntry): Promise<void> {
    for (const tr of entry.pc.getTransceivers()) {
      const kind = tr.receiver.track.kind as "audio" | "video";
      const track = this.outgoingTrack(kind);
      if (track && tr.sender.track !== track) {
        await tr.sender.replaceTrack(track);
        if (this.localStream) tr.sender.setStreams?.(this.localStream);
      }
      tr.direction = track ? "sendrecv" : "recvonly";
    }
  }

  private async attachTrack(entry: PeerEntry, kind: "audio" | "video", track: MediaStreamTrack | null): Promise<void> {
    for (const tr of entry.pc.getTransceivers()) {
      if (tr.receiver.track.kind !== kind) continue;
      await tr.sender.replaceTrack(track);
      // Going from recvonly to sendrecv needs one renegotiation, which negotiationneeded handles.
      const wanted: RTCRtpTransceiverDirection = track ? "sendrecv" : "recvonly";
      if (tr.direction !== wanted && tr.direction !== "stopped") tr.direction = wanted;
    }
  }

  private outgoingTrack(kind: "audio" | "video"): MediaStreamTrack | null {
    if (kind === "video" && this.screenTrack) return this.screenTrack;
    const tracks = kind === "audio" ? this.localStream?.getAudioTracks() : this.localStream?.getVideoTracks();
    return tracks?.[0] ?? null;
  }

  private dropPeer(peerId: string): void {
    const entry = this.peers.get(peerId);
    if (!entry) return;
    clearTimeout(entry.restartTimer);
    entry.pc.onconnectionstatechange = null;
    entry.pc.close();
    this.peers.delete(peerId);
    this.dispatchEvent(new CustomEvent("peer-left", { detail: { peerId } }));
  }

  private emitPeer(type: "peer-joined" | "peer-stream" | "peer-updated", entry: PeerEntry): void {
    this.dispatchEvent(new CustomEvent(type, { detail: entry.info }));
  }

  private announceMute(): void {
    this.send({ type: "mute-state", audioMuted: this.audioMuted, videoMuted: this.videoMuted });
  }
}
