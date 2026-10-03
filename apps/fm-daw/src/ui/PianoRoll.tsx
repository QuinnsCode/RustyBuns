// Notes for one track over the loop. Drag on empty space to draw a note (it
// sounds as you press), click a note to delete it.
import { useRef, useState } from "react";
import type { Note, TrackDoc } from "../project.ts";
import { Playhead } from "./Playhead.tsx";

const ROWS = 25;
const NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
export const noteName = (m: number) => `${NAMES[m % 12]}${Math.floor(m / 12) - 1}`;
const black = (m: number) => [1, 3, 6, 8, 10].includes(m % 12);

export function PianoRoll(props: {
  track: TrackDoc;
  color: string;
  loopBeats: number;
  grid: number;
  onNotes(notes: Note[]): void;
  onPreview(midi: number, on: boolean): void;
}) {
  const { track: t, loopBeats, grid } = props;
  const [low, setLow] = useState(() => defaultLow(t));
  const [draft, setDraft] = useState<{ m: number; s0: number; s1: number } | null>(null);
  const area = useRef<HTMLDivElement>(null);
  const cols = Math.round(loopBeats / grid);
  const high = low + ROWS - 1;

  const cellAt = (e: React.PointerEvent) => {
    const r = area.current!.getBoundingClientRect();
    const col = Math.min(Math.max(Math.floor(((e.clientX - r.left) / r.width) * cols), 0), cols - 1);
    const row = Math.min(Math.max(Math.floor(((e.clientY - r.top) / r.height) * ROWS), 0), ROWS - 1);
    return { col, m: high - row };
  };

  return (
    <div className="roll" style={{ "--track": props.color } as React.CSSProperties}>
      <div className="roll-keys" aria-hidden>
        <button className="ghost tiny" onClick={() => setLow((l) => Math.min(l + 12, 127 - ROWS + 1))} title="Octave up">▲</button>
        {Array.from({ length: ROWS }, (_, r) => {
          const m = high - r;
          return <div key={m} className={black(m) ? "rk black" : "rk"}>{m % 12 === 0 ? noteName(m) : ""}</div>;
        })}
        <button className="ghost tiny" onClick={() => setLow((l) => Math.max(l - 12, 0))} title="Octave down">▼</button>
      </div>
      <div
        className="roll-area" ref={area}
        style={{ "--cols": cols, "--beat": Math.round(1 / grid) } as React.CSSProperties}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          const c = cellAt(e);
          area.current!.setPointerCapture(e.pointerId);
          setDraft({ m: c.m, s0: c.col, s1: c.col });
          props.onPreview(c.m, true);
        }}
        onPointerMove={(e) => { if (draft) { const c = cellAt(e); setDraft({ ...draft, s1: Math.max(c.col, draft.s0) }); } }}
        onPointerUp={() => {
          if (!draft) return;
          props.onPreview(draft.m, false);
          props.onNotes([...t.notes, { s: draft.s0 * grid, l: (draft.s1 - draft.s0 + 1) * grid, m: draft.m, v: 0.8 }]);
          setDraft(null);
        }}
        onPointerCancel={() => { if (draft) props.onPreview(draft.m, false); setDraft(null); }}
      >
        {Array.from({ length: ROWS }, (_, r) => <div key={r} className={black(high - r) ? "lane black" : "lane"} style={{ top: `${(r / ROWS) * 100}%` }} />)}
        {t.notes.map((n, k) => n.m < low || n.m > high ? null : (
          <button
            key={k} className="note" aria-label={`${noteName(n.m)} at beat ${(n.s + 1).toFixed(2)}, delete`}
            style={pos(n.s, n.l, n.m, high, loopBeats, n.v)}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => props.onNotes(t.notes.filter((_, j) => j !== k))}
          />
        ))}
        {draft && <div className="note draft" style={pos(draft.s0 * grid, (draft.s1 - draft.s0 + 1) * grid, draft.m, high, loopBeats, 0.8)} />}
        <Playhead loopBeats={loopBeats} />
      </div>
    </div>
  );
}

function pos(s: number, l: number, m: number, high: number, loopBeats: number, v: number): React.CSSProperties {
  return {
    left: `${(s / loopBeats) * 100}%`,
    width: `${(Math.min(l, loopBeats - s) / loopBeats) * 100}%`,
    top: `${((high - m) / ROWS) * 100}%`,
    height: `${100 / ROWS}%`,
    opacity: 0.45 + 0.55 * v,
  };
}

function defaultLow(t: TrackDoc) {
  if (!t.notes.length) return Math.max(t.root - 5, 0);
  const lo = Math.min(...t.notes.map((n) => n.m)), hi = Math.max(...t.notes.map((n) => n.m));
  return Math.max(Math.min(Math.round((lo + hi) / 2) - 12, 127 - ROWS + 1), 0);
}
