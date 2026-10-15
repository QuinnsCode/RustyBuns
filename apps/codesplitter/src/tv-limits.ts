// Limits for the TV view (#1562): a flood, say 10,000 cheap agents all branching at once, has to stay
// readable and not melt the page. The view is drawn from these pure functions; the viewer's choices
// live in their browser (localStorage "tv-limits"). Imports nothing.

export interface Limits {
  /** Lanes drawn in full before the rest share a thinning band and fold into "+N more". */
  maxLanes: number;
  /** Seconds of activity averaged into one swell, so 500 commits in a second read as one. */
  smoothSecs: number;
  /** Lanes with fewer changed lines than this are hidden (the floor). */
  minLines: number;
  /** A lane with more changed lines than this is summarised, not animated line by line (the ceiling). */
  maxLines: number;
}

export type Preset = "calm" | "busy" | "firehose";
export const PRESETS: Record<Preset, Limits> = {
  calm: { maxLanes: 12, smoothSecs: 10, minLines: 2, maxLines: 200 },
  busy: { maxLanes: 40, smoothSecs: 4, minLines: 1, maxLines: 1000 },
  firehose: { maxLanes: 120, smoothSecs: 1, minLines: 0, maxLines: 5000 },
};
/** What an untouched TV uses. */
export const DEFAULT: Preset = "calm";
/** Hard bounds on what a viewer may set, so no setting can melt the page. */
export const BOUNDS: Record<keyof Limits, [number, number]> = { maxLanes: [1, 200], smoothSecs: [0.5, 60], minLines: [0, 100], maxLines: [10, 20000] };

/** Stored settings back into valid limits: anything missing, wrong or out of bounds falls to the default's. */
export function parseLimits(raw: string | null | undefined): Limits {
  const base = PRESETS[DEFAULT];
  try {
    const o = JSON.parse(raw ?? "null") as Record<string, unknown> | null;
    if (typeof o?.preset === "string" && o.preset in PRESETS) return { ...PRESETS[o.preset as Preset] };
    const out = { ...base };
    for (const k of Object.keys(BOUNDS) as (keyof Limits)[]) {
      const v = o?.[k], [lo, hi] = BOUNDS[k];
      if (typeof v === "number" && Number.isFinite(v)) out[k] = Math.min(hi, Math.max(lo, v));
    }
    return out;
  } catch { return { ...base }; }
}

/**
 * A count through a log scale: the first few get full detail, the next hundreds a thinning share.
 * `n` things onto `room` slots, never more than `room` and never zero for a positive `n`.
 */
export function logShare(n: number, room: number): number {
  if (n <= 0) return 0;
  return Math.max(1, Math.min(room, Math.round(room * Math.log1p(n) / Math.log1p(Math.max(n, room)))));
}

export interface Lane { name: string; lines: number; at: number }
export interface Shown { lanes: Lane[]; folded: { count: number; lines: number; heat: number } | null }

/**
 * The lanes to draw: those under the floor are hidden, the busiest `maxLanes` kept, and the rest folded
 * into one "+N more" lane carrying the count and a heat in 0..1 (their share of all the changed lines).
 */
export function shownLanes(lanes: Lane[], l: Limits): Shown {
  const live = lanes.filter((x) => x.lines >= l.minLines).sort((a, b) => b.lines - a.lines || b.at - a.at);
  const kept = live.slice(0, l.maxLanes), rest = live.slice(l.maxLanes);
  if (!rest.length) return { lanes: kept, folded: null };
  const lines = rest.reduce((s, x) => s + x.lines, 0), all = live.reduce((s, x) => s + x.lines, 0);
  return { lanes: kept, folded: { count: rest.length, lines, heat: all ? lines / all : 0 } };
}

/** Exponential smoothing of a rate over a window: a burst becomes a swell that decays. Call once per sample. */
export function smooth(prev: number, sample: number, dtSecs: number, windowSecs: number): number {
  if (windowSecs <= 0) return sample;
  const a = 1 - Math.exp(-Math.max(0, dtSecs) / windowSecs);
  return prev + a * (sample - prev);
}

/** Beads to draw for `events` this tick: rate-limited and merged, so a burst is one fat bead. `size` is how many it stands for. */
export function beads(events: number, maxBeads: number): { count: number; size: number } {
  if (events <= 0) return { count: 0, size: 0 };
  const count = Math.min(events, Math.max(1, maxBeads));
  return { count, size: Math.ceil(events / count) };
}

/** Whether a lane's per-line animation drops to a glow (past the ceiling). */
export const glowOnly = (lines: number, l: Limits) => lines > l.maxLines;

/** What a viewer stored under localStorage "tv-limits": a preset's name alone, as the select writes it. */
export const storeLimits = (preset: Preset) => JSON.stringify({ preset });

/**
 * The vein's lanes capped at `maxLanes` (main is lane 0): every lane past that shares one folded lane, so a flood of
 * branches stays `maxLanes + 1` rows tall. `folded` counts the dots moved there, for its "+N more" label.
 */
export function foldLanes<D extends { lane: number }, E extends { l1: number; l2: number }>(dots: D[], edges: E[], lanes: number, maxLanes: number) {
  if (lanes <= maxLanes) return { dots, edges, lanes, folded: 0 };
  const at = (l: number) => Math.min(l, maxLanes);
  return {
    dots: dots.map((d) => ({ ...d, lane: at(d.lane) })),
    edges: edges.map((e) => ({ ...e, l1: at(e.l1), l2: at(e.l2) })),
    lanes: maxLanes + 1,
    folded: dots.filter((d) => d.lane >= maxLanes).length,
  };
}
