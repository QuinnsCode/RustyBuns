// The Rust engine (wasm/src/lib.rs) from TypeScript: one memoized load, typed wrappers around
// the JSON-string API. Works in the browser (Vite resolves the .wasm URL) and under Bun (tests).
import init, * as wasm from "./wasm-pkg/qcrm_engine.js";
import { unseal } from "@rustybuns/seal";

export type Engine = typeof wasm;

let loading: Promise<Engine> | undefined;

/**
 * Sealed builds (VITE_QCRM_SEALED=1) fetch the encrypted wasm and the key the server gets from
 * artstewengine; no payment, no key, no engine. Plain builds (dev, tests) load the wasm as is.
 */
async function sealedSource(): Promise<ArrayBuffer> {
  const res = await fetch("/api/engine/key");
  if (!res.ok) throw new Error("engine locked: license not paid");
  const { key } = await res.json() as { key: string };
  const sealed = new Uint8Array(await (await fetch("/engine.sealed")).arrayBuffer());
  return (await unseal(sealed, key)).buffer as ArrayBuffer;
}

/** Load and instantiate the engine once; later calls share the promise. */
export function loadEngine(): Promise<Engine> {
  loading ??= (async () => {
    if ((import.meta as { env?: Record<string, string> }).env?.VITE_QCRM_SEALED === "1") {
      await init({ module_or_path: await sealedSource() });
      return wasm;
    }
    const url = new URL("./wasm-pkg/qcrm_engine_bg.wasm", import.meta.url);
    // Bun: read the file instead of fetching a file: URL.
    const source = typeof Bun !== "undefined" && url.protocol === "file:" ? await Bun.file(url).arrayBuffer() : url;
    await init({ module_or_path: source });
    return wasm;
  })();
  loading.catch(() => { loading = undefined; }); // locked today, paid tomorrow: ask again
  return loading;
}

export interface ContactRow {
  id: string | number;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
  company_id?: string | number | null;
}
export interface DealRow {
  id: string | number;
  name?: string | null;
  stage?: string | null;
  amount_cents?: number | null;
  close_at?: number | string | null;
  contact_id?: string | number | null;
  company_id?: string | number | null;
  updated_at?: number | string | null;
}
export interface ActivityRow {
  id: string | number;
  deal_id?: string | number | null;
  contact_id?: string | number | null;
  at?: number | string | null;
  type?: string | null;
}

export interface DupePair { a: string | number; b: string | number; score: number; why: string[] }
export interface StageTotal { stage: string; weight: number; count: number; amount_cents: number; weighted_cents: number }
export interface MonthTotal { month: string; count: number; amount_cents: number; weighted_cents: number }
export interface Forecast {
  stages: StageTotal[];
  months: MonthTotal[];
  unscheduled_cents: number;
  unscheduled_weighted_cents: number;
  total_weighted_cents: number;
}
export interface StaleDeal {
  id: string | number;
  name: string | null;
  stage: string | null;
  amount_cents: number;
  last_touch_at: number | null;
  days_idle: number | null;
}

/** Below this many contacts one thread is faster than starting workers. */
const PARALLEL_FROM = 1500;

/** Row ranges holding equal shares of the n²/2 pairs: row i compares against every row after it. */
export function splitRows(n: number, parts: number): [number, number][] {
  const out: [number, number][] = [];
  let start = 0;
  for (let k = 1; k <= parts; k++) {
    // Pairs before row r: r(2n - r - 1)/2. Solve for the r that reaches k/parts of n(n-1)/2.
    const end = k === parts ? n : Math.min(n, Math.round(n - 0.5 - Math.sqrt((n - 0.5) ** 2 - (k / parts) * n * (n - 1))));
    if (end > start) out.push([start, end]);
    start = Math.max(start, end);
  }
  return out;
}

/**
 * Likely duplicate contacts, best first. Big lists are split across `workers` Web Workers (default:
 * one per core), each comparing its share of the pairs; small ones, or no Worker, run right here.
 */
export async function dedupe(rows: ContactRow[], workers = globalThis.navigator?.hardwareConcurrency ?? 1): Promise<DupePair[]> {
  if (rows.length < PARALLEL_FROM || workers < 2 || typeof Worker === "undefined") {
    const e = await loadEngine();
    return JSON.parse(e.dedupe(JSON.stringify(rows)));
  }
  const json = JSON.stringify(rows);
  const parts = await Promise.all(splitRows(rows.length, workers).map(([start, end]) => new Promise<DupePair[]>((resolve, reject) => {
    const w = new Worker(new URL("./engine-worker.ts", import.meta.url), { type: "module" });
    w.onmessage = (m) => { w.terminate(); resolve(JSON.parse(m.data)); };
    w.onerror = (err) => { w.terminate(); reject(new Error(err.message || "dedupe worker failed")); };
    w.postMessage({ json, start, end });
  })));
  return parts.flat().sort((p, q) => q.score - p.score);
}

/** Weighted pipeline per stage and expected close per month for six months from `now`. */
export async function forecast(deals: DealRow[], now: number = Date.now()): Promise<Forecast> {
  const e = await loadEngine();
  return JSON.parse(e.forecast(JSON.stringify(deals), now));
}

/** Open deals nobody touched in `days` days, oldest first. */
export async function stale(deals: DealRow[], activities: ActivityRow[], now: number = Date.now(), days = 14): Promise<StaleDeal[]> {
  const e = await loadEngine();
  return JSON.parse(e.stale(JSON.stringify(deals), JSON.stringify(activities), now, days));
}

/** Palette as `0xRRGGBB` numbers, the way the shader wants them. */
export interface WavePalette { sky: number; navy: number; cream: number }

/**
 * Paint one frame of the wave into `out` (RGBA, `w`×`h`, length `w*h*4`) at `t` seconds in blocks
 * of `pixel` screen pixels. Needs a loaded engine: pass the result of `loadEngine()`.
 */
export function waveFrame(engine: Engine, out: Uint8Array, w: number, h: number, t: number, pixel: number, palette: WavePalette) {
  engine.wave_frame(out, w, h, t, pixel, palette.sky, palette.navy, palette.cream);
}

/** `#rgb`, `#rrggbb` or `rgb(r, g, b)` → `0xRRGGBB`; anything else → `fallback`. */
export function cssColor(value: string, fallback: number): number {
  const s = value.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
  if (hex?.[1]) {
    const h = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join("") : hex[1];
    return parseInt(h, 16);
  }
  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(s);
  if (rgb) return (Number(rgb[1]) << 16) | (Number(rgb[2]) << 8) | Number(rgb[3]);
  return fallback;
}
