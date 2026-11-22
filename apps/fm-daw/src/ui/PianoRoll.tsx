// Notes for one track over the loop (or the window of it on show). With the pencil: drag on empty space to draw a
// note (it sounds as you press), drag a note to move it, drag either end to stretch it, click it to delete it. With
// the scissors: click a note to cut it in two. Snap puts every edit on the Grid; off (or with Alt held) a note
// starts and ends exactly where the pointer is. The arithmetic is src/roll.ts.
import { useEffect, useRef, useState } from "react";
import type { Note, TrackDoc } from "../project.ts";
import { cutNote, drawNote, findNote, moveNote, snapBeat, stretchEnd, stretchStart } from "../roll.ts";
import { Playhead } from "./Playhead.tsx";

const ROWS = 25;
const NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
export const noteName = (m: number) => `${NAMES[m % 12]}${Math.floor(m / 12) - 1}`;
const black = (m: number) => [1, 3, 6, 8, 10].includes(m % 12);
/** Pixels a press may wander and still be a click. */
const SLOP = 3;
/** Pixels at each end of a note that stretch it (less on a note too short for both). */
const EDGE = 7;

type Tool = "draw" | "cut";
type Drag =
  /** Drawing a new note from beat `a`. */
  | { t: "draw"; m: number; a: number; b: number; free: boolean }
  /** Moving or stretching the note that was `was`: `now` is how it looks under the pointer. */
  | { t: "move" | "start" | "end"; was: Note; now: Note; b0: number; m0: number; x0: number; y0: number; moved: boolean; sounding: number };

const recall = (k: string, dflt: string) => { try { return localStorage.getItem(k) ?? dflt; } catch { return dflt; } };
const keep = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode: the choice lasts the visit */ } };

export function PianoRoll(props: {
  track: TrackDoc;
  color: string;
  /** Beats across the roll: the loop, or the window of it on show. */
  loopBeats: number;
  /** Where this window starts in the song, beats (for the playhead). */
  from?: number;
  /** The Grid choice, beats: where lines are drawn and, with Snap on, where edits land. */
  grid: number;
  onNotes(notes: Note[]): void;
  onPreview(midi: number, on: boolean): void;
}) {
  const { track: t, loopBeats, grid } = props;
  const [low, setLow] = useState(() => defaultLow(t));
  const [drag, setDragState] = useState<Drag | null>(null);
  // the drag as it is this instant: a pointer's last move and its release can come in one frame, before a redraw
  const live = useRef<Drag | null>(null);
  const setDrag = (d: Drag | null) => { live.current = d; setDragState(d); };
  const [tool, setToolState] = useState<Tool>("draw");
  const [snapOn, setSnapState] = useState(() => recall("fm-daw.snap", "1") === "1");
  /** The scissors' line, beats, while the pointer is over the roll. */
  const [cutAt, setCutAt] = useState<number | null>(null);
  const area = useRef<HTMLDivElement>(null);
  const high = low + ROWS - 1;
  // the lines never get closer than a few pixels: a long window draws every 2nd, 4th... line
  const cols = Math.max(1, Math.round(loopBeats / grid));
  const beatCols = Math.max(1, Math.round(1 / grid));
  const setSnap = (on: boolean) => { setSnapState(on); keep("fm-daw.snap", on ? "1" : "0"); };
  const setTool = (next: Tool) => { setToolState(next); setCutAt(null); };
  /** Where edits land for this event: the grid, or anywhere with Snap off or Alt held. */
  const snapFor = (e: { altKey: boolean }) => (snapOn && !e.altKey ? grid : null);

  const at = (e: { clientX: number; clientY: number }) => {
    const r = area.current!.getBoundingClientRect();
    const b = Math.min(Math.max(((e.clientX - r.left) / r.width) * loopBeats, 0), loopBeats);
    const row = Math.min(Math.max(Math.floor(((e.clientY - r.top) / r.height) * ROWS), 0), ROWS - 1);
    return { b, m: high - row };
  };

  // the scissors on C, the pencil on B or Escape, snap on N: only while the pointer is over the roll, so the
  // keyboard still plays notes everywhere else
  const over = useRef(false);
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (!over.current || e.metaKey || e.ctrlKey || e.repeat) return;
      const el = e.target as HTMLElement;
      if (el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "TEXTAREA") return;
      if (e.code === "KeyC") setTool("cut");
      else if (e.code === "KeyB") setTool("draw");
      else if (e.code === "KeyN") setSnap(!snapOn);
      else return;
      e.stopImmediatePropagation();
    };
    window.addEventListener("keydown", down, true);
    return () => window.removeEventListener("keydown", down, true);
  });

  const replace = (was: Note, now: Note[]) => {
    const k = findNote(t.notes, was);
    if (k >= 0) props.onNotes([...t.notes.slice(0, k), ...now, ...t.notes.slice(k + 1)]);
  };

  function down(e: React.PointerEvent) {
    if (e.button !== 0) return;
    const p = at(e);
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-k]");
    const n = el ? t.notes[Number(el.dataset.k)] : undefined;
    if (tool === "cut") {
      // a cut is on the grid unless Alt says otherwise, whatever Snap is: a cut off the grid is rarely meant
      if (n) replace(n, cutNote(n, snapBeat(p.b, e.altKey ? null : grid)));
      return;
    }
    try { area.current!.setPointerCapture(e.pointerId); } catch { /* a pointer that is already gone: the drag ends on the roll's own up */ }
    if (!n || !el) {
      setDrag({ t: "draw", m: p.m, a: p.b, b: p.b, free: !snapFor(e) });
      props.onPreview(p.m, true);
      return;
    }
    const r = el.getBoundingClientRect(), edge = Math.min(EDGE, r.width / 3);
    const part = e.clientX - r.left < edge ? "start" : r.right - e.clientX < edge ? "end" : "move";
    setDrag({ t: part, was: n, now: n, b0: p.b, m0: p.m, x0: e.clientX, y0: e.clientY, moved: false, sounding: -1 });
  }

  function move(e: React.PointerEvent) {
    const p = at(e);
    if (tool === "cut") { setCutAt(snapBeat(p.b, e.altKey ? null : grid)); return; }
    const drag = live.current;
    if (!drag) return;
    if (drag.t === "draw") { setDrag({ ...drag, b: p.b, free: !snapFor(e) }); return; }
    const moved = drag.moved || Math.abs(e.clientX - drag.x0) > SLOP || Math.abs(e.clientY - drag.y0) > SLOP;
    if (!moved) return;
    const snap = snapFor(e);
    const now = drag.t === "move" ? moveNote(drag.was, p.b - drag.b0, p.m - drag.m0, snap, loopBeats)
      : drag.t === "end" ? stretchEnd(drag.was, p.b, snap) : stretchStart(drag.was, p.b, snap);
    // a note carried to another pitch is heard there
    let sounding = drag.sounding;
    if (drag.t === "move" && now.m !== (sounding < 0 ? drag.was.m : sounding)) {
      if (sounding >= 0) props.onPreview(sounding, false);
      props.onPreview(now.m, true);
      sounding = now.m;
    }
    setDrag({ ...drag, now, moved, sounding });
  }

  function end(commit: boolean) {
    const drag = live.current;
    if (!drag) return;
    setDrag(null);
    if (drag.t === "draw") {
      props.onPreview(drag.m, false);
      if (commit) props.onNotes([...t.notes, drawNote(drag.a, drag.b, drag.m, drag.free ? null : grid, loopBeats, grid)]);
      return;
    }
    if (drag.sounding >= 0) props.onPreview(drag.sounding, false);
    if (!commit) return;
    // a click that went nowhere takes the note off, as it always has
    replace(drag.was, drag.moved ? [drag.now] : []);
  }

  /** A focused note from the keys: arrows move it, Shift+arrows stretch its end, Delete takes it off. Alt: fine steps. */
  function key(e: React.KeyboardEvent, n: Note) {
    const step = e.altKey || !snapOn ? 1 / 32 : grid;
    const dx = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0, dy = e.key === "ArrowUp" ? 1 : e.key === "ArrowDown" ? -1 : 0;
    let now: Note[] | null = null;
    if (e.key === "Delete" || e.key === "Backspace") now = [];
    else if (dx && e.shiftKey) now = [stretchEnd(n, n.s + n.l + dx * step, null)];
    else if (dx || dy) now = [moveNote(n, dx * step, dy, null, loopBeats)];
    if (!now) return;
    e.preventDefault(); e.stopPropagation();
    replace(n, now);
  }

  const draft = drag?.t === "draw" ? drawNote(drag.a, drag.b, drag.m, drag.free ? null : grid, loopBeats, grid) : null;
  const held = drag && drag.t !== "draw" && drag.moved ? drag : null;
  const heldK = held ? findNote(t.notes, held.was) : -1;

  return (
    <div className={`roll tool-${tool}`} style={{ "--track": props.color } as React.CSSProperties}>
      <div className="roll-tools" role="toolbar" aria-label="Piano roll tools">
        <button className={tool === "draw" ? "ghost tiny on" : "ghost tiny"} aria-pressed={tool === "draw"} onClick={() => setTool("draw")}
          title="Pencil (B): drag to draw a note, drag a note to move it, drag its ends to stretch it, click it to delete" aria-label="Pencil">
          <Icon d={["M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z", "m15 5 4 4"]} />
        </button>
        <button className={tool === "cut" ? "ghost tiny on" : "ghost tiny"} aria-pressed={tool === "cut"} onClick={() => setTool(tool === "cut" ? "draw" : "cut")}
          title="Scissors (C): click a note to cut it in two, on the grid (hold Alt to cut anywhere)" aria-label="Scissors">
          <Icon d={["M8.12 8.12 12 12", "M20 4 8.12 15.88", "M14.8 14.8 20 20"]} circles={[[6, 6], [6, 18]]} />
        </button>
        <button className={snapOn ? "ghost tiny on" : "ghost tiny"} aria-pressed={snapOn} onClick={() => setSnap(!snapOn)}
          title={snapOn ? "Snap is on (N): notes land on the Grid. Hold Alt while you drag to place one freely" : "Snap is off (N): notes start and end exactly where you put them"} aria-label="Snap to grid">
          <Icon d={["m12 15 4 4", "M2.352 10.648a1.205 1.205 0 0 0 0 1.704l2.296 2.296a1.205 1.205 0 0 0 1.704 0l6.029-6.029a1 1 0 1 1 3 3l-6.029 6.029a1.205 1.205 0 0 0 0 1.704l2.296 2.296a1.205 1.205 0 0 0 1.704 0l6.365-6.367A1 1 0 0 0 8.716 4.282z", "m5 8 4 4"]} />
        </button>
        <span className="silk roll-snap">{snapOn ? "Snap" : "Free"}</span>
      </div>
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
        style={{ "--cols": cols, "--beat": beatCols } as React.CSSProperties}
        onPointerEnter={() => { over.current = true; }}
        onPointerLeave={() => { over.current = false; setCutAt(null); }}
        onPointerDown={down} onPointerMove={move} onPointerUp={(e) => { move(e); end(true); }} onPointerCancel={() => end(false)}
        onContextMenu={(e) => {
          // right click takes a note off, with either tool
          const el = (e.target as HTMLElement).closest<HTMLElement>("[data-k]");
          if (!el) return;
          e.preventDefault();
          const n = t.notes[Number(el.dataset.k)];
          if (n) replace(n, []);
        }}
      >
        {Array.from({ length: ROWS }, (_, r) => <div key={r} className={black(high - r) ? "lane black" : "lane"} style={{ top: `${(r / ROWS) * 100}%` }} />)}
        {t.notes.map((n, k) => {
          const shown = k === heldK && held ? held.now : n;
          return shown.m < low || shown.m > high ? null : (
            <button
              key={k} data-k={k} className={k === heldK ? "note held" : "note"}
              aria-label={`${noteName(shown.m)} at beat ${(shown.s + (props.from ?? 0) + 1).toFixed(2)}, ${shown.l.toFixed(2)} beats long. Arrows move it, Shift and arrows stretch it, Delete takes it off`}
              style={pos(shown, high, loopBeats)}
              onKeyDown={(e) => key(e, n)}
            />
          );
        })}
        {draft && <div className="note draft" style={pos(draft, high, loopBeats)} />}
        {tool === "cut" && cutAt !== null && <div className="cut-line" style={{ left: `${(cutAt / loopBeats) * 100}%` }} aria-hidden />}
        <Playhead loopBeats={loopBeats} from={props.from} />
      </div>
    </div>
  );
}

/** A lucide icon (ISC): pencil, scissors and magnet above. */
function Icon({ d, circles = [] }: { d: string[]; circles?: [number, number][] }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {circles.map(([cx, cy]) => <circle key={`${cx}:${cy}`} cx={cx} cy={cy} r="3" />)}
      {d.map((p) => <path key={p} d={p} />)}
    </svg>
  );
}

function pos(n: Note, high: number, loopBeats: number): React.CSSProperties {
  return {
    left: `${(n.s / loopBeats) * 100}%`,
    width: `${(Math.min(n.l, loopBeats - n.s) / loopBeats) * 100}%`,
    top: `${((high - n.m) / ROWS) * 100}%`,
    height: `${100 / ROWS}%`,
    opacity: 0.45 + 0.55 * n.v,
  };
}

function defaultLow(t: TrackDoc) {
  if (!t.notes.length) return Math.max(t.root - 5, 0);
  const lo = Math.min(...t.notes.map((n) => n.m)), hi = Math.max(...t.notes.map((n) => n.m));
  return Math.max(Math.min(Math.round((lo + hi) / 2) - 12, 127 - ROWS + 1), 0);
}
