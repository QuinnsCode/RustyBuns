// The book shops: bookstore, used books, library and archive. One spine per few lines of the file:
// the bigger the file, the fuller the shelves, and its path seeds every colour so the room is the same for everyone.
import { room, stack, counter } from "./room.js";

const spines = {
  books: ["#7a2e2a", "#2f4a6b", "#c79a3a", "#3d5a40", "#e8e0cc", "#5a3a66"],
  used: ["#6b4a2c", "#8a6a3c", "#4a3a2a", "#a08a5a", "#37301f"],
  library: ["#2f4a3a", "#5a3a2a", "#3a3a5a", "#7a6a3c", "#2a2a2a"],
  archive: ["#5a6670", "#6c7882", "#4a545c", "#d9b25a"],
};
const floors = { books: "#2a1c22", used: "#2a2216", library: "#1c2a24", archive: "#1c2226" };
const wood = "#6b4a2e";

/** A reading table with a green-shaded lamp, chairs either side, and a few open books. */
function table(R, r, u, d, shade, colors) {
  R.box("tint", u, d, 0.2, 0.62, 0.04, 0.38, wood);
  for (const [lu, ld] of [[-0.26, -0.15], [0.26, -0.15], [-0.26, 0.15], [0.26, 0.15]]) R.box("tint", u + lu, d + ld, 0.09, 0.04, 0.18, 0.04, "#3a2a1a");
  R.cyl(u + 0.2, d, 0.3, 0.025, 0.16, undefined, "cylMetal");
  R.cyl(u + 0.2, d, 0.4, 0.12, 0.07, shade);
  R.ball(u + 0.2, d, 0.35, 0.06, "#ffe2b3");
  R.pool(u + 0.2, d, 0.9, "#ffd29a");
  for (const s of [-1, 1]) R.box("tint", u, d + s * 0.3, 0.12, 0.22, 0.24, 0.2, "#3a2a1a");
  for (let i = 0; i < 2; i++) R.box("tint", u - 0.12 + i * 0.2, d + (r() - 0.5) * 0.1, 0.23, 0.14, 0.02, 0.1, colors[Math.floor(r() * colors.length)]);
}

const kinds = {
  books(R, r, ctx, fill) {
    const colors = spines.books, labels = ["#f4f5f5", "#e8c83a", "#ff2f9a"];
    for (const side of ["left", "right"]) stack(R, r, { side, rows: 4, rh: 0.26, from: 0.5, to: R.W - 0.2, depth: 0.12, fill, colors, label: labels });
    stack(R, r, { side: "back", rows: 3, rh: 0.26, from: -R.ih + 0.2, to: R.ih - 0.2, depth: 0.12, fill, colors });
    // A display table of face-out bestsellers, stacked in piles.
    R.box("tint", 0, R.W * 0.5, 0.17, 0.62, 0.34, 0.5, wood);
    for (let i = 0; i < 6; i++) for (let k = 0; k < 1 + Math.floor(fill * 3); k++) R.box("tint", -0.2 + (i % 3) * 0.2, R.W * 0.5 - 0.1 + Math.floor(i / 3) * 0.2, 0.37 + k * 0.04, 0.16, 0.035, 0.12, colors[(i + k) % colors.length]);
    R.box("neon", 0, R.W - 0.06, 1.12, R.W * 0.7, 0.03, 0.03, "#ff2f9a");
    counter(R, { u: R.ih * 0.45, len: 0.8, color: "#2a1a1a", top: "#e8e0cc", glow: "#ff2f9a" });
    return { cu: R.ih * 0.45, aisles: [[-0.8, 1.0], [0.8, 1.0], [-0.55, 1.9], [0.05, 0.6]] };
  },
  used(R, r, ctx, fill) {
    const colors = spines.used;
    for (const side of ["left", "right"]) stack(R, r, { side, rows: 4, rh: 0.26, from: 0.5, to: R.W - 0.2, depth: 0.12, fill: Math.min(1, fill + 0.1), colors, tall: 1 });
    stack(R, r, { side: "back", rows: 3, rh: 0.26, from: -R.ih + 0.2, to: R.ih - 0.2, depth: 0.12, fill, colors, tall: 1 });
    // Leaning towers of books on the floor, and a "50p" bargain crate.
    for (let i = 0; i < 4; i++) {
      const u = -0.6 + i * 0.4, d = 0.7 + r() * 1.2;
      for (let k = 0; k < 2 + Math.floor(fill * 5); k++) R.box("tint", u + (r() - 0.5) * 0.04, d, 0.03 + k * 0.05, 0.2 + r() * 0.06, 0.045, 0.15, colors[Math.floor(r() * colors.length)]);
    }
    R.box("tint", 0, R.W * 0.55, 0.12, 0.6, 0.24, 0.4, wood);
    for (let k = 0; k < 9; k++) R.box("tint", -0.24 + k * 0.06, R.W * 0.55, 0.28, 0.04, 0.2, 0.3, colors[k % colors.length]);
    counter(R, { u: -R.ih * 0.45, len: 0.8, color: "#2a1c10", top: "#a08a5a", glow: "#ffe14a" });
    return { cu: -R.ih * 0.45, aisles: [[0.7, 0.9], [-0.7, 1.4], [0.1, 1.9], [0.8, 1.6]] };
  },
  library(R, r, ctx, fill) {
    const colors = spines.library;
    for (const side of ["left", "right"]) stack(R, r, { side, rows: 5, rh: 0.24, from: 0.5, to: R.W - 0.2, depth: 0.14, fill, colors, tall: 1 });
    stack(R, r, { side: "back", rows: 4, rh: 0.24, from: -R.ih + 0.2, to: R.ih - 0.2, depth: 0.14, fill, colors, tall: 1 });
    // The rolling ladder on the right wall, leaning on the top shelf.
    const lu = R.ih - 0.3;
    for (const s of [-1, 1]) R.box("tint", lu, R.W * 0.5 + s * 0.1, 0.6, 0.03, 1.3, 0.03, "#3a2a1a");
    for (let k = 0; k < 6; k++) R.box("tint", lu, R.W * 0.5, 0.15 + k * 0.2, 0.03, 0.025, 0.2, "#3a2a1a");
    // Two reading tables with lamps, readers' chairs and open books.
    table(R, r, -0.5, 1.0, "#1f7a4a", colors);
    table(R, r, 0.35, 1.9, "#1f7a4a", colors);
    // The checkout desk, a card catalogue at its end.
    counter(R, { u: -R.ih * 0.35, len: 0.9, color: "#2a1c10", top: "#c9b78a", glow: "#41ffb0" });
    R.box("tint", R.ih * 0.4, R.W - 0.45, 0.25, 0.4, 0.5, 0.25, wood);
    for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) R.box("metal", R.ih * 0.4 - 0.12 + i * 0.12, R.W - 0.575, 0.1 + j * 0.15, 0.08, 0.09, 0.01);
    return { cu: -R.ih * 0.35, aisles: [[-0.5, 1.4], [0.35, 1.4], [0.8, 0.8], [-0.2, 2.2]] };
  },
  archive(R, r, ctx, fill) {
    const colors = spines.archive, labels = ["#f4f5f5", "#d9b25a"];
    // Box files on steel racking, three bays, the labels facing out.
    for (const side of ["left", "right"]) stack(R, r, { side, rows: 5, rh: 0.24, from: 0.5, to: R.W - 0.2, depth: 0.18, fill, colors, label: labels, tall: 0.95 });
    stack(R, r, { side: "back", rows: 4, rh: 0.24, from: -R.ih + 0.2, to: R.ih - 0.2, depth: 0.18, fill, colors, label: labels, tall: 0.95 });
    // Archive crates in a stack, lids on, a tag on each.
    for (let i = 0; i < 3; i++) for (let k = 0; k < 3 - i; k++) if (r() < fill + 0.3) {
      R.box("tint", -0.35 + i * 0.5, R.W * 0.5, 0.1 + k * 0.2, 0.42, 0.18, 0.32, "#c9b78a");
      R.box("tint", -0.35 + i * 0.5, R.W * 0.5 - 0.17, 0.1 + k * 0.2, 0.12, 0.08, 0.01, "#f4f5f5");
    }
    R.box("neon", 0, R.W - 0.06, 1.2, R.W * 0.7, 0.03, 0.03, "#19d3ff");
    counter(R, { u: R.ih * 0.45, len: 0.7, color: "#2a3036", top: "#6c7882", glow: "#19d3ff" });
    return { cu: R.ih * 0.45, aisles: [[-0.6, 1.0], [0.6, 1.0], [-0.1, 1.9], [0.7, 1.7]] };
  },
};

export function buildInterior(ctx) {
  const R = room(ctx), build = kinds[ctx.kind] ?? kinds.library;
  const fill = Math.min(1, 0.4 + Math.sqrt(ctx.lines) / 30);
  const out = build(R, ctx.r, ctx, fill);
  R.box("tint", 0, R.W / 2, 0.012, R.W, 0.02, R.W, floors[ctx.kind] ?? floors.library);
  // A little more stock the bigger the file: one loose book per 150 lines on the shelf-tops' reading side.
  for (let i = 0; i < Math.min(6, Math.floor(ctx.lines / 150)); i++) R.box("tint", -R.ih + 0.25 + i * 0.12, 0.3, 0.025, 0.1, 0.03, 0.14, spines[ctx.kind]?.[i % spines[ctx.kind].length] ?? "#7a6a3c");
  return { aisles: out.aisles.map(([u, d]) => R.at(u, d)), clerk: R.at(out.cu, R.W - 0.35) };
}
