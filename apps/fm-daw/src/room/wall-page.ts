// The sound wall on a page (WALL.md): its audio thread (wall-worklet.ts) heard from where its Q Out stands, and the
// module list that brings one to your hands. The gear room (main.ts) and every studio's gear wall (../studio/main.ts)
// run the same, so a sesh's wall plays on every listener's machine from the sesh's patch.
import wallWorkletUrl from "./wall-worklet.ts?worker&url";
import type { FromWall, ToWall } from "./wall-worklet.ts";
import type { WallSpec } from "../wall/wall.ts";
import { PANELS } from "../../circuits/wall-panels.ts";

export class WallLine {
  private key = "";
  private got: FromWall | null = null;
  private sentTempo = { bpm: 0, synced: false, at: 0 };
  private constructor(private readonly node: AudioWorkletNode, private readonly pan: PannerNode) {
    node.port.onmessage = (e: MessageEvent<FromWall>) => { this.got = e.data; };
  }

  /** The wall's thread on `ctx`, out through a panner (as a guitar's cab) into `to`. */
  static async start(ctx: AudioContext, to: AudioNode): Promise<WallLine> {
    await ctx.audioWorklet.addModule(wallWorkletUrl);
    const node = new AudioWorkletNode(ctx, "q-wall", { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
    const pan = new PannerNode(ctx, { panningModel: "HRTF", distanceModel: "inverse", refDistance: 1, rolloffFactor: 0.8 });
    node.connect(pan).connect(new GainNode(ctx, { gain: 0.5 })).connect(to);
    return new WallLine(node, pan);
  }

  /** The wall as the patch has it now (`listen().wall.spec`): sent on only when it changed. */
  set(spec: WallSpec) {
    const key = JSON.stringify(spec);
    if (key === this.key) return;
    this.key = key;
    this.node.port.postMessage({ t: "wall", spec } satisfies ToWall);
  }
  /** Where its Q Out stands (metres; y is the module's height). */
  place(x: number, y: number, z: number) { this.pan.positionX.value = x; this.pan.positionY.value = y; this.pan.positionZ.value = z; }
  /** A key down (velocity 0 to 1) or up (0) on Q Keys. */
  note(midi: number, vel: number) { this.node.port.postMessage({ t: "note", midi, vel } satisfies ToWall); }
  /**
   * The sesh's tempo, and the band's beat now when its clock is known (null when not): Q Keys' clock and Q Steps follow
   * it. Sent on when either changes, and every 4 s while the beat is known, so the wall's count stays on the band's.
   */
  tempo(bpm: number, beat: number | null) {
    const now = performance.now(), synced = beat !== null, was = this.sentTempo;
    if (bpm === was.bpm && synced === was.synced && (!synced || now - was.at < 4000)) return;
    this.sentTempo = { bpm, synced, at: now };
    this.node.port.postMessage({ t: "tempo", bpm, beat } satisfies ToWall);
  }

  /** What each module is doing on the thread now, and its load: for the probes. */
  async state(): Promise<FromWall | null> {
    const was = this.got;
    this.node.port.postMessage({ t: "state" } satisfies ToWall);
    for (let i = 0; i < 50 && this.got === was; i++) await new Promise((r) => setTimeout(r, 10));
    return this.got;
  }
}

/** The module list (a `#modules-list`): a button for each module, which `pick` brings to your hands. Filled once. */
export function moduleButtons(list: HTMLElement, pick: (kind: string) => void) {
  if (list.childElementCount) return;
  for (const p of PANELS) {
    const b = document.createElement("button");
    b.type = "button";
    const name = document.createElement("b"), what = document.createElement("span");
    name.textContent = p.name;
    what.textContent = `${p.what}, ${p.hp} HP`;
    b.append(name, what);
    b.addEventListener("click", () => pick(p.id));
    list.append(b);
  }
}
