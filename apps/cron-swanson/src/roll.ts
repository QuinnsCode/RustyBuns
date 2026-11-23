// The busses: the coming alarms as little fuzzy clouds hovering on their tracks, time running left to right from now
// to the end of the window. Tracks are grouped into busses by lane (every-N, daily, weekly, monthly, yearly), the way a
// mixer groups channels. A playhead sweeps across on a loop; each cloud it reaches gets struck by lightning and, with
// the speaker on, thumps an 808 at its bus's pitch. An alarm too busy to draw cloud by cloud is one long cloud bank.
import { upcoming, type Flow } from "./bacron.ts";
import type { Job } from "./api.ts";

const HEAD = 22, BUS_GAP = 14, LOOP_MS = 16_000, MAX_NOTES = 240, GUTTER = 44;

export interface Lane { job: Job; flow: Flow; color: string; hz: number }
/** One alarm in the window: its runs' times, or a cloud bank when there are too many to draw. */
export interface Track { lane: Lane; times: number[]; hum: boolean }
/** Where a bus sits, for the page's icons beside it. */
export interface BusSpot { flow: Flow; top: number; height: number; color: string }
export interface Hover { job: Job; at: number | null; x: number; y: number }

/** The tracks for a window of `span` ms from `from`: each alarm's runs in it, a cloud bank past MAX_NOTES. */
export function tracks(lanes: Lane[], from: number, span: number): Track[] {
  return lanes.map((lane) => {
    const j = lane.job;
    if (!j.enabled || j.nextAt === null) return { lane, times: [], hum: false };
    const runs = upcoming(j.cadence, from - 1, j.tz, MAX_NOTES + 1, j.anchor).filter((t) => t < from + span);
    return { lane, times: runs.slice(0, MAX_NOTES), hum: runs.length > MAX_NOTES };
  });
}

function ticks(from: number, span: number): { at: number; label: string }[] {
  const day = 86_400_000, hour = 3_600_000;
  const step = span <= 8 * hour ? hour : span <= 2 * day ? 3 * hour : span <= 10 * day ? day : 7 * day;
  const out: { at: number; label: string }[] = [];
  const start = new Date(from);
  if (step >= day) start.setHours(0, 0, 0, 0); else start.setMinutes(0, 0, 0);
  for (let t = start.getTime() + step; t < from + span; t += step) {
    const d = new Date(t);
    out.push({ at: t, label: step >= day ? d.toLocaleDateString(undefined, { day: "numeric", month: "short" }) : d.toLocaleTimeString(undefined, { hour: "numeric" }) });
  }
  return out;
}

/** A small seeded wobble per cloud, so each one hovers on its own beat. */
const seed = (s: string) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return ((h >>> 0) % 1000) / 1000; };

export interface Roll { draw(tracks: Track[], from: number, span: number): void; sound(on: boolean): void }

/**
 * Starts the busses on `canvas`, filling `height()` px. `pick` hears the alarm a click landed on, `hit` each cloud the
 * playhead strikes, `hover` what's under the pointer (null when nothing), `laid` where each bus sits after a change.
 */
export function roll(canvas: HTMLCanvasElement, o: { height(): number; pick(job: Job): void; hit(lane: Lane): void; hover(h: Hover | null): void; laid(b: BusSpot[]): void }): Roll {
  const ctx = canvas.getContext("2d")!;
  let rows: Track[] = [], from = 0, span = 86_400_000, loud = false, last = 0, lastBoom = 0, layoutKey = "";
  const struck = new Map<string, number>();
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let spots: { tr: Track; mid: number; h: number }[] = [];

  const css = (name: string) => getComputedStyle(canvas).getPropertyValue(name).trim();
  /** A cloud's x for time t: inset from both ends of the bus so a whole cloud fits at either edge. */
  const xOf = (t: number, w: number) => GUTTER + 22 + ((t - from) / span) * (w - GUTTER - 60);

  /** Each track's middle and height: busses stacked with a gap, tracks sharing what's left. */
  function layout(h: number) {
    const busses = [...Map.groupBy(rows, (r) => r.lane.flow)];
    const room = h - HEAD - BUS_GAP * Math.max(0, busses.length - 1) - 8;
    const th = Math.max(26, Math.min(110, room / Math.max(1, rows.length)));
    let y = HEAD;
    spots = [];
    const bus: BusSpot[] = [];
    for (const [flow, list] of busses) {
      bus.push({ flow, top: y, height: list.length * th, color: list[0]!.lane.color });
      for (const tr of list) { spots.push({ tr, mid: y + th / 2, h: th }); y += th; }
      y += BUS_GAP;
    }
    const key = JSON.stringify(bus.map((b) => [b.flow, b.top, b.height]));
    if (key !== layoutKey) { layoutKey = key; o.laid(bus); }
    return bus;
  }

  function cloud(x: number, y: number, r: number, color: string, glow: number) {
    ctx.save();
    ctx.globalAlpha = 0.5 + glow * 0.45;
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 14 + glow * 26;
    ctx.filter = `blur(${1.6 - glow}px)`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.arc(x - r * 0.85, y + r * 0.25, r * 0.7, 0, Math.PI * 2);
    ctx.arc(x + r * 0.9, y + r * 0.2, r * 0.75, 0, Math.PI * 2);
    ctx.arc(x + r * 0.2, y - r * 0.5, r * 0.65, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /** A lightning bolt striking down onto the cloud at x, from `top` to `bottom`. */
  function bolt(x: number, top: number, bottom: number, color: string, k: number) {
    const h = bottom - top, w = h * 0.42;
    // The classic bolt: down-left, a notch back right, then down to a point.
    const pts: [number, number][] = [[0.15, 0], [-0.45, 0.55], [0.02, 0.55], [-0.2, 1], [0.5, 0.38], [0.05, 0.38], [0.35, 0]];
    ctx.save();
    ctx.globalAlpha = k;
    ctx.fillStyle = css("--bolt") || "#fff6c8";
    ctx.shadowColor = color;
    ctx.shadowBlur = 22;
    ctx.beginPath();
    pts.forEach(([px, py], i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, x + px * w, top + py * h));
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function paint(now: number) {
    const w = canvas.clientWidth, h = o.height(), dpr = devicePixelRatio || 1;
    canvas.style.height = `${h}px`;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const bus = layout(h), muted = css("--muted"), line = css("--line");

    ctx.font = `11px ${css("--digital") || "ui-monospace, monospace"}`;
    // A label that would crowd the one before it is left off (a phone shows every other hour mark).
    let lastLabel = -Infinity;
    for (const t of ticks(from, span)) {
      const x = xOf(t.at, w);
      ctx.fillStyle = line; ctx.fillRect(x, HEAD - 4, 1, h - HEAD);
      if (x - lastLabel < ctx.measureText(t.label).width + 14) continue;
      ctx.fillStyle = muted; ctx.fillText(t.label, x + 4, 12);
      lastLabel = x;
    }
    for (const b of bus) {
      ctx.fillStyle = css("--bus");
      ctx.beginPath(); ctx.roundRect(GUTTER - 6, b.top, w - GUTTER - 4, b.height, 14); ctx.fill();
    }
    for (const { tr, mid, h: th } of spots) {
      const c = tr.lane.color, wob = seed(tr.lane.job.id);
      ctx.fillStyle = line; ctx.fillRect(GUTTER, mid, w - GUTTER - 16, 1);
      if (tr.hum) {
        for (let x = GUTTER + 8; x < w - 20; x += 14) cloud(x, mid + Math.sin(now / 900 + x / 40) * 1.5, Math.min(9, th * 0.22), c, 0);
        continue;
      }
      const gap = (w - GUTTER) / Math.max(1, tr.times.length);
      const r = Math.max(4, Math.min(th * 0.2, gap * 0.32, 18));
      for (const t of tr.times) {
        const x = xOf(t, w), hit = struck.get(`${tr.lane.job.id}:${t}`) ?? -1e9, k = Math.max(0, 1 - (now - hit) / 450);
        const y = mid + (still ? 0 : Math.sin(now / 850 + wob * 6 + t / 3.6e6) * Math.min(3, th * 0.06));
        cloud(x, y, r, c, k);
        if (k > 0) bolt(x, y - r - th * 0.42, y - r * 0.3, c, k);
      }
    }
    if (!still) {
      const p = (now % LOOP_MS) / LOOP_MS, px = GUTTER + 22 + p * (w - GUTTER - 60);
      const grad = ctx.createLinearGradient(px - 48, 0, px, 0);
      grad.addColorStop(0, "rgba(255,255,255,0)"); grad.addColorStop(1, css("--scan"));
      ctx.fillStyle = grad; ctx.fillRect(px - 48, HEAD - 4, 48, h - HEAD);
      ctx.fillStyle = css("--scan-line"); ctx.fillRect(px, HEAD - 4, 1.5, h - HEAD);
    }
  }

  function sweep(now: number) {
    const p0 = (last % LOOP_MS) / LOOP_MS, p1 = (now % LOOP_MS) / LOOP_MS;
    last = now;
    if (p1 < p0) return;
    for (const tr of rows) for (const t of tr.times) {
      const p = (t - from) / span;
      if (p >= p0 && p < p1) {
        struck.set(`${tr.lane.job.id}:${t}`, now);
        if (loud && now - lastBoom > 150 && tr.times.length <= 48) { lastBoom = now; o.hit(tr.lane); }
      }
    }
  }

  const loop = (now: number) => { if (!still) sweep(now); paint(now); requestAnimationFrame(loop); };
  requestAnimationFrame((now) => { last = now; loop(now); });

  /** The track (and, when near one, the cloud) under a point. */
  function under(e: MouseEvent): Hover | null {
    const r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    const spot = spots.find((s) => Math.abs(y - s.mid) <= s.h / 2);
    if (!spot) return null;
    const w = canvas.clientWidth;
    let at: number | null = null, best = 18;
    for (const t of spot.tr.times) { const d = Math.abs(xOf(t, w) - x); if (d < best) { best = d; at = t; } }
    return { job: spot.tr.lane.job, at, x: e.clientX, y: e.clientY };
  }
  canvas.addEventListener("click", (e) => { const u = under(e); if (u) o.pick(u.job); });
  canvas.addEventListener("mousemove", (e) => { const u = under(e); canvas.style.cursor = u ? "pointer" : "default"; o.hover(u); });
  canvas.addEventListener("mouseleave", () => o.hover(null));

  return {
    draw(t, f, s) { rows = t; from = f; span = s; },
    sound(on) { loud = on; },
  };
}
