// The frame around the drum grid and the piano roll that sets what they show:
// an overview of the whole loop with the view as a box (drag it to scroll, drag
// its edges to scale, pinch it), zoom buttons, a ruler, and the gestures over
// the editor (ctrl/cmd + wheel or a trackpad pinch zooms about the pointer,
// a sideways or shift wheel scrolls, two fingers pinch and pan). The window
// math is view.ts; the editors only get the window App works out from it.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { clamp01 } from "@rustybuns/util";
import type { TrackDoc } from "../project.ts";
import { useTick } from "./store.ts";
import { fit, rulerMarks, scrollBy, zoomAbout, type View } from "./view.ts";

/** A change to the view, given the latest one and the loop length; App keeps the result inside the loop. */
export type ViewChange = (v: View, L: number) => View;

/** The editor's timeline area (where beat 0 of the window is its left edge), inside the frame. */
const AREA = ".roll-area, .steps";

export function Timeline(props: {
  /** The view as the user set it (the overview's box). */
  view: View;
  /** The window the editors show: the view widened to whole grid steps. */
  win: View;
  loop: number;
  beatsPerBar: number;
  tracks: TrackDoc[];
  colors: string[];
  follow: boolean;
  onFollow(on: boolean): void;
  onView(change: ViewChange): void;
  /** The editor area's width, px, for the grid to coarsen by. */
  onPx(px: number): void;
  children: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [inset, setInset] = useState({ left: 0, width: 0 });
  const live = useRef(props);
  live.current = props;

  // where the editor's area sits, so the ruler lines up with it and a pointer maps to a beat
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const measure = () => {
      const area = el.querySelector(AREA)?.getBoundingClientRect(), box = el.getBoundingClientRect();
      const next = area ? { left: Math.round(area.left - box.left), width: Math.round(area.width) } : { left: 0, width: Math.round(box.width) };
      setInset((p) => (p.left === next.left && p.width === next.width ? p : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  });
  useEffect(() => { if (inset.width > 0) props.onPx(inset.width); }, [inset.width]);

  // wheel, Safari's trackpad pinch and two-finger touch over the editor
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const frac = (x: number) => {
      const r = el.querySelector(AREA)?.getBoundingClientRect() ?? el.getBoundingClientRect();
      return clamp01((x - r.left) / Math.max(r.width, 1));
    };
    const width = () => Math.max(el.querySelector(AREA)?.getBoundingClientRect().width ?? el.clientWidth, 1);
    const beatAt = (x: number) => { const w = live.current.win; return w.from + frac(x) * w.span; };
    const wheel = (e: WheelEvent) => {
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const at = beatAt(e.clientX), k = Math.exp(Math.max(-1, Math.min(1, e.deltaY * unit * 0.01)));
        live.current.onView((v, L) => zoomAbout(v, L, k, at));
        return;
      }
      const dx = e.shiftKey ? (e.deltaX || e.deltaY) : Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : 0;
      if (!dx) return;
      e.preventDefault();
      const beats = (dx * unit / width()) * live.current.win.span;
      live.current.onView((v, L) => scrollBy(v, L, beats));
    };
    let gesture: { scale: number; at: number } | null = null;
    const scaleOf = (e: Event) => ("scale" in e && typeof e.scale === "number" ? e.scale : 1);
    const xOf = (e: Event) => ("clientX" in e && typeof e.clientX === "number" ? e.clientX : 0);
    const gStart = (e: Event) => { e.preventDefault(); gesture = { scale: 1, at: beatAt(xOf(e)) }; };
    const gChange = (e: Event) => {
      if (!gesture) return;
      e.preventDefault();
      const s = scaleOf(e), k = gesture.scale / s, at = gesture.at;
      gesture.scale = s;
      live.current.onView((v, L) => zoomAbout(v, L, k, at));
    };
    const gEnd = () => { gesture = null; };
    let pinch: { d: number; at: number; view: View } | null = null;
    const two = (t: TouchList) => ({ d: Math.max(Math.abs(t[0].clientX - t[1].clientX), 24), x: (t[0].clientX + t[1].clientX) / 2 });
    const tStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) { pinch = null; return; }
      const p = two(e.touches);
      pinch = { d: p.d, at: beatAt(p.x), view: live.current.view };
    };
    const tMove = (e: TouchEvent) => {
      if (!pinch || e.touches.length !== 2) return;
      e.preventDefault();
      const p = two(e.touches), start = pinch;
      const span = start.view.span * (start.d / p.d), from = start.at - frac(p.x) * span;
      live.current.onView(() => ({ from, span }));
    };
    const tEnd = (e: TouchEvent) => { if (e.touches.length < 2) pinch = null; };
    el.addEventListener("wheel", wheel, { passive: false });
    el.addEventListener("gesturestart", gStart);
    el.addEventListener("gesturechange", gChange);
    el.addEventListener("gestureend", gEnd);
    el.addEventListener("touchstart", tStart, { passive: true });
    el.addEventListener("touchmove", tMove, { passive: false });
    el.addEventListener("touchend", tEnd);
    el.addEventListener("touchcancel", tEnd);
    return () => {
      el.removeEventListener("wheel", wheel);
      el.removeEventListener("gesturestart", gStart);
      el.removeEventListener("gesturechange", gChange);
      el.removeEventListener("gestureend", gEnd);
      el.removeEventListener("touchstart", tStart);
      el.removeEventListener("touchmove", tMove);
      el.removeEventListener("touchend", tEnd);
      el.removeEventListener("touchcancel", tEnd);
    };
  }, []);

  const zoom = (k: number) => props.onView((v, L) => zoomAbout(v, L, k, v.from + v.span / 2));
  const marks = rulerMarks(props.win, inset.width, props.beatsPerBar);
  const whole = props.view.span >= props.loop - 1e-9;
  return (
    <div className="timeline" ref={root}>
      <div className="tl-bar">
        <Overview view={props.view} loop={props.loop} tracks={props.tracks} colors={props.colors} onView={props.onView} />
        <div className="tl-tools">
          <button className="ghost icon" onClick={() => zoom(2)} disabled={whole} title="Zoom out (-)" aria-label="Zoom out"><Icon d={ZOOM_OUT} /></button>
          <button className="ghost icon" onClick={() => zoom(0.5)} title="Zoom in (=)" aria-label="Zoom in"><Icon d={ZOOM_IN} /></button>
          <button className="ghost icon" onClick={() => props.onView((_, L) => fit(L))} disabled={whole} title="Fit the loop (\)" aria-label="Fit the loop"><Icon d={FIT} /></button>
          <button className={props.follow ? "ghost icon on" : "ghost icon"} onClick={() => props.onFollow(!props.follow)} aria-pressed={props.follow}
            title="Follow the playhead" aria-label="Follow the playhead"><Icon d={FOLLOW} /></button>
        </div>
      </div>
      <div className="tl-ruler" style={{ marginLeft: inset.left, width: inset.width || undefined }} aria-hidden>
        {marks.map((m) => (
          <span key={m.at} className={m.major ? "mark major" : "mark"} style={{ left: `${((m.at - props.win.from) / props.win.span) * 100}%` }}>{m.label}</span>
        ))}
      </div>
      {props.follow && <Follow view={props.view} onView={props.onView} />}
      {props.children}
    </div>
  );
}

/** Keeps the playhead in view while it plays: when it leaves, the view pages on to it. */
function Follow(props: { view: View; onView(change: ViewChange): void }) {
  const pos = useTick((t) => (t.playing ? t.pos : -1));
  const { from, span } = props.view;
  useEffect(() => {
    if (pos >= 0 && (pos < from || pos >= from + span)) props.onView((v, L) => scrollBy(v, L, pos - v.from));
  }, [pos, from, span]);
  return null;
}

type Drag = { id: number; mode: "move" | "left" | "right"; x: number; view: View };

/** The whole loop small, every track's notes as ticks, with the view as a box. */
function Overview(props: { view: View; loop: number; tracks: TrackDoc[]; colors: string[]; onView(change: ViewChange): void }) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [w, setW] = useState(0);
  const drags = useRef(new Map<number, { x: number }>());
  const drag = useRef<Drag | null>(null);
  const pinch = useRef<{ d: number; mid: number; view: View } | null>(null);
  const { view, loop } = props;

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const c = canvas.current, g = c?.getContext("2d");
    if (!c || !g || !w) return;
    const dpr = window.devicePixelRatio || 1, h = c.clientHeight || 28;
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const rows = props.tracks.length || 1, rowH = h / rows;
    props.tracks.forEach((t, i) => {
      g.fillStyle = props.colors[i] ?? "#888";
      for (const n of t.notes) g.fillRect((n.s / loop) * w, i * rowH + 1, Math.max((n.l / loop) * w, 1), Math.max(rowH - 1, 1));
    });
  }, [w, loop, props.tracks, props.colors]);

  const beats = (px: number) => (px / Math.max(w, 1)) * loop;
  const xIn = (e: React.PointerEvent) => e.clientX - wrap.current!.getBoundingClientRect().left;

  const down = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    wrap.current!.setPointerCapture(e.pointerId);
    const x = xIn(e);
    drags.current.set(e.pointerId, { x });
    if (drags.current.size === 2) {
      const [a, b] = [...drags.current.values()];
      pinch.current = { d: Math.max(Math.abs(a.x - b.x), 16), mid: (a.x + b.x) / 2, view };
      drag.current = null;
      return;
    }
    const left = (view.from / loop) * w, right = ((view.from + view.span) / loop) * w;
    const edge = e.pointerType === "touch" ? 14 : 7;
    let v = view, mode: Drag["mode"] = "move";
    if (Math.abs(x - left) <= edge && right - left > edge * 2) mode = "left";
    else if (Math.abs(x - right) <= edge) mode = "right";
    else if (x < left || x > right) {
      // a press outside the box puts the box there and drags it
      v = { from: beats(x) - view.span / 2, span: view.span };
      props.onView((cur, L) => scrollBy(cur, L, v.from - cur.from));
    }
    drag.current = { id: e.pointerId, mode, x, view: v };
  };
  const move = (e: React.PointerEvent) => {
    const p = drags.current.get(e.pointerId);
    if (!p) return;
    p.x = xIn(e);
    if (pinch.current && drags.current.size >= 2) {
      const [a, b] = [...drags.current.values()];
      const s = pinch.current, d = Math.max(Math.abs(a.x - b.x), 16), mid = (a.x + b.x) / 2;
      // fingers apart widen the box, so the editor shows more
      const span = s.view.span * (d / s.d), from = s.view.from + s.view.span / 2 - span / 2 + beats(mid - s.mid);
      props.onView(() => ({ from, span }));
      return;
    }
    const g = drag.current;
    if (!g || g.id !== e.pointerId) return;
    const db = beats(p.x - g.x), v0 = g.view;
    const next = g.mode === "move" ? { from: v0.from + db, span: v0.span }
      : g.mode === "left" ? { from: Math.min(v0.from + db, v0.from + v0.span - 1), span: Math.max(v0.span - db, 1) }
      : { from: v0.from, span: v0.span + db };
    props.onView(() => next);
  };
  const up = (e: React.PointerEvent) => {
    drags.current.delete(e.pointerId);
    if (drags.current.size < 2) pinch.current = null;
    if (drag.current?.id === e.pointerId) drag.current = null;
  };

  return (
    <div className="overview" ref={wrap} role="scrollbar" aria-orientation="horizontal" aria-label="The whole loop; drag the box to scroll, its edges to zoom"
      aria-valuemin={0} aria-valuemax={loop} aria-valuenow={Math.round(view.from)}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
      onDoubleClick={() => props.onView((_, L) => fit(L))}>
      <canvas ref={canvas} />
      <div className="ov-box" style={{ left: `${(view.from / loop) * 100}%`, width: `${(view.span / loop) * 100}%` }} />
    </div>
  );
}

const ZOOM_IN = "M11 3a8 8 0 1 0 0 16a8 8 0 1 0 0-16 M21 21l-4.35-4.35 M11 8v6 M8 11h6";
const ZOOM_OUT = "M11 3a8 8 0 1 0 0 16a8 8 0 1 0 0-16 M21 21l-4.35-4.35 M8 11h6";
const FIT = "M18 8l4 4l-4 4 M6 8l-4 4l4 4 M2 12h20";
const FOLLOW = "M2 12h3 M19 12h3 M12 2v3 M12 19v3 M12 5a7 7 0 1 0 0 14a7 7 0 1 0 0-14 M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6";

/** A lucide-style line icon. */
function Icon({ d }: { d: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}
