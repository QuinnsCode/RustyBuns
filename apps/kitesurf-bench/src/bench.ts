// One cell of the bench: the same Quick Action on the same page, Kitesurf and Chromium taking turns,
// each timed from inside the Worker. Turns alternate so neither engine always goes first into a cold page.

/** The part of the Browser Run binding the bench calls. */
export interface Browser {
  quickAction(action: string, options: { url: string; browser?: "kitesurf" }): Promise<Response>;
}

export const ENGINES = ["kitesurf", "chromium"] as const;
export type Engine = (typeof ENGINES)[number];
export const ACTIONS = ["content", "markdown", "screenshot"] as const;
export type Action = (typeof ACTIONS)[number];
export const isAction = (x: unknown): x is Action => ACTIONS.some((a) => a === x);

/** Our live pages. A fixed list, so nobody can point the deployed bench at anything else. */
export const SITES = [
  { name: "eqosys", url: "https://eqosys.qntbr.com/" },
  { name: "qCRM", url: "https://qcrm.qntbr.com/" },
  { name: "codeSplitter", url: "https://codesplitter.notryanquinn.workers.dev/" },
  { name: "ShareSplat", url: "https://sharesplat.notryanquinn.workers.dev/" },
  { name: "Playground", url: "https://rustybuns-playground.notryanquinn.workers.dev/" },
  { name: "Hello World", url: "https://hello-world.notryanquinn.workers.dev/" },
  { name: "Skate Tech Park (WebGL)", url: "https://skate-tech-park.notryanquinn.workers.dev/" },
] as const;

export type Run = { ms: number; ok: boolean; status: number; bytes: number; browserMs: number | null; error?: string };
export type Side = { runs: Run[]; medianMs: number | null; medianBrowserMs: number | null; failed: number; error?: string };
export type Cell = { site: string; url: string; action: Action; kitesurf: Side; chromium: Side };

export const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/** Browser time Cloudflare reports for the call, when it sends the header. */
const browserMs = (r: Response): number | null => {
  const v = r.headers.get("x-browser-ms-used");
  const n = v === null ? NaN : Number(v);
  return Number.isFinite(n) ? n : null;
};

async function once(b: Browser, engine: Engine, action: Action, url: string, now: () => number): Promise<Run> {
  const t0 = now();
  try {
    const r = await b.quickAction(action, engine === "kitesurf" ? { url, browser: "kitesurf" } : { url });
    const body = await r.arrayBuffer();
    const run: Run = { ms: now() - t0, ok: r.ok, status: r.status, bytes: body.byteLength, browserMs: browserMs(r) };
    if (!r.ok) run.error = new TextDecoder().decode(body.slice(0, 300));
    return run;
  } catch (e) {
    return { ms: now() - t0, ok: false, status: 0, bytes: 0, browserMs: null, error: String(e instanceof Error ? e.message : e).slice(0, 300) };
  }
}

const side = (runs: Run[]): Side => {
  const good = runs.filter((r) => r.ok);
  const ms = good.map((r) => r.browserMs).filter((x): x is number => x !== null);
  const s: Side = { runs, medianMs: median(good.map((r) => r.ms)), medianBrowserMs: median(ms), failed: runs.length - good.length };
  const err = runs.find((r) => !r.ok)?.error;
  if (err) s.error = err;
  return s;
};

/** `reps` turns each, alternating which engine goes first. */
export async function cell(b: Browser, siteIndex: number, action: Action, reps: number, now = () => Date.now()): Promise<Cell> {
  const site = SITES[siteIndex]!;
  const runs: Record<Engine, Run[]> = { kitesurf: [], chromium: [] };
  for (let i = 0; i < reps; i++) {
    const order: Engine[] = i % 2 ? ["chromium", "kitesurf"] : ["kitesurf", "chromium"];
    for (const e of order) runs[e].push(await once(b, e, action, site.url, now));
  }
  return { site: site.name, url: site.url, action, kitesurf: side(runs.kitesurf), chromium: side(runs.chromium) };
}
