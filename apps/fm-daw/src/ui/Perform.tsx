// Playing live: hold a stutter, change the wobble's speed on the beat, ride
// the filter and wobble depth on one pad, bend the pitch. Works on whichever
// track is selected. Stutter and bend are the performance (not saved); the pad
// and the wobble rate move the patch, so they record into undo like a slider.
// While recording, stutter, bend and the pad also go into the track's
// automation, so the take plays back the way it was played.
import { useRef } from "react";
import { P, BEND_RANGE, LANE_BEND, LANE_STUTTER, LFO_DIV_LABELS } from "../engine/params.ts";
import type { Lane, TrackDoc } from "../project.ts";
import { forget, paramName, setLearning, useLearn } from "./learn.ts";

/** Stutter slices, in beats, with the key that holds each. */
export const STUTTERS: { beats: number; label: string; key: string }[] = [
  { beats: 1, label: "1/4", key: "V" }, { beats: 0.5, label: "1/8", key: "B" },
  { beats: 0.25, label: "1/16", key: "N" }, { beats: 0.125, label: "1/32", key: "M" },
];
/** The LFO_SYNC divisions worth a button on stage. */
const RATES = [3, 4, 5, 6, 7, 8];

export function Perform(props: {
  track: TrackDoc;
  color: string;
  repeat: number;
  bend: number;
  onRepeat(beats: number): void;
  onBend(semis: number): void;
  onParam(i: number, v: number): void;
  /** The pad: a param move that's recorded as automation while recording. */
  onPad(i: number, v: number): void;
  /** The track's automation, with a lane taken out. */
  onLanes(lanes: Lane[]): void;
}) {
  const { track: t, onParam } = props;
  const p = t.params;
  const analog = p[P.MODE] >= 0.5;
  const pad = useRef<HTMLDivElement>(null);
  const drag = (e: React.PointerEvent) => {
    if (e.type === "pointerdown") (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    else if (!(e.buttons & 1)) return;
    const r = pad.current!.getBoundingClientRect();
    const x = Math.min(Math.max((e.clientX - r.left) / r.width, 0), 1);
    const y = Math.min(Math.max(1 - (e.clientY - r.top) / r.height, 0), 1);
    if (analog) props.onPad(P.CUTOFF, 0.15 + x * 0.7);
    props.onPad(P.LFO_CUT, y);
  };
  const cutX = analog ? (p[P.CUTOFF] - 0.15) / 0.7 : 0.5;
  const hold = (beats: number) => ({
    onPointerDown: (e: React.PointerEvent) => { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); props.onRepeat(beats); },
    onPointerUp: () => props.onRepeat(0),
    onPointerCancel: () => props.onRepeat(0),
  });
  return (
    <section className="perform" style={{ "--track": props.color } as React.CSSProperties} aria-label={`Perform on ${t.name}`}>
      <div className="col">
        <span className="silk">Stutter · hold</span>
        <div className="seg">
          {STUTTERS.map((s) => (
            <button key={s.beats} className={props.repeat === s.beats ? "on" : ""} {...hold(s.beats)} title={`Hold to repeat the last ${s.label} (${s.key})`}>
              {s.label}<kbd>{s.key}</kbd>
            </button>
          ))}
        </div>
        <span className="silk">Wobble rate · {t.name}</span>
        <div className="seg">
          {RATES.map((r) => (
            <button key={r} className={(p[P.LFO_SYNC] | 0) === r ? "on" : ""}
              onClick={() => { onParam(P.LFO_SYNC, r); if (p[P.LFO_CUT] < 0.05) onParam(P.LFO_CUT, 0.4); }}>{LFO_DIV_LABELS[r]}</button>
          ))}
        </div>
      </div>
      <div className="col">
        <span className="silk">{analog ? "Cutoff ↔ · wobble depth ↕" : "Wobble depth ↕"}</span>
        <div className="xy" ref={pad} onPointerDown={drag} onPointerMove={drag} role="slider" aria-label="Filter and wobble pad"
          aria-valuenow={Math.round(p[P.LFO_CUT] * 100)}>
          <div className="puck" style={{ left: `${cutX * 100}%`, top: `${(1 - p[P.LFO_CUT]) * 100}%` }} />
          <span className="axis" style={{ left: 6, bottom: 4 }}>{analog ? "dark" : ""}</span>
          <span className="axis" style={{ right: 6, bottom: 4 }}>{analog ? "bright" : ""}</span>
          <span className="axis" style={{ left: 6, top: 4 }}>wobble</span>
        </div>
      </div>
      <div className="col">
        <span className="silk">Bend {props.bend > 0 ? "+" : ""}{props.bend.toFixed(1)} st · springs back</span>
        <input className="bend" type="range" min={-BEND_RANGE} max={BEND_RANGE} step={0.1} value={props.bend}
          onChange={(e) => props.onBend(Number(e.currentTarget.value))}
          onPointerUp={() => props.onBend(0)} onKeyUp={() => props.onBend(0)} aria-label="Pitch bend" />
        <p className="dim keys-help">MIDI: the pitch wheel bends ±2; knobs move the selected track's params as mapped below.</p>
        <Moves lanes={t.auto ?? []} onLanes={props.onLanes} />
        <Learn />
      </div>
    </section>
  );
}

const laneName = (i: number) => (i === LANE_BEND ? "bend" : i === LANE_STUTTER ? "stutter" : paramName(i));

/** The track's automation lanes (recorded moves and a song's sweeps), each one clearable. */
function Moves({ lanes, onLanes }: { lanes: Lane[]; onLanes(lanes: Lane[]): void }) {
  if (!lanes.length) return <span className="dim keys-help">Record (R) and play the stutter, bend or pad: the moves are kept.</span>;
  return (
    <ul className="learn-map" aria-label="Automation on this track">
      {lanes.map((l) => (
        <li key={l.i}>Moves: {laneName(l.i)}
          <button className="ghost" onClick={() => onLanes(lanes.filter((x) => x.i !== l.i))} title={`Clear the ${laneName(l.i)} automation (undo brings it back)`}
            aria-label={`Clear ${laneName(l.i)} automation`}>×</button>
        </li>
      ))}
    </ul>
  );
}

/** MIDI learn: turn it on, touch a slider, move a knob. */
function Learn() {
  const l = useLearn();
  return (<>
    <div className="seg" style={{ justifySelf: "start" }}>
      <button className={l.on ? "on" : ""} aria-pressed={l.on} onClick={() => setLearning(!l.on)}
        title="Touch any slider, then move a knob or fader on your MIDI controller">MIDI learn</button>
    </div>
    {l.on && <span className="dim keys-help">{l.armed ? `Move a knob for ${l.armed.label}…` : "Touch a slider below…"}</span>}
    <ul className="learn-map" aria-label="MIDI mappings">
      {l.map.map((m) => (
        <li key={m.cc}>CC {m.cc} → {paramName(m.i)}
          {l.on && <button className="ghost" onClick={() => forget(m.cc)} title={`Forget CC ${m.cc}`} aria-label={`Forget CC ${m.cc}`}>×</button>}
        </li>
      ))}
    </ul>
  </>);
}
