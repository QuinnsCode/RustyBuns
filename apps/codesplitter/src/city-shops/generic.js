// The fallback mini-store: a shop kind with no module of its own still gets shelves, a counter and a
// table of goods, so no ground floor is ever empty. The file's lines set how full the shelves are.
import { room, stack, counter } from "./room.js";

export function buildInterior(ctx) {
  const R = room(ctx), r = ctx.r, fill = Math.min(1, 0.4 + Math.sqrt(ctx.lines) / 30);
  const goods = ["#d8402a", "#2a8ad8", "#e8c83a", "#f0f0f0", "#2ac86a", "#9a3ad8", "#8a5a3c"];
  for (const side of ["left", "right"]) stack(R, r, { side, rows: 4, rh: 0.26, from: 0.5, to: R.W - 0.2, depth: 0.14, fill, colors: goods });
  stack(R, r, { side: "back", rows: 3, rh: 0.26, from: -R.ih + 0.2, to: R.ih - 0.2, depth: 0.14, fill, colors: goods });
  // A table of goods in the middle, low enough to see the room over.
  R.box("tint", 0, R.W * 0.5, 0.17, 0.5, 0.34, 0.5, "#6b4a2e");
  for (let i = 0; i < 3 + Math.floor(fill * 5); i++) R.box("tint", (r() - 0.5) * 0.36, R.W * 0.5 + (r() - 0.5) * 0.36, 0.37, 0.1, 0.06 + r() * 0.08, 0.1, goods[Math.floor(r() * goods.length)]);
  counter(R, { u: R.ih * 0.45, len: 0.8, color: "#3a2a20", top: "#d8cfc0", glow: "#ffe2b3" });
  R.box("tint", 0, R.W / 2, 0.012, R.W, 0.02, R.W, "#2a2420");
  return { aisles: [[-0.8, 1.0], [0.8, 1.0], [-0.7, 1.9], [0.1, 0.55], [0.8, 1.9]].map(([u, d]) => R.at(u, d)), clerk: R.at(R.ih * 0.45, R.W - 0.35) };
}
