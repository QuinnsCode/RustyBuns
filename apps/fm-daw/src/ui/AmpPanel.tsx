// A track's Amp insert: pick a Q Amp head (or none) and turn its knobs, saved with the project.
// With the input on this track, Monitor plays the guitar through it live; it starts off, so a hot
// input never reaches the speakers until you ask, and the round trip says how late you'll hear yourself.
import { AMPS } from "../circuit/amps.ts";
import { AMP_KNOBS, TREM_KNOBS, TrackAmp } from "../amp/track-amp.ts";
import { check } from "@rustybuns/util/guard";

const LABEL: Record<(typeof AMP_KNOBS)[number] | (typeof TREM_KNOBS)[number], string> = {
  gain: "Gain", bass: "Bass", mid: "Mid", treble: "Treble", master: "Master", rate: "Rate", depth: "Depth",
};

/** A head at its own knobs: what picking it from Off starts at. */
export function freshAmp(id: string): TrackAmp | null {
  const head = AMPS.find((a) => a.id === id);
  return head ? check(TrackAmp, { amp: head.id, ...head.knobs }) : null;
}

export function AmpPanel(props: {
  name: string; amp: TrackAmp | undefined;
  onChange(amp: TrackAmp | null, group?: string): void;
  /** The input is on this track. */
  armed: boolean; monitor: boolean; onMonitor(on: boolean): void;
  /** Input plus output latency, ms, or null before the input is on. */
  roundTripMs: number | null;
  misses: number;
}) {
  const { amp } = props;
  const head = amp ? AMPS.find((a) => a.id === amp.amp) : undefined;
  const knobs = amp ? [...AMP_KNOBS, ...(head?.trem ? TREM_KNOBS : [])] : [];
  return (
    <section className="amp-insert" aria-label={`Amp on ${props.name}`}>
      <div className="toolbar">
        <label className="field inline"><span className="silk">Amp on {props.name}</span>
          <select value={amp?.amp ?? ""} aria-label="Amp head" onChange={(e) => {
            const v = e.currentTarget.value;
            props.onChange(v ? (amp ? { ...amp, amp: v as TrackAmp["amp"] } : freshAmp(v)) : null);
          }}>
            <option value="">Off</option>
            {AMPS.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
        {amp && (
          <button className={props.monitor ? "ghost on" : "ghost"} aria-pressed={props.monitor} disabled={!props.armed}
            onClick={() => props.onMonitor(!props.monitor)}
            title={props.armed ? "Hear the input through this amp as you play (Rec still records it dry, so you can change the amp after)" : "Turn the input on, on this track, to play through the amp"}>
            Monitor
          </button>
        )}
        {amp && props.roundTripMs !== null && <span className="silk" title="How late you hear what you play: the input's latency plus the output's">Round trip {Math.round(props.roundTripMs)} ms</span>}
        {props.misses > 0 && <span className="silk" role="status" title="The circuit solver missed some samples: the amp is working too hard">Missed {props.misses}</span>}
      </div>
      {head && amp ? (<>
        <p className="silk">{head.blurb}</p>
        <div className="faders">
          {knobs.map((k) => (
            <label key={k} className="fader">
              <span className="silk">{LABEL[k]}</span>
              <input type="range" min={0} max={100} value={Math.round(amp[k] * 10)} aria-label={LABEL[k]}
                onChange={(e) => props.onChange({ ...amp, [k]: Number(e.currentTarget.value) / 10 }, `amp:${k}`)} />
              <output>{amp[k].toFixed(1)}</output>
            </label>
          ))}
        </div>
      </>) : <p className="silk">No amp on this track. Pick a head to play its take, or your guitar live, through it.</p>}
    </section>
  );
}
