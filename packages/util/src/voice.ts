// Copied from Qlave (QuinnsCode/clave, src/sdk/voice.ts) as @rustybuns/util/voice; fix it there first, then here.
// The one change: event details are read as `unknown` and narrowed, instead of trusted.
//
// Voice for Qollab spaces (apps/eqosys/QLAVE.md §2). Audio only, no DOM
// beyond hidden <audio> elements. Games import this; the ticket is the auth.
//
//   const v = await join("https://qlave.dev", ticket);  // ticket from the Space DO
//   v.onSpeakers(list => render(list));                  // [{ sub, name, talking, muted, self }]
//   v.onGone(reason => ...);                             // "kicked" | "ended" | "network"
//   v.muteSelf(true); v.leave();

import { QlaveCall } from "./qlave-call.ts";

export interface Speaker {
  sub: string;
  name: string;
  talking: boolean;
  /** Muted by themselves or by the space owner. */
  muted: boolean;
  self: boolean;
}

export type GoneReason = "kicked" | "ended" | "network";

export interface VoiceHandle {
  leave(): void;
  muteSelf(on: boolean): void;
  onSpeakers(fn: (speakers: Speaker[]) => void): () => void;
  onGone(fn: (reason: GoneReason) => void): () => void;
  /** Test/debug handle. */
  readonly call: QlaveCall;
}

export interface VoiceOptions {
  /** Defaults to the microphone; pass a stream to use something else (tests, a picked device). */
  stream?: MediaStream;
  peerId?: string;
}

/** What an event carries, unchecked. */
const detailOf = (e: Event): Record<string, unknown> => {
  const d: unknown = e instanceof CustomEvent ? e.detail : undefined;
  return d && typeof d === "object" ? { ...d } : {};
};
const strOf = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

const TALK_LEVEL = 0.02;   // audioLevel 0..1
const POLL_MS = 100;
const HOLD_MS = 600;       // keep "talking" on between syllables

export async function join(url: string, ticket: string, opts: VoiceOptions = {}): Promise<VoiceHandle> {
  const base = new URL(url);
  const wsBase = `${base.protocol === "http:" ? "ws:" : "wss:"}//${base.host}/__qlave/voice`;

  const stream = opts.stream ?? await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  const call = new QlaveCall({ signalingUrl: `${wsBase}?eqosys=${encodeURIComponent(ticket)}`, localStream: stream, peerId: opts.peerId });

  let self = { sub: "", name: "" };
  let selfMuted = false;
  const serverMuted = new Set<string>();
  const audios = new Map<string, HTMLAudioElement>();
  const speakerFns = new Set<(s: Speaker[]) => void>();
  const goneFns = new Set<(r: GoneReason) => void>();
  let last = "";
  let gone = false;

  const isServerMuted = () => serverMuted.has(self.sub);
  const applySelfMute = () => call.setAudioEnabled(!selfMuted && !isServerMuted());

  call.addEventListener("joined", (e) => {
    const r = detailOf(e).room;
    const room: Record<string, unknown> = r && typeof r === "object" ? { ...r } : {};
    const me: Record<string, unknown> = room.self && typeof room.self === "object" ? { ...room.self } : {};
    const sub = strOf(me.sub);
    if (sub) self = { sub, name: strOf(me.name) ?? "" };
    serverMuted.clear();
    for (const s of Array.isArray(room.serverMuted) ? room.serverMuted : []) if (typeof s === "string") serverMuted.add(s);
    // The eqosys ticket is single use: reconnects go in with the room's resume ticket.
    const resume = strOf(room.resume);
    if (resume) call.setSignalingUrl(`${wsBase}?resume=${encodeURIComponent(resume)}`);
    applySelfMute();
    for (const p of call.remotePeers) playPeer(p.peerId);
  });

  call.addEventListener("message", (e) => {
    const m = detailOf(e), sub = strOf(m.sub);
    if (m.type !== "server-mute" || !sub) return;
    if (m.on) serverMuted.add(sub); else serverMuted.delete(sub);
    if (sub === self.sub) applySelfMute();
    for (const p of call.remotePeers) if (p.sub === sub) playPeer(p.peerId);
  });

  const playPeer = (peerId: string) => {
    const p = call.remotePeers.find(x => x.peerId === peerId);
    if (!p) return;
    let el = audios.get(peerId);
    if (!el) {
      el = document.createElement("audio");
      el.autoplay = true;
      el.dataset.qlaveVoice = peerId;
      el.style.display = "none";
      document.body.appendChild(el);
      audios.set(peerId, el);
    }
    if (el.srcObject !== p.stream) el.srcObject = p.stream;
    // A server mute is enforced on every listener too, not just the speaker's own client.
    el.muted = !!p.sub && serverMuted.has(p.sub);
    el.play?.().catch(() => { /* autoplay blocked until a gesture */ });
  };

  call.addEventListener("peer-stream", (e) => { const id = strOf(detailOf(e).peerId); if (id) playPeer(id); });
  call.addEventListener("peer-left", (e) => {
    const id = strOf(detailOf(e).peerId);
    if (!id) return;
    audios.get(id)?.remove();
    audios.delete(id);
  });

  const end = (reason: GoneReason) => {
    if (gone) return;
    gone = true;
    cleanup();
    for (const fn of goneFns) fn(reason);
  };
  call.addEventListener("fatal", (e) => {
    const { code, message } = detailOf(e);
    end(code === 4004 || message === "kicked" || message === "erased" ? "kicked" : code === 4005 ? "ended" : "network");
  });

  // ── Who is talking ──────────────────────────────────────────────────────────
  let selfLevel = 0;
  let ctx: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  try {
    ctx = new AudioContext();
    analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    ctx.createMediaStreamSource(stream).connect(analyser);
  } catch { /* no Web Audio: self never shows as talking */ }
  const buf = new Float32Array(512);
  const loudAt = new Map<string, number>();
  const talking = (key: string, level: number, muted: boolean) => {
    const now = Date.now();
    if (!muted && level > TALK_LEVEL) loudAt.set(key, now);
    return !muted && now - (loudAt.get(key) ?? 0) < HOLD_MS;
  };

  const levelOf = (pc: RTCPeerConnection | null): number => {
    const r = pc?.getReceivers().find(x => x.track?.kind === "audio");
    const src = r?.getSynchronizationSources?.()[0];
    return src && performance.timeOrigin + performance.now() - src.timestamp < 1000 ? src.audioLevel ?? 0 : 0;
  };

  const tick = () => {
    if (analyser) {
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += v * v;
      selfLevel = Math.sqrt(sum / buf.length) * 3;
    }
    const mutedSelf = selfMuted || isServerMuted();
    const list: Speaker[] = [];
    if (self.sub) list.push({ sub: self.sub, name: self.name, talking: talking("self", selfLevel, mutedSelf), muted: mutedSelf, self: true });
    for (const p of call.remotePeers) {
      const muted = p.audioMuted || (!!p.sub && serverMuted.has(p.sub));
      list.push({ sub: p.sub ?? p.peerId, name: p.name, talking: talking(p.peerId, levelOf(call.peerConnection(p.peerId)), muted), muted, self: false });
    }
    const key = JSON.stringify(list);
    if (key !== last) { last = key; for (const fn of speakerFns) fn(list); }
  };
  const timer = setInterval(tick, POLL_MS);

  const cleanup = () => {
    clearInterval(timer);
    for (const el of audios.values()) el.remove();
    audios.clear();
    if (!opts.stream) stream.getTracks().forEach(t => t.stop());
    ctx?.close().catch(() => {});
  };

  try {
    await call.join();
  } catch (e) {
    gone = true;
    cleanup();
    throw e;
  }

  return {
    call,
    leave() { if (gone) return; gone = true; call.leave(); cleanup(); },
    muteSelf(on: boolean) { selfMuted = on; applySelfMute(); tick(); },
    onSpeakers(fn) { speakerFns.add(fn); if (last) fn(JSON.parse(last)); return () => speakerFns.delete(fn); },
    onGone(fn) { goneFns.add(fn); return () => goneFns.delete(fn); },
  };
}
