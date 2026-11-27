// Page side of the audio thread: creates the AudioContext on a click (browsers
// require one), loads the worklet, and fetches the wasm engine on request.
import workletUrl from "../engine/worklet.ts?worker&url";
import type { FromWorklet, ToWorklet } from "../engine/messages.ts";
import { TRACKS } from "../engine/params.ts";
import type { ShapeAt } from "../desk.ts";

export const START_DB = -12;
export const dbToGain = (db: number) => (db <= -60 ? 0 : Math.pow(10, db / 20));

/** The engine's input for the aux sends of guitars heard on calls (src/studio/guitar-line.ts): the Space bus, then aux 2's. */
export const CALL_SENDS = 2;

export class AudioOut {
  readonly ctx: AudioContext;
  readonly node: AudioWorkletNode;
  /** What leaves the speakers, for Shape's spectrum. */
  readonly analyser: AnalyserNode;
  /** The one channel whose Shape is open (`listen`), copied out of the mix as it plays: the engine's third output, for that Shape's spectrum. */
  readonly heard: AnalyserNode;
  /** Each page plugin's own sound, before its fader, on its track's channel: the engine's fourth input, sent to the sesh (src/studio/plugin-line.ts). */
  readonly webTaps: ChannelMergerNode;
  /** Each track's FM sound bound for a web effect (src/ui/wam.ts), a channel a track: the engine's second output. */
  readonly inserts: ChannelSplitterNode;
  /** What each track's web effect hears: its channel of `inserts`, and a page plugin's sound when the track has one (#5551). */
  readonly fxIn: GainNode[];
  /** Each page plugin's own sound, before its fader: on to `webPost`, or into its track's effect while it has one. */
  readonly webIn: GainNode[];
  /** A page plugin's sound after its track's effect (or with none), before its fader: `web` hangs the fader here. */
  readonly webPost: GainNode[];
  /** What each track's web effect plays: into its page plugin's fader while the track has one, else straight to `ret`. */
  readonly fxOut: GainNode[];
  /** Each track's way back into the engine, two sides (a mono sound on both): its channels of `returns`. */
  readonly ret: GainNode[];
  /** The page's sound coming back, two channels a track (2t, 2t + 1): the engine's fifth input pans and sends it (#5617). */
  readonly returns: ChannelMergerNode;
  private inserted = new Set<number>();
  private playing = new Set<number>();
  /** @param speakers where the mix plays: the context's speakers, or what `start` was handed in front of them (the jam room's brick wall) */
  private constructor(ctx: AudioContext, node: AudioWorkletNode, readonly speakers: AudioNode) {
    this.ctx = ctx; this.node = node;
    this.analyser = new AnalyserNode(ctx, { fftSize: 8192, smoothingTimeConstant: 0.8 });
    node.connect(this.analyser);
    this.heard = new AnalyserNode(ctx, { fftSize: 8192, smoothingTimeConstant: 0.8 });
    node.connect(this.heard, 2);
    this.webTaps = new ChannelMergerNode(ctx, { numberOfInputs: TRACKS });
    this.webTaps.connect(node, 0, 3);
    this.inserts = new ChannelSplitterNode(ctx, { numberOfOutputs: TRACKS });
    node.connect(this.inserts, 1);
    this.fxIn = Array.from({ length: TRACKS }, (_, t) => { const g = new GainNode(ctx); this.inserts.connect(g, t); return g; });
    this.returns = new ChannelMergerNode(ctx, { numberOfInputs: 2 * TRACKS });
    this.returns.connect(node, 0, 4);
    const stereo = { channelCount: 2, channelCountMode: "explicit", channelInterpretation: "speakers" } as const;
    this.ret = Array.from({ length: TRACKS }, (_, t) => {
      const g = new GainNode(ctx, stereo), split = new ChannelSplitterNode(ctx, { numberOfOutputs: 2 });
      g.connect(split);
      split.connect(this.returns, 0, 2 * t);
      split.connect(this.returns, 1, 2 * t + 1);
      return g;
    });
    this.webPost = Array.from({ length: TRACKS }, () => new GainNode(ctx, stereo));
    this.webIn = Array.from({ length: TRACKS }, (_, t) => { const g = new GainNode(ctx, stereo); g.connect(this.webPost[t]!); return g; });
    this.fxOut = Array.from({ length: TRACKS }, (_, t) => { const g = new GainNode(ctx, stereo); g.connect(this.ret[t]!); return g; });
  }

  /**
   * Track `t`'s web effect in (`on`) or out. With a page plugin on the track, its sound goes through the effect and then
   * its fader, as a bounce has it (#5617); an FM track's sound left the engine after its fader, so its effect plays back.
   */
  routeWeb(t: number, on: boolean) {
    if (on) this.inserted.add(t); else this.inserted.delete(t);
    this.rewire(t);
  }

  /** Track `t`'s page plugin plays through `fader` (null: it stopped): its sound into the track's effect, if any, then `fader`, then back to the engine. */
  web(t: number, fader: AudioNode | null) {
    const post = this.webPost[t];
    if (!post) return;
    try { post.disconnect(); } catch { /* not connected yet */ }
    if (fader) { post.connect(fader); fader.connect(this.ret[t]!); this.playing.add(t); } else this.playing.delete(t);
    this.rewire(t);
  }

  private rewire(t: number) {
    const inn = this.webIn[t], fx = this.fxOut[t];
    if (!inn || !fx) return;
    const on = this.inserted.has(t);
    try { inn.disconnect(); } catch { /* not connected yet */ }
    try { fx.disconnect(); } catch { /* not connected yet */ }
    inn.connect(on ? this.fxIn[t]! : this.webPost[t]!);
    fx.connect(on && this.playing.has(t) ? this.webPost[t]! : this.ret[t]!);
  }

  /** @param latency "playback" asks for a bigger buffer: more delay, and room for a busy page (picture first, #6475) */
  static async start(onMessage: (m: FromWorklet) => void, speakers: (ctx: AudioContext) => AudioNode = (ctx) => ctx.destination, latency: "interactive" | "playback" = "interactive"): Promise<AudioOut> {
    const ctx = new AudioContext({ latencyHint: latency });
    await ctx.audioWorklet.addModule(workletUrl);
    // inputs: yours (a guitar or mic), nothing (it was the page's own plugins, which come back on the returns now), the aux sends of guitars heard on calls (CALL_SENDS), the
    // page's plugins one track a channel, and the page's returns (two channels a track: web effects and page plugins). Outputs: the mix, each track's sound for its web effect, a channel each,
    // and the channel being listened to (mono), for its Shape's spectrum
    const node = new AudioWorkletNode(ctx, "fm-daw", { numberOfInputs: 5, numberOfOutputs: 3, outputChannelCount: [2, TRACKS, 1] });
    node.port.onmessage = (e: MessageEvent<FromWorklet>) => onMessage(e.data);
    const to = speakers(ctx);
    node.connect(to);
    await ctx.resume();
    const out = new AudioOut(ctx, node, to);
    // what the player hears lags what we schedule by this much; recording subtracts it
    out.send({ t: "latency", seconds: (ctx.outputLatency || 0) + ctx.baseLatency });
    return out;
  }

  send(m: ToWorklet, transfer: Transferable[] = []) { this.node.port.postMessage(m, transfer); }

  /** The analyser for a Shape's spectrum: the mix's for the master's, else `heard`, now copying that channel (null: none). */
  listen(at: ShapeAt | null): AnalyserNode {
    const master = !at || "master" in at;
    this.send({ t: "listen", at: master ? null : at });
    return master ? this.analyser : this.heard;
  }

  async useEngine(kind: "ts" | "rust") {
    if (kind === "ts") return this.send({ t: "engine", kind });
    const bytes = await fetchWasm();
    if (!bytes) throw new Error("No Rust engine in this build. Run `bun run build:native`, then rebuild.");
    this.send({ t: "engine", kind, bytes }, [bytes]);
  }
}

/** The Rust engine as wasm, or null when this build doesn't have it. */
export async function fetchWasm(): Promise<ArrayBuffer | null> {
  const res = await fetch(new URL("fm_daw.wasm", document.baseURI)).catch(() => null);
  return res?.ok ? res.arrayBuffer() : null;
}
