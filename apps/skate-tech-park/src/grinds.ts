// Which grind the board lands, and the lean it has to hold. Pure: sim.ts calls these, the tests do too.
import { BOARD, type Rail, onRail } from "./level.ts";

export type GrindKind = "50-50" | "boardslide" | "lipslide" | "nosegrind" | "5-0" | "smith" | "feeble" | "crooked" | "overcrook" | "tailslide" | "noseslide" | "bluntslide" | "nose bluntslide" | "willy" | "salad";
export const GRIND_POINTS: Record<GrindKind, number> = { "50-50": 300, "5-0": 350, nosegrind: 400, boardslide: 450, lipslide: 500, smith: 500, feeble: 500, crooked: 500, overcrook: 550, tailslide: 550, noseslide: 550, bluntslide: 650, "nose bluntslide": 700, willy: 550, salad: 550 };
export const LEDGE_NAME: Record<GrindKind, string> = { "50-50": "50-50 slide", "5-0": "5-0 slide", nosegrind: "Nose slide", boardslide: "Boardslide", lipslide: "Lipslide", smith: "Smith slide", feeble: "Feeble slide", crooked: "Crooked slide", overcrook: "Overcrook slide", tailslide: "Tailslide", noseslide: "Noseslide", bluntslide: "Bluntslide", "nose bluntslide": "Nose bluntslide", willy: "Willy grind", salad: "Salad grind" };
export const GRIND_NAME: Record<GrindKind, string> = { "50-50": "50-50 grind", "5-0": "5-0 grind", nosegrind: "Nosegrind", boardslide: "Boardslide", lipslide: "Lipslide", smith: "Smith grind", feeble: "Feeble grind", crooked: "Crooked grind", overcrook: "Overcrook grind", tailslide: "Tailslide", noseslide: "Noseslide", bluntslide: "Bluntslide", "nose bluntslide": "Nose bluntslide", willy: "Willy grind", salad: "Salad grind" };

/** The board's pitch held onto a bar: 1 is the nose up (the tail dropped), -1 the nose down, 0 flat. The manual keys set it at the catch. */
export type Nose = -1 | 0 | 1;

const TRUCK = 0.6; // the trucks sit this share of the way from the middle to either tip

/** What the approach to a rail makes of the grind: `off` is the angle between the rider and the bar, `side` +1 if coming in from its left. */
export function grindKind(off: number, side: number): GrindKind {
  const a = off > Math.PI / 2 ? Math.PI - off : off; // riding the bar backwards is the same trick
  if (a < 0.35) return "50-50";
  if (a > 1.1) return side > 0 ? "boardslide" : "lipslide"; // across the bar: which truck is over it
  if (a > 0.85) return side > 0 ? "smith" : "feeble"; // nearly across: the back truck hangs over, then the front
  return side > 0 ? "nosegrind" : "5-0";
}

/** Where the bar meets the deck: `at` runs -1 (tail tip) to +1 (nose tip) along the board, `rel` is the board's yaw against the bar. */
export interface Landing { at: number; rel: number }

/** The bar a falling board lands on, or null: the bar's line has to cross the deck's rectangle, tail tip and nose tip included. */
export function landing(r: Rail, x: number, z: number, yaw: number, dir: number): (Landing & { t: number }) | null {
  const o = onRail(r, x, z);
  if (!(o.t > 0 && o.t < 1)) return null;
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  const d = o.dx * (z - r.a.z) - o.dz * (x - r.a.x); // signed distance of the board's middle from the bar's line
  const sin = o.dx * fz - o.dz * fx, cos = o.dx * fx + o.dz * fz;
  if (Math.abs(d) > BOARD.halfLen * Math.abs(sin) + 0.45 * Math.abs(cos)) return null;
  const at = Math.abs(sin) < 0.05 ? 0 : Math.max(-1, Math.min(1, -d / sin / BOARD.halfLen)); // along the bar the whole deck is over it
  const rel = Math.atan2(Math.sin(yaw - Math.atan2(dir * o.dx, dir * o.dz)), Math.cos(yaw - Math.atan2(dir * o.dx, dir * o.dz))); // yaw against the way we ride, wrapped
  return { at, rel, t: o.t };
}

/**
 * The grind named by the angle, by which part of the deck is over the bar, and by the pitch held onto it. Past the trucks it is a
 * tail or nose grind or slide; a truck on the bar names it by angle. Pitched (`nose`), a tip over the bar with the other end held
 * high is a bluntslide, and a truck over it with the other end dropped is a willy (front truck, tail dropped) or a salad (back truck, nose dipped).
 */
export function grindFor(rel: number, at: number, nose: Nose = 0): GrindKind {
  const side = Math.sign(rel) || 1, a = Math.abs(rel) > Math.PI / 2 ? Math.PI - Math.abs(rel) : Math.abs(rel);
  const base = grindKind(Math.abs(rel), side);
  if (a < 0.35) return base; // both trucks on a bar along the deck
  if (a > 1.1) return at > 0.8 ? (nose < 0 ? "nose bluntslide" : "noseslide") : at < -0.8 ? (nose > 0 ? "bluntslide" : "tailslide") : base;
  if (at > TRUCK) return nose > 0 ? "willy" : a > 0.85 ? (side > 0 ? "crooked" : "overcrook") : "nosegrind"; // the front truck's pair, as smith and feeble are the back truck's
  if (at < -TRUCK) return nose < 0 ? "salad" : a > 0.85 ? (side > 0 ? "smith" : "feeble") : "5-0";
  return base;
}

/** Across the bar: the deck lies over it, and the view turns the board a quarter turn. */
export const across = (k: GrindKind) => k === "boardslide" || k === "lipslide" || k === "tailslide" || k === "noseslide" || k === "bluntslide" || k === "nose bluntslide";

// Lip tricks: a stall is a catch on the coping at the top of a slow wall ride, held like a grind and dropped back down the wall.
export type StallKind = "rock to fakie" | "disaster" | "axle stall" | "tail stall" | "blunt to fakie" | "nose stall" | "nose blunt";
export const STALL_POINTS: Record<StallKind, number> = { "rock to fakie": 250, disaster: 450, "axle stall": 300, "tail stall": 300, "blunt to fakie": 500, "nose stall": 350, "nose blunt": 550 };
export const STALL_NAME: Record<StallKind, string> = { "rock to fakie": "Rock to fakie", disaster: "Disaster", "axle stall": "Axle stall", "tail stall": "Tail stall", "blunt to fakie": "Blunt to fakie", "nose stall": "Nose stall", "nose blunt": "Nose blunt" };

const STALL_ALONG = 0.45; // radians: a board turned to within this of the coping's line has its trucks locked along it
const STALL_TURNED = 0.9; // radians the rider turned in the air before the catch: more and the board came onto the coping turned, a disaster

/**
 * The stall named by how the board lies on the coping: along it (a truck or both locked on) is an axle stall; an end held high
 * (`nose`, from the manual keys as for a grind) stands the other end on the coping, a blunt; a tip on the coping is a tail or nose
 * stall and a truck an axle stall; else the coping is mid-deck, a rock, or a disaster when the rider turned onto it.
 */
export function stallFor(rel: number, at: number, spun: number, nose: Nose): StallKind {
  const a = Math.abs(rel) > Math.PI / 2 ? Math.PI - Math.abs(rel) : Math.abs(rel);
  if (a < STALL_ALONG) return "axle stall";
  if (nose > 0) return "blunt to fakie";
  if (nose < 0) return "nose blunt";
  if (at < -0.8) return "tail stall";
  if (at > 0.8) return "nose stall";
  if (Math.abs(at) > TRUCK) return "axle stall";
  return Math.abs(spun) >= STALL_TURNED ? "disaster" : "rock to fakie";
}

/** How far the board rides above its wheels' plane on the bar (model units): across the bar it is the deck's underside that slides, along it the truck's hanger. */
export const GRIND_LIFT = { deck: 0.42, truck: 0.16 };
export const ROADSTER_LIFT = 0.24; // the roadster slides on its dark sill, whichever way it lies over the bar
export const grindLift = (k: GrindKind, skin: "fingerboard" | "roadster" = "fingerboard") => (skin === "roadster" ? ROADSTER_LIFT : across(k) ? GRIND_LIFT.deck : GRIND_LIFT.truck);

// How far over each grind rests, and how hard it tips: a 50-50 is stable, a nosegrind tips forward, a crooked to one side, a tailslide has one point to stand on.
const REST: Record<GrindKind, number> = { "50-50": 0, "5-0": 0.12, nosegrind: 0.28, boardslide: 0.1, lipslide: 0.14, smith: 0.2, feeble: 0.2, crooked: 0.34, overcrook: 0.36, tailslide: 0.3, noseslide: 0.36, bluntslide: 0.34, "nose bluntslide": 0.4, willy: 0.32, salad: 0.3 };
const TIPPY: Record<GrindKind, number> = { "50-50": 1, "5-0": 1.2, nosegrind: 1.5, boardslide: 1, lipslide: 1.2, smith: 1.4, feeble: 1.4, crooked: 1.6, overcrook: 1.7, tailslide: 1.6, noseslide: 1.8, bluntslide: 1.9, "nose bluntslide": 2, willy: 1.7, salad: 1.7 };
export const restOf = (k: GrindKind) => REST[k];
export const tippiness = (k: GrindKind) => TIPPY[k];

const TIP = 6; // 1/s²: how hard gravity pulls the lean away from its balance point
const STEADY = 6; // m/s: at this speed the wheels' momentum halves the tipping
const DAMP = 1; // 1/s: the rider's own steadiness
const CORRECT = 12; // 1/s²: what a full stick does to the lean once it has taken hold
const LAG = 0.08; // s: the body takes this long to follow the stick, so it rocks before it settles

export interface Lean { balance: number; lean: number; push: number }

/**
 * The lean is a rocking pendulum: it falls away from the balance point faster the slower you go, a sloped bar moves the point, and
 * the correction (`input`, -1..1, positive pulls back from positive lean) takes `LAG` to reach the body.
 */
export function leanStep(s: Lean, point: number, tippy: number, speed: number, input: number, dt: number) {
  s.push += (input - s.push) * Math.min(1, dt / LAG);
  const fall = (TIP * tippy) / (1 + Math.abs(speed) / STEADY);
  s.lean += (fall * (s.balance - point) - DAMP * s.lean - CORRECT * s.push) * dt;
  s.balance += s.lean * dt;
}
