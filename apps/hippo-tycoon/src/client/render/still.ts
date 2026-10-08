// Frames made by hand, with no sim behind them: the menu's backdrop and the dev
// preview page draw the real renderer from these.
import { DEFAULT_CFG, type DropView, type Phase, type Snapshot } from "../../engine/match.ts";
import { SEAT_NAMES, SEATS } from "../../sim/rules.ts";
import type { Event, Hippo } from "../../sim/types.ts";
import type { Frame, SeatView } from "../driver.ts";

export interface Still {
  phase?: Phase;
  scores?: number[];
  slides?: number[];
  /** Per-seat overrides: bellow (roar), sputter, sore. */
  hippos?: Partial<Hippo>[];
  countdown?: number;
  drops?: DropView[];
  seats?: Partial<SeatView>[];
  mine?: number[];
  events?: Event[];
}

export function stillSnapshot(o: Still = {}): Snapshot {
  const hippos = Array.from({ length: SEATS }, (_, i): Hippo => ({
    seat: i, slide: o.slides?.[i] ?? 0, gulp: -1, cooldown: 0, sputter: 0, sore: 0, flooded: false, dud: false, score: o.scores?.[i] ?? 0, bellow: 0, ...o.hippos?.[i],
  }));
  return { tick: 0, round: 0, phase: o.phase ?? "lobby", countdown: o.countdown ?? 0, left: 0, hippos, drops: o.drops ?? [], slicks: [], events: [] };
}

export function stillFrame(o: Still = {}): Frame {
  const snap = stillSnapshot(o), mine = o.mine ?? [];
  const seats = Array.from({ length: SEATS }, (_, i): SeatView => ({ name: SEAT_NAMES[i]!, human: false, ready: false, mine: mine.includes(i), ...o.seats?.[i] }));
  return { phase: snap.phase, prev: snap, cur: snap, alpha: 1, seats, mine, cfg: DEFAULT_CFG, hostSeat: 0, events: o.events ?? [] };
}
