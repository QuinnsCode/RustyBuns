// The coffee shop: a stool counter with an espresso machine, a pastry case, mugs, a chalkboard menu and little
// tables of seated patrons. The file's lines are the stock: the bigger the file, the fuller the case and the shelves.
import { room } from "./room.js";

const cups = ["#f4f5f5", "#e8590c", "#2a8ad8", "#e8c83a", "#2ac86a", "#d8402a"];
const bakes = ["#c98a4a", "#e8b86a", "#8a5a3c", "#f0d9a8", "#d8402a"];
const coats = ["#16191c", "#2e3439", "#6b7680", "#8a5a3c", "#3a6b8a", "#7a2e2a"];
const skins = ["#f1c9a5", "#d9a47a", "#a8744f", "#6b4a32"];

/** Menu lines for the chalkboard: the file's function names when the loader passes them, else the words of its path. */
function menuLines(ctx) {
  const given = ctx.fns?.length ? ctx.fns : String(ctx.path ?? "").split(/[^A-Za-z0-9]+|(?<=[a-z])(?=[A-Z])/).filter((w) => w.length > 1 && !/^(src|js|ts|tsx|jsx|index)$/.test(w));
  return (given.length ? given : ["drip", "flat", "mocha"]).slice(0, 5);
}

/** The chalkboard itself, a canvas plane on the back wall, only when there is a browser to draw it. */
function chalkboard(ctx, R, lines) {
  const T = ctx.THREE;
  if (!T?.CanvasTexture || typeof document === "undefined") return;
  const c = document.createElement("canvas"); c.width = 256; c.height = 128;
  const g = c.getContext("2d");
  g.fillStyle = "#1d2a24"; g.fillRect(0, 0, 256, 128);
  g.strokeStyle = "#8a6a3c"; g.lineWidth = 6; g.strokeRect(3, 3, 250, 122);
  g.fillStyle = "#f2efe4"; g.font = "700 18px ui-monospace, monospace"; g.fillText("MENU", 14, 26);
  g.font = "500 14px ui-monospace, monospace";
  lines.forEach((l, i) => { g.fillText(l.slice(0, 18), 14, 50 + i * 17); g.fillText(`${2 + ((i * 7 + ctx.lines) % 5)}.${(i * 25) % 100 || "00"}`.slice(0, 5), 196, 50 + i * 17); });
  const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace;
  const m = new T.Mesh(new T.PlaneGeometry(1, 1), new T.MeshBasicMaterial({ map: t }));
  const [x, z] = R.at(-0.35, R.W - 0.03);
  m.position.set(x, ctx.y0 + 1.0, z); m.scale.set(0.9, 0.45, 1);
  m.rotation.y = Math.atan2(-ctx.door[0], -ctx.door[1]);
  ctx.scene.add(m);
}

/** A seated patron: legs folded on the seat, a torso, a head, and a mug in hand. */
function patron(R, r, u, d, seat, facing) {
  const coat = coats[Math.floor(r() * coats.length)], skin = skins[Math.floor(r() * skins.length)];
  R.box("tint", u, d, seat + 0.05, 0.1, 0.1, 0.12, "#2e3439");
  R.box("tint", u, d, seat + 0.17, 0.12, 0.16, 0.09, coat);
  R.ball(u, d, seat + 0.3, 0.09, skin, "lamp");
  R.box("tint", u, d + facing * 0.07, seat + 0.2, 0.04, 0.04, 0.05, skin);
}

export function buildInterior(ctx) {
  const R = room(ctx), r = ctx.r, fill = Math.min(1, 0.4 + Math.sqrt(ctx.lines) / 30), hw = R.ih - 0.12;
  R.box("tint", 0, R.W / 2, 0.012, R.W, 0.02, R.W, "#3a2a20");
  R.box("tint", 0, R.W / 2 - 0.2, 0.016, 1.6, 0.02, 1.4, "#5a3a26");

  // The bar across the back: a dark front, a pale top, stools along it, the barista behind.
  const bd = R.W - 0.72;
  R.box("tint", 0, bd, 0.22, 2.0, 0.44, 0.34, "#2a1a10");
  R.box("tint", 0, bd, 0.45, 2.06, 0.03, 0.4, "#d8cfc0");
  R.box("neon", 0, bd - 0.18, 0.3, 1.8, 0.02, 0.02, "#ffb020");
  for (const u of [-0.75, -0.25, 0.25, 0.75]) {
    R.cyl(u, bd - 0.5, 0.11, 0.05, 0.22, undefined, "cylMetal");
    R.cyl(u, bd - 0.5, 0.23, 0.2, 0.04, "#8a2a1a");
    if (r() < 0.75) patron(R, r, u, bd - 0.5, 0.25, 1);
  }

  // The espresso machine: a steel body, group heads, drip tray, a steam wand and rising puffs.
  const mu = 0.55;
  R.box("metal", mu, bd, 0.62, 0.42, 0.28, 0.26);
  R.box("tint", mu, bd, 0.79, 0.44, 0.04, 0.28, "#16191c");
  R.box("tint", mu, bd - 0.14, 0.52, 0.36, 0.03, 0.08, "#16191c");
  for (const k of [-0.12, 0.12]) { R.cyl(mu + k, bd - 0.13, 0.58, 0.07, 0.06, undefined, "cylMetal"); R.cyl(mu + k, bd - 0.13, 0.52, 0.05, 0.05, "#e8590c"); }
  R.cyl(mu + 0.22, bd - 0.1, 0.62, 0.015, 0.2, undefined, "cylMetal");
  for (let i = 0; i < 4; i++) R.ball(mu + 0.22 + (r() - 0.5) * 0.06, bd - 0.1 + (r() - 0.5) * 0.06, 0.78 + i * 0.1, 0.05 + i * 0.015, "#e6ebee");
  R.ball(mu, bd - 0.16, 0.72, 0.03, "#ff2a1a", "redLight");

  // A grinder, a till, mugs in a stack and a pastry case under glass.
  R.cyl(-0.05, bd, 0.55, 0.12, 0.2, "#2a1a10"); R.cyl(-0.05, bd, 0.7, 0.14, 0.1, "#16191c");
  R.box("metal", -0.4, bd, 0.52, 0.18, 0.12, 0.14);
  for (let i = 0; i < 4; i++) R.cyl(0.0 + (i % 2) * 0.1, bd + 0.1, 0.5 + Math.floor(i / 2) * 0.07, 0.07, 0.06, cups[i % cups.length]);
  const cu = -0.8;
  R.box("tint", cu, bd - 0.06, 0.55, 0.5, 0.2, 0.22, "#f4f5f5");
  R.box("panel", cu, bd - 0.06, 0.66, 0.52, 0.03, 0.24);
  for (let i = 0; i < 3 + Math.floor(fill * 6); i++) R.ball(cu - 0.2 + (i % 5) * 0.1, bd - 0.1 + Math.floor(i / 5) * 0.08, 0.57, 0.07, bakes[Math.floor(r() * bakes.length)], "lamp");

  // Back shelves of beans and mugs, sparser for a short file, and the chalkboard menu over them.
  for (let j = 0; j < 2; j++) {
    R.box("grey", 0, R.W - 0.1, 0.62 + j * 0.34, 2.1, 0.03, 0.16);
    for (let u = -hw + 0.15; u < hw - 0.1; u += 0.13) if (r() < fill) {
      if (j === 0) R.cyl(u, R.W - 0.1, 0.72, 0.09, 0.16, cups[Math.floor(r() * cups.length)]);
      else R.box("tint", u, R.W - 0.1, 1.06, 0.1, 0.14, 0.1, "#8a5a3c");
    }
  }
  chalkboard(ctx, R, menuLines(ctx));

  // Four little tables, each a round top on a post with two stools and seated patrons.
  const tables = [[-0.85, 0.7], [0.85, 0.7], [-0.85, 1.45], [0.85, 1.45]];
  tables.forEach(([u, d], i) => {
    R.cyl(u, d, 0.15, 0.04, 0.3, undefined, "cylMetal");
    R.cyl(u, d, 0.31, 0.34, 0.03, i % 2 ? "#e8e0cc" : "#8a5a3c");
    R.cyl(u + 0.04, d - 0.03, 0.35, 0.06, 0.05, cups[Math.floor(r() * cups.length)]);
    if (r() < fill) R.cyl(u - 0.07, d + 0.04, 0.34, 0.1, 0.02, bakes[Math.floor(r() * bakes.length)]);
    for (const s of [-1, 1]) {
      R.cyl(u + s * 0.3 * (u > 0 ? -1 : 1), d, 0.11, 0.18, 0.22, "#8a2a1a");
      if (r() < 0.7) patron(R, r, u + s * 0.3 * (u > 0 ? -1 : 1), d, 0.22, -s);
    }
  });

  // Pendant lamps and a warm pool of light on the floor under each.
  for (const [u, d] of [[-0.6, 1.1], [0.6, 1.1], [0, 2.0]]) { R.cyl(u, d, 1.4, 0.01, 0.4, undefined, "cylMetal"); R.ball(u, d, 1.22, 0.1, "#ffe2b3"); R.pool(u, d, 1.4, "#ffb060"); }

  return { aisles: [[0, 0.5], [0, 1.1], [-0.3, 1.7], [0.3, 1.7], [0, 0.9]].map(([u, d]) => R.at(u, d)), clerk: R.at(0.1, R.W - 0.4) };
}
