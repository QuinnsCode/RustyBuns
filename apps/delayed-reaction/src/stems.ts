// What a text-only agent can say about a render without ears: how loud it is, whether it clips, whether the
// weight is dead centre, and whether the kicks land on the grid. Pure numbers over sample arrays; the page that
// makes them is scripts/render.ts. Everything that still needs ears is listed in scripts/render.ts's report.

export type Take = { l: Float32Array; r: Float32Array; rate: number };

const db = (x: number) => (x > 1e-9 ? 20 * Math.log10(x) : -180);

/** A 32-bit float stereo WAV, so a render keeps its headroom for whoever opens it next. */
export function wav({ l, r, rate }: Take): Uint8Array {
  const n = l.length, out = new DataView(new ArrayBuffer(44 + n * 8));
  const text = (at: number, s: string) => { for (let i = 0; i < s.length; i++) out.setUint8(at + i, s.charCodeAt(i)); };
  text(0, "RIFF"); out.setUint32(4, 36 + n * 8, true); text(8, "WAVE"); text(12, "fmt ");
  out.setUint32(16, 16, true); out.setUint16(20, 3, true); out.setUint16(22, 2, true);
  out.setUint32(24, rate, true); out.setUint32(28, rate * 8, true); out.setUint16(32, 8, true); out.setUint16(34, 32, true);
  text(36, "data"); out.setUint32(40, n * 8, true);
  for (let i = 0; i < n; i++) { out.setFloat32(44 + i * 8, l[i]!, true); out.setFloat32(48 + i * 8, r[i]!, true); }
  return new Uint8Array(out.buffer);
}

/** Peak and loudness in dBFS, how many samples reach full scale, and the DC offset (a speaker-killer in a sub). */
export function levels({ l, r }: Take) {
  let peak = 0, sum = 0, clipped = 0, dc = 0;
  for (const ch of [l, r]) for (let i = 0; i < ch.length; i++) {
    const v = ch[i]!, a = Math.abs(v);
    if (a > peak) peak = a;
    if (a >= 0.999) clipped++;
    sum += v * v;
    dc += v;
  }
  const n = l.length + r.length;
  return { peakDb: db(peak), rmsDb: db(Math.sqrt(sum / n)), clipped, dc: n ? dc / n : 0 };
}

/** Side level under mid level in dB: very negative is mono and dead centre, about 0 is as wide as it gets. */
export function width({ l, r }: Take): number {
  let mid = 0, side = 0;
  for (let i = 0; i < l.length; i++) { const m = (l[i]! + r[i]!) / 2, s = (l[i]! - r[i]!) / 2; mid += m * m; side += s * s; }
  return db(Math.sqrt(side / Math.max(l.length, 1))) - db(Math.sqrt(mid / Math.max(l.length, 1)));
}

/** The share of a signal's energy under `hz`: how much of a stem is weight, not air. */
export function lowShare(x: Float32Array, rate: number, hz: number): number {
  const a = 1 - Math.exp((-2 * Math.PI * hz) / rate);
  let y = 0, low = 0, all = 0;
  for (let i = 0; i < x.length; i++) { y += a * (x[i]! - y); low += y * y; all += x[i]! * x[i]!; }
  return all ? low / all : 0;
}

/** Times (seconds) where the low end of `x` jumps: the kick. An 80 Hz one-pole, 5 ms hops, rising past half the loudest. */
export function kicks(x: Float32Array, rate: number, fraction = 0.5): number[] {
  const a = 1 - Math.exp((-2 * Math.PI * 80) / rate), hop = Math.round(rate * 0.005), step = hop / rate;
  const env: number[] = [];
  let y = 0, peak = 0;
  for (let i = 0; i + hop <= x.length; i += hop) {
    let m = 0;
    for (let k = 0; k < hop; k++) { y += a * (x[i + k]! - y); m = Math.max(m, Math.abs(y)); }
    env.push(m);
    peak = Math.max(peak, m);
  }
  const out: number[] = [];
  for (let i = 1; i < env.length; i++) {
    if (env[i]! > peak * fraction && env[i - 1]! <= peak * fraction && (!out.length || i * step - out.at(-1)! > 0.15)) out.push(i * step);
  }
  return out;
}

/** How far the times wander from a steady `bpm` grid, in ms: the worst gap from the median offset, which takes out the detector's own lag. */
export function offGrid(times: number[], bpm: number, offset: number): number {
  const spb = 60 / bpm;
  const dev = times.map((t) => { const k = (t - offset) / spb; return (k - Math.round(k)) * spb * 1000; });
  const mid = [...dev].sort((a, b) => a - b)[Math.floor(dev.length / 2)] ?? 0;
  return Math.max(0, ...dev.map((d) => Math.abs(d - mid)));
}

/** The report a render gets: one row per stem and the mix. */
export type Row = { stem: string; peakDb: number; rmsDb: number; clipped: number; dc: number; widthDb: number; lowShare: number };

export function row(stem: string, take: Take): Row {
  const v = levels(take);
  return { stem, ...v, widthDb: width(take), lowShare: lowShare(take.l, take.rate, 120) };
}
