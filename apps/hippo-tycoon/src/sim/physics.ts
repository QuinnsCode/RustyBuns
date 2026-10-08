import { DISH, DROP_R, MAX_SPEED, MIN_SPEED, FRICTION, RESTITUTION, SLICK_BOOST, SLICK_R, TICK_HZ, WALL_R } from "./rules.ts";
import type { Drop, State } from "./types.ts";

const MIN_V = MIN_SPEED / TICK_HZ, MAX_V = MAX_SPEED / TICK_HZ;

export function stepDrops(s: State) {
  for (const d of s.drops) {
    d.age++;
    let slick = false;
    for (const k of s.slicks) if ((d.x - k.x) ** 2 + (d.y - k.y) ** 2 < SLICK_R * SLICK_R) { slick = true; break; }
    // the dished pan pulls toward the middle, harder at the rim
    const r = Math.hypot(d.x, d.y);
    if (r > 1e-6) { const pull = DISH * (r / WALL_R); d.vx -= (d.x / r) * pull; d.vy -= (d.y / r) * pull; }
    let sp = Math.hypot(d.vx, d.vy);
    if (sp > 1e-9) {
      const f = slick ? SLICK_BOOST : FRICTION;
      let target = sp * f;
      if (target < MIN_V) target = MIN_V;
      if (target > MAX_V) target = MAX_V;
      d.vx *= target / sp; d.vy *= target / sp;
    }
    d.x += d.vx; d.y += d.vy;
    wall(d);
  }
  collide(s.drops);
}

function wall(d: Drop) {
  const lim = WALL_R - DROP_R, r = Math.hypot(d.x, d.y);
  if (r <= lim) return;
  const nx = d.x / r, ny = d.y / r;
  d.x = nx * lim; d.y = ny * lim;
  const vn = d.vx * nx + d.vy * ny;
  if (vn > 0) { d.vx -= (1 + RESTITUTION) * vn * nx; d.vy -= (1 + RESTITUTION) * vn * ny; }
}

/** Equal-mass circles. Pairs in array (id) order, so the result is deterministic. */
function collide(ds: Drop[]) {
  const min = 2 * DROP_R;
  for (let i = 0; i < ds.length; i++) {
    const a = ds[i]!;
    for (let j = i + 1; j < ds.length; j++) {
      const b = ds[j]!;
      const dx = b.x - a.x, dy = b.y - a.y, d2 = dx * dx + dy * dy;
      if (d2 >= min * min) continue;
      const d = Math.sqrt(d2) || 1e-6;
      const nx = dx / d, ny = dy / d, push = (min - d) / 2;
      a.x -= nx * push; a.y -= ny * push; b.x += nx * push; b.y += ny * push;
      const vn = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
      if (vn <= 0) continue;
      const imp = (vn * (1 + RESTITUTION)) / 2;
      a.vx -= imp * nx; a.vy -= imp * ny; b.vx += imp * nx; b.vy += imp * ny;
    }
  }
}
