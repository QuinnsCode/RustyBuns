// Your guitar's own rig in the jam room (src/studio/seat-bar.ts): the head and cabinet you picked, the pedals on your
// board in the order the signal goes, and one loop back. It travels with your guitar on the live line, so everyone
// hears your board without touching the sesh's groove. The project and the world read it, so it imports nothing from
// the circuits (a test keeps these lists the same as theirs); src/guitar.ts builds the settings from it.
import { arr, int, num, obj, oneOf, opt, type Of } from "@rustybuns/util/guard";
import { AMP_IDS } from "./track-amp.ts";

/** PEDALS (src/circuit/amps.ts), by id. */
export const PEDAL_IDS = ["drive", "fuzz", "dist", "phase", "vibe", "trem", "wah", "autowah", "comp", "octave", "germ"] as const;
export type PedalId = (typeof PEDAL_IDS)[number];
/** CAB_IDS (@rustybuns/gear/circuit cab.ts). */
export const BOARD_CABS = ["1x12", "2x12", "4x12"] as const;
/** Pedals a board holds: each is a circuit solved at the oversampled rate, and six is what a laptop keeps up with. */
export const MAX_BOARD = 6;
/** How much of the loop's pedal goes round again. */
export const BACK_GAIN = 0.35;

const Pedal = obj({ pedal: oneOf(PEDAL_IDS), drive: num(0, 10, 5) });
export const BoardRig = obj({
  amp: oneOf(AMP_IDS, "brit"),
  cab: oneOf(BOARD_CABS, "2x12"),
  pedals: arr(Pedal, MAX_BOARD),
  /** A loop from pedal `from`'s output back to pedal `to`'s input (`to` ≤ `from`). */
  back: opt(obj({ from: int(0, MAX_BOARD - 1), to: int(0, MAX_BOARD - 1) })),
});
export type BoardRig = Of<typeof BoardRig>;

/** A fresh board: one pedal into the first head. */
export const newBoard = (): BoardRig => ({ amp: "brit", cab: "2x12", pedals: [{ pedal: "drive", drive: 5 }] });

/** The board with `pedal` at the end of the chain, cabled; unchanged when it's full. */
export const addPedal = (b: BoardRig, pedal: PedalId): BoardRig => (b.pedals.length >= MAX_BOARD ? b : { ...b, pedals: [...b.pedals, { pedal, drive: 5 }] });

/** The board without pedal `i`: the cables close up, and a loop that touched it comes out. */
export function removePedal(b: BoardRig, i: number): BoardRig {
  const { back, ...rest } = b, shift = (n: number) => (n > i ? n - 1 : n);
  return { ...rest, pedals: b.pedals.filter((_, k) => k !== i), ...(back && back.from !== i && back.to !== i ? { back: { from: shift(back.from), to: shift(back.to) } } : {}) };
}

/** A drag from pedal `a` to pedal `b`: the loop from the later one's output into the earlier's input. The same drag again takes it out. */
export function loopBack(r: BoardRig, a: number, b: number): BoardRig {
  const from = Math.max(a, b), to = Math.min(a, b), { back, ...rest } = r;
  if (to < 0 || from >= r.pedals.length) return r;
  return back?.from === from && back.to === to ? rest : { ...rest, back: { from, to } };
}
