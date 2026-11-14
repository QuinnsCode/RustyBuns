// The stage screens: what the amp is doing, drawn from one FFT of the output.
// Spectrum (bars, 40 Hz up to 25 kHz or the top of the sample rate), Analog (the
// same range as a glowing phosphor trace that leaves a trail), Scope (the wave
// itself, held still on a rising zero crossing), and Focus (three zoomed bands:
// low mids, mids, highs).

export type ScreenMode = "spectrum" | "analog" | "scope" | "focus";
export const MODES: { id: ScreenMode; label: string }[] = [
  { id: "spectrum", label: "Spectrum" },
  { id: "analog", label: "Analog" },
  { id: "scope", label: "Scope" },
  { id: "focus", label: "Focus" },
];

/** One analyser read, shared by every screen this frame. */
export interface Frame { db: Float32Array; wave: Float32Array; sampleRate: number }

export const F_MIN = 40;
export const topHz = (sampleRate: number) => Math.min(25_000, sampleRate / 2);
const DB_LO = -110, DB_HI = -10;
/** The three Focus bands: name, low and high edge (Hz; Infinity is the top of the range), colour. */
export const BANDS = [
  { name: "Low mids", lo: 150, hi: 1000, color: "#ffb000" },
  { name: "Mids", lo: 1000, hi: 2500, color: "#ff6b4a" },
  { name: "Highs", lo: 5000, hi: Infinity, color: "#6bc8ff" },
] as const;
const GRID_HZ = [50, 100, 200, 500, 1000, 2000, 5000, 10_000, 20_000];

export const hzLabel = (f: number) => (f >= 1000 ? `${+(f / 1000).toFixed(f % 1000 ? 1 : 0)}k` : `${Math.round(f)}`);

/** The loudest bin between f0 and f1 Hz, in dB; between bins when the range is narrower than one. */
export function bandDb(db: Float32Array, binHz: number, f0: number, f1: number): number {
  const b0 = f0 / binHz, b1 = f1 / binHz;
  if (b1 - b0 < 1) {
    const c = (b0 + b1) / 2, i = Math.min(Math.floor(c), db.length - 2), t = c - i;
    return db[i] + (db[i + 1] - db[i]) * t;
  }
  let m = -Infinity;
  for (let i = Math.floor(b0), end = Math.min(Math.ceil(b1), db.length - 1); i <= end; i++) if (db[i] > m) m = db[i];
  return m;
}

const yOfDb = (d: number, h: number) => h * (1 - (Math.max(DB_LO, Math.min(DB_HI, d)) - DB_LO) / (DB_HI - DB_LO));

export class Screen {
  mode: ScreenMode;
  private g: CanvasRenderingContext2D;
  private caps = new Float32Array(0);
  private w = 0;
  private h = 0;

  constructor(readonly canvas: HTMLCanvasElement, mode: ScreenMode) {
    this.mode = mode;
    const g = canvas.getContext("2d");
    if (!g) throw new Error("no 2D canvas");
    this.g = g;
  }

  setMode(m: ScreenMode): void { this.mode = m; this.w = 0; }

  draw(fr: Frame): void {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const cw = Math.round(this.canvas.clientWidth * dpr), ch = Math.round(this.canvas.clientHeight * dpr);
    if (cw === 0 || ch === 0) return;
    if (cw !== this.w || ch !== this.h) {
      this.canvas.width = this.w = cw; this.canvas.height = this.h = ch;
      this.caps = new Float32Array(0);
      this.g.fillStyle = "#05080a"; this.g.fillRect(0, 0, cw, ch);
    }
    const g = this.g;
    g.save();
    g.scale(dpr, dpr);
    const w = cw / dpr, h = ch / dpr;
    if (this.mode === "spectrum") this.spectrum(g, fr, w, h);
    else if (this.mode === "analog") this.analog(g, fr, w, h);
    else if (this.mode === "scope") this.scope(g, fr, w, h);
    else this.focus(g, fr, w, h);
    g.restore();
  }

  private logGrid(g: CanvasRenderingContext2D, x0: number, w: number, h: number, lo: number, hi: number, ticks: number[], color: string) {
    g.strokeStyle = color; g.fillStyle = color; g.lineWidth = 1;
    g.font = "10px 'IBM Plex Mono', ui-monospace, monospace";
    for (let d = DB_HI; d >= DB_LO; d -= 20) { const y = Math.round(yOfDb(d, h)) + 0.5; g.beginPath(); g.moveTo(x0, y); g.lineTo(x0 + w, y); g.stroke(); }
    for (const f of ticks) {
      if (f < lo || f > hi) continue;
      const xl = x0 + (w * Math.log(f / lo)) / Math.log(hi / lo);
      if (xl > x0 + w - 26) continue; // no label cut off at the edge
      const x = Math.round(x0 + (w * Math.log(f / lo)) / Math.log(hi / lo)) + 0.5;
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke();
      g.fillText(hzLabel(f), x + 3, h - 4);
    }
  }

  private spectrum(g: CanvasRenderingContext2D, fr: Frame, w: number, h: number) {
    const top = topHz(fr.sampleRate), binHz = fr.sampleRate / 2 / fr.db.length;
    const bars = Math.max(24, Math.min(120, Math.floor(w / 7)));
    if (this.caps.length !== bars) this.caps = new Float32Array(bars).fill(DB_LO);
    g.fillStyle = "#05080a"; g.fillRect(0, 0, w, h);
    this.logGrid(g, 0, w, h, F_MIN, top, GRID_HZ, "rgba(255,255,255,0.08)");
    const grad = g.createLinearGradient(0, h, 0, 0);
    grad.addColorStop(0, "#1f8a5a"); grad.addColorStop(0.55, "#4fd18b"); grad.addColorStop(0.8, "#ffb000"); grad.addColorStop(1, "#ff4d3d");
    const bw = w / bars, k = Math.log(top / F_MIN) / bars;
    for (let i = 0; i < bars; i++) {
      const d = bandDb(fr.db, binHz, F_MIN * Math.exp(k * i), F_MIN * Math.exp(k * (i + 1)));
      const y = yOfDb(d, h);
      g.fillStyle = grad; g.fillRect(i * bw + 1, y, bw - 2, h - y);
      this.caps[i] = Math.max(d, this.caps[i] - 0.6); // peak caps fall slowly
      g.fillStyle = "#eceef1"; g.fillRect(i * bw + 1, yOfDb(this.caps[i], h) - 2, bw - 2, 2);
    }
  }

  private analog(g: CanvasRenderingContext2D, fr: Frame, w: number, h: number) {
    const top = topHz(fr.sampleRate), binHz = fr.sampleRate / 2 / fr.db.length;
    g.fillStyle = "rgba(3, 10, 6, 0.3)"; g.fillRect(0, 0, w, h); // the old trace fades: phosphor persistence
    this.logGrid(g, 0, w, h, F_MIN, top, GRID_HZ, "rgba(93, 255, 138, 0.12)");
    g.strokeStyle = "#7dffa3"; g.lineWidth = 1.6; g.shadowColor = "#3dff7a"; g.shadowBlur = 8;
    g.beginPath();
    const k = Math.log(top / F_MIN) / w;
    for (let x = 0; x <= w; x += 1) {
      const y = yOfDb(bandDb(fr.db, binHz, F_MIN * Math.exp(k * x), F_MIN * Math.exp(k * (x + 1))), h);
      if (x === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.stroke();
    g.shadowBlur = 0;
  }

  private scope(g: CanvasRenderingContext2D, fr: Frame, w: number, h: number) {
    const wave = fr.wave, span = Math.min(wave.length >> 1, Math.round(fr.sampleRate * 0.04)); // 40 ms across
    // Hold it still: the last rising zero crossing that leaves a full span after it.
    let start = wave.length - span - 1;
    for (let i = wave.length - span - 1; i > wave.length - 2 * span; i--) if (wave[i - 1] < 0 && wave[i] >= 0) { start = i; break; }
    g.fillStyle = "rgba(10, 7, 2, 0.35)"; g.fillRect(0, 0, w, h);
    g.strokeStyle = "rgba(255, 176, 0, 0.12)"; g.lineWidth = 1;
    for (let i = 1; i < 10; i++) { const x = Math.round((w * i) / 10) + 0.5; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
    for (let i = 1; i < 8; i++) { const y = Math.round((h * i) / 8) + 0.5; g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    g.strokeStyle = "#ffc94d"; g.lineWidth = 1.6; g.shadowColor = "#ffb000"; g.shadowBlur = 8;
    g.beginPath();
    for (let x = 0; x <= w; x++) {
      const v = wave[start + Math.floor((x / w) * span)] ?? 0, y = h / 2 - v * (h / 2) * 0.95;
      if (x === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.stroke();
    g.shadowBlur = 0;
    g.fillStyle = "rgba(255, 201, 77, 0.7)"; g.font = "10px 'IBM Plex Mono', ui-monospace, monospace";
    g.fillText("4 ms / div", 6, h - 6);
  }

  private focus(g: CanvasRenderingContext2D, fr: Frame, w: number, h: number) {
    const top = topHz(fr.sampleRate), binHz = fr.sampleRate / 2 / fr.db.length;
    g.fillStyle = "#05080a"; g.fillRect(0, 0, w, h);
    const stacked = w < 520, gap = 8;
    const pw = stacked ? w : (w - gap * 2) / 3, ph = stacked ? (h - gap * 2) / 3 : h;
    BANDS.forEach((b, i) => {
      const x0 = stacked ? 0 : i * (pw + gap), y0 = stacked ? i * (ph + gap) : 0, hi = Math.min(b.hi, top);
      g.save();
      g.translate(x0, y0);
      g.beginPath(); g.rect(0, 0, pw, ph); g.clip();
      g.fillStyle = "#0a0e12"; g.fillRect(0, 0, pw, ph);
      const ticks = b.lo === 150 ? [200, 300, 500, 700] : b.lo === 1000 ? [1200, 1500, 2000] : [6000, 8000, 10_000, 15_000, 20_000];
      this.logGrid(g, 0, pw, ph, b.lo, hi, ticks, "rgba(255,255,255,0.08)");
      const k = Math.log(hi / b.lo) / pw;
      let best = -Infinity, bestHz: number = b.lo;
      g.beginPath(); g.moveTo(0, ph);
      for (let x = 0; x <= pw; x++) {
        const f0 = b.lo * Math.exp(k * x), d = bandDb(fr.db, binHz, f0, b.lo * Math.exp(k * (x + 1)));
        if (d > best) { best = d; bestHz = f0; }
        g.lineTo(x, yOfDb(d, ph));
      }
      g.lineTo(pw, ph); g.closePath();
      g.fillStyle = b.color + "55"; g.fill();
      g.strokeStyle = b.color; g.lineWidth = 1.4; g.stroke();
      g.fillStyle = b.color; g.font = "600 12px 'Barlow Condensed', 'Arial Narrow', sans-serif";
      g.fillText(`${b.name.toUpperCase()}  ${hzLabel(b.lo)}–${hzLabel(hi)}`, 6, 15);
      g.font = "10px 'IBM Plex Mono', ui-monospace, monospace";
      if (best > DB_LO) g.fillText(`peak ${hzLabel(bestHz)} Hz ${Math.round(best)} dB`, 6, 29);
      g.restore();
    });
  }
}
