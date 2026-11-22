// The drum machine view: one row per drum track, one cell per step of the
// view's grid (a 16th zoomed in, coarser zoomed out). A cell is lit if any
// note starts inside it, so free-played hits show up too (marked off-grid
// until you quantize them). Click toggles, shift-click accents.
import type { Note, TrackDoc } from "../project.ts";
import { Playhead } from "./Playhead.tsx";

/** The finest cell, a 16th; off-grid marks are against it at any zoom. */
const FINE = 0.25;

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
  return (
    <div className="grid-wrap" role="grid" aria-label="Drum steps">
      {drums.map(({ t, i }) => {
        const cells = cellsFor(t.notes, steps, step);
        return (
          <div key={i} role="row" className={i === props.selected ? "drum-row sel" : "drum-row"} style={{ "--track": props.colors[i] } as React.CSSProperties}>
            <button className="row-name" onClick={() => { props.onSelect(i); props.onAudition(i); }}>{t.name}</button>
            <div className="steps" style={{ gridTemplateColumns: `repeat(${steps}, 1fr)`, gap: steps > 64 ? 1 : undefined }}>
              {cells.map((c, s) => (
                <button
                  key={s} role="gridcell"
                  aria-label={`${t.name} step ${s + 1}${c ? ", on" : ""}`}
                  aria-pressed={!!c}
                  className={["step", ((props.from ?? 0) + s * step) % 1 < 1e-6 ? "beat" : "", c ? "on" : "", c?.offGrid ? "off-grid" : ""].join(" ")}
                  style={c ? ({ "--v": c.v } as React.CSSProperties) : undefined}
                  onClick={(e) => props.onNotes(i, toggle(t, s, step, e.shiftKey))}
                />
              ))}
              <Playhead loopBeats={props.loopBeats} from={props.from} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function cellsFor(notes: Note[], steps: number, step: number) {
  const cells: ({ v: number; offGrid: boolean } | null)[] = new Array(steps).fill(null);
  for (const n of notes) {
    // a hit from before the view (a long note reaching in) has no cell here
    if (n.s < -1e-6) continue;
    const s = Math.min(Math.floor(n.s / step + 1e-6), steps - 1);
    const offGrid = Math.abs(n.s - Math.round(n.s / FINE) * FINE) > 1e-4;
    const c = cells[s];
    cells[s] = { v: Math.max(c?.v ?? 0, n.v), offGrid: (c?.offGrid ?? false) || offGrid };
  }
  return cells;
}

function toggle(t: TrackDoc, s: number, step: number, accent: boolean): Note[] {
  const inCell = (n: Note) => n.s > -1e-6 && Math.floor(n.s / step + 1e-6) === s;
  const hit = t.notes.filter(inCell);
  if (accent) {
    // shift: add as accented, or flip existing hits between accent and normal
    if (!hit.length) return [...t.notes, { s: s * step, l: FINE, m: t.root, v: 1 }];
    return t.notes.map((n) => (inCell(n) ? { ...n, v: n.v >= 0.95 ? 0.7 : 1 } : n));
  }
  if (hit.length) return t.notes.filter((n) => !inCell(n));
  return [...t.notes, { s: s * step, l: FINE, m: t.root, v: 0.8 }];
}
