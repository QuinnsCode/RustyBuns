// Helpers the shop interiors share (not a shop kind itself). A room is a square whose door is on one
// wall: u runs across it (0 = the door's middle), d runs inward from the door wall to the back wall.
// Every box is axis-aligned, so the frame only swaps which world axis is which.
export function room({ b, pw, ph, y0, put, door: [fx, fz] }) {
  const ih = pw / 2 - 0.1, W = 2 * ih, alongX = fx !== 0;
  const at = (u, d) => [b.x + fx * (ih - d) + fz * u, b.z + fz * (ih - d) + fx * u];
  /** A box centred u across, d in, y up from the floor; lu across, ly tall, ld deep. */
  const box = (key, u, d, y, lu, ly, ld, color) => { const [x, z] = at(u, d); put(key, x, y0 + y, z, alongX ? ld : lu, ly, alongX ? lu : ld, 0, color); };
  const cyl = (u, d, y, dia, h, color, key = "cylTint") => { const [x, z] = at(u, d); put(key, x, y0 + y, z, dia, h, dia, 0, color); };
  const ball = (u, d, y, dia, color, key = "lamp") => { const [x, z] = at(u, d); put(key, x, y0 + y, z, dia, dia, dia, 0, color); };
  const pool = (u, d, size, color) => { const [x, z] = at(u, d); put("pool", x, y0 + 0.02, z, size, 1, size, 0, color); };
  return { ih, W, at, box, cyl, ball, pool, alongX };
}

/** Shelving against a wall, rows of spines in seeded runs; fill (0..1) is how much of it the code stocks. */
export function stack(R, r, { side, rows = 4, rh = 0.24, from, to, depth = 0.12, fill = 1, colors, tall = 0.9, label }) {
  const { ih, W } = R, back = side === "back", wall = back ? W : ih;
  for (let j = 0; j < rows; j++) {
    const y = 0.06 + j * rh;
    const along = (a, len, key, h, color, t = depth, dy = 0) => {
      const s = a + len / 2;
      if (back) R.box(key, s, W - t / 2 - 0.02, y + h / 2 + dy, len, h, t, color);
      else R.box(key, (side === "left" ? -1 : 1) * (wall - t / 2 - 0.02), s, y + h / 2 + dy, t, h, len, color);
    };
    along(from, to - from, "grey", 0.025, undefined, depth + 0.02);
    for (let s = from; s < to - 0.05;) {
      const len = Math.min(0.08 + r() * 0.16, to - s);
      if (r() < fill) { const h = rh * (tall - r() * 0.15); along(s, len * 0.94, "tint", h, colors[Math.floor(r() * colors.length)], depth); if (label && r() < 0.5) along(s, len * 0.94, "tint", 0.035, label[Math.floor(r() * label.length)], depth + 0.012, h * 0.4); }
      s += len;
    }
  }
}

/** A counter with a till across the back wall, offset u across; the clerk stands behind it at (u, W - 0.35). */
export function counter(R, { u = 0, len = 0.9, color = "#3a2a20", top = "#d8cfc0", glow }) {
  R.box("tint", u, R.W - 0.7, 0.2, len, 0.4, 0.3, color);
  R.box("tint", u, R.W - 0.7, 0.41, len + 0.04, 0.03, 0.34, top);
  R.box("metal", u + len * 0.25, R.W - 0.7, 0.5, 0.16, 0.14, 0.12);
  if (glow) R.box("neon", u - len * 0.2, R.W - 0.86, 0.3, len * 0.6, 0.02, 0.02, glow);
}
