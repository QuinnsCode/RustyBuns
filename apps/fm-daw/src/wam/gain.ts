// Gain as a Web Audio Module effect (#5359): sound in, the same sound out at its Gain slider. FM DAW carries it so a
// track's Insert can be tried with no network and no site to trust, as Test Tone (src/wam/tone.ts) is for Plays. It is
// built on the WAM working group's SDK the way an effect from anywhere is, so it also proves the host speaks to one.
import { addFunctionModule, WamNode, WebAudioModule } from "@webaudiomodules/sdk";
import type { WamParameterInfoMap } from "@webaudiomodules/api";
import type { WamSDKBaseModuleScope } from "@webaudiomodules/sdk/src/types";

declare function registerProcessor(name: string, ctor: unknown): void;
declare const webAudioModules: { getModuleScope(moduleId: string): WamSDKBaseModuleScope };

const ID = "com.rustybuns.fm-daw.gain";

/** The audio thread's half. The SDK sends this function over as text, so it uses nothing from outside itself. */
const gainProcessor = (moduleId: string) => {
  const need = <T,>(v: T | undefined): T => { if (!v) throw new Error("the WAM SDK isn't loaded"); return v; };
  const scope = webAudioModules.getModuleScope(moduleId);
  const WamProcessor = need(scope.WamProcessor), Info = need(scope.WamParameterInfo);
  class Gain extends WamProcessor {
    _generateWamParameterInfo(): WamParameterInfoMap {
      return { gain: new Info("gain", { type: "float", label: "Gain", defaultValue: 1, minValue: 0, maxValue: 1 }) };
    }
    _process(start: number, end: number, inputs: Float32Array[][], outputs: Float32Array[][]) {
      const inp = inputs[0], out = outputs[0];
      if (!out?.[0]) return;
      const gain = this._parameterInterpolators.gain.values;
      for (let c = 0; c < out.length; c++) {
        // a track's sound comes in mono: every output channel takes it
        const src = inp?.[c] ?? inp?.[0], ch = out[c];
        for (let i = start; i < end; i++) ch[i] = (src?.[i] ?? 0) * gain[i];
      }
    }
  }
  try { registerProcessor(moduleId, Gain); } catch { /* a second Gain: the first one registered it */ }
};

class TrimNode extends WamNode {
  static override async addModules(ctx: BaseAudioContext, moduleId: string) {
    await super.addModules(ctx, moduleId);
    await addFunctionModule(ctx.audioWorklet, gainProcessor, moduleId);
  }
}

export default class Gain extends WebAudioModule<TrimNode> {
  constructor(groupId: string, ctx: BaseAudioContext) {
    super(groupId, ctx);
    this._descriptor = { ...this._descriptor, identifier: ID, name: "Gain", vendor: "FM DAW", isInstrument: false, hasAudioInput: true, hasAudioOutput: true };
  }
  override async createAudioNode() {
    await TrimNode.addModules(this.audioContext, this.moduleId);
    const node = new TrimNode(this, { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
    await node._initialize();
    return node;
  }
}
