// The roll: the coming alarms as glowing notes, one row per alarm, time running left to right from now to the end
// of the window. A playhead sweeps across on a loop, and each note it passes lights up and thumps an 808 at its
// row's pitch, so a busy day sounds busy. An alarm that comes round more often than the row can show is a steady hum.
import { upcoming } from "./bacron.ts";
import type { Job } from "./api.ts";

const ROW = 30, HEAD = 26, LABEL = 150, LOOP_MS = 16_000, MAX_NOTES = 240;

export interface Lane { job: Job; color: string; hz: number }

/** Where one alarm sits in the window: its notes' times, or a hum when there are too many to draw. */
export interface Track { lane: Lane; times: number[]; hum: boolean }

/** The tracks for a window of `span` ms from `from`: each alarm's runs in it, a hum past MAX_NOTES. */
export function tracks(lanes: Lane[], from: number, span: number): Track[] {
  return lanes.map((lane) => {
    const j = lane.job;
    if (!j.enabled || j.nextAt === null) return { lane, times: [], hum: false };
    const runs = upcoming(j.cadence, from - 1, j.tz, MAX_NOTES + 1, j.anchor).filter((t) => t < from + span);
    return { lane, times: runs.slice(0, MAX_NOTES), hum: runs.length > MAX_NOTES };
  });
}

/** Tick marks for the top: hours on a short window, days on a long one. */
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

export interface Roll { draw(tracks: Track[], from: number, span: number): void; sound(on: boolean): void }

/** Starts the roll on `canvas`. `pick` hears the alarm a click landed on; `hit` each note the playhead passes. */
export function roll(canvas: HTMLCanvasElement, pick: (job: Job) => void, hit: (lane: Lane) => void): Roll {
  const ctx = canvas.getContext("2d")!;
  let rows: Track[] = [], from = 0, span = 86_400_000, loud = false, last = 0, lastBoom = 0;
  const lit = new Map<string, number>();
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const css = (name: string) => getComputedStyle(canvas).getPropertyValue(name).trim();
  const size = () => {
    const w = canvas.clientWidth, h = HEAD + Math.max(1, rows.length) * ROW + 8, dpr = devicePixelRatio || 1;
    canvas.style.height = `${h}px`;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { w, h };
  };
  const label = () => (canvas.clientWidth < 560 ? 0 : LABEL);
  const xOf = (t: number, w: number) => label() + ((t - from) / span) * (w - label() - 12);

  function paint(now: number) {
    const { w, h } = size(), ink = css("--ink"), muted = css("--muted"), line = css("--line");
    ctx.clearRect(0, 0, w, h);
    ctx.font = "11px ui-sans-serif, system-ui";
    for (const t of ticks(from, span)) {
      const x = xOf(t.at, w);
      ctx.fillStyle = line; ctx.fillRect(x, HEAD - 6, 1, h - HEAD);
      ctx.fillStyle = muted; ctx.fillText(t.label, x + 4, 14);
    }
    rows.forEach((tr, i) => {
      const y = HEAD + i * ROW, mid = y + ROW / 2, c = tr.lane.color;
      if (label()) {
        ctx.fillStyle = tr.lane.job.enabled ? ink : muted;
        ctx.font = "12px ui-sans-serif, system-ui";
        const name = tr.lane.job.name;
        ctx.fillText(name.length > 20 ? `${name.slice(0, 19)}…` : name, 6, mid + 4);
      }
      ctx.fillStyle = line; ctx.fillRect(label(), mid, w - label() - 12, 1);
      if (tr.hum) {
        ctx.save(); ctx.shadowColor = c; ctx.shadowBlur = 14; ctx.globalAlpha = 0.55; ctx.fillStyle = c;
        ctx.beginPath(); ctx.roundRect(label(), mid - 4, w - label() - 12, 8, 4); ctx.fill(); ctx.restore();
        return;
      }
      const bw = Math.max(5, Math.min(18, ((w - label()) / Math.max(1, tr.times.length)) * 0.55));
      for (const t of tr.times) {
        const x = xOf(t, w), flash = lit.get(`${tr.lane.job.id}:${t}`) ?? 0, glow = Math.max(0, 1 - (now - flash) / 600);
        ctx.save();
        ctx.shadowColor = c; ctx.shadowBlur = 10 + glow * 22; ctx.fillStyle = c; ctx.globalAlpha = 0.7 + glow * 0.3;
        ctx.filter = "blur(0.6px)";
        ctx.beginPath(); ctx.roundRect(x - bw / 2, mid - 7 - glow * 2, bw, 14 + glow * 4, 7); ctx.fill();
        ctx.filter = "none"; ctx.globalAlpha = 0.85; ctx.fillStyle = "rgba(255,255,255,.55)";
        ctx.beginPath(); ctx.roundRect(x - bw / 2 + 2, mid - 3, Math.max(1, bw - 4), 3, 2); ctx.fill();
        ctx.restore();
      }
    });
    if (!still) {
      const p = (now % LOOP_MS) / LOOP_MS, px = label() + p * (w - label() - 12);
      const grad = ctx.createLinearGradient(px - 40, 0, px, 0);
      grad.addColorStop(0, "rgba(255,255,255,0)"); grad.addColorStop(1, css("--scan") || "rgba(255,220,170,.35)");
      ctx.fillStyle = grad; ctx.fillRect(px - 40, HEAD - 6, 40, h - HEAD);
      ctx.fillStyle = css("--scan-line") || "#ffd9a8"; ctx.fillRect(px, HEAD - 6, 1.5, h - HEAD);
    }
  }

  /** Notes the playhead crossed since the last frame: lit, and one boom each (no more than one per 150 ms). */
  function sweep(now: number) {
    const p0 = (last % LOOP_MS) / LOOP_MS, p1 = (now % LOOP_MS) / LOOP_MS;
    last = now;
    if (p1 < p0) return;
    for (const tr of rows) for (const t of tr.times) {
      const p = (t - from) / span;
      if (p >= p0 && p < p1) {
        lit.set(`${tr.lane.job.id}:${t}`, now);
        if (loud && now - lastBoom > 150 && tr.times.length <= 48) { lastBoom = now; hit(tr.lane); }
      }
    }
  }

  const loop = (now: number) => { if (!still) sweep(now); paint(now); requestAnimationFrame(loop); };
  requestAnimationFrame((now) => { last = now; loop(now); });

  canvas.addEventListener("click", (e) => {
    const r = canvas.getBoundingClientRect(), i = Math.floor((e.clientY - r.top - HEAD) / ROW);
    const tr = rows[i];
    if (tr) pick(tr.lane.job);
  });
  canvas.addEventListener("mousemove", (e) => {
    const r = canvas.getBoundingClientRect(), i = Math.floor((e.clientY - r.top - HEAD) / ROW);
    canvas.style.cursor = rows[i] ? "pointer" : "default";
  });

  return {
    draw(t, f, s) { rows = t; from = f; span = s; },
    sound(on) { loud = on; },
  };
}
