// One track's sound: FM (algorithm, four operators) or analog (saws and sub,
// filter, LFO), then the drum-ish extras (pitch envelope, noise) and the mix.
import { ALGOS, OPS, P } from "../engine/params.ts";
import type { TrackDoc } from "../project.ts";
import { Slider } from "./Slider.tsx";

export function PatchEditor(props: {
  track: TrackDoc;
  color: string;
  onParam(i: number, v: number): void;
  onRandom(): void;
  onReset(): void;
  onAudition(): void;
}) {
  const { track: t, onParam } = props;
  const p = t.params;
  const algo = ALGOS[p[P.ALGO] | 0];
  const analog = p[P.MODE] >= 0.5;
  return (
    <section className="patch" style={{ "--track": props.color } as React.CSSProperties} aria-label={`${t.name} sound`}>
      <header className="patch-head">
        <h2>{t.name} <span className="dim">· {analog ? "analog" : "4-op FM"}</span></h2>
        <div className="seg" role="radiogroup" aria-label="Voice">
          <button role="radio" aria-checked={!analog} className={analog ? "" : "on"} onClick={() => onParam(P.MODE, 0)}>FM</button>
          <button role="radio" aria-checked={analog} className={analog ? "on" : ""} onClick={() => onParam(P.MODE, 1)}>Analog</button>
        </div>
        <div className="patch-actions">
          <button className="ghost" onClick={props.onAudition} title="Play the track's note">Audition</button>
          <button className="ghost" onClick={props.onRandom} title="A random patch, with levels kept safe">Randomize</button>
          <button className="ghost" onClick={props.onReset}>Reset</button>
        </div>
      </header>

      {analog ? <AnalogVoice p={p} onParam={onParam} /> : <>
      <div className="algos" role="radiogroup" aria-label="Algorithm">
        {ALGOS.map((a, i) => (
          <button key={a.name} role="radio" aria-checked={(p[P.ALGO] | 0) === i}
            className={(p[P.ALGO] | 0) === i ? "algo on" : "algo"} onClick={() => onParam(P.ALGO, i)}>
            <strong>{a.name}</strong><span>{a.diagram}</span>
          </button>
        ))}
      </div>

      <div className="ops">
        {Array.from({ length: OPS }, (_, op) => {
          const carrier = (algo.carriers as readonly number[]).includes(op);
          return (
            <fieldset key={op} className={carrier ? "op carrier" : "op"}>
              <legend><span className="silk">Op {op + 1}</span> <span className="role">{carrier ? "carrier" : "modulator"}</span></legend>
              <Slider label="Ratio" index={P.ratio(op)} value={p[P.ratio(op)]} log unit="x" onChange={(v) => onParam(P.ratio(op), snapRatio(v))} />
              <Slider label={carrier ? "Level" : "Depth"} index={P.level(op)} value={p[P.level(op)]} onChange={(v) => onParam(P.level(op), v)} />
              <Slider label="Attack" index={P.attack(op)} value={p[P.attack(op)]} log unit="s" onChange={(v) => onParam(P.attack(op), v)} />
              <Slider label="Decay" index={P.decay(op)} value={p[P.decay(op)]} log unit="s" onChange={(v) => onParam(P.decay(op), v)} />
              <Slider label="Sustain" index={P.sustain(op)} value={p[P.sustain(op)]} onChange={(v) => onParam(P.sustain(op), v)} />
              <Slider label="Release" index={P.release(op)} value={p[P.release(op)]} log unit="s" onChange={(v) => onParam(P.release(op), v)} />
            </fieldset>
          );
        })}
      </div>
      </>}

      <div className="voice">
        <fieldset className="op">
          <legend><span className="silk">{analog ? "Pitch" : "Op 4 feedback · pitch"}</span></legend>
          {!analog && <Slider label="Feedback" index={P.FEEDBACK} value={p[P.FEEDBACK]} onChange={(v) => onParam(P.FEEDBACK, v)} />}
          <Slider label="Pitch drop" index={P.PITCH_AMT} value={p[P.PITCH_AMT]} unit="st" onChange={(v) => onParam(P.PITCH_AMT, v)} />
          <Slider label="Pitch time" index={P.PITCH_DECAY} value={p[P.PITCH_DECAY]} log unit="s" onChange={(v) => onParam(P.PITCH_DECAY, v)} />
        </fieldset>
        <fieldset className="op">
          <legend><span className="silk">Noise</span></legend>
          <Slider label="Level" index={P.NOISE} value={p[P.NOISE]} onChange={(v) => onParam(P.NOISE, v)} />
          <Slider label="Decay" index={P.NOISE_DECAY} value={p[P.NOISE_DECAY]} log unit="s" onChange={(v) => onParam(P.NOISE_DECAY, v)} />
          <Slider label="Tone" index={P.NOISE_TONE} value={p[P.NOISE_TONE]} onChange={(v) => onParam(P.NOISE_TONE, v)} />
        </fieldset>
        <fieldset className="op">
          <legend><span className="silk">Mix</span></legend>
          <Slider label="Gain" index={P.GAIN} value={p[P.GAIN]} onChange={(v) => onParam(P.GAIN, v)} />
          <Slider label="Pan" index={P.PAN} value={p[P.PAN]} unit="pan" onChange={(v) => onParam(P.PAN, v)} />
          <Slider label="Velocity" index={P.VEL} value={p[P.VEL]} onChange={(v) => onParam(P.VEL, v)} />
          <Slider label="Vel tone" index={P.VEL_TONE} value={p[P.VEL_TONE]} onChange={(v) => onParam(P.VEL_TONE, v)} />
          <Slider label="Send" index={P.SEND} value={p[P.SEND]} onChange={(v) => onParam(P.SEND, v)} />
        </fieldset>
      </div>
    </section>
  );
}

const hz = (x: number) => { const f = 20 * Math.pow(2, x * 10); return f < 1000 ? `${Math.round(f)} Hz` : `${(f / 1000).toFixed(1)} kHz`; };
const signed = (v: number) => `${v > 0 ? "+" : ""}${Math.round(v * 100)}%`;
const rate = (v: number) => (v < 1 ? `${(1 / v).toFixed(1)} s` : `${v.toFixed(1)} Hz`);

function AnalogVoice({ p, onParam }: { p: number[]; onParam(i: number, v: number): void }) {
  const s = (label: string, i: number, extra: { log?: boolean; unit?: string; format?: (v: number) => string } = {}) =>
    <Slider label={label} index={i} value={p[i]} {...extra} onChange={(v) => onParam(i, v)} />;
  return (
    <div className="ops">
      <fieldset className="op carrier">
        <legend><span className="silk">Oscillators</span> <span className="role">2 saws + sub</span></legend>
        {s("Level", P.level(0))}
        {s("Detune", P.DETUNE, { format: (v) => `±${Math.round(v * 50)} ct` })}
        {s("Sub", P.SUB)}
        {s("Glide", P.GLIDE, { format: (v) => (v === 0 ? "off" : `${Math.round(v * 1000)} ms`) })}
        {s("Drive", P.DRIVE)}
      </fieldset>
      <fieldset className="op carrier">
        <legend><span className="silk">Filter</span> <span className="role">low-pass</span></legend>
        {s("Cutoff", P.CUTOFF, { format: hz })}
        {s("Resonance", P.RES)}
        {s("Env amount", P.FENV_AMT, { format: signed })}
        {s("Env attack", P.FENV_ATTACK, { log: true, unit: "s" })}
        {s("Env decay", P.FENV_DECAY, { log: true, unit: "s" })}
      </fieldset>
      <fieldset className="op carrier">
        <legend><span className="silk">Amp</span> <span className="role">envelope</span></legend>
        {s("Attack", P.attack(0), { log: true, unit: "s" })}
        {s("Decay", P.decay(0), { log: true, unit: "s" })}
        {s("Sustain", P.sustain(0))}
        {s("Release", P.release(0), { log: true, unit: "s" })}
      </fieldset>
      <fieldset className="op">
        <legend><span className="silk">LFO</span> <span className="role">free-running</span></legend>
        {s("Rate", P.LFO_RATE, { log: true, format: rate })}
        {s("To cutoff", P.LFO_CUT)}
        {s("To pitch", P.LFO_PITCH)}
      </fieldset>
    </div>
  );
}

// Integer and classic DX ratios are where FM sounds musical; snap to them when close.
const NICE = [0.25, 0.5, 0.75, 1, 1.41, 1.5, 2, 2.5, 2.73, 3, 3.5, 3.91, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
function snapRatio(v: number) {
  for (const n of NICE) if (Math.abs(v - n) / n < 0.025) return n;
  return Math.round(v * 100) / 100;
}
