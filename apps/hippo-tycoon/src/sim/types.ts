export interface Input {
  /** Slide, -1 (driver's left) .. 1 (driver's right). */
  move: number;
  /** A gulp was pressed this tick (an edge, not a level). */
  gulp: boolean;
  /** A bellow was pressed this tick. */
  bellow: boolean;
}
export const NO_INPUT: Readonly<Input> = Object.freeze({ move: 0, gulp: false, bellow: false });

export interface Hippo {
  seat: number;
  /** -1..1 along the rail. */
  slide: number;
  /** Ticks since the gulp started, or -1 when not gulping. */
  gulp: number;
  /** Ticks until a new gulp may start. */
  cooldown: number;
  sputter: number;
  sore: number;
  /** Water was eaten: the next gulp is a dud. */
  flooded: boolean;
  /** The gulp in progress is a dud. */
  dud: boolean;
  score: number;
  bellow: number;
}

export interface Drop {
  id: number;
  kind: number;
  x: number; y: number;
  vx: number; vy: number;
  age: number;
}

export interface Slick { id: number; x: number; y: number; life: number }

export interface State {
  tick: number;
  seed: number;
  rng: number;
  roundTicks: number;
  over: boolean;
  nextId: number;
  spawnCd: number;
  burst: number;
  hippos: Hippo[];
  drops: Drop[];
  slicks: Slick[];
}

export type Event =
  | { t: "gulp"; seat: number }
  | { t: "bellow"; seat: number }
  | { t: "dud"; seat: number }
  | { t: "eat"; seat: number; kind: number; pts: number; x: number; y: number }
  | { t: "sputter"; seat: number }
  | { t: "sore"; seat: number }
  | { t: "flood"; seat: number }
  | { t: "spawn"; kind: number }
  | { t: "slick"; x: number; y: number }
  | { t: "overflow" }
  | { t: "end" };
