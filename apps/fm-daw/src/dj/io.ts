// The decks' sound card, in and out. OUT: the master (what the room's PA and REC get) also plays to an output you
// pick: an interface's outputs, or a virtual cable into OBS or a streaming app, so a set goes anywhere your computer
// can send sound, with nothing uploaded by us. IN: an input (a turntable, a mic, another computer) into mixer channel
// 1 or 4, the two the decks leave free, raw (no echo cancelling, no noise gate, no auto gain), in stereo when it is.
// Picking an output needs `setSinkId` on a media element (Chrome, Edge, Firefox 116+); Safari plays to the default.
import { DECK_CHANNEL, type Ch, type Mixer } from "./mixer.ts";

export interface Device { id: string; label: string }
/** The channels a line in may take: the ones no deck plays into. */
export const LINE_CHANNELS: readonly Ch[] = ([0, 1, 2, 3] as const).filter((c) => !(DECK_CHANNEL as readonly number[]).includes(c));

type Sinkable = HTMLAudioElement & { setSinkId(id: string): Promise<void>; sinkId: string };
const sinkable = (a: HTMLAudioElement): a is Sinkable => "setSinkId" in a;

interface LineIn { id: string; stream: MediaStream; src: MediaStreamAudioSourceNode }

export class DeckIo {
  private out: { id: string; tag: Sinkable } | null = null;
  private ins = new Map<Ch, LineIn>();
  constructor(private readonly mixer: Mixer) {}

  /** Whether this browser can send to an output other than the default one. */
  static canPickOutput(): boolean { return typeof HTMLAudioElement !== "undefined" && "setSinkId" in HTMLAudioElement.prototype; }

  /** The sound card's inputs and outputs. `names`: ask for the microphone once, so the browser gives their names. */
  async devices(names = false): Promise<{ inputs: Device[]; outputs: Device[] }> {
    if (names) {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => null);
      s?.getTracks().forEach((t) => t.stop());
    }
    const all = await navigator.mediaDevices.enumerateDevices();
    const of = (kind: MediaDeviceKind) => all.filter((d) => d.kind === kind && d.deviceId).map((d, i) => ({ id: d.deviceId, label: d.label || `${kind === "audioinput" ? "Input" : "Output"} ${i + 1}` }));
    return { inputs: of("audioinput"), outputs: of("audiooutput") };
  }

  /** Send the master to output `id` as well as your speakers (null: stop). Resolves false when the output can't be used. */
  async sendTo(id: string | null): Promise<boolean> {
    this.out?.tag.pause();
    if (this.out) this.out.tag.srcObject = null;
    this.out = null;
    if (id === null) return true;
    const tag = new Audio();
    if (!sinkable(tag)) return false;
    tag.srcObject = this.mixer.stream;
    try { await tag.setSinkId(id); await tag.play(); } catch { tag.srcObject = null; return false; }
    this.out = { id, tag };
    return true;
  }

  /** Input `id` into channel `ch` (1 or 4 on the mixer; null: unplug it). Resolves false when the input can't be opened. */
  async lineIn(ch: Ch, id: string | null): Promise<boolean> {
    if (!LINE_CHANNELS.includes(ch)) return false;
    const had = this.ins.get(ch);
    if (had) { had.src.disconnect(); had.stream.getTracks().forEach((t) => t.stop()); this.ins.delete(ch); }
    if (id === null) return true;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: id }, echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: { ideal: 2 } } }).catch(() => null);
    if (!stream) return false;
    const src = this.mixer.ctx.createMediaStreamSource(stream);
    src.connect(this.mixer.channels[ch]!.input);
    this.ins.set(ch, { id, stream, src });
    return true;
  }

  /** What's plugged: the output the master goes to, and each line in by channel. */
  state(): { out: string | null; playing: boolean; ins: Partial<Record<Ch, string>> } {
    return { out: this.out?.id ?? null, playing: !!this.out && !this.out.tag.paused, ins: Object.fromEntries([...this.ins].map(([c, l]) => [c, l.id])) };
  }
}
