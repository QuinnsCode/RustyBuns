// Which grind the board lands, and the lean it has to hold. Pure: sim.ts calls these, the tests do too.
import { BOARD, type Rail, onRail } from "./level.ts";

export type GrindKind = "50-50" | "boardslide" | "lipslide" | "nosegrind" | "5-0" | "smith" | "feeble" | "crooked" | "tailslide" | "noseslide";
export const GRIND_POINTS: Record<GrindKind, number> = { "50-50": 300, "5-0": 350, nosegrind: 400, boardslide: 450, lipslide: 500, smith: 500, feeble: 500, crooked: 500, tailslide: 550, noseslide: 550 };
export const LEDGE_NAME: Record<GrindKind, string> = { "50-50": "50-50 slide", "5-0": "5-0 slide", nosegrind: "Nose slide", boardslide: "Boardslide", lipslide: "Lipslide", smith: "Smith slide", feeble: "Feeble slide", crooked: "Crooked slide", tailslide: "Tailslide", noseslide: "Noseslide" };
export const GRIND_NAME: Record<GrindKind, string> = { "50-50": "50-50 grind", "5-0": "5-0 grind", nosegrind: "Nosegrind", boardslide: "Boardslide", lipslide: "Lipslide", smith: "Smith grind", feeble: "Feeble grind", crooked: "Crooked grind", tailslide: "Tailslide", noseslide: "Noseslide" };

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

/** The grind named by the angle and by which part of the deck is over the bar. Past the trucks it is a tail or nose grind or slide; a truck on the bar names it by angle. */
export function grindFor(rel: number, at: number): GrindKind {
  const side = Math.sign(rel) || 1, a = Math.abs(rel) > Math.PI / 2 ? Math.PI - Math.abs(rel) : Math.abs(rel);
  const base = grindKind(Math.abs(rel), side);
  if (a < 0.35) return base; // both trucks on a bar along the deck
  if (a > 1.1) return at > 0.8 ? "noseslide" : at < -0.8 ? "tailslide" : base;
  if (at > TRUCK) return a > 0.85 ? "crooked" : "nosegrind";
  if (at < -TRUCK) return a > 0.85 ? (side > 0 ? "smith" : "feeble") : "5-0";
  return base;
}

/** Across the bar: the deck lies over it, and the view turns the board a quarter turn. */
export const across = (k: GrindKind) => k === "boardslide" || k === "lipslide" || k === "tailslide" || k === "noseslide";

/** How far the board rides above its wheels' plane on the bar (model units): across the bar it is the deck's underside that slides, along it the truck's hanger. */
export const GRIND_LIFT = { deck: 0.42, truck: 0.16 };
export const ROADSTER_LIFT = 0.24; // the roadster slides on its dark sill, whichever way it lies over the bar
export const grindLift = (k: GrindKind, skin: "fingerboard" | "roadster" = "fingerboard") => (skin === "roadster" ? ROADSTER_LIFT : across(k) ? GRIND_LIFT.deck : GRIND_LIFT.truck);

// How far over each grind rests, and how hard it tips: a 50-50 is stable, a nosegrind tips forward, a crooked to one side, a tailslide has one point to stand on.
const REST: Record<GrindKind, number> = { "50-50": 0, "5-0": 0.12, nosegrind: 0.28, boardslide: 0.1, lipslide: 0.14, smith: 0.2, feeble: 0.2, crooked: 0.34, tailslide: 0.3, noseslide: 0.36 };
const TIPPY: Record<GrindKind, number> = { "50-50": 1, "5-0": 1.2, nosegrind: 1.5, boardslide: 1, lipslide: 1.2, smith: 1.4, feeble: 1.4, crooked: 1.6, tailslide: 1.6, noseslide: 1.8 };
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
