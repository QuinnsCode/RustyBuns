// The drum machine view: one row per drum track, one cell per 16th. A cell is
// lit if any note starts inside it, so free-played hits show up too (marked
// off-grid until you quantize them). Click toggles, shift-click accents.
import type { Note, TrackDoc } from "../project.ts";
import { Playhead } from "./Playhead.tsx";

const STEP = 0.25;

export function DrumGrid(props: {
  tracks: TrackDoc[];
  colors: string[];
  selected: number;
  loopBeats: number;
  onSelect(i: number): void;
  onNotes(i: number, notes: Note[]): void;
  onAudition(i: number): void;
}) {
  const steps = Math.round(props.loopBeats / STEP);
  const drums = props.tracks.map((t, i) => ({ t, i })).filter(({ t }) => t.kind === "drum");
  return (
    <div className="grid-wrap" role="grid" aria-label="Drum steps">
      {drums.map(({ t, i }) => {
        const cells = cellsFor(t.notes, steps);
        return (
          <div key={i} role="row" className={i === props.selected ? "drum-row sel" : "drum-row"} style={{ "--track": props.colors[i] } as React.CSSProperties}>
            <button className="row-name" onClick={() => { props.onSelect(i); props.onAudition(i); }}>{t.name}</button>
            <div className="steps" style={{ gridTemplateColumns: `repeat(${steps}, 1fr)` }}>
              {cells.map((c, s) => (
                <button
                  key={s} role="gridcell"
                  aria-label={`${t.name} step ${s + 1}${c ? ", on" : ""}`}
                  aria-pressed={!!c}
                  className={["step", s % 4 === 0 ? "beat" : "", c ? "on" : "", c?.offGrid ? "off-grid" : ""].join(" ")}
                  style={c ? ({ "--v": c.v } as React.CSSProperties) : undefined}
                  onClick={(e) => props.onNotes(i, toggle(t, s, e.shiftKey))}
                />
              ))}
              <Playhead loopBeats={props.loopBeats} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function cellsFor(notes: Note[], steps: number) {
  const cells: ({ v: number; offGrid: boolean } | null)[] = new Array(steps).fill(null);
  for (const n of notes) {
    const s = Math.min(Math.floor(n.s / STEP + 1e-6), steps - 1);
    const offGrid = Math.abs(n.s - s * STEP) > 1e-4;
    const c = cells[s];
    cells[s] = { v: Math.max(c?.v ?? 0, n.v), offGrid: (c?.offGrid ?? false) || offGrid };
  }
  return cells;
}

function toggle(t: TrackDoc, s: number, accent: boolean): Note[] {
  const inCell = (n: Note) => Math.floor(n.s / STEP + 1e-6) === s;
  const hit = t.notes.filter(inCell);
  if (accent) {
    // shift: add as accented, or flip existing hits between accent and normal
    if (!hit.length) return [...t.notes, { s: s * STEP, l: STEP, m: t.root, v: 1 }];
    return t.notes.map((n) => (inCell(n) ? { ...n, v: n.v >= 0.95 ? 0.7 : 1 } : n));
  }
  if (hit.length) return t.notes.filter((n) => !inCell(n));
  return [...t.notes, { s: s * STEP, l: STEP, m: t.root, v: 0.8 }];
}
