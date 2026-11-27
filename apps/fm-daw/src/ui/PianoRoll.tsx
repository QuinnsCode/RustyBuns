// Notes for one track over the loop (or the window of it on show), with four tools. The pencil draws: drag on empty
// space, the start lands on the Grid and the end goes exactly where you let go (it sounds as you press). The eraser
// takes off every note you click or drag across. The scissors open a note's edit popover: two thumbs for its start
// and its end (drag, touch-drag or scroll over one). The hand carries a note in time and pitch with no snapping.
// Snap puts the pencil's start and the popover's thumbs on the Grid; off (or with Alt held) they go anywhere. The
// arithmetic is src/roll.ts; every edit goes through `act` below, and the desk_* commands call the same functions.
import { useEffect, useRef, useState } from "react";
import { addCommands } from "@rustybuns/util/commands";
import { int, num, obj, oneOf, opt } from "@rustybuns/util/guard";
import { byStart, type Note, type TrackDoc } from "../project.ts";
import { drawNote, editNotes, findNote, moveNote, snapBeat, trimNote } from "../roll.ts";
import { Playhead } from "./Playhead.tsx";

const ROWS = 25;
const NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
export const noteName = (m: number) => `${NAMES[m % 12]}${Math.floor(m / 12) - 1}`;
const black = (m: number) => [1, 3, 6, 8, 10].includes(m % 12);
/** Pixels a press may wander and still be a click. */
const SLOP = 3;
/** The edit popover's room around the note, beats either side (at least one beat, or the note's own length). */
const ROOM = 1;

const TOOLS = ["pencil", "eraser", "scissors", "hand"] as const;
export type Tool = (typeof TOOLS)[number];
/** Each tool's icon (lucide, ISC), key and tooltip. */
const TOOL: Record<Tool, { key: string; code: string; tip: string; d: string[]; circles?: [number, number][] }> = {
  pencil: {
    key: "B", code: "KeyB", tip: "Pencil (B): drag to draw a note. Its start lands on the Grid, its end where you let go",
    d: ["M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z", "m15 5 4 4"],
  },
  eraser: {
    key: "E", code: "KeyE", tip: "Eraser (E): click a note, or drag across notes, to take them off",
    d: ["M21 21H8a2 2 0 0 1-1.42-.587l-3.994-3.999a2 2 0 0 1 0-2.828l10-10a2 2 0 0 1 2.828 0l5.999 6a2 2 0 0 1 0 2.828L12.834 21", "m5.082 11.09 8.828 8.828"],
  },
  scissors: {
    key: "C", code: "KeyC", tip: "Scissors (C): click a note to trim its start and end",
    d: ["M8.12 8.12 12 12", "M20 4 8.12 15.88", "M14.8 14.8 20 20"], circles: [[6, 6], [6, 18]],
  },
  hand: {
    key: "H", code: "KeyH", tip: "Hand (H): drag a note to move it, off the Grid",
    d: ["M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2", "M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2", "M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8", "M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"],
  },
};

type Drag =
  /** Drawing a new note from beat `a`. */
  | { t: "draw"; m: number; a: number; b: number; free: boolean }
  /** Carrying the note that was `was`: `now` is how it looks under the pointer. */
  | { t: "move"; was: Note; now: Note; b0: number; m0: number; x0: number; y0: number; moved: boolean; sounding: number }
  /** Rubbing out notes; `group` makes the whole rub one undo step. */
  | { t: "erase"; group: string };
/** The edit popover: note `k`, its thumbs over beats `lo` to `hi` (fixed while it is open), one undo step `group`. */
type Edit = { k: number; lo: number; hi: number; group: string };

const recall = (k: string, dflt: string) => { try { return localStorage.getItem(k) ?? dflt; } catch { return dflt; } };
const keep = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode: the choice lasts the visit */ } };
let sessions = 0;
const session = (what: string) => `drag:${what}:${++sessions}`;

const DrawArgs = obj({ start: num(-1e6, 1e6), end: num(-1e6, 1e6), midi: int(0, 127) });
const IndexArgs = obj({ index: int(0, 1e6) });
const EndsArgs = obj({ index: int(0, 1e6), start: opt(num(-1e6, 1e6)), end: opt(num(-1e6, 1e6)) });
const MoveArgs = obj({ index: int(0, 1e6), beats: num(-1e6, 1e6), semis: opt(int(-127, 127)) });
const ToolArgs = obj({ tool: oneOf(TOOLS) });

export function PianoRoll(props: {
  track: TrackDoc;
  color: string;
  /** Beats across the roll: the loop, or the window of it on show. */
  loopBeats: number;
  /** Where this window starts in the song, beats (for the playhead). */
  from?: number;
  /** The Grid choice, beats: where lines are drawn and, with Snap on, where edits land. */
  grid: number;
  /** The roll's notes as they now are; `group` ties edits into one undo step (a "drag:" group: one gesture). */
  onNotes(notes: Note[], group?: string): void;
  onPreview(midi: number, on: boolean): void;
}) {
  const { track: t, loopBeats, grid } = props;
  const [low, setLow] = useState(() => defaultLow(t));
  const [drag, setDragState] = useState<Drag | null>(null);
  // the drag as it is this instant: a pointer's last move and its release can come in one frame, before a redraw
  const live = useRef<Drag | null>(null);
  const setDrag = (d: Drag | null) => { live.current = d; setDragState(d); };
  const [tool, setToolState] = useState<Tool>("pencil");
  const [snapOn, setSnapState] = useState(() => recall("fm-daw.snap", "1") === "1");
  const [edit, setEdit] = useState<Edit | null>(null);
  const area = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  // the notes as the last edit left them: two edits in one frame (a rub across notes) each see the other's
  const notes = useRef(t.notes);
  notes.current = t.notes;
  const high = low + ROWS - 1;
  // the lines never get closer than a few pixels: a long window draws every 2nd, 4th... line
  const cols = Math.max(1, Math.round(loopBeats / grid));
  const beatCols = Math.max(1, Math.round(1 / grid));
  const setSnap = (on: boolean) => { setSnapState(on); keep("fm-daw.snap", on ? "1" : "0"); };
  /** Where edits land for this event: the grid, or anywhere with Snap off or Alt held. */
  const snapFor = (e: { altKey: boolean }) => (snapOn && !e.altKey ? grid : null);
  const snap = snapOn ? grid : null;

  /** Every edit the roll makes, whichever door it came in by: the pointer, the keys, or a desk_* command. */
  const act = {
    pick(next: Tool) { setToolState(next); setEdit(null); return next; },
    /** The notes as an edit left them, in the track's own order (so an index is the one the next render has). */
    set(next: Note[], group?: string) { notes.current = next.sort(byStart); props.onNotes(notes.current, group); },
    /** A pencil's note from beat `a` to `b` on key `m`: the start on the grid with `sn`, the end free. Its index. */
    draw(a: number, b: number, m: number, sn: number | null) {
      const n = drawNote(a, b, m, sn, loopBeats, grid);
      act.set([...notes.current, n]);
      return notes.current.indexOf(n);
    },
    erase(k: number, group?: string) {
      if (!notes.current[k]) return false;
      act.set(editNotes(notes.current, k, []), group);
      return true;
    },
    /** Note `k` sounding from `start` to `end`; `moved` is the end that gives way when they meet. The note and its index now. */
    trim(k: number, start: number, end: number, moved: "start" | "end", group?: string) {
      const n = notes.current[k];
      if (!n) return null;
      const now = trimNote(n, start, end, loopBeats, moved);
      if (now.s === n.s && now.l === n.l) return { index: k, ...n };
      act.set(editNotes(notes.current, k, [now]), group);
      return { index: notes.current.indexOf(now), ...now };
    },
    /** Note `k` `beats` later and `semis` higher, off the grid. The note and its index now. */
    move(k: number, beats: number, semis: number) {
      const n = notes.current[k];
      if (!n) return null;
      const now = moveNote(n, beats, semis, null, loopBeats);
      act.set(editNotes(notes.current, k, [now]));
      return { index: notes.current.indexOf(now), ...now };
    },
  };
  const doors = useRef(act);
  doors.current = act;
  const view = useRef({ loopBeats, from: props.from ?? 0, snap, tool });
  view.current = { loopBeats, from: props.from ?? 0, snap, tool };

  // the same edits for an agent (WebMCP, window.__commands) and the palette
  useEffect(() => addCommands([
    {
      name: "desk_roll_tool", title: "Piano roll: pick a tool", group: "Piano roll", ask: "Tool: pencil, eraser, scissors or hand",
      description: "Pick the piano roll's tool: pencil (draws), eraser (takes notes off), scissors (trims a note's start and end), hand (moves a note off the grid). Answers with the tool.",
      inputSchema: { type: "object", properties: { tool: { type: "string", enum: [...TOOLS] } }, required: ["tool"] },
      execute: (a) => doors.current.pick(ToolArgs(a).tool),
    },
    {
      name: "desk_roll_notes", title: "Piano roll: the notes", group: "Piano roll", palette: false, annotations: { readOnlyHint: true },
      description: "The piano roll's notes as indexes for the other desk_ commands: each note's start s and length l in beats from the roll's left edge, its MIDI key m and velocity v. Also span (beats across), from (the song beat at the left edge), snap (the Grid in beats, or null when Snap is off) and the tool.",
      execute: () => ({ ...view.current, notes: notes.current.map((n, index) => ({ index, ...n })) }),
    },
    {
      name: "desk_draw_note", title: "Piano roll: draw a note", group: "Piano roll", palette: false,
      description: "Draw a note on the piano roll as the pencil does: from beat start to beat end (beats from the roll's left edge) on MIDI key midi. With Snap on, the start lands on the Grid line at or before it; the end stays exactly where given. Answers with the new note's index.",
      inputSchema: { type: "object", properties: { start: { type: "number" }, end: { type: "number" }, midi: { type: "integer", minimum: 0, maximum: 127 } }, required: ["start", "end", "midi"] },
      execute: (a) => { const { start, end, midi } = DrawArgs(a); return { index: doors.current.draw(start, end, midi, view.current.snap) }; },
    },
    {
      name: "desk_erase_note", title: "Piano roll: erase a note", group: "Piano roll", palette: false, annotations: { destructiveHint: true },
      description: "Take the note at index (from desk_roll_notes) off the piano roll, as the eraser does. Later notes' indexes move down one. Answers whether there was one.",
      inputSchema: { type: "object", properties: { index: { type: "integer", minimum: 0 } }, required: ["index"] },
      execute: (a) => ({ erased: doors.current.erase(IndexArgs(a).index) }),
    },
    {
      name: "desk_set_note_ends", title: "Piano roll: set a note's start and end", group: "Piano roll", palette: false,
      description: "Set where the note at index starts and/or ends, in beats from the roll's left edge, as the scissors' popover does; the other end stays. The end stays at least 1/64 beat after the start. Answers with the note as it is now, or null when there is none.",
      inputSchema: { type: "object", properties: { index: { type: "integer", minimum: 0 }, start: { type: "number" }, end: { type: "number" } }, required: ["index"] },
      execute: (a) => {
        const { index, start, end } = EndsArgs(a), n = notes.current[index];
        return n ? doors.current.trim(index, start ?? n.s, end ?? n.s + n.l, start === undefined ? "end" : "start") : null;
      },
    },
    {
      name: "desk_move_note", title: "Piano roll: move a note", group: "Piano roll", palette: false,
      description: "Move the note at index beats later (negative: earlier) and semis higher, with no snapping, as the hand does. Answers with the note as it is now, or null when there is none.",
      inputSchema: { type: "object", properties: { index: { type: "integer", minimum: 0 }, beats: { type: "number" }, semis: { type: "integer" } }, required: ["index", "beats"] },
      execute: (a) => { const { index, beats, semis } = MoveArgs(a); return doors.current.move(index, beats, semis ?? 0); },
    },
  ]), []);

  const at = (e: { clientX: number; clientY: number }) => {
    const r = area.current!.getBoundingClientRect();
    const b = Math.min(Math.max(((e.clientX - r.left) / r.width) * loopBeats, 0), loopBeats);
    const row = Math.min(Math.max(Math.floor(((e.clientY - r.top) / r.height) * ROWS), 0), ROWS - 1);
    return { b, m: high - row };
  };
  const noteAt = (x: number, y: number) => {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-k]");
    return el && area.current?.contains(el) ? Number(el.dataset.k) : -1;
  };

  // a tool's key, and N for snap: only while the pointer is over the roll, so the keyboard still plays notes
  // everywhere else. Escape closes the edit popover wherever the pointer is.
  const over = useRef(false);
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "Escape" && edit) { setEdit(null); e.stopImmediatePropagation(); return; }
      if (!over.current || e.metaKey || e.ctrlKey || e.repeat) return;
      const el = e.target as HTMLElement;
      if (el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "TEXTAREA") return;
      const pick = TOOLS.find((k) => TOOL[k].code === e.code);
      if (pick) act.pick(pick);
      else if (e.code === "KeyN") setSnap(!snapOn);
      else return;
      e.stopImmediatePropagation();
    };
    window.addEventListener("keydown", down, true);
    return () => window.removeEventListener("keydown", down, true);
  });

  // a press anywhere outside the popover closes it (a press on another note with the scissors opens that one's)
  useEffect(() => {
    if (!edit) return;
    const away = (e: PointerEvent) => { if (!pop.current?.contains(e.target as Node)) setEdit(null); };
    document.addEventListener("pointerdown", away, true);
    return () => document.removeEventListener("pointerdown", away, true);
  }, [edit]);

  function open(k: number) {
    const n = notes.current[k];
    if (!n) return;
    const room = Math.max(ROOM, n.l);
    setEdit({ k, lo: Math.max(n.s - room, Math.min(n.s, 0)), hi: Math.min(n.s + n.l + room, Math.max(loopBeats, n.s + n.l)), group: session("trim") });
  }

  function down(e: React.PointerEvent) {
    if (e.button !== 0) return;
    const p = at(e);
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-k]");
    const k = el ? Number(el.dataset.k) : -1;
    const n = notes.current[k];
    if (tool === "scissors") { if (n) open(k); return; }
    try { area.current!.setPointerCapture(e.pointerId); } catch { /* a pointer that is already gone: the drag ends on the roll's own up */ }
    if (tool === "eraser") {
      const group = session("erase");
      setDrag({ t: "erase", group });
      if (n) act.erase(k, group);
    } else if (tool === "hand") {
      if (n) setDrag({ t: "move", was: n, now: n, b0: p.b, m0: p.m, x0: e.clientX, y0: e.clientY, moved: false, sounding: -1 });
    } else if (!n) {
      setDrag({ t: "draw", m: p.m, a: p.b, b: p.b, free: !snapFor(e) });
      props.onPreview(p.m, true);
    }
  }

  function move(e: React.PointerEvent) {
    const drag = live.current;
    if (!drag) return;
    if (drag.t === "erase") { const k = noteAt(e.clientX, e.clientY); if (k >= 0) act.erase(k, drag.group); return; }
    const p = at(e);
    if (drag.t === "draw") { setDrag({ ...drag, b: p.b, free: !snapFor(e) }); return; }
    const moved = drag.moved || Math.abs(e.clientX - drag.x0) > SLOP || Math.abs(e.clientY - drag.y0) > SLOP;
    if (!moved) return;
    const now = moveNote(drag.was, p.b - drag.b0, p.m - drag.m0, null, loopBeats);
    // a note carried to another pitch is heard there
    let sounding = drag.sounding;
    if (now.m !== (sounding < 0 ? drag.was.m : sounding)) {
      if (sounding >= 0) props.onPreview(sounding, false);
      props.onPreview(now.m, true);
      sounding = now.m;
    }
    setDrag({ ...drag, now, moved, sounding });
  }

  function end(commit: boolean, e?: React.PointerEvent) {
    const drag = live.current;
    if (!drag) return;
    setDrag(null);
    if (drag.t === "erase") return;
    if (drag.t === "draw") {
      props.onPreview(drag.m, false);
      if (commit) act.draw(drag.a, drag.b, drag.m, drag.free ? null : grid);
      return;
    }
    if (drag.sounding >= 0) props.onPreview(drag.sounding, false);
    if (!commit || !drag.moved || !e) return;
    const p = at(e);
    act.move(findNote(notes.current, drag.was), p.b - drag.b0, p.m - drag.m0);
  }

  /** A focused note from the keys: arrows move it, Shift+arrows stretch its end, Delete takes it off. Alt: fine steps. */
  function key(e: React.KeyboardEvent, k: number) {
    const n = notes.current[k];
    if (!n) return;
    const step = e.altKey || !snapOn ? 1 / 32 : grid;
    const dx = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0, dy = e.key === "ArrowUp" ? 1 : e.key === "ArrowDown" ? -1 : 0;
    if (e.key === "Delete" || e.key === "Backspace") act.erase(k);
    else if (dx && e.shiftKey) act.trim(k, n.s, n.s + n.l + dx * step, "end");
    else if (dx || dy) act.move(k, dx * step, dy);
    else return;
    e.preventDefault(); e.stopPropagation();
  }

  const draft = drag?.t === "draw" ? drawNote(drag.a, drag.b, drag.m, drag.free ? null : grid, loopBeats, grid) : null;
  const held = drag?.t === "move" && drag.moved ? drag : null;
  const heldK = held ? findNote(t.notes, held.was) : -1;
  const editing = edit && t.notes[edit.k] ? edit : null;

  return (
    <div className={`roll tool-${tool}`} style={{ "--track": props.color } as React.CSSProperties}>
      <div className="roll-tools" role="toolbar" aria-label="Piano roll tools">
        {TOOLS.map((k) => (
          <button key={k} className={tool === k ? "ghost tiny on" : "ghost tiny"} aria-pressed={tool === k} onClick={() => act.pick(k)}
            title={TOOL[k].tip} aria-label={k[0]!.toUpperCase() + k.slice(1)} data-tool={k}>
            <Icon d={TOOL[k].d} circles={TOOL[k].circles} />
          </button>
        ))}
        <button className={snapOn ? "ghost tiny on" : "ghost tiny"} aria-pressed={snapOn} onClick={() => setSnap(!snapOn)}
          title={snapOn ? "Snap is on (N): the pencil's start and the scissors' ends land on the Grid. Hold Alt to place them freely" : "Snap is off (N): notes start and end exactly where you put them"} aria-label="Snap to grid">
          <Icon d={MAGNET} />
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
        onPointerLeave={() => { over.current = false; }}
        onPointerDown={down} onPointerMove={move} onPointerUp={(e) => { move(e); end(true, e); }} onPointerCancel={() => end(false)}
        onContextMenu={(e) => {
          // right click takes a note off, with any tool
          const el = (e.target as HTMLElement).closest<HTMLElement>("[data-k]");
          if (!el) return;
          e.preventDefault();
          act.erase(Number(el.dataset.k));
        }}
      >
        {Array.from({ length: ROWS }, (_, r) => <div key={r} className={black(high - r) ? "lane black" : "lane"} style={{ top: `${(r / ROWS) * 100}%` }} />)}
        {t.notes.map((n, k) => {
          const shown = k === heldK && held ? held.now : n;
          return shown.m < low || shown.m > high ? null : (
            <button
              key={k} data-k={k} className={k === heldK || k === editing?.k ? "note held" : "note"}
              aria-label={`${noteName(shown.m)} at beat ${(shown.s + (props.from ?? 0) + 1).toFixed(2)}, ${shown.l.toFixed(2)} beats long. Arrows move it, Shift and arrows stretch it, Delete takes it off`}
              style={pos(shown, high, loopBeats)}
              onKeyDown={(e) => key(e, k)}
            />
          );
        })}
        {draft && <div className="note draft" style={pos(draft, high, loopBeats)} />}
        <Playhead loopBeats={loopBeats} from={props.from} />
      </div>
      {editing && area.current && (
        <Trim edit={editing} note={t.notes[editing.k]!} rect={area.current.getBoundingClientRect()} loopBeats={loopBeats} high={high}
          from={props.from ?? 0} step={(alt) => (alt || !snapOn ? 1 / 32 : grid)} snapFor={snapFor} pop={pop}
          onTrim={(start, end, moved) => {
            // a start trimmed past another note's moves it in the list: the popover follows it
            const now = act.trim(editing.k, start, end, moved, editing.group);
            if (now && now.index !== editing.k) setEdit({ ...editing, k: now.index });
          }} />
      )}
    </div>
  );
}

/**
 * The scissors' popover: one third of the window wide whatever the zoom, under its note (over it near the bottom),
 * with a thumb for the note's start and one for its end over a range fixed while it is open. Drag either thumb,
 * touch-drag it, scroll over it or arrow it.
 */
function Trim(props: {
  edit: Edit; note: Note; rect: DOMRect; loopBeats: number; high: number; from: number;
  step(alt: boolean): number; snapFor(e: { altKey: boolean }): number | null;
  pop: React.RefObject<HTMLDivElement | null>;
  onTrim(start: number, end: number, moved: "start" | "end"): void;
}) {
  const { edit, note: n, rect: r, loopBeats } = props;
  const track = useRef<HTMLDivElement>(null);
  const span = edit.hi - edit.lo || 1;
  const pct = (b: number) => `${Math.min(Math.max((b - edit.lo) / span, 0), 1) * 100}%`;
  const set = (which: "start" | "end", b: number) =>
    props.onTrim(which === "start" ? b : n.s, which === "end" ? b : n.s + n.l, which);

  // the wheel over a thumb moves that end a step: down or right later, up or left earlier (not passive, so the
  // page doesn't scroll under it)
  const latest = useRef({ n, set, step: props.step });
  latest.current = { n, set, step: props.step };
  useEffect(() => {
    const el = props.pop.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      const which = (e.target as HTMLElement).closest<HTMLElement>("[data-end]")?.dataset.end;
      if (which !== "start" && which !== "end") return;
      e.preventDefault();
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (!d) return;
      const { n, set, step } = latest.current;
      set(which, (which === "start" ? n.s : n.s + n.l) + Math.sign(d) * step(e.altKey));
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [props.pop]);

  const w = innerWidth / 3;
  const cx = r.left + ((n.s + n.l / 2) / loopBeats) * r.width;
  const below = r.top + ((props.high - n.m + 1) / ROWS) * r.height + 8;
  const above = r.top + ((props.high - n.m) / ROWS) * r.height - 8 - 88;
  const style: React.CSSProperties = {
    width: w, left: Math.min(Math.max(cx - w / 2, 0), Math.max(innerWidth - w, 0)),
    top: below + 88 > innerHeight && above > 0 ? above : below,
  };

  const thumb = (which: "start" | "end") => {
    const b = which === "start" ? n.s : n.s + n.l;
    const drag = (e: React.PointerEvent) => {
      const t = track.current!.getBoundingClientRect();
      set(which, snapBeat(edit.lo + ((e.clientX - t.left) / t.width) * span, props.snapFor(e)));
    };
    return (
      <button type="button" className="trim-thumb" data-end={which} style={{ left: pct(b) }} role="slider"
        aria-label={which === "start" ? "Start" : "End"} aria-valuemin={edit.lo} aria-valuemax={edit.hi} aria-valuenow={b}
        aria-valuetext={`beat ${(b + props.from + 1).toFixed(2)}`}
        onPointerDown={(e) => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); }}
        onPointerMove={(e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) drag(e); }}
        onKeyDown={(e) => {
          const d = e.key === "ArrowRight" || e.key === "ArrowUp" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowDown" ? -1 : 0;
          if (!d) return;
          e.preventDefault();
          set(which, b + d * props.step(e.altKey));
        }} />
    );
  };

  return (
    <div className="trim-pop" ref={props.pop} style={style} role="dialog" aria-label={`Trim ${noteName(n.m)}`}>
      <div className="trim-head silk">
        <span>{noteName(n.m)}</span>
        <span>beat {(n.s + props.from + 1).toFixed(2)} to {(n.s + n.l + props.from + 1).toFixed(2)}</span>
      </div>
      <div className="trim-track" ref={track}>
        <div className="trim-fill" style={{ left: pct(n.s), right: `calc(100% - ${pct(n.s + n.l)})` }} />
        {thumb("start")}
        {thumb("end")}
      </div>
    </div>
  );
}

/** The Snap magnet, the roll's and the drum grid's (lucide, ISC). */
export const MAGNET = ["m12 15 4 4", "M2.352 10.648a1.205 1.205 0 0 0 0 1.704l2.296 2.296a1.205 1.205 0 0 0 1.704 0l6.029-6.029a1 1 0 1 1 3 3l-6.029 6.029a1.205 1.205 0 0 0 0 1.704l2.296 2.296a1.205 1.205 0 0 0 1.704 0l6.365-6.367A1 1 0 0 0 8.716 4.282z", "m5 8 4 4"];

export function Icon({ d, circles = [] }: { d: string[]; circles?: [number, number][] }) {
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
