// Which eqosys achievements a frame earns (the catalog is "hippo-tycoon" in apps/eqosys/src/achievements.ts). Pure: it
// reads the frames the game already draws, keeps a round's tallies in `Tally`, and names ids; the page sends them.
import type { Frame } from "./driver.ts";
import { GOLD } from "../sim/rules.ts";

export interface Tally {
  phase: string;
  /** This round, for this machine's seats. */
  gold: number;
  bad: boolean;
  /** Rounds won in a row. */
  streak: number;
}
export const newTally = (): Tally => ({ phase: "", gold: 0, bad: false, streak: 0 });

/** The achievement ids `f` earns (repeats are fine: the eqosys client asks once per id). Updates `t`. */
export function earned(t: Tally, f: Frame): string[] {
  const out: string[] = [];
  const mine = (seat: number) => f.mine.includes(seat);
  if (f.phase === "countdown" && t.phase !== "countdown") { t.gold = 0; t.bad = false; }
  if (f.phase === "playing" && t.phase !== "playing") {
    out.push("played", "alpha");
    const people = f.seats.filter((s) => s.human).length;
    if (f.mine.length >= 2) out.push("couch");
    if (people > f.mine.length) out.push("online");
    if (people === f.seats.length) out.push("full-park");
  }
  for (const e of f.events) {
    if (!("seat" in e) || !mine(e.seat)) continue;
    if (e.t === "eat") {
      out.push("first-chomp");
      if (e.kind === GOLD) { out.push("gold"); if (++t.gold >= 5) out.push("gold-rush"); }
    } else if (e.t === "sputter") { out.push("sludge"); t.bad = true; }
    else if (e.t === "sore") { out.push("nail"); t.bad = true; }
    else if (e.t === "flood") t.bad = true;
    else if (e.t === "dud") out.push("water");
    else if (e.t === "bellow") out.push("bellow");
  }
  if (f.phase === "podium" && t.phase === "playing" && f.mine.length) {
    const scores = f.cur.hippos.map((h) => h.score);
    const best = Math.max(...f.mine.map((s) => scores[s] ?? 0));
    const won = f.mine.some((s) => scores.every((x, i) => i === s || x < scores[s]!));
    if (best > 0) out.push("profitable");
    if (best >= 30) out.push("tycoon");
    if (best >= 50) out.push("oil-baron");
    if (!t.bad && best > 0) out.push("clean-books");
    if (f.cfg.secs >= 90) out.push("long-shift");
    t.streak = won ? t.streak + 1 : 0;
    if (won) {
      out.push("first-win");
      // every seat no person sits in is a hard bot
      if (f.seats.some((s) => !s.human) && f.seats.every((s, i) => s.human || f.cfg.bots[i] === "hard")) out.push("hard-win");
      if (t.streak >= 3) out.push("hat-trick");
    }
  }
  t.phase = f.phase;
  return out;
}
