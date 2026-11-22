// The selected track's audio as clips, over the window of the song in view (`from`, `span` beats). Each clip
// draws its sound: bright inside its window, dim outside it (there, but not on). Drag a clip's edge to trim it
// (Shift snaps to the grid), Alt-drag or the Slip tool to slide the sound under a window that stays put (what lines
// a hit up with the beat), drag the middle to move it on the grid. The Cut tool, or C over the lane, splits a clip
// at the pointer on the grid; Delete takes the picked one off. Each drag is one undo step (its group starts "drag:").
import { useEffect, useRef, useState } from "react";
import { TAKE_RATE, spanOf, type Clip } from "../take.ts";
import { clipEnd, cutClip, deleteClip, moveClip, slipClip, trimClip } from "../project.ts";
import { Playhead } from "./Playhead.tsx";

const HEIGHT = 88;
/** How near an edge (px) a press grabs it: a finger needs more room than a mouse. */
const reach = (e: React.PointerEvent) => (e.pointerType === "mouse" ? 7 : 14);
let drags = 0;

type Grab = { i: number; how: "start" | "end" | "move" | "slip"; base: readonly Clip[]; at: number; group: string };

export function ClipLane(props: {
  clips: readonly Clip[];
  /** A take's sound by id, when it's here (it may still be on its way from the sesh). */
  sound(id: string): Float32Array | undefined;
  bpm: number;
  loopBeats: number;
  /** The part of the song in view, beats. */
  from: number;
  span: number;
  /** The Grid choice, beats: where cuts and moves land. */
  grid: number;
  color: string;
  onClips(clips: Clip[], group?: string): void;
}) {
  const { clips, from, span, bpm } = props;
  const box = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(600);
  const [picked, setPicked] = useState<Clip | null>(null);
  const [tool, setTool] = useState<"edit" | "cut" | "slip">("edit");
  const grab = useRef<Grab | null>(null), hover = useRef<number | null>(null);
  const sel = picked ? clips.indexOf(picked) : -1;

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.max(80, Math.floor(el.clientWidth))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const px = (beat: number) => ((beat - from) / span) * width;
  const beatAt = (e: { clientX: number }) => {
    const r = canvas.current!.getBoundingClientRect();
    return from + ((e.clientX - r.left) / r.width) * span;
  };
  const snap = (b: number) => Math.round(b / props.grid) * props.grid;

  useEffect(() => draw(canvas.current, { ...props, width, sel }), [props, width, sel]);

  const commit = (next: readonly Clip[], keep: number, group?: string) => {
    if (next === clips) return;
    setPicked(next[keep] ?? null);
    props.onClips([...next], group);
  };
  const cutAt = (b: number) => commit(cutClip(clips, snap(b), bpm), -1);
  const remove = () => { if (sel >= 0) commit(deleteClip(clips, sel), -1); };

  function down(e: React.PointerEvent<HTMLCanvasElement>) {
    canvas.current?.focus();
    const b = beatAt(e), x = px(b), near = reach(e);
    if (tool === "cut") return cutAt(b);
    // the top clip under the press, or one whose edge is within reach
    for (let i = clips.length - 1; i >= 0; i--) {
      const c = clips[i], a = px(c.beat), z = px(clipEnd(c, bpm));
      if (x < a - near || x > z + near) continue;
      const how = tool === "slip" || e.altKey ? "slip" : Math.abs(x - a) <= near ? "start" : Math.abs(x - z) <= near ? "end" : x > a && x < z ? "move" : null;
      if (!how) continue;
      grab.current = { i, how, base: clips, at: b, group: `drag:clip:${++drags}` };
      setPicked(c);
      e.currentTarget.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }
    setPicked(null);
  }

  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    const b = beatAt(e);
    hover.current = b;
    const g = grab.current;
    if (!g) return void (e.currentTarget.style.cursor = cursor(b));
    const c = g.base[g.i];
    const next =
      g.how === "slip" ? slipClip(g.base, g.i, b - g.at, bpm)
      : g.how === "move" ? moveClip(g.base, g.i, Math.min(props.loopBeats - props.grid, Math.max(0, snap(c.beat + b - g.at))))
      : trimClip(g.base, g.i, g.how, e.shiftKey ? snap(b) : b, bpm);
    commit(next, g.i, g.group);
  }

  function cursor(b: number): string {
    if (tool === "cut") return "crosshair";
    const x = px(b);
    for (const c of clips) {
      const a = px(c.beat), z = px(clipEnd(c, bpm));
      if (Math.abs(x - a) <= 7 || Math.abs(x - z) <= 7) return "ew-resize";
      if (x > a && x < z) return tool === "slip" ? "grab" : "move";
    }
    return "default";
  }

  function key(e: React.KeyboardEvent) {
    if (e.metaKey || e.ctrlKey) return;
    if (e.code === "KeyC" && hover.current !== null) { e.preventDefault(); e.stopPropagation(); cutAt(hover.current); }
    else if ((e.code === "Delete" || e.code === "Backspace") && sel >= 0) { e.preventDefault(); e.stopPropagation(); remove(); }
  }

  return (
    <div className="clip-lane" style={{ "--track": props.color } as React.CSSProperties}>
      <div className="clip-tools" role="toolbar" aria-label="Clips">
        <button className={tool === "cut" ? "ghost icon on" : "ghost icon"} aria-pressed={tool === "cut"} onClick={() => setTool(tool === "cut" ? "edit" : "cut")}
          title="Cut: click a clip to split it on the grid (or press C over the lane)" aria-label="Cut"><Icon d={SCISSORS} /></button>
        <button className={tool === "slip" ? "ghost icon on" : "ghost icon"} aria-pressed={tool === "slip"} onClick={() => setTool(tool === "slip" ? "edit" : "slip")}
          title="Slip: drag to slide the sound under the clip, which stays put (or Alt-drag)" aria-label="Slip"><Icon d={SLIP} /></button>
        <button className="ghost icon" disabled={sel < 0} onClick={remove} title="Delete the picked clip (Delete)" aria-label="Delete clip"><Icon d={TRASH} /></button>
      </div>
      <div className="clip-box" ref={box}>
        <canvas ref={canvas} tabIndex={0} aria-label="Clips: drag an edge to trim, the middle to move, Alt-drag to slip the sound, C to cut at the pointer"
          onPointerDown={down} onPointerMove={move} onPointerUp={() => { grab.current = null; }} onPointerCancel={() => { grab.current = null; }}
          onPointerLeave={() => { if (!grab.current) hover.current = null; }} onKeyDown={key} />
        <Playhead loopBeats={span} from={from} />
      </div>
    </div>
  );
}

/** The lane: bar lines, then each clip's sound (dim outside its window) and its box, the picked one bolder. */
function draw(cv: HTMLCanvasElement | null, o: { clips: readonly Clip[]; sound(id: string): Float32Array | undefined; bpm: number; from: number; span: number; grid: number; color: string; width: number; sel: number }) {
  const g = cv?.getContext("2d");
  if (!cv || !g) return;
  const dpr = globalThis.devicePixelRatio || 1, w = o.width, h = HEIGHT, mid = h / 2;
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  cv.style.width = `${w}px`; cv.style.height = `${h}px`;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const px = (b: number) => ((b - o.from) / o.span) * w;
  const fpb = (60 / o.bpm) * TAKE_RATE, framesPerPx = (o.span / w) * fpb;
  // the grid, and every bar a little brighter
  const step = o.grid * (w / o.span) >= 6 ? o.grid : 4;
  for (let b = Math.ceil(o.from / step) * step; b < o.from + o.span; b += step) {
    g.fillStyle = b % 4 === 0 ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.05)";
    g.fillRect(Math.round(px(b)), 0, 1, h);
  }
  o.clips.forEach((c, i) => {
    const { from, to } = spanOf(c), a = px(c.beat), z = px(clipEnd(c, o.bpm)), zero = c.beat - from / fpb;
    const pcm = o.sound(c.id);
    if (pcm) {
      // a column per pixel across the whole sound, its loudest sample (at most 64 looked at)
      const x0 = Math.max(0, Math.floor(px(zero))), x1 = Math.min(w, Math.ceil(px(zero + pcm.length / fpb)));
      for (let x = x0; x < x1; x++) {
        const f0 = Math.floor((o.from + (x / w) * o.span - zero) * fpb), f1 = Math.min(pcm.length, f0 + Math.max(1, Math.ceil(framesPerPx)));
        let peak = 0;
        for (let f = Math.max(0, f0), s = Math.max(1, Math.floor((f1 - f0) / 64)); f < f1; f += s) peak = Math.max(peak, Math.abs(pcm[f]));
        const on = f0 >= from && f0 < to;
        g.globalAlpha = on ? 0.95 : 0.22;
        g.fillStyle = o.color;
        const y = Math.max(0.5, peak * (mid - 6));
        g.fillRect(x, mid - y, 1, y * 2);
      }
      g.globalAlpha = 1;
    }
    g.fillStyle = o.color;
    g.globalAlpha = 0.12;
    g.fillRect(a, 2, z - a, h - 4);
    g.globalAlpha = 1;
    g.strokeStyle = o.color;
    g.lineWidth = i === o.sel ? 2 : 1;
    g.strokeRect(a + 0.5, 2.5, Math.max(1, z - a - 1), h - 5);
    // the handles: a light grip on each edge, so it shows over the sound
    g.fillStyle = "rgba(236,238,241,0.9)";
    g.fillRect(a, mid - 12, 4, 24);
    g.fillRect(z - 4, mid - 12, 4, 24);
  });
}

// lucide's scissors, move-horizontal and trash-2 (ISC)
const SCISSORS = ["M8.12 8.12 12 12", "M20 4 8.12 15.88", "M14.8 14.8 20 20", "M9 6a3 3 0 1 1-6 0a3 3 0 1 1 6 0", "M9 18a3 3 0 1 1-6 0a3 3 0 1 1 6 0"];
const SLIP = ["m18 8 4 4-4 4", "M2 12h20", "m6 8-4 4 4 4"];
const TRASH = ["M3 6h18", "M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6", "M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"];
function Icon(props: { d: string[] }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {props.d.map((d) => <path key={d} d={d} />)}
    </svg>
  );
}
