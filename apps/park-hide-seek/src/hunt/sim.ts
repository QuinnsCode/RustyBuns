// Movement and sight on a zone, shared by the page (your own camper or ranger
// moves instantly) and the world (which checks everyone and decides who sees whom).

import { CLIFF, type Zone } from "../zones/zone.ts";

export type Role = "camper" | "ranger";
export type TimeOfDay = "day" | "dusk" | "night";

export const MOVE = {
  camper: { walk: 3.2, run: 6.0, crouch: 1.4 },
  // Rangers are faster: a camper who's been spotted in the open should be caught.
  ranger: { walk: 3.8, run: 7.6, crouch: 1.8 },
  /** Seconds of running on a full tank, and how fast it refills. */
  stamina: { camper: 6, ranger: 8, refill: 0.35 },
};

export const EYE = { stand: 1.6, crouch: 0.9 };
export const TAG_REACH = 1.5;

export interface Body {
  x: number;
  y: number;
  yaw: number;
  /** 0..1 */
  stamina: number;
  crouch: boolean;
  run: boolean;
}

export interface MoveInput {
  /** Wish direction in the body's frame: forward and right, each -1..1. */
  fwd: number;
  right: number;
  run: boolean;
  crouch: boolean;
}

/** One movement step: walk, slide along cliffs and trunks, stay in the zone. */
export function step(z: Zone, b: Body, role: Role, inp: MoveInput, dt: number) {
  const len = Math.hypot(inp.fwd, inp.right);
  b.crouch = inp.crouch;
  const wantsRun = inp.run && !inp.crouch && len > 0.1;
  const cap = MOVE.stamina[role];
  b.run = wantsRun && b.stamina > 0.02;
  b.stamina = Math.max(0, Math.min(1, b.stamina + (b.run ? -dt / cap : (dt * MOVE.stamina.refill) / (len > 0.1 ? 2 : 1))));
  if (len < 0.05) return;
  const sp = MOVE[role][b.crouch ? "crouch" : b.run ? "run" : "walk"];
  // Forward is +yaw: yaw 0 faces north (+y), increasing clockwise towards east.
  const fx = Math.sin(b.yaw), fy = Math.cos(b.yaw);
  const dx = ((fx * inp.fwd + fy * inp.right) / Math.max(1, len)) * sp * dt;
  const dy = ((fy * inp.fwd - fx * inp.right) / Math.max(1, len)) * sp * dt;
  // Uphill is slower.
  const h0 = z.height(b.x, b.y);
  const grade = Math.max(0, (z.height(b.x + dx, b.y + dy) - h0) / Math.max(1e-6, Math.hypot(dx, dy)));
  const k = 1 / (1 + grade * 0.5);
  tryMove(z, b, dx * k, dy * k);
}

/** Move by (dx, dy) if the ground allows it, else slide along whichever axis does. */
export function tryMove(z: Zone, b: Body, dx: number, dy: number) {
  for (const [mx, my] of [[dx, dy], [dx, 0], [0, dy]]) {
    if (mx === 0 && my === 0) continue;
    const nx = b.x + mx, ny = b.y + my;
    if (walkable(z, b.x, b.y, nx, ny)) { b.x = nx; b.y = ny; break; }
  }
  resolve(z, b);
}

function walkable(z: Zone, x0: number, y0: number, x1: number, y1: number): boolean {
  if (!z.inside(x1, y1, 0.5)) return false;
  const d = Math.hypot(x1 - x0, y1 - y0);
  const rise = z.height(x1, y1) - z.height(x0, y0);
  // Going down a cliff is allowed (you slide); going up one isn't.
  return rise / Math.max(d, 1e-6) < CLIFF;
}

/** Push out of trunks, boulders and tents, and back inside the zone. */
export function resolve(z: Zone, b: Body) {
  const me = 0.35;
  for (const p of z.near(b.x, b.y, 6)) {
    if (p.r <= 0) continue;
    const dx = b.x - p.x, dy = b.y - p.y, d = Math.hypot(dx, dy), min = p.r + me;
    if (d < min && d > 1e-6) { b.x = p.x + (dx / d) * min; b.y = p.y + (dy / d) * min; }
  }
  const d = Math.hypot(b.x, b.y), lim = z.R - 0.5;
  if (d > lim) { b.x *= lim / d; b.y *= lim / d; }
}

export interface Seer { x: number; y: number; yaw: number; crouch: boolean; role: Role; light: boolean }
export interface Seen { x: number; y: number; crouch: boolean }

export const SIGHT = {
  range: { day: 90, dusk: 45, night: 7 },
  torch: { range: 42, halfAngle: (26 * Math.PI) / 180 },
  /** Crouched in a bush, you can only be seen this close (or lit up nearby). */
  bush: 3.5,
  crouchFactor: 0.6,
};

/** Can `a` see `b`? Range from the light, then line of sight past terrain and props. */
export function canSee(z: Zone, tod: TimeOfDay, a: Seer, b: Seen): boolean {
  const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
  let range: number = SIGHT.range[tod];
  let lit = false;
  if (a.light && tod !== "day" && d < SIGHT.torch.range) {
    const ang = Math.abs(wrap(Math.atan2(dx, dy) - a.yaw));
    if (ang < SIGHT.torch.halfAngle) { range = Math.max(range, SIGHT.torch.range); lit = true; }
  }
  if (b.crouch) {
    const bush = z.bushAt(b.x, b.y);
    if (bush) range = Math.min(range, lit && d < 10 ? 10 : SIGHT.bush);
    else range *= SIGHT.crouchFactor;
  }
  if (d > range) return false;
  return clearLine(z, a.x, a.y, z.height(a.x, a.y) + (a.crouch ? EYE.crouch : EYE.stand), b.x, b.y, z.height(b.x, b.y) + (b.crouch ? 0.6 : 1.1));
}

/** Nothing solid between two points: no ridge, trunk, boulder, tent or cabin. */
export function clearLine(z: Zone, ax: number, ay: number, ah: number, bx: number, by: number, bh: number): boolean {
  const d = Math.hypot(bx - ax, by - ay);
  const n = Math.ceil(d / 1.5);
  for (let i = 1; i < n; i++) {
    const t = i / n;
    if (z.height(ax + (bx - ax) * t, ay + (by - ay) * t) > ah + (bh - ah) * t + 0.05) return false;
  }
  // Props: a 2D segment-circle test against anything taller than the line there.
  const mx = (ax + bx) / 2, my = (ay + by) / 2;
  for (const p of z.near(mx, my, d / 2 + 4)) {
    if (p.r <= 0 || p.kind === "sign") continue;
    const t = Math.max(0, Math.min(1, ((p.x - ax) * (bx - ax) + (p.y - ay) * (by - ay)) / (d * d || 1)));
    const cx = ax + (bx - ax) * t, cy = ay + (by - ay) * t;
    if (Math.hypot(p.x - cx, p.y - cy) >= p.r) continue;
    // Is the prop's top above the sight line at that point?
    if (z.height(p.x, p.y) + p.tall > ah + (bh - ah) * t) {
      // Don't let the prop you're pressed against hide what's right next to you.
      if (Math.hypot(p.x - bx, p.y - by) < p.r + 0.2 && d < 2) continue;
      return false;
    }
  }
  return true;
}

export const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
