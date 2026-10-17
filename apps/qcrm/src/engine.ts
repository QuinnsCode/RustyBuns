// The Rust engine (wasm/src/lib.rs) from TypeScript: one memoized load, typed wrappers around
// the JSON-string API. Works in the browser (Vite resolves the .wasm URL) and under Bun (tests).
import init, * as wasm from "./wasm-pkg/qcrm_engine.js";

export type Engine = typeof wasm;

let loading: Promise<Engine> | undefined;

/** Load and instantiate the engine once; later calls share the promise. */
export function loadEngine(): Promise<Engine> {
  loading ??= (async () => {
    const url = new URL("./wasm-pkg/qcrm_engine_bg.wasm", import.meta.url);
    // Bun: read the file instead of fetching a file: URL.
    const source = typeof Bun !== "undefined" && url.protocol === "file:" ? await Bun.file(url).arrayBuffer() : url;
    await init({ module_or_path: source });
    return wasm;
  })();
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

/** Likely duplicate contacts, best first. */
export async function dedupe(rows: ContactRow[]): Promise<DupePair[]> {
  const e = await loadEngine();
  return JSON.parse(e.dedupe(JSON.stringify(rows)));
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
