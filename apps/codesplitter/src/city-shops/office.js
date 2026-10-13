// The offices: the city hall, the HQ lobby and the plain corporate office. The file's lines are the paperwork:
// the bigger the file, the more drawers hang open and the more paper spills and stacks up. Its path seeds the rest.
import { room, stack, counter } from "./room.js";

const paper = ["#f4f1e6", "#ece6d2", "#fbfaf4", "#e2dcc6"], folders = ["#d9b25a", "#c9a24a", "#6f8fb0", "#b05a4a", "#7aa070"];

/** A bank of filing cabinets down a side wall, some drawers pulled out with paper spilling onto the floor. */
function cabinets(R, r, side, fill) {
  const s = side === "left" ? -1 : 1, n = 4;
  for (let i = 0; i < n; i++) {
    const d = 0.55 + i * 0.52;
    R.box("tint", s * (R.ih - 0.17), d, 0.45, 0.32, 0.9, 0.46, "#8a949c");
    for (let k = 0; k < 3; k++) {
      const open = r() < fill * 0.7, y = 0.16 + k * 0.28;
      R.box("tint", s * (R.ih - (open ? 0.5 : 0.34)), d, y, 0.02, 0.2, 0.4, "#aab4bc");
      if (open) {
        R.box("tint", s * (R.ih - 0.4), d, y, 0.16, 0.14, 0.4, "#7a848c");
        for (let p = 0; p < 4; p++) R.box("tint", s * (R.ih - 0.4), d - 0.15 + p * 0.1, y + 0.09, 0.14, 0.05 + r() * 0.05, 0.05, folders[Math.floor(r() * folders.length)]);
      }
    }
    // Spilled paper on the floor in front of the bank, thicker the bigger the file.
    for (let p = 0, m = Math.floor(fill * 7); p < m; p++) {
      R.box("tint", s * (R.ih - 0.55 - r() * 0.5), d + (r() - 0.5) * 0.45, 0.02 + (p % 3) * 0.005, 0.2, 0.004, 0.14, paper[Math.floor(r() * paper.length)]);
    }
  }
}

/** A desk with a monitor, a keyboard, a paper stack and a chair; paper is how much of the file is on it. */
function desk(R, r, u, d, fill, tilt = 1) {
  R.box("tint", u, d, 0.34, 0.62, 0.03, 0.34, "#8a6a4a");
  R.box("tint", u - 0.27, d, 0.17, 0.04, 0.34, 0.3, "#5a4430"); R.box("tint", u + 0.27, d, 0.17, 0.04, 0.34, 0.3, "#5a4430");
  R.box("panel", u, d + 0.1 * tilt, 0.5, 0.26, 0.17, 0.02);
  R.box("neon", u, d + 0.1 * tilt - 0.011 * tilt, 0.5, 0.23, 0.14, 0.004, "#8fd6ff");
  R.box("metal", u, d + 0.1 * tilt, 0.39, 0.05, 0.06, 0.04);
  R.box("tint", u, d - 0.08 * tilt, 0.365, 0.2, 0.012, 0.07, "#2c3238");
  for (let p = 0, m = Math.floor(1 + fill * 5); p < m; p++) R.box("tint", u + 0.2, d - 0.02 * tilt, 0.37 + p * 0.012, 0.13, 0.01, 0.17, paper[p % paper.length]);
  R.cyl(u, d - 0.3 * tilt, 0.12, 0.2, 0.24, "#2c3238"); R.box("tint", u, d - 0.38 * tilt, 0.36, 0.2, 0.2, 0.03, "#2c3238");
}

const kinds = {
  /** The city hall: a marble floor, a long public counter under a seal, queue stanchions and benches. */
  hall(R, r, ctx, fill) {
    R.box("tint", 0, R.W - 0.03, 0.6, R.W * 0.5, 0.5, 0.02, "#2a2a2e");
    R.ball(0, R.W - 0.05, 0.6, 0.3, "#e8590c");
    counter(R, { u: 0, len: 1.3, color: "#4a3a2c", top: "#c9c4b4", glow: "#ffe2b3" });
    for (const u of [-0.95, 0.95]) desk(R, r, u, R.W - 0.3, fill);
    cabinets(R, r, "left", fill);
    // A rope queue to the counter: posts and a sagging rail either side of the path from the door.
    for (const s of [-1, 1]) for (let i = 0; i < 3; i++) {
      R.cyl(s * 0.35, 0.5 + i * 0.45, 0.17, 0.05, 0.34, undefined, "cylMetal");
      if (i) R.box("tint", s * 0.35, 0.5 + i * 0.45 - 0.225, 0.3, 0.012, 0.012, 0.4, "#b8382a");
    }
    // A bench by the right wall, a notice board above it pinned with forms.
    R.box("tint", R.ih - 0.2, 1.1, 0.2, 0.3, 0.04, 0.9, "#6b4a2e"); R.box("tint", R.ih - 0.06, 1.1, 0.4, 0.02, 0.4, 0.9, "#6b4a2e");
    R.box("tint", R.ih - 0.04, 1.6, 0.85, 0.02, 0.5, 0.8, "#6b4a2e");
    for (let i = 0; i < 5; i++) if (r() < fill + 0.3) R.box("tint", R.ih - 0.06, 1.3 + i * 0.16, 0.85 + (r() - 0.5) * 0.3, 0.01, 0.16, 0.12, paper[i % paper.length]);
    R.box("neon", 0, 0.1, 1.15, R.W * 0.6, 0.02, 0.02, "#e8e0cc");
    return { cu: 0, floor: "#c9c4b4", aisles: [[0, 0.6], [-0.4, 1.4], [0.4, 1.4], [0.1, 2.0]] };
  },
  /** The HQ lobby: a reception desk with a glowing logo wall, sofas, a plant, a water cooler. */
  hq(R, r, ctx, fill) {
    R.box("tint", 0, R.W - 0.03, 0.8, R.W * 0.8, 1.2, 0.03, "#16191c");
    R.box("orange", 0, R.W - 0.06, 1.0, 0.5, 0.2, 0.01); R.box("orange", 0, R.W - 0.06, 0.78, 0.3, 0.12, 0.01);
    R.pool(0, R.W - 0.5, 1.6, "#ff7a1a");
    counter(R, { u: 0, len: 1.2, color: "#e8e8e8", top: "#16191c", glow: "#ff7a1a" });
    for (const s of [-1, 1]) {
      R.box("tint", s * (R.ih - 0.3), 0.8, 0.15, 0.4, 0.3, 0.9, "#2e3439"); R.box("tint", s * (R.ih - 0.1), 0.8, 0.35, 0.06, 0.4, 0.9, "#2e3439");
      R.box("tint", s * (R.ih - 0.5), 1.6, 0.1, 0.5, 0.2, 0.5, "#e8590c");
    }
    R.box("tint", 0, 1.1, 0.12, 0.5, 0.24, 0.3, "#2c3238");
    for (let i = 0; i < 4; i++) if (r() < fill + 0.3) R.box("tint", -0.15 + i * 0.1, 1.1, 0.27, 0.07, 0.01 + r() * 0.01, 0.1, paper[i]);
    // The visitors' tray of forms on the desk and a records wall of binders beside the logo.
    stack(R, r, { side: "left", rows: 3, rh: 0.26, from: 1.6, to: R.W - 0.2, depth: 0.14, fill, colors: folders.concat("#e9e1cf") });
    stack(R, r, { side: "right", rows: 3, rh: 0.26, from: 1.6, to: R.W - 0.2, depth: 0.14, fill, colors: folders.concat("#e9e1cf") });
    for (let i = 0, m = Math.floor(2 + fill * 8); i < m; i++) R.box("tint", -0.3 + (i % 4) * 0.03, R.W - 0.7 + (r() - 0.5) * 0.1, 0.47 + i * 0.01, 0.16, 0.008, 0.22, paper[i % paper.length]);
    R.cyl(-R.ih + 0.2, 0.3, 0.12, 0.2, 0.24, "#6b4a2e"); R.cyl(-R.ih + 0.2, 0.3, 0.45, 0.06, 0.4, "#4a3320"); R.ball(-R.ih + 0.2, 0.3, 0.72, 0.4, "#3d5a40", "leaf");
    return { cu: 0, floor: "#d8d8d4", aisles: [[-0.4, 0.8], [0.4, 0.8], [-0.2, 1.5], [0.5, 1.9]] };
  },
  /** The plain office: banks of cabinets, desks in rows, a records wall, the copier and the water cooler. */
  office(R, r, ctx, fill) {
    cabinets(R, r, "left", fill);
    // The records wall: binders and boxes along the back and right.
    stack(R, r, { side: "back", rows: 4, rh: 0.26, from: -R.ih + 0.2, to: R.ih - 0.2, depth: 0.16, fill, colors: folders.concat("#e9e1cf", "#3a4148") });
    stack(R, r, { side: "right", rows: 4, rh: 0.26, from: 1.2, to: R.W - 0.2, depth: 0.16, fill, colors: folders.concat("#e9e1cf", "#3a4148") });
    for (const [u, d] of [[-0.35, 1.1], [0.35, 1.1], [-0.35, 1.8], [0.35, 1.8]]) desk(R, r, u * 0.9, d, fill);
    // The copier by the door on the right: a box, a lid, a glowing panel, paper in the tray.
    R.box("tint", R.ih - 0.28, 0.35, 0.3, 0.45, 0.6, 0.4, "#c9d0d8"); R.box("tint", R.ih - 0.28, 0.35, 0.62, 0.47, 0.04, 0.42, "#2c3238");
    R.box("neon", R.ih - 0.28, 0.14, 0.5, 0.2, 0.04, 0.01, "#19d3ff");
    for (let p = 0, m = Math.floor(1 + fill * 4); p < m; p++) R.box("tint", R.ih - 0.28, 0.6, 0.22 + p * 0.01, 0.22, 0.008, 0.2, paper[p % paper.length]);
    // The water cooler: a stand and an upturned blue bottle.
    R.cyl(-R.ih + 0.2, R.W - 0.25, 0.2, 0.2, 0.4, "#e9ecee"); R.cyl(-R.ih + 0.2, R.W - 0.25, 0.52, 0.18, 0.28, "#8fd6ff");
    counter(R, { u: 0.2, len: 0.8, color: "#5a4430", top: "#e9e1cf", glow: "#ffe2b3" });
    return { cu: 0.2, floor: "#5a626a", aisles: [[0, 0.5], [0, 1.45], [0.05, 2.1], [0.9, 0.9]] };
  },
};

export function buildInterior(ctx) {
  const R = room(ctx), build = kinds[ctx.kind] ?? kinds.office;
  const fill = Math.min(1, 0.4 + Math.sqrt(ctx.lines) / 30);
  const out = build(R, ctx.r, ctx, fill);
  R.box("tint", 0, R.W / 2, 0.012, R.W, 0.02, R.W, out.floor);
  return { aisles: out.aisles.map(([u, d]) => R.at(u, d)), clerk: R.at(out.cu, R.W - 0.35) };
}
