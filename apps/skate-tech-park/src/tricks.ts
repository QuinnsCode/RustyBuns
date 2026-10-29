// The compendium of flick tricks. A flat-ground trick is named by two things: how far the board turns under
// the rider's feet, and which way it flips. That is the grid SkateBench (T3-Content/skatebench, MIT) asks
// models to name: "board spins 360 backside and flips in the kickflip direction, the skater does not spin"
// is a tre flip. So a trick here is data (`board`, `flip`), and the sim, the view and the tests all read it.

/** `board` is degrees the board turns about its up axis, backside positive; `flip` is turns about its length, kickflip positive (2 is a double). */
export type Trick = { board: number; flip: number; points: number };

export const TRICKS = {
  kickflip: { board: 0, flip: 1, points: 300 },
  heelflip: { board: 0, flip: -1, points: 300 },
  "shove-it": { board: 180, flip: 0, points: 200 },
  varial: { board: 180, flip: 1, points: 450 },
  "inward heel": { board: 180, flip: -1, points: 450 },
  hardflip: { board: -180, flip: 1, points: 500 },
  "varial heel": { board: -180, flip: -1, points: 450 },
  "tre flip": { board: 360, flip: 1, points: 650 },
  "laser flip": { board: -360, flip: -1, points: 700 },
  "frontside shove-it": { board: -180, flip: 0, points: 250 },
  "360 shove-it": { board: 360, flip: 0, points: 450 },
  "double kickflip": { board: 0, flip: 2, points: 550 },
  "double heelflip": { board: 0, flip: -2, points: 550 },
} satisfies Record<string, Trick>;

/** A flick with the rider turning a half on top of it has a name of its own (a tre flip under a 180 is a big flip). */
export const WITH_HALF_TURN: Partial<Record<keyof typeof TRICKS, string>> = { "tre flip": "big flip", "360 shove-it": "bigspin" };

export type Flick = keyof typeof TRICKS;

/** A double turn, or a double flip, takes longer to come round. */
export const flickLong = (k: Flick) => Math.abs(TRICKS[k].board) >= 360 || Math.abs(TRICKS[k].flip) >= 2;
