// Shape, the master EQ's face: one big curve over the live spectrum, a dot per
// band. Double-click empty space for a band (a low cut at the bottom end, a
// high cut at the top, a bell in between), drag a dot to move it, roll the
// wheel over it for Q, double-click it (or Delete) to take it out. The strip
// under the curve sets the selected band exactly. What's drawn is the filters'
// real digital response (src/engine/eq.ts `response`), phase included.
import { useEffect, useMemo, useRef, useState } from "react";
import {
  EQ_BANDS, EQ_LIMITS, EQ_SLOPES, bandResponse, hasGain, isCut, response, flatEq,
  type EqBand, type EqDoc, type EqKind,
} from "../engine/eq.ts";
import { TRACK_COLORS } from "./colors.ts";

/** dB at the top and bottom of the curve. */
const RANGE = 24;
const F_LO = 20, F_HI = 20000;
const SPEC_TOP = -12, SPEC_BOTTOM = -96; // dBFS the spectrum fills between
const GRID_F = [50, 100, 200, 500, 1000, 2000, 5000, 10000];
const HIT = 11;

export const KIND_INFO: Record<EqKind, { label: string; tip: string; path: string }> = {
  lowCut: { label: "Low cut", tip: "Low cut: everything under the corner goes, steeper with the slope. Q above 0.71 adds a bump at the corner", path: "M2 13 C5 4 8 4 12 4 L23 4" },
  lowShelf: { label: "Low shelf", tip: "Low shelf: lifts or lowers everything under it", path: "M1 4 C8 4 10 4 12 7 C14 10 16 10 23 10" },
  bell: { label: "Bell", tip: "Bell: a bump up or a dip down around one frequency. Q is how narrow", path: "M1 10 C8 10 9 2 12 2 C15 2 16 10 23 10" },
  notch: { label: "Notch", tip: "Notch: a keyhole that takes a range clean out. Low Q sweeps out a wide range, high Q one ringing tone", path: "M1 4 L9 4 C11 4 11.5 13 12 13 C12.5 13 13 4 15 4 L23 4" },
  bandPass: { label: "Band pass", tip: "Band pass: only this range gets through. Sweep it to find a ring, then notch it", path: "M1 13 C8 13 9 3 12 3 C15 3 16 13 23 13" },
  highShelf: { label: "High shelf", tip: "High shelf: lifts or lowers everything over it", path: "M1 10 C8 10 10 10 12 7 C14 4 16 4 23 4" },
  highCut: { label: "High cut", tip: "High cut: everything over the corner goes, steeper with the slope. Q above 0.71 adds a bump at the corner", path: "M1 4 L12 4 C16 4 19 4 22 13" },
};
const KIND_ORDER: EqKind[] = ["lowCut", "lowShelf", "bell", "notch", "bandPass", "highShelf", "highCut"];

export const xOfF = (f: number, w: number) => (w * Math.log(f / F_LO)) / Math.log(F_HI / F_LO);
export const fOfX = (x: number, w: number) => Math.min(F_HI, Math.max(F_LO, F_LO * Math.pow(F_HI / F_LO, x / w)));
const yOfDb = (db: number, h: number) => h / 2 - (db / RANGE) * (h / 2 - 10);
const dbOfY = (y: number, h: number) => ((h / 2 - y) / (h / 2 - 10)) * RANGE;
export const fmtHz = (f: number) => (f < 1000 ? `${Math.round(f)} Hz` : `${(f / 1000).toFixed(f < 10000 ? 2 : 1)} kHz`);
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** The band a double-click at (f, dB) makes: a cut near either end, a bell between. */
export function newBand(f: number, db: number): EqBand {
  if (f < 45) return { kind: "lowCut", f: Math.max(f, 30), g: 0, q: Math.SQRT1_2, slope: 24, on: true };
  if (f > 14000) return { kind: "highCut", f: Math.min(f, 18000), g: 0, q: Math.SQRT1_2, slope: 12, on: true };
  return { kind: "bell", f, g: Math.round(clamp(db, -RANGE, RANGE) * 10) / 10, q: 1, slope: 12, on: true };
}

/** Where a band's dot sits: at its gain for bells and shelves, on the 0 dB line otherwise. */
const dotDb = (b: EqBand) => (hasGain(b.kind) ? b.g : 0);

export function Shape(props: { doc: EqDoc; sampleRate: number; analyser: AnalyserNode | null; onChange(doc: EqDoc, group?: string): void }) {
  const { doc, sampleRate: sr, analyser, onChange } = props;
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 800, h: 300 });
  const [sel, setSel] = useState<number | null>(() => { const i = doc.findIndex(Boolean); return i < 0 ? null : i; });
  const [phase, setPhase] = useState(false);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const drag = useRef<{ slot: number; dx: number; dy: number } | null>(null);
  const live = useRef({ doc, sel, onChange });
  live.current = { doc, sel, onChange };
  const band = sel !== null ? doc[sel] : null;

  const put = (slot: number, b: EqBand | null, group?: string) => {
    const next = live.current.doc.slice();
    next[slot] = b;
    live.current.onChange(next, group);
  };
  const patch = (slot: number, p: Partial<EqBand>, group?: string) => { const b = live.current.doc[slot]; if (b) put(slot, { ...b, ...p }, group); };

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: Math.max(200, Math.round(e.contentRect.width)), h: Math.round(clamp(e.contentRect.width * 0.32, 220, 380)) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // the curves: one point per pixel column
  const curves = useMemo(() => {
    const freqs = new Float64Array(size.w);
    for (let x = 0; x < size.w; x++) freqs[x] = fOfX(x + 0.5, size.w);
    const total = response(doc, sr, freqs);
    const bands = doc.map((b) => {
      if (!b?.on) return null;
      const db = new Float64Array(size.w), deg = new Float64Array(size.w);
      bandResponse(b, sr, freqs, db, deg);
      return db;
    });
    return { freqs, total, bands };
  }, [doc, sr, size.w]);

  // draw: every frame while there's a spectrum to show, else when anything changes
  useEffect(() => {
    const cv = canvas.current;
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    const { w, h } = size;
    cv.width = w * dpr; cv.height = h * dpr;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const spec = analyser ? new Float32Array(analyser.frequencyBinCount) : null;
    let raf = 0;
    const draw = () => {
      const css = getComputedStyle(cv);
      const ink = css.getPropertyValue("--ink").trim() || "#eee", dim = css.getPropertyValue("--dim").trim() || "#999";
      const edge = css.getPropertyValue("--edge").trim() || "#333", warn = css.getPropertyValue("--warn").trim() || "#fb0";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      // spectrum
      if (analyser && spec) {
        analyser.getFloatFrequencyData(spec);
        const binHz = analyser.context.sampleRate / analyser.fftSize;
        ctx.beginPath();
        ctx.moveTo(0, h);
        for (let x = 0; x < w; x++) {
          const a = Math.max(1, Math.floor(fOfX(x, w) / binHz)), b = Math.max(a + 1, Math.ceil(fOfX(x + 1, w) / binHz));
          let peak = -Infinity;
          for (let i = a; i < b && i < spec.length; i++) peak = Math.max(peak, spec[i]);
          // a gentle +3 dB/oct tilt so a balanced mix reads level, as on a mastering EQ
          const db = peak + 3 * Math.log2(fOfX(x, w) / 1000);
          ctx.lineTo(x, h * clamp((SPEC_TOP - db) / (SPEC_TOP - SPEC_BOTTOM), 0, 1));
        }
        ctx.lineTo(w, h);
        ctx.closePath();
        ctx.fillStyle = dim; ctx.globalAlpha = 0.22;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      // grid
      ctx.lineWidth = 1;
      ctx.font = "500 10px 'IBM Plex Mono', monospace";
      ctx.fillStyle = dim;
      for (const f of GRID_F) {
        const x = Math.round(xOfF(f, w)) + 0.5;
        ctx.strokeStyle = edge; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
        ctx.fillText(f >= 1000 ? `${f / 1000}k` : `${f}`, x + 3, h - 4);
      }
      for (let db = -RANGE + 6; db < RANGE; db += 6) {
        const y = Math.round(yOfDb(db, h)) + 0.5;
        ctx.strokeStyle = db === 0 ? dim : edge;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
        ctx.fillText(`${db > 0 ? "+" : ""}${db}`, 3, y - 3);
      }
      // each band, faint; the selected one filled
      const { total, bands } = curves;
      const s = live.current.sel;
      bands.forEach((db, i) => {
        if (!db) return;
        const col = TRACK_COLORS[i % TRACK_COLORS.length];
        ctx.beginPath();
        for (let x = 0; x < w; x++) { const y = yOfDb(clamp(db[x], -RANGE * 2, RANGE * 2), h); if (x) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
        ctx.strokeStyle = col; ctx.globalAlpha = 0.55;
        ctx.lineWidth = 1;
        ctx.stroke();
        if (i === s) {
          ctx.lineTo(w, yOfDb(0, h)); ctx.lineTo(0, yOfDb(0, h)); ctx.closePath();
          ctx.fillStyle = col; ctx.globalAlpha = 0.18;
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      });
      // phase, dashed: -180 at the bottom, +180 at the top
      if (phase) {
        ctx.beginPath();
        for (let x = 0; x < w; x++) {
          const y = h / 2 - (total.deg[x] / 180) * (h / 2 - 10);
          if (x && Math.abs(total.deg[x] - total.deg[x - 1]) < 180) ctx.lineTo(x, y); else ctx.moveTo(x, y);
        }
        ctx.setLineDash([4, 4]); ctx.strokeStyle = warn; ctx.lineWidth = 1.25; ctx.stroke(); ctx.setLineDash([]);
      }
      // the sum
      ctx.beginPath();
      for (let x = 0; x < w; x++) { const y = yOfDb(clamp(total.db[x], -RANGE * 2, RANGE * 2), h); if (x) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
      ctx.strokeStyle = ink; ctx.lineWidth = 2.25; ctx.stroke();
      // dots
      live.current.doc.forEach((b, i) => {
        if (!b) return;
        const x = xOfF(b.f, w), y = yOfDb(dotDb(b), h), col = TRACK_COLORS[i % TRACK_COLORS.length];
        ctx.beginPath(); ctx.arc(x, y, i === s ? 9 : 7.5, 0, Math.PI * 2);
        ctx.fillStyle = b.on ? col : "transparent"; ctx.fill();
        ctx.lineWidth = i === s ? 2.5 : 1.5; ctx.strokeStyle = b.on ? ink : col; ctx.stroke();
        ctx.fillStyle = b.on ? "#111" : col; ctx.font = "700 10px 'Barlow Condensed', sans-serif";
        ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(String(i + 1), x, y + 0.5);
        ctx.textAlign = "start"; ctx.textBaseline = "alphabetic";
      });
      if (analyser) raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [size, curves, phase, analyser, sel]);

  const at = (e: { clientX: number; clientY: number }) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const hit = (x: number, y: number) => {
    let best = -1, bestD = HIT;
    live.current.doc.forEach((b, i) => {
      if (!b) return;
      const d = Math.hypot(xOfF(b.f, size.w) - x, yOfDb(dotDb(b), size.h) - y);
      if (d <= bestD) { best = i; bestD = d; }
    });
    return best;
  };

  // the wheel sets Q on the dot under the pointer (or the selected band); passive listeners can't stop the page scrolling
  useEffect(() => {
    const cv = canvas.current;
    if (!cv) return;
    const onWheel = (e: WheelEvent) => {
      const { x, y } = at(e);
      const h = hit(x, y), slot = h >= 0 ? h : live.current.sel;
      const b = slot !== null ? live.current.doc[slot] : null;
      if (slot === null || !b) return;
      e.preventDefault();
      setSel(slot);
      patch(slot, { q: clamp(b.q * Math.exp(-e.deltaY * 0.0015), EQ_LIMITS.q[0], EQ_LIMITS.q[1]) }, `eq:${slot}:q`);
    };
    cv.addEventListener("wheel", onWheel, { passive: false });
    return () => cv.removeEventListener("wheel", onWheel);
  });

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { x, y } = at(e);
    const i = hit(x, y);
    if (i < 0) return;
    const b = doc[i]!;
    setSel(i);
    if (e.altKey) { patch(i, { on: !b.on }); return; }
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { slot: i, dx: xOfF(b.f, size.w) - x, dy: yOfDb(dotDb(b), size.h) - y };
  };
  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { x, y } = at(e);
    setHover({ x, y });
    const d = drag.current;
    if (!d || !(e.buttons & 1)) return;
    const b = live.current.doc[d.slot];
    if (!b) return;
    const f = Math.round(fOfX(x + d.dx, size.w));
    const g = hasGain(b.kind) ? Math.round(clamp(dbOfY(y + d.dy, size.h), EQ_LIMITS.g[0], EQ_LIMITS.g[1]) * 10) / 10 : b.g;
    patch(d.slot, { f, g }, `eq:${d.slot}:drag`);
  };
  const onUp = () => { drag.current = null; };
  const onDouble = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { x, y } = at(e);
    const i = hit(x, y);
    if (i >= 0) { put(i, null); setSel(null); return; }
    const slot = doc.findIndex((b) => !b);
    if (slot < 0) return;
    put(slot, newBand(Math.round(fOfX(x, size.w)), dbOfY(y, size.h)));
    setSel(slot);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if ((e.key === "Delete" || e.key === "Backspace") && sel !== null && doc[sel]) { e.preventDefault(); put(sel, null); setSel(null); }
  };

  const used = doc.filter(Boolean).length;
  return (
    <section className="shape" aria-label="Shape: the master EQ">
      <div className="shape-bar">
        <span className="silk">Shape · master EQ</span>
        <span className="dim shape-hint">Double-click to add · drag to move · wheel for Q · Alt-click to bypass · double-click a dot to remove</span>
        <span className="spacer" />
        <label className="check" title="Draw the phase the bands add (dashed, -180 to +180 degrees). Steep cuts turn it most"><input type="checkbox" checked={phase} onChange={(e) => setPhase(e.currentTarget.checked)} /> Phase</label>
        <span className="dim">{used}/{EQ_BANDS}</span>
        <button className="ghost" disabled={!used} onClick={() => { onChange(flatEq()); setSel(null); }} title="Take every band out (undo brings them back)">Flat</button>
      </div>
      <div className="shape-plot" ref={wrap}>
        <canvas ref={canvas} tabIndex={0} style={{ width: size.w, height: size.h }}
          className={drag.current ? "dragging" : ""}
          onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={() => setHover(null)}
          onDoubleClick={onDouble} onKeyDown={onKey} aria-label="EQ curve: double-click to add a band" />
        {hover && <span className="shape-readout">{fmtHz(fOfX(hover.x, size.w))} · {(() => { const d = dbOfY(hover.y, size.h); return `${d > 0 ? "+" : ""}${d.toFixed(1)} dB`; })()}</span>}
        {!used && <span className="shape-empty dim">Flat. Double-click the curve to add a band.</span>}
      </div>
      {band && sel !== null && (
        <div className="shape-band" style={{ "--track": TRACK_COLORS[sel % TRACK_COLORS.length] } as React.CSSProperties}>
          <span className="shape-num">{sel + 1}</span>
          <div className="seg shape-kinds" role="radiogroup" aria-label="Filter type">
            {KIND_ORDER.map((k) => (
              <button key={k} className={band.kind === k ? "on" : ""} role="radio" aria-checked={band.kind === k} aria-label={KIND_INFO[k].label} title={KIND_INFO[k].tip}
                onClick={() => patch(sel, { kind: k })}>
                <svg viewBox="0 0 24 14" width="24" height="14" aria-hidden="true"><path d={KIND_INFO[k].path} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
              </button>
            ))}
          </div>
          <Num label="Freq" unit="Hz" value={Math.round(band.f)} min={EQ_LIMITS.f[0]} max={EQ_LIMITS.f[1]} step={1} onValue={(f) => patch(sel, { f }, `eq:${sel}:f`)} />
          <Num label="Gain" unit="dB" value={band.g} min={EQ_LIMITS.g[0]} max={EQ_LIMITS.g[1]} step={0.5} disabled={!hasGain(band.kind)} onValue={(g) => patch(sel, { g }, `eq:${sel}:g`)} />
          <Num label={isCut(band.kind) ? "Reso" : "Q"} unit="" value={Math.round(band.q * 100) / 100} min={EQ_LIMITS.q[0]} max={EQ_LIMITS.q[1]} step={0.05} onValue={(q) => patch(sel, { q }, `eq:${sel}:q`)} />
          {isCut(band.kind) && (
            <label className="field inline"><span className="silk">Slope</span>
              <select value={band.slope} onChange={(e) => patch(sel, { slope: Number(e.currentTarget.value) })}>
                {EQ_SLOPES.map((s) => <option key={s} value={s}>{s} dB/oct</option>)}
              </select>
            </label>
          )}
          <span className="spacer" />
          <label className="check"><input type="checkbox" checked={band.on} onChange={(e) => patch(sel, { on: e.currentTarget.checked })} /> On</label>
          <button className="ghost" onClick={() => { put(sel, null); setSel(null); }}>Remove</button>
        </div>
      )}
      <div className="shape-dots" aria-label="Bands">
        {doc.map((b, i) => b && (
          <button key={i} className={i === sel ? "on" : ""} style={{ "--track": TRACK_COLORS[i % TRACK_COLORS.length] } as React.CSSProperties}
            onClick={() => setSel(i)} title={`${KIND_INFO[b.kind].label} ${fmtHz(b.f)}${hasGain(b.kind) ? ` ${b.g > 0 ? "+" : ""}${b.g} dB` : ""}${b.on ? "" : " (off)"}`}>
            <span className="shape-num">{i + 1}</span>
            <svg viewBox="0 0 24 14" width="20" height="12" aria-hidden="true"><path d={KIND_INFO[b.kind].path} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
            <span className="dim">{fmtHz(b.f)}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function Num(props: { label: string; unit: string; value: number; min: number; max: number; step: number; disabled?: boolean; onValue(v: number): void }) {
  const { label, unit, value, min, max, step, disabled, onValue } = props;
  return (
    <label className="field inline"><span className="silk">{label}</span>
      <input type="number" value={value} min={min} max={max} step={step} disabled={disabled}
        onChange={(e) => { const v = Number(e.currentTarget.value); if (Number.isFinite(v) && v >= min && v <= max) onValue(v); }} />
      {unit && <span className="dim">{unit}</span>}
    </label>
  );
}
