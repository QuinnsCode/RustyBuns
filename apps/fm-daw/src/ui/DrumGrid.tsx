// The drum machine view: one row per drum track, one cell per step of the
// view's grid (a 16th zoomed in, coarser zoomed out). A cell is lit if any
// note starts inside it, and a free-played hit is marked where it sits in
// its step (striped while it is off the 16ths). Click toggles, shift-click
// accents in place; with Snap on, a click puts a free hit on its step first.
import { useState } from "react";
import type { Note, TrackDoc } from "../project.ts";
import { cellsFor, FINE, toggle } from "../steps.ts";
import { Icon, MAGNET } from "./PianoRoll.tsx";
import { Playhead } from "./Playhead.tsx";

const SNAP_KEY = "fm-daw.drum-snap";

export function DrumGrid(props: {
  tracks: TrackDoc[];
  colors: string[];
  selected: number;
  loopBeats: number;
  /** Where this window starts in the song, beats (for the playhead). */
  from?: number;
  /** Beats per cell: a 16th, or coarser zoomed out (view.ts gridFor). */
  step?: number;
  onSelect(i: number): void;
  onNotes(i: number, notes: Note[]): void;
  onAudition(i: number): void;
}) {
  const step = props.step ?? FINE;
  const steps = Math.max(1, Math.round(props.loopBeats / step));
  const drums = props.tracks.map((t, i) => ({ t, i })).filter(({ t }) => t.kind === "drum");
  // off unless asked: a free hit stays where it was played
  const [snapOn, setSnapState] = useState(() => { try { return localStorage.getItem(SNAP_KEY) === "1"; } catch { return false; } });
  const setSnap = (on: boolean) => { setSnapState(on); try { localStorage.setItem(SNAP_KEY, on ? "1" : "0"); } catch { /* private mode */ } };
  return (
    <div className="grid-wrap" role="grid" aria-label="Drum steps">
      <div className="roll-tools">
        <button className={snapOn ? "ghost tiny on" : "ghost tiny"} aria-pressed={snapOn} onClick={() => setSnap(!snapOn)}
          title={snapOn ? "Snap is on: a click puts a free hit on its step" : "Snap is off: free hits stay where they were played"} aria-label="Snap hits to steps">
          <Icon d={MAGNET} />
        </button>
        <span className="silk roll-snap">{snapOn ? "Snap" : "Free"}</span>
      </div>
      {drums.map(({ t, i }) => {
        const cells = cellsFor(t.notes, steps, step);
        return (
          <div key={i} role="row" className={i === props.selected ? "drum-row sel" : "drum-row"} style={{ "--track": props.colors[i] } as React.CSSProperties}>
            <button className="row-name" onClick={() => { props.onSelect(i); props.onAudition(i); }}>{t.name}</button>
            <div className="steps" style={{ gridTemplateColumns: `repeat(${steps}, 1fr)`, gap: steps > 64 ? 1 : undefined }}>
              {cells.map((c, s) => (
                <button
                  key={s} role="gridcell"
                  aria-label={`${t.name} step ${s + 1}${c ? (c.at.some((a) => a > 0) ? ", on, off the step" : ", on") : ""}`}
                  aria-pressed={!!c}
                  className={["step", ((props.from ?? 0) + s * step) % 1 < 1e-6 ? "beat" : "", c ? "on" : "", c?.offGrid ? "off-grid" : ""].join(" ")}
                  style={c ? ({ "--v": c.v } as React.CSSProperties) : undefined}
                  onClick={(e) => props.onNotes(i, toggle(t, s, step, { accent: e.shiftKey, snap: snapOn }))}
                >
                  {c && c.at.some((a) => a > 0) && c.at.map((a, k) => <span key={k} className="hit-mark" style={{ left: `${a * 100}%` }} />)}
                </button>
              ))}
              <Playhead loopBeats={props.loopBeats} from={props.from} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
