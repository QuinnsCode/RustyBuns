// Walking a room on foot, pure: a body of RADIUS on the floor, pushed out of the walls and anything standing in the
// way. Q Studio's gear room (../room/room.ts) and the jam room (./jam.ts) both walk with it.

/** Your body's radius, metres, and your walking speed, metres a second. */
export const RADIUS = 0.25, WALK = 1.5;

/** A box on the floor seen from above: its middle, half its width and depth, and how far it is turned. */
export type Rect = { cx: number; cz: number; hw: number; hd: number; turn: number };
/** Where you stand and which way you face: yaw 0 looks down -z, as a three.js camera does. */
export interface Feet { x: number; z: number; yaw: number }
export interface Input { forward: number; right: number; turn: number }

/** Push `y` out of every rect, then keep it inside the room's walls (half its width and depth). */
export function pushOut(y: Feet, solids: readonly Rect[], halfW: number, halfD: number) {
  for (const s of solids) {
    const c = Math.cos(s.turn), sn = Math.sin(s.turn), dx = y.x - s.cx, dz = y.z - s.cz;
    const lx = dx * c - dz * sn, lz = dx * sn + dz * c;
    const px = Math.max(-s.hw, Math.min(s.hw, lx)), pz = Math.max(-s.hd, Math.min(s.hd, lz));
    let ox = lx - px, oz = lz - pz, dist = Math.hypot(ox, oz);
    if (dist >= RADIUS) continue;
    if (dist < 1e-6) { // inside: out the nearest side
      const ex = s.hw - Math.abs(lx), ez = s.hd - Math.abs(lz);
      [ox, oz] = ex < ez ? [Math.sign(lx) || 1, 0] : [0, Math.sign(lz) || 1];
    } else { ox /= dist; oz /= dist; }
    const lx2 = px + ox * RADIUS, lz2 = pz + oz * RADIUS;
    y.x = s.cx + lx2 * c + lz2 * sn;
    y.z = s.cz - lx2 * sn + lz2 * c;
  }
  y.x = Math.max(-halfW + RADIUS, Math.min(halfW - RADIUS, y.x));
  y.z = Math.max(-halfD + RADIUS, Math.min(halfD - RADIUS, y.z));
}

/** One tick: turn, then walk the way you face (strafing with `right`), then out of whatever you walked into. */
export function stepFeet(y: Feet, dt: number, i: Input, solids: readonly Rect[], halfW: number, halfD: number) {
  y.yaw += i.turn;
  const len = Math.hypot(i.forward, i.right);
  if (len > 0) {
    const k = (WALK * dt) / Math.max(1, len), fx = -Math.sin(y.yaw), fz = -Math.cos(y.yaw);
    y.x += (fx * i.forward - fz * i.right) * k;
    y.z += (fz * i.forward + fx * i.right) * k;
  }
  pushOut(y, solids, halfW, halfD);
}

/** Walk straight to (x, z) tick by tick, facing where you were; the seconds it took. Stops at anything in the way. */
export function walkFeet(y: Feet, x: number, z: number, step: (dt: number, i: Input) => void): number {
  const dt = 1 / 30;
  let t = 0;
  for (let n = 0; n < 900; n++) {
    const dx = x - y.x, dz = z - y.z, d = Math.hypot(dx, dz);
    if (d < 0.05) break;
    const yaw = y.yaw;
    y.yaw = Math.atan2(-dx, -dz);
    const before = [y.x, y.z];
    step(dt, { forward: Math.min(1, d / (WALK * dt)), right: 0, turn: 0 });
    y.yaw = yaw;
    t += dt;
    if (Math.hypot(y.x - before[0], y.z - before[1]) < 1e-4) break;
  }
  return Math.round(t * 10) / 10;
}
