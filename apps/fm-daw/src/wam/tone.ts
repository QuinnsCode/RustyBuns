// Test Tone as a Web Audio Module: a sine per held key, one Level slider. FM DAW carries it so the browser's plugin
// host (src/ui/wam.ts) can be tried with no network and no site to trust, as the desktop's CLAP host carries its
// own Test Tone. It is built on the WAM working group's SDK the way a plugin from anywhere is, so it also proves
// the host speaks to a real one.
import { addFunctionModule, WamNode, WebAudioModule } from "@webaudiomodules/sdk";
import type { WamMidiData, WamParameterInfoMap } from "@webaudiomodules/api";
import type { WamSDKBaseModuleScope } from "@webaudiomodules/sdk/src/types";

declare const sampleRate: number;
declare function registerProcessor(name: string, ctor: unknown): void;
declare const webAudioModules: { getModuleScope(moduleId: string): WamSDKBaseModuleScope };

const ID = "com.rustybuns.fm-daw.tone";

/** The audio thread's half. The SDK sends this function over as text, so it uses nothing from outside itself. */
const toneProcessor = (moduleId: string) => {
  const need = <T,>(v: T | undefined): T => { if (!v) throw new Error("the WAM SDK isn't loaded"); return v; };
  const scope = webAudioModules.getModuleScope(moduleId);
  const WamProcessor = need(scope.WamProcessor), Info = need(scope.WamParameterInfo);
  interface Voice { key: number; phase: number; step: number; amp: number; to: number }
  class Tone extends WamProcessor {
    voices: Voice[] = [];
    _generateWamParameterInfo(): WamParameterInfoMap {
      return { level: new Info("level", { type: "float", label: "Level", defaultValue: 0.5, minValue: 0, maxValue: 1 }) };
    }
    _onMidi(midi: WamMidiData) {
      const [status, key, vel] = midi.bytes;
      const kind = status & 0xf0;
      if (kind === 0x90 && vel > 0) this.voices.push({ key, phase: 0, step: (2 * Math.PI * 440 * 2 ** ((key - 69) / 12)) / sampleRate, amp: 0, to: vel / 127 });
      else if (kind === 0x80 || kind === 0x90) for (const v of this.voices) if (v.key === key) v.to = 0;
    }
    _process(start: number, end: number, _inputs: Float32Array[][], outputs: Float32Array[][]) {
      const out = outputs[0];
      if (!out?.[0]) return;
      const level = this._parameterInterpolators.level.values;
      for (let i = start; i < end; i++) {
        let x = 0;
        for (const v of this.voices) {
          v.amp += (v.to - v.amp) * 0.002;   // a few ms up and down, so a key doesn't click
          x += Math.sin(v.phase) * v.amp;
          v.phase += v.step;
        }
        x *= level[i];
        for (const ch of out) ch[i] = x;
      }
      this.voices = this.voices.filter((v) => v.to > 0 || v.amp > 1e-4);
    }
  }
  try { registerProcessor(moduleId, Tone); } catch { /* a second Test Tone: the first one registered it */ }
};

class ToneNode extends WamNode {
  static override async addModules(ctx: BaseAudioContext, moduleId: string) {
    await super.addModules(ctx, moduleId);
    await addFunctionModule(ctx.audioWorklet, toneProcessor, moduleId);
  }
}

export default class TestTone extends WebAudioModule<ToneNode> {
  constructor(groupId: string, ctx: BaseAudioContext) {
    super(groupId, ctx);
    this._descriptor = { ...this._descriptor, identifier: ID, name: "Test Tone", vendor: "FM DAW", isInstrument: true, hasAudioInput: false };
  }
  override async createAudioNode() {
    await ToneNode.addModules(this.audioContext, this.moduleId);
    const node = new ToneNode(this, { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
    await node._initialize();
    return node;
  }
}
