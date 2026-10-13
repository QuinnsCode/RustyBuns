// The media shops: video rental, comics, records and lava lamps. The file's lines are the stock:
// the bigger the file, the fuller its shelves, and its path seeds every colour so the shop is the same for everyone.
import { room, stack, counter } from "./room.js";

const kinds = {
  video(R, r, ctx, fill) {
    const tapes = ["#101214", "#16181b", "#1c1f23", "#22262b"], labels = ["#f4f5f5", "#e8590c", "#19d3ff", "#ff2f9a"];
    for (const side of ["left", "right"]) stack(R, r, { side, rows: 4, rh: 0.26, from: 0.5, to: R.W - 0.2, depth: 0.1, fill, colors: tapes, label: labels });
    stack(R, r, { side: "back", rows: 4, rh: 0.26, from: -R.ih + 0.2, to: R.ih - 0.2, depth: 0.1, fill, colors: tapes, label: labels });
    counter(R, { u: R.ih * 0.45, len: 0.8, color: "#16191c", top: "#2a3036", glow: "#19d3ff" });
    // A returns drop by the door and a new-releases stand.
    R.box("tint", -R.ih + 0.18, 0.28, 0.2, 0.2, 0.4, 0.2, "#e8590c");
    R.box("tint", -R.ih * 0.5, R.W * 0.62, 0.12, 0.7, 0.24, 0.2, "#16191c");
    for (let i = 0; i < 6; i++) R.box("tint", -R.ih * 0.5 - 0.3 + i * 0.12, R.W * 0.62 - 0.02, 0.28, 0.08, 0.1, 0.06, labels[i % 4]);
    R.box("neon", 0, R.W * 0.5, 1.12, R.W * 0.8, 0.03, 0.03, "#19d3ff");
    return { cu: R.ih * 0.45, floor: "#14171c", aisles: [[-0.3, 0.8], [0.3, 1.2], [-0.4, 1.7], [0.2, 0.7]] };
  },
  comics(R, r, ctx, fill) {
    const covers = ["#e8302a", "#2a6ae8", "#f4d03a", "#2ac86a", "#ff6aa8", "#ffffff", "#8a5cff"];
    // The wall: covers in a grid, each one a little off true.
    stack(R, r, { side: "left", rows: 4, rh: 0.26, from: 0.5, to: R.W - 0.2, depth: 0.04, fill, colors: covers, tall: 0.95 });
    stack(R, r, { side: "back", rows: 3, rh: 0.26, from: -R.ih + 0.2, to: R.ih - 0.2, depth: 0.04, fill, colors: covers, tall: 0.95 });
    // Long boxes along the right: white cardboard with a coloured tab, two high.
    for (let row = 0; row < 2; row++) for (let i = 0; i < 4; i++) if (r() < fill + 0.3) {
      const d = 0.6 + i * 0.52;
      R.box("tint", R.ih - 0.17, d, 0.1 + row * 0.2, 0.3, 0.18, 0.48, "#e9e1cf");
      R.box("tint", R.ih - 0.32, d, 0.19 + row * 0.2, 0.01, 0.06, 0.2, covers[Math.floor(r() * covers.length)]);
    }
    // Spinner racks: a pole and three rings of angled comics.
    for (const [u, d] of [[-R.ih * 0.45, 0.55], [R.ih * 0.15, R.W * 0.55]]) {
      R.cyl(u, d, 0.45, 0.04, 0.9, undefined, "cylMetal");
      for (let tier = 0; tier < 3; tier++) for (let k = 0; k < 6; k++) {
        const a = k * Math.PI / 3 + tier * 0.4, [x, z] = R.at(u + Math.cos(a) * 0.1, d + Math.sin(a) * 0.1);
        ctx.put("tint", x, ctx.y0 + 0.28 + tier * 0.22, z, 0.12, 0.17, 0.012, a + Math.PI / 2, covers[(k + tier * 2 + Math.floor(r() * 3)) % covers.length]);
      }
    }
    counter(R, { u: -R.ih * 0.35, len: 0.8, color: "#2a1a10", top: "#f4d03a", glow: "#ff7a1a" });
    return { cu: -R.ih * 0.35, floor: "#2a2420", aisles: [[0.55, 0.6], [-0.1, 1.4], [0.5, 1.8], [-0.7, 1.1]] };
  },
  records(R, r, ctx, fill) {
    const sleeves = ["#d8402a", "#2a8ad8", "#e8c83a", "#f0f0f0", "#3a3a3a", "#9a3ad8"];
    // The wall of sleeves facing out, square covers in a grid.
    for (let j = 0; j < 3; j++) for (let i = 0; i < 10; i++) if (r() < fill + 0.15) R.box("tint", -R.ih + 0.2 + i * 0.25, R.W - 0.04, 0.4 + j * 0.24, 0.22, 0.22, 0.015, sleeves[Math.floor(r() * sleeves.length)]);
    // Crates in two rows, a divider card stuck up at each, the sleeves packed edge-on.
    for (const u of [-0.5, 0.5]) for (let i = 0; i < 2; i++) {
      const d = 0.7 + i * 0.6;
      R.box("tint", u, d, 0.12, 0.5, 0.24, 0.4, "#6b4a2e");
      for (let k = 0; k < 11; k++) if (r() < fill + 0.2) R.box("tint", u - 0.22 + k * 0.044, d, 0.3, 0.03, 0.24, 0.34, sleeves[Math.floor(r() * sleeves.length)]);
    }
    // The listening booth in the back left corner: three panels, a deck, a neon lip.
    const bu = -R.ih + 0.35, bd = R.W - 0.4;
    R.box("tint", bu - 0.3, bd, 0.5, 0.03, 1.0, 0.7, "#16191c"); R.box("tint", bu + 0.3, bd, 0.5, 0.03, 1.0, 0.7, "#16191c"); R.box("tint", bu, bd + 0.34, 0.5, 0.6, 1.0, 0.03, "#16191c");
    R.box("tint", bu, bd + 0.1, 0.2, 0.3, 0.04, 0.3, "#3a3a3a"); R.cyl(bu, bd + 0.1, 0.23, 0.24, 0.02, "#0d0d0d"); R.ball(bu, bd + 0.1, 0.26, 0.05, "#d8402a");
    R.box("neon", bu, bd - 0.3, 1.02, 0.6, 0.03, 0.03, "#8a5cff");
    counter(R, { u: R.ih * 0.5, len: 0.7, color: "#2a1a3a", top: "#8a5cff", glow: "#8a5cff" });
    return { cu: R.ih * 0.5, floor: "#1c1624", aisles: [[0, 0.5], [0, 1.5], [-0.15, 2.0], [0.9, 1.2]] };
  },
  lava(R, r, ctx, fill) {
    const hues = [["#ff5a0a", "#ffb020"], ["#ff2f9a", "#ff9ac8"], ["#19d3ff", "#a8f0ff"], ["#8a5cff", "#cbb8ff"], ["#ff7a1a", "#ffd29a"]];
    const lamp = (u, d, y, s) => {
      const [a, b] = hues[Math.floor(r() * hues.length)];
      R.cyl(u, d, y + 0.02 * s, 0.07 * s, 0.04 * s, undefined, "cylMetal");
      R.cyl(u, d, y + 0.14 * s, 0.05 * s, 0.22 * s, a, "cylTint");
      R.box("neon", u, d, y + 0.14 * s, 0.07 * s, 0.2 * s, 0.07 * s, a);
      R.ball(u, d, y + (0.07 + r() * 0.12) * s, 0.08 * s, b);
      R.cyl(u, d, y + 0.27 * s, 0.03 * s, 0.04 * s, undefined, "cylMetal");
    };
    // Three shelves down each side and across the back, a lamp every hand's width, the glow pooled on the floor.
    for (const side of [-1, 1]) {
      for (let j = 0; j < 3; j++) {
        R.box("grey", side * (R.ih - 0.1), R.W / 2 + 0.2, 0.2 + j * 0.3, 0.2, 0.03, R.W - 0.7);
        for (let d = 0.55; d < R.W - 0.25; d += 0.2) if (r() < fill) lamp(side * (R.ih - 0.1), d, 0.22 + j * 0.3, 1);
      }
      R.pool(side * (R.ih - 0.5), R.W / 2, 1.6, hues[side > 0 ? 1 : 3][0]);
    }
    for (let j = 0; j < 3; j++) { R.box("grey", 0, R.W - 0.1, 0.2 + j * 0.3, R.W - 0.6, 0.03, 0.2); for (let u = -R.ih + 0.35; u < R.ih - 0.3; u += 0.2) if (r() < fill) lamp(u, R.W - 0.1, 0.22 + j * 0.3, 1); }
    // A tall showpiece on a plinth.
    R.cyl(0, R.W * 0.55, 0.12, 0.3, 0.24, "#16191c"); lamp(0, R.W * 0.55, 0.24, 2.2);
    R.pool(0, R.W * 0.55, 1.4, hues[0][0]);
    counter(R, { u: R.ih * 0.45, len: 0.6, color: "#16191c", top: "#2a2430", glow: "#ff7a1a" });
    return { cu: R.ih * 0.45, floor: "#120a08", aisles: [[-0.55, 0.8], [0.55, 1.4], [-0.55, 1.9], [0.55, 0.7]] };
  },
};

export function buildInterior(ctx) {
  const R = room(ctx), build = kinds[ctx.kind] ?? kinds.video;
  const fill = Math.min(1, 0.4 + Math.sqrt(ctx.lines) / 30);
  const out = build(R, ctx.r, ctx, fill);
  R.box("tint", 0, R.W / 2, 0.012, R.W, 0.02, R.W, out.floor);
  return { aisles: out.aisles.map(([u, d]) => R.at(u, d)), clerk: R.at(out.cu, R.W - 0.35) };
}
