// Movement and sight on a zone, shared by the page (your own camper or ranger
// moves instantly) and the world (which checks everyone and decides who sees whom).

import { CLIFF, type Zone } from "../zones/zone.ts";

export type Role = "camper" | "ranger";
export type TimeOfDay = "day" | "dusk" | "night";

/**
 * The conditions a round is played in: the lobby's pick, or the park's live
 * weather (see weather.ts). fog, rain and wind run 0..1.
 */
export interface Sky {
  tod: TimeOfDay;
  fog: number;
  rain: number;
  wind: number;
  /** Heavy cloud: a darker day, and a night with no moon or stars. */
  overcast: boolean;
  /** The rain is snow (it falls differently; it hushes steps the same). */
  snow: boolean;
}

export const clearSky = (tod: TimeOfDay): Sky => ({ tod, fog: 0, rain: 0, wind: 0, overcast: false, snow: false });

export const WEATHER = {
  /** Dense fog cuts sight by this fraction, and a flashlight's reach by the second. */
  fogSight: 0.6,
  fogTorch: 0.45,
  /** An overcast night is this much darker than a moonlit one. */
  moonless: 0.7,
  /** Heavy rain cuts how far footsteps carry by this fraction. */
  rainHush: 0.55,
  /** A gale makes rustles and steps this much harder to place (jitter x (1 + this)). */
  windJitter: 1.5,
};

/** How far footsteps carry through the rain. */
export const stepReach = (sky: Sky, reach: number) => reach * (1 - WEATHER.rainHush * sky.rain);
/** How roughly a sound can be placed in the wind. */
export const soundJitter = (sky: Sky, j: number) => j * (1 + WEATHER.windJitter * sky.wind);

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

/** How far you can see in the open, and how far a flashlight reaches. */
export function sightRange(sky: Sky): { open: number; torch: number } {
  let open: number = SIGHT.range[sky.tod];
  if (sky.tod === "night" && sky.overcast) open *= WEATHER.moonless;
  return { open: open * (1 - WEATHER.fogSight * sky.fog), torch: SIGHT.torch.range * (1 - WEATHER.fogTorch * sky.fog) };
}

/** Can `a` see `b`? Range from the light and the weather, then line of sight past terrain and props. */
export function canSee(z: Zone, sky: Sky | TimeOfDay, a: Seer, b: Seen): boolean {
  const s = typeof sky === "string" ? clearSky(sky) : sky;
  const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
  const reach = sightRange(s);
  let range = reach.open;
  let lit = false;
  if (a.light && s.tod !== "day" && d < reach.torch) {
    const ang = Math.abs(wrap(Math.atan2(dx, dy) - a.yaw));
    if (ang < SIGHT.torch.halfAngle) { range = Math.max(range, reach.torch); lit = true; }
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
