// Watches a run on a park level and keeps score of what the level asks: named gaps cleared (the bonus is
// added to the rider's score), pickups collected, the best combo, and which goals are done. It only reads
// the sim's State, so the page and the tests drive it the same way.
import type { State } from "../sim.ts";
import type { Goal, ParkLevel } from "./park.ts";

const COMBO_WINDOW = 4; // seconds between tricks before the combo ends
const PICK_R = 1.8;

export type Run = {
  combo: number; bestCombo: number;
  gaps: Map<string, number>;
  collected: Set<number>;
  /** Feed it the state after every sim step. Returns what happened this step, for the HUD. */
  update(s: State): string[];
  done(g: Goal): boolean;
  /** "3 / 6", "1,200 / 3,000" ... for the goal list. */
  progress(g: Goal): string;
};

export function trackRun(level: ParkLevel): Run {
  const run: Run = {
    combo: 0, bestCombo: 0, gaps: new Map(), collected: new Set(),
    update, done, progress,
  };
  let air = false, takeoff = { x: 0, z: 0 }, last: State["last"] = null, score = 0, comboT = -Infinity, score0 = false, topScore = 0, y0 = 0, topY = 0;

  function update(s: State) {
    const events: string[] = [];
    if (!score0) { score = s.score; last = s.last; score0 = true; air = s.air; y0 = topY = s.y; }
    topY = Math.max(topY, s.y);
    if (s.last !== last && s.score > score) {
      if (s.t - comboT > COMBO_WINDOW) run.combo = 0;
      run.combo += s.score - score;
      comboT = s.t;
      run.bestCombo = Math.max(run.bestCombo, run.combo);
    }
    if (s.bail > 0) run.combo = 0;
    if (!air && s.air) takeoff = { x: s.x, z: s.z };
    if (air && !s.air && s.bail <= 0) {
      for (const g of level.gaps) {
        if (Math.hypot(takeoff.x - g.a.x, takeoff.z - g.a.z) > g.r || Math.hypot(s.x - g.b.x, s.z - g.b.z) > g.rb || Math.hypot(s.x - takeoff.x, s.z - takeoff.z) < g.min) continue;
        run.gaps.set(g.name, (run.gaps.get(g.name) ?? 0) + 1);
        s.score += g.bonus; s.last = { name: `Gap: ${g.name}`, points: g.bonus };
        run.combo += g.bonus; run.bestCombo = Math.max(run.bestCombo, run.combo); comboT = s.t;
        events.push(`Gap: ${g.name} +${g.bonus}`);
      }
    }
    level.pickups.forEach((p, i) => {
      if (run.collected.has(i) || Math.hypot(s.x - p.x, s.z - p.z) > PICK_R || Math.abs(s.y - p.y) > 1.8) return;
      run.collected.add(i);
      events.push("Pickup");
    });
    air = s.air; last = s.last; score = s.score; topScore = Math.max(topScore, s.score);
    return events;
  }

  function done(g: Goal) {
    switch (g.kind) {
      case "score": return topScore >= g.target;
      case "combo": return run.bestCombo >= g.target;
      case "gap": return (run.gaps.get(g.name) ?? 0) > 0;
      case "collect": return run.collected.size >= (g.count ?? level.pickups.length);
      case "climb": return topY - y0 >= g.metres;
    }
  }

  function progress(g: Goal) {
    switch (g.kind) {
      case "score": return `${Math.min(topScore, g.target).toLocaleString("en-US")} / ${g.target.toLocaleString("en-US")}`;
      case "combo": return `${Math.min(run.bestCombo, g.target).toLocaleString("en-US")} / ${g.target.toLocaleString("en-US")}`;
      case "gap": return done(g) ? "cleared" : "not yet";
      case "collect": return `${run.collected.size} / ${g.count ?? level.pickups.length}`;
      case "climb": return `${Math.round(Math.min(g.metres, topY - y0))} / ${g.metres} m`;
    }
  }

  return run;
}
