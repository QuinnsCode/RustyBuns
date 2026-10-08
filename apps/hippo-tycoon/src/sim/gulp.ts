import { hippoPoint } from "./geom.ts";
import { GULP_OUT, MIN_SCORE, NAIL, POINTS, SCOOP_R, SLUDGE, SORE_TICKS, SPUTTER_TICKS, WATER } from "./rules.ts";
import type { Event, State } from "./types.ts";

/** Resolve every chomp that lands this tick. A drop two jaws both reach goes to the nearer one. */
export function resolveGulps(s: State, out: Event[]) {
  const landing = s.hippos.filter((h) => h.gulp === GULP_OUT);
  if (!landing.length) return;
  const jaws = landing.map((h) => ({ h, ...hippoPoint(h.seat, h.slide, 1) }));
  for (const j of jaws) if (j.h.dud) { out.push({ t: "dud", seat: j.h.seat }); }
  const live = jaws.filter((j) => !j.h.dud);
  const eaten = new Set<number>();
  for (const d of s.drops) {
    let best: (typeof live)[number] | null = null, bestD = Infinity;
    for (const j of live) {
      const d2 = (d.x - j.x) ** 2 + (d.y - j.y) ** 2;
      if (d2 <= SCOOP_R * SCOOP_R && d2 < bestD) { best = j; bestD = d2; }
    }
    if (!best) continue;
    eaten.add(d.id);
    const h = best.h, pts = POINTS[d.kind]!;
    h.score = Math.max(MIN_SCORE, h.score + pts);
    out.push({ t: "eat", seat: h.seat, kind: d.kind, pts, x: d.x, y: d.y });
    if (d.kind === SLUDGE) { h.sputter = SPUTTER_TICKS; out.push({ t: "sputter", seat: h.seat }); }
    else if (d.kind === NAIL) { h.sore = SORE_TICKS; out.push({ t: "sore", seat: h.seat }); }
    else if (d.kind === WATER) { h.flooded = true; out.push({ t: "flood", seat: h.seat }); }
  }
  if (eaten.size) s.drops = s.drops.filter((d) => !eaten.has(d.id));
}
