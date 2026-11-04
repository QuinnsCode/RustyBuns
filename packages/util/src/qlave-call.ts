// Copied from Qlave (QuinnsCode/clave, src/sdk/qlaveCall.ts) for @rustybuns/util/voice; fix it there first, then here.
// The one change: frames off the socket are `Signal`, every field looked at before use, instead of `any`.
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

/** A frame off the signaling socket: its `type`, and fields nothing has checked yet. */
export type Signal = { type: string } & Record<string, unknown>;

const strOf = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
/** A string-to-string map, keeping only the string values. */
const namesOf = (v: unknown): Record<string, string> => {
  const out: Record<string, string> = {};
  if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) if (typeof x === "string") out[k] = x;
  return out;
};
const iceOf = (v: unknown): RTCIceServer[] =>
  Array.isArray(v) ? v.filter((x): x is RTCIceServer => !!x && typeof x === "object" && "urls" in x && (typeof x.urls === "string" || Array.isArray(x.urls))) : [];
const descriptionOf = (v: unknown): RTCSessionDescriptionInit | null =>
  v && typeof v === "object" && "type" in v && (v.type === "offer" || v.type === "answer" || v.type === "pranswer" || v.type === "rollback")
    ? { type: v.type, ...("sdp" in v && typeof v.sdp === "string" ? { sdp: v.sdp } : {}) }
    : null;
const candidateOf = (v: unknown): RTCIceCandidateInit | null => {
  if (!v || typeof v !== "object" || !("candidate" in v) || typeof v.candidate !== "string") return null;
  const mid = "sdpMid" in v && typeof v.sdpMid === "string" ? v.sdpMid : null;
  const line = "sdpMLineIndex" in v && typeof v.sdpMLineIndex === "number" ? v.sdpMLineIndex : null;
  const frag = "usernameFragment" in v && typeof v.usernameFragment === "string" ? v.usernameFragment : null;
  return { candidate: v.candidate, sdpMid: mid, sdpMLineIndex: line, usernameFragment: frag };
};
/** A frame as a Signal, or null when it isn't an object with a string `type`. */
function signalOf(raw: unknown): Signal | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || !("type" in raw) || typeof raw.type !== "string") return null;
  return { ...raw, type: raw.type };
}

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
  send(msg: Record<string, unknown>): void {
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
      const msg = signalOf(raw);
      if (msg) this.onSignal(msg);
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

  private onSignal(msg: Signal): void {
    const peerId = strOf(msg.peerId), from = strOf(msg.from);
    switch (msg.type) {
      case "joined": {
        const rejoin = this.everJoined;
        this.everJoined = true;
        // After a signaling reconnect, others saw us leave and tore down; start clean.
        if (rejoin) for (const id of [...this.peers.keys()]) this.dropPeer(id);
        // The room may hand out ICE servers (voice rooms do), before any peer connection exists.
        const ice = iceOf(msg.iceServers);
        if (ice.length) this.iceServers = ice;
        const names = namesOf(msg.peerNames);
        const subs = namesOf(msg.peerSubs);
        for (const pid of Array.isArray(msg.peers) ? msg.peers : []) {
          if (typeof pid !== "string" || pid === this.peerId) continue;
          this.ensurePeer(pid, names[pid] ?? "Guest", true, subs[pid]);
        }
        this.setState("joined");
        this.announceMute();
        this.dispatchEvent(new CustomEvent("joined", { detail: { peerId: this.peerId, room: msg } }));
        return;
      }
      case "peer-joined": {
        if (!peerId || peerId === this.peerId) return;
        // A peer that rejoins after a blip gets a fresh connection from its side.
        if (this.peers.has(peerId)) this.dropPeer(peerId);
        this.ensurePeer(peerId, strOf(msg.name) ?? "Guest", false, strOf(msg.sub));
        this.announceMute();
        return;
      }
      case "peer-left":
        if (peerId) this.dropPeer(peerId);
        return;
      case "offer":
      case "answer":
      case "ice-candidate": {
        if (!from) return;
        const entry = this.peers.get(from) ?? this.ensurePeer(from, "Guest", false);
        // Serialize per peer: a candidate must never race the description it belongs to.
        entry.queue = entry.queue.then(() => this.handleNegotiation(entry, msg)).catch(err => {
          console.warn("[qlave] negotiation error", msg.type, err);
        });
        return;
      }
      case "mute-state": {
        const entry = from && this.peers.get(from);
        if (!entry) return;
        entry.info = { ...entry.info, audioMuted: !!msg.audioMuted, videoMuted: !!msg.videoMuted };
        this.emitPeer("peer-updated", entry);
        return;
      }
      case "error":
        console.warn("[qlave] server:", msg.message);
        this.dispatchEvent(new CustomEvent("server-error", { detail: msg }));
        return;
      default:
        // captions and anything else apps put on the wire
        this.dispatchEvent(new CustomEvent("message", { detail: msg }));
    }
  }

  private async handleNegotiation(entry: PeerEntry, msg: Signal): Promise<void> {
    const { pc } = entry;
    if (pc.signalingState === "closed") return;

    if (msg.type === "ice-candidate") {
      const candidate = candidateOf(msg.candidate);
      if (!candidate) return;
      try { await pc.addIceCandidate(candidate); }
      catch (e) { if (!entry.ignoreOffer) throw e; }
      return;
    }

    const description = descriptionOf(msg.sdp);
    if (!description) return;
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
