// A cable as a roll: a coil you carry, set down, or bowl across the floor while it pays itself out behind it. The
// weight is the real one (kg per metre), and it decides everything: how far your arm can send the roll, how fast you
// walk with it, how hard the laid cable is to drag, and whether it slithers or stays where it fell.
// Plain numbers, no three.js: the feel page (src/feel) draws it, the test bowls it.
import { newRope, stepRope, type Rope, type Solid, type Vec } from "./rope.ts";

/** Real cable by the metre. `grip` and `stick` are the rope's floor friction (rope.ts `feel`), heavier is deader. */
export const CABLE = {
  xlr: { what: "mic cable", kgPerM: 0.06, radius: 0.0035, grip: 0.5, stick: 0.02 },
  instrument: { what: "instrument cable", kgPerM: 0.05, radius: 0.003, grip: 0.5, stick: 0.02 },
  /** A 12 AWG three-core rubber extension cord. */
  cord: { what: "power cord", kgPerM: 0.17, radius: 0.0055, grip: 0.4, stick: 0.06 },
  speaker: { what: "speaker cable", kgPerM: 0.21, radius: 0.006, grip: 0.3, stick: 0.12 },
  power: { what: "power feeder", kgPerM: 1.1, radius: 0.014, grip: 0.1, stick: 0.45 },
  /** A 12-pair analog snake: twelve shielded pairs in one jacket, about 0.9 kg a metre. */
  multi: { what: "12-pair snake", kgPerM: 0.9, radius: 0.011, grip: 0.12, stick: 0.4 },
} as const;
export type CableKind = keyof typeof CABLE;

/** Power runs this long or longer are a feeder (a generator to a distro); shorter ones are a cord. */
export const FEEDER_M = 20;
/** Which roll a game cable (@rustybuns/gear's kind) is: a long power run is a feeder, a short one a cord. */
export const rollKind = (kind: "power" | "speaker" | "xlr" | "instrument" | "rca" | "ground" | "digital" | "multi", lengthM: number): CableKind =>
  kind === "power" ? (lengthM >= FEEDER_M ? "power" : "cord")
  // A DJ deck's thin leads (RCA pair, ground wire, digital coax) coil like an instrument cable.
  : kind === "rca" || kind === "ground" || kind === "digital" ? "instrument" : kind;

/** The coil's radius in metres, what an arm can put into a throw (joules) and the fastest it swings (m/s). */
export const ROLL_R = 0.2, ARM_J = 90, ARM_MS = 8;
/** Rolling drag (a floppy coil on a deck, as a share of its weight) and the speed under which it falls over. */
/** How far past its own length the laid cable must be stretched before another step of it pays out. */
const PAY_TAUT = 1.02;
/** The fastest cable comes off a coil, m/s. */
const PAY_MS = 12;
const ROLL_DRAG = 0.07, TOPPLE_MS = 0.35, G = 9.8;
/** Friction of cable dragged along a floor, as a share of its weight. */
const DRAG_MU = 0.6;

/**
 * `held`: in your hands. `rolling`: bowled, on its edge. `down`: lying flat where it stopped or was put. `tied`: its
 * inner end is plugged in and the spare coil lies under the jack. `out`: every metre is paid out, no coil left.
 */
export type RollState = "held" | "rolling" | "down" | "tied" | "out";
export type RollEvent = "topple" | "bump" | "out";

export interface Roll {
  kind: CableKind; rope: Rope; state: RollState;
  /** Whether the outer end is still wound on the coil (nothing pays out until it is let go of or plugged in). */
  tailIn: boolean;
  /** The last rope point that has left the coil. */
  paid: number;
  /** The coil's centre, its heading (radians, 0 is +z), speed, how far it has turned, and its drift to one side. */
  x: number; y: number; z: number; dir: number; v: number; spin: number; lean: number;
  /** Whether the slack a plugged-in cable is left with has been given (once, when its inner end goes into a jack). */
  slacked?: boolean;
  /** What dragging the laid cable weighs on your hand this tick, in kg. */
  pullKg: number;
}

export function newRoll(kind: CableKind, lengthM: number, at: { x: number; z: number }): Roll {
  const c = CABLE[kind], rope = newRope(lengthM, { x: at.x, y: c.radius, z: at.z });
  rope.feel = { grip: c.grip, stick: c.stick, thick: c.radius };
  return { kind, rope, state: "down", tailIn: true, paid: 0, x: at.x, y: c.radius, z: at.z, dir: 0, v: 0, spin: 0, lean: 0, pullKg: 0 };
}

const dist = (p: Vec, q: Vec) => Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z);
const step = (r: Roll) => r.rope.lengthM / (r.rope.pts.length - 1);
/** Metres still on the coil, and what the coil weighs. */
export const leftM = (r: Roll) => (r.state === "out" ? 0 : (r.rope.pts.length - 1 - r.paid) * step(r));
export const rollKg = (r: Roll) => leftM(r) * CABLE[r.kind].kgPerM;

/** How fast an arm sends `kg` at `power` (0 to 1): the same push, so a heavy roll leaves slowly. */
export function throwSpeed(kg: number, power: number): number {
  return Math.min(ARM_MS * power, Math.sqrt((2 * ARM_J * power) / Math.max(kg, 0.2)));
}

/** Bowl the roll from where it is held, along `dir`. Its outer end comes off the coil where you stand. */
export function bowl(r: Roll, dir: number, power: number) {
  if (r.state !== "held") return;
  r.v = throwSpeed(rollKg(r), power);
  r.dir = dir; r.state = "rolling"; r.tailIn = false; r.y = ROLL_R; r.lean = 0;
}

/** Where cable leaves the coil: its foot on the floor when it stands or lies, the coil itself in your hands. */
function mouth(r: Roll): Vec {
  return { x: r.x, y: r.state === "rolling" ? r.y - ROLL_R + CABLE[r.kind].radius : r.y, z: r.z };
}

function inside(s: Solid, x: number, z: number, pad: number): boolean {
  const c = Math.cos(s.rot), sn = Math.sin(s.rot), dx = x - s.x, dz = z - s.z;
  return Math.abs(dx * c - dz * sn) < s.w / 2 + pad && Math.abs(dx * sn + dz * c) < s.d / 2 + pad;
}

/**
 * One tick of a roll and its cable. `pins` holds the ends that are in a jack or a hand, `rnd` (0 to 1) wobbles a
 * rolling coil off its line, `hand` names the end you hold (the coil counts as `b`). A coil pays out a step of cable each time it gets a step away from the last one laid.
 */
export function stepRoll(r: Roll, dt: number, pins: { a?: Vec; b?: Vec }, solids: readonly Solid[], rnd: () => number, hand?: "a" | "b"): RollEvent[] {
  const events: RollEvent[] = [], { pts, prev } = r.rope, n = pts.length, L = step(r);
  if (r.state === "rolling") {
    r.v -= ROLL_DRAG * G * dt;
    // It wanders, more as it slows: a coil is not a wheel.
    r.lean += (rnd() - 0.5) * 1.2 * dt;
    r.dir += r.lean * dt * (1 + 1.5 / Math.max(r.v, 0.3));
    const nx = r.x + Math.sin(r.dir) * r.v * dt, nz = r.z + Math.cos(r.dir) * r.v * dt;
    const hit = solids.some((s) => s.y + s.h > r.y - ROLL_R + 0.05 && inside(s, nx, nz, ROLL_R * 0.5));
    if (hit) events.push("bump"); else { r.x = nx; r.z = nz; r.spin += (r.v * dt) / ROLL_R; }
    if (hit || r.v < TOPPLE_MS) { if (!hit) events.push("topple"); r.state = "down"; r.v = 0; r.y += CABLE[r.kind].radius - ROLL_R; }
  }
  const before = pts.map((p) => ({ x: p.x, z: p.z }));
  // The coil holds the cable where it leaves it: without this the hanging cable sags away from the coil every tick,
  // and the coil pays out to follow it (two metres for each one walked).
  const held = r.state !== "out" && !r.tailIn && r.paid + 1 < n ? { i: r.paid + 1, at: mouth(r) } : undefined;
  stepRope(r.rope, dt, { ...pins, mid: held }, solids);
  if (r.state !== "out") {
    const m = mouth(r);
    if (!r.tailIn) {
      // The coil pays out when the cable already off it is pulled taut: its path, end to mouth, longer than the cable
      // laid so far. A hanging or slack cable pays nothing (a coil held still keeps its cable), and a loose end with
      // nothing holding it just drags behind you.
      let laid = dist(pts[r.paid]!, m);
      for (let i = 0; i < r.paid; i++) laid += dist(pts[i]!, pts[i + 1]!);
      // No faster than PAY_MS (one step a tick at 60 a second; faster than any arm bowls): a stretch that is only the solver catching up
      // with a jump settles over the next ticks and is not paid for all at once.
      let want = Math.min(r.paid + Math.max(1, Math.ceil((PAY_MS * dt) / L)), Math.ceil(laid / (L * PAY_TAUT)) - 1);
      // Plugged in, a run is left some slack (half a metre and a twentieth of its length), so it lies on the floor
      // and does not hang tight between two jacks.
      if (r.state === "tied" && !r.slacked) { want = Math.max(want, r.paid) + Math.ceil((0.5 + laid * 0.05) / L); r.slacked = true; }
      if (r.state !== "tied") r.slacked = false;
      while (r.paid < n - 1 && r.paid < want) {
        r.paid++;
        Object.assign(pts[r.paid]!, m); Object.assign(prev[r.paid]!, m);
      }
    }
    if (r.paid >= n - 1) { r.state = "out"; events.push("out"); }
    else for (let i = r.tailIn ? 0 : r.paid + 1; i < n; i++) {
      // The spare coil of a tied roll keeps its last point in the jack.
      if (i === n - 1 && r.state === "tied" && pins.b) continue;
      Object.assign(pts[i]!, m); Object.assign(prev[i]!, m);
    }
  }
  // What the hand feels: laid cable that moved this tick drags at its weight, lifted cable hangs at it.
  let moved = 0, hung = 0;
  const last = r.state === "out" ? n - 1 : r.paid;
  for (let i = 0; i <= last && !r.tailIn && hand; i++) {
    const p = pts[i]!, b = before[i]!;
    if (p.y <= 0.08 && Math.hypot(p.x - b.x, p.z - b.z) > 5e-4) moved++;
  }
  // From your hand down to the first point on the floor.
  if (hand && !r.tailIn) for (let i = hand === "a" ? 0 : last; i >= 0 && i <= last && pts[i]!.y > 0.08; i += hand === "a" ? 1 : -1) hung++;
  r.pullKg = (moved * DRAG_MU + hung) * L * CABLE[r.kind].kgPerM;
  return events;
}
