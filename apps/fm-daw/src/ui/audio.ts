// Page side of the audio thread: creates the AudioContext on a click (browsers
// require one), loads the worklet, and fetches the wasm engine on request.
import workletUrl from "../engine/worklet.ts?worker&url";
import type { FromWorklet, ToWorklet } from "../engine/messages.ts";

export const START_DB = -12;
export const dbToGain = (db: number) => (db <= -60 ? 0 : Math.pow(10, db / 20));

export class AudioOut {
  readonly ctx: AudioContext;
  readonly node: AudioWorkletNode;
  private constructor(ctx: AudioContext, node: AudioWorkletNode) { this.ctx = ctx; this.node = node; }

  static async start(onMessage: (m: FromWorklet) => void): Promise<AudioOut> {
    const ctx = new AudioContext({ latencyHint: "interactive" });
    await ctx.audioWorklet.addModule(workletUrl);
    const node = new AudioWorkletNode(ctx, "fm-daw", { numberOfInputs: 0, outputChannelCount: [2] });
    node.port.onmessage = (e: MessageEvent<FromWorklet>) => onMessage(e.data);
    node.connect(ctx.destination);
    await ctx.resume();
    const out = new AudioOut(ctx, node);
    // what the player hears lags what we schedule by this much; recording subtracts it
    out.send({ t: "latency", seconds: (ctx.outputLatency || 0) + ctx.baseLatency });
    return out;
  }

  send(m: ToWorklet, transfer: Transferable[] = []) { this.node.port.postMessage(m, transfer); }

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
