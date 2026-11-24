// The cloth over the deck table at Desert Gathering: hand block-printed cotton, the kind sold by the metre at a market
// stall. Three cloths, one down each end and one across the front, pinned over the board and falling to the sand, where
// the hem pools and gathers the dust. The print is the old kind: small flower sprigs in a half-drop repeat, a vine
// border at the hem and the selvedges, a soft medallion on the front cloth, the dyes faded by the sun and every stamp a
// little off (a block lands slightly askew, the ink runs thin, a second colour misses its register). Drawn onto a canvas
// from a seed, so everyone in the room sees the same cloth; the folds are geometry (`drape`), the weave a normal map.
import * as THREE from "three";
import { mulberry32 } from "@rustybuns/util";

/** A cloth's dyes: the ground, then the block colours in the order they're stamped. */
export type Palette = { name: string; ground: string; inks: [string, string, string] };

/** Three real block-print traditions' colourings, faded: madder and iron black on unbleached cotton; a mud-resist
 *  indigo with cream and rust; a pomegranate-ochre ground with black and madder. */
export const PALETTES: readonly Palette[] = [
  { name: "madder on cream", ground: "#bfae8b", inks: ["#8e3b2c", "#2d2622", "#a88340"] },
  { name: "indigo resist", ground: "#34405a", inks: ["#d3c4a2", "#8d5136", "#5d6b83"] },
  { name: "ochre ground", ground: "#ad8652", inks: ["#2b231e", "#7f3426", "#d5c39c"] },
];

/** A cloth's palette from its seed. */
export const palette = (seed: number): Palette => PALETTES[((seed % PALETTES.length) + PALETTES.length) % PALETTES.length]!;

/** How the table's three sides are laid out along the cloth: left end, front, right end, each its own cloth. */
export type Panels = { end: number; front: number };

/** Metres of cloth that turn over the board's edge above the drop, and that lie on the sand under it. */
export const OVER = 0.05, POOL = 0.09;

/** Pixels per metre of the printed texture. */
const PX = 480;

/** The printed cloth laid flat, as a texture: the three panels side by side (end, front, end), `drop` metres tall
 *  plus what turns over the top and pools on the sand. u is metres along the table's edge, v metres down from the top. */
export function tapestry(p: Panels, drop: number, seed: number): THREE.CanvasTexture {
  const len = p.end * 2 + p.front, tall = OVER + drop + POOL;
  const c = document.createElement("canvas");
  c.width = Math.round(len * PX); c.height = Math.round(tall * PX);
  printCloth(c.getContext("2d")!, p, tall, seed);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** The cloth on the board's top, under the gear: the same field, no borders. */
export function tabletop(w: number, d: number, seed: number): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = Math.round(w * PX * 0.6); c.height = Math.round(d * PX * 0.6);
  const g = c.getContext("2d")!, r = mulberry32(seed ^ 0x5eed), pal = palette(seed);
  g.scale(0.6, 0.6);
  g.fillStyle = pal.ground; g.fillRect(0, 0, w * PX, d * PX);
  sprigs(g, r, pal, 0, 0, w * PX, d * PX);
  weathering(g, r, pal, w * PX, d * PX, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function printCloth(g: CanvasRenderingContext2D, p: Panels, tall: number, seed: number) {
  const r = mulberry32(seed), pal = palette(seed), H = tall * PX;
  const x0 = [0, p.end, p.end + p.front], widths = [p.end, p.front, p.end];
  g.fillStyle = pal.ground; g.fillRect(0, 0, (p.end * 2 + p.front) * PX, H);
  widths.forEach((w, i) => {
    const X = x0[i]! * PX, W = w * PX, hem = H - POOL * PX;
    g.save(); g.beginPath(); g.rect(X, 0, W, H); g.clip();
    // the field: sprigs in a half-drop repeat
    sprigs(g, r, pal, X, 0, W, H);
    // the front cloth's medallion, low on the drop where the crowd's eye sits, and quarter medallions in its corners
    if (i === 1) {
      const top = OVER * PX + 0.1 * PX, size = Math.min(W * 0.2, (hem - top) * 0.42);
      medallion(g, r, pal, X + W / 2, (top + hem) / 2, size);
      for (const cx of [X + 0.13 * PX, X + W - 0.13 * PX]) for (const cy of [top, hem - 0.13 * PX]) medallion(g, r, pal, cx, cy, size * 0.45);
    }
    // borders: the hem's wide vine, a narrow one along each selvedge and under the turn at the top
    vine(g, r, pal, X, hem - 0.11 * PX, W, 0.11 * PX, false);
    vine(g, r, pal, X, OVER * PX - 0.01 * PX, W, 0.045 * PX, false);
    for (const sx of [X, X + W - 0.05 * PX]) vine(g, r, pal, sx, OVER * PX, hem - OVER * PX, 0.05 * PX, true);
    // a hand-rolled hem stitched in the first ink
    g.strokeStyle = shade(pal.inks[0], 0.9); g.lineWidth = 1.5; g.setLineDash([5, 4]);
    g.beginPath(); g.moveTo(X, hem + 4); g.lineTo(X + W, hem + 4); g.stroke(); g.setLineDash([]);
    g.restore();
  });
  weathering(g, r, pal, (p.end * 2 + p.front) * PX, H, H - POOL * PX - 0.18 * PX);
}

/** One block stamped: the shape drawn by `path`, inked a little thin and a little askew. */
function stamp(g: CanvasRenderingContext2D, r: () => number, ink: string, x: number, y: number, rot: number, path: (g: CanvasRenderingContext2D) => void) {
  g.save();
  g.translate(x + (r() - 0.5) * 1.6, y + (r() - 0.5) * 1.6);
  g.rotate(rot + (r() - 0.5) * 0.05);
  g.globalAlpha = 0.62 + r() * 0.3;
  g.fillStyle = ink; g.strokeStyle = ink;
  path(g);
  g.restore();
}

function petal(g: CanvasRenderingContext2D, len: number, wide: number) {
  g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(wide, -len * 0.5, 0, -len); g.quadraticCurveTo(-wide, -len * 0.5, 0, 0); g.fill();
}

/** The field: a small flower on a curved stem with two leaves, in a half-drop repeat about 7 cm apart. Two blocks per
 *  sprig, the outline and the fill, so the second colour sometimes misses its register by a millimetre. */
function sprigs(g: CanvasRenderingContext2D, r: () => number, pal: Palette, X: number, Y: number, W: number, H: number) {
  const step = 0.072 * PX, s = step * 0.3;
  for (let col = -1, cx = X; cx < X + W + step; col++, cx += step) for (let cy = Y - step + (col % 2 ? step / 2 : 0); cy < Y + H + step; cy += step) {
    const tilt = (col % 2 ? 0.25 : -0.25);
    // the stem and leaves in the dark ink
    stamp(g, r, pal.inks[1], cx, cy, tilt, (g) => {
      g.lineWidth = s * 0.09; g.beginPath(); g.moveTo(0, s * 1.1); g.quadraticCurveTo(s * 0.25, s * 0.5, 0, 0); g.stroke();
      g.save(); g.translate(0, s * 0.7); g.rotate(1.0); petal(g, s * 0.55, s * 0.2); g.rotate(-2.0); petal(g, s * 0.5, s * 0.18); g.restore();
    });
    // the flower in the main ink, the eye in the third
    const miss = r() < 0.15 ? 1.8 : 0.5;
    stamp(g, r, pal.inks[0], cx + (r() - 0.5) * miss, cy + (r() - 0.5) * miss, tilt, (g) => {
      for (let k = 0; k < 6; k++) { g.rotate(Math.PI / 3); petal(g, s * 0.62, s * 0.26); }
    });
    stamp(g, r, pal.inks[2], cx, cy, 0, (g) => { g.beginPath(); g.arc(0, 0, s * 0.16, 0, Math.PI * 2); g.fill(); });
  }
}

/** A border: two fine rules and a running vine between them, leaves alternating side, a bud at each crest. */
function vine(g: CanvasRenderingContext2D, r: () => number, pal: Palette, X: number, Y: number, L: number, w: number, upright: boolean) {
  g.save();
  g.translate(X, Y);
  if (upright) { g.translate(w, 0); g.rotate(Math.PI / 2); }
  g.globalAlpha = 0.9;
  g.fillStyle = pal.ground; g.fillRect(0, 0, L, w);
  g.fillStyle = pal.inks[1];
  g.fillRect(0, w * 0.06, L, Math.max(1, w * 0.05)); g.fillRect(0, w * 0.89, L, Math.max(1, w * 0.05));
  const wave = w * 0.9, mid = w / 2, amp = w * 0.17;
  g.strokeStyle = pal.inks[1]; g.lineWidth = Math.max(1, w * 0.045);
  g.beginPath();
  for (let x = 0; x <= L; x += 3) { const y = mid + Math.sin((x / wave) * Math.PI * 2) * amp; x ? g.lineTo(x, y) : g.moveTo(x, y); }
  g.stroke();
  for (let x = wave / 4, k = 0; x < L; x += wave / 2, k++) {
    const up = k % 2 ? 1 : -1, y = mid + up * amp;
    stamp(g, r, pal.inks[0], x, y, 0, (g) => { for (let j = 0; j < 5; j++) { g.rotate((Math.PI * 2) / 5); petal(g, w * 0.16, w * 0.07); } });
    stamp(g, r, pal.inks[2], x + wave / 4, mid, up > 0 ? 0.6 : Math.PI - 0.6, (g) => petal(g, w * 0.22, w * 0.08));
  }
  g.restore();
}

/** A medallion: scalloped rings of petals round a rosette, in all three inks, the outer ring the faintest. */
function medallion(g: CanvasRenderingContext2D, r: () => number, pal: Palette, cx: number, cy: number, size: number) {
  g.save();
  g.globalAlpha = 0.85;
  g.fillStyle = pal.ground; g.beginPath(); g.arc(cx, cy, size * 1.02, 0, Math.PI * 2); g.fill();
  g.restore();
  const rings = [
    { at: 1, n: 24, len: 0.2, ink: pal.inks[1] },
    { at: 0.8, n: 16, len: 0.24, ink: pal.inks[0] },
    { at: 0.55, n: 12, len: 0.22, ink: pal.inks[2] },
    { at: 0.34, n: 8, len: 0.26, ink: pal.inks[0] },
  ];
  for (const ring of rings) {
    for (let k = 0; k < ring.n; k++) {
      const a = (k / ring.n) * Math.PI * 2;
      stamp(g, r, ring.ink, cx + Math.cos(a) * size * (ring.at - ring.len), cy + Math.sin(a) * size * (ring.at - ring.len), a + Math.PI / 2, (g) => {
        g.rotate(Math.PI); petal(g, size * ring.len, size * ring.len * 0.35);
      });
    }
    g.save(); g.globalAlpha = 0.7; g.strokeStyle = pal.inks[1]; g.lineWidth = Math.max(1, size * 0.012);
    g.beginPath(); g.arc(cx, cy, size * ring.at, 0, Math.PI * 2); g.stroke(); g.restore();
  }
  stamp(g, r, pal.inks[1], cx, cy, 0, (g) => { g.beginPath(); g.arc(0, 0, size * 0.09, 0, Math.PI * 2); g.fill(); });
}

/** Sun, wear and the desert: thin ink where a block ran dry, slubs in the yarn, the whole cloth faded toward the
 *  ground, and sand worked into it below `dustFrom`. */
function weathering(g: CanvasRenderingContext2D, r: () => number, pal: Palette, W: number, H: number, dustFrom: number) {
  // ink that didn't take: little flecks of bare ground
  g.fillStyle = pal.ground;
  for (let i = 0, n = Math.round(W * H / 220); i < n; i++) { g.globalAlpha = 0.25 + r() * 0.45; g.fillRect(r() * W, r() * H, 1 + r() * 2, 1 + r()); }
  // slubs: thick and thin threads running the weft, lighter and darker
  for (let y = 0; y < H; y += 2) {
    if (r() > 0.35) continue;
    g.globalAlpha = 0.04 + r() * 0.06;
    g.fillStyle = r() < 0.5 ? "#ffffff" : "#000000";
    g.fillRect(0, y, W, 1 + Math.round(r()));
  }
  // the sun: everything washed a step toward the ground and a little paler
  g.globalAlpha = 0.18; g.fillStyle = pal.ground; g.fillRect(0, 0, W, H);
  g.globalAlpha = 0.06; g.fillStyle = "#fff4e0"; g.fillRect(0, 0, W, H);
  // dust: sand worked into the bottom of the drop, heaviest in the pool
  if (dustFrom > 0) {
    const grad = g.createLinearGradient(0, dustFrom, 0, H);
    grad.addColorStop(0, "rgba(176,140,98,0)"); grad.addColorStop(0.7, "rgba(176,140,98,0.35)"); grad.addColorStop(1, "rgba(176,140,98,0.55)");
    g.globalAlpha = 1; g.fillStyle = grad; g.fillRect(0, dustFrom, W, H - dustFrom);
    for (let i = 0, n = Math.round(W * (H - dustFrom) / 60); i < n; i++) {
      g.globalAlpha = r() * 0.25; g.fillStyle = r() < 0.5 ? "#c6a57a" : "#8c6d4c";
      g.fillRect(r() * W, dustFrom + Math.pow(r(), 0.5) * (H - dustFrom), 1, 1);
    }
  }
  g.globalAlpha = 1;
}

function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16), f = (v: number) => Math.round(Math.min(255, v * k)).toString(16).padStart(2, "0");
  return `#${f(n >> 16)}${f((n >> 8) & 255)}${f(n & 255)}`;
}

/** The weave as a normal map: plain-weave cotton, warp and weft crossing, tiled every `tile` metres. */
export function weave(tile = 0.012): THREE.DataTexture {
  const n = 32, data = new Uint8Array(n * n * 4), threads = 4;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const cx = ((x / n) * threads) % 1, cy = ((y / n) * threads) % 1;
    const over = (Math.floor((x / n) * threads) + Math.floor((y / n) * threads)) % 2 === 0;
    // over a thread, the slope runs across it; at the crossings it dips
    const sx = over ? Math.sin(cx * Math.PI * 2) * 0.55 : 0, sy = over ? 0 : Math.sin(cy * Math.PI * 2) * 0.55;
    const i = (y * n + x) * 4;
    data[i] = Math.round((sx * 0.5 + 0.5) * 255); data[i + 1] = Math.round((sy * 0.5 + 0.5) * 255); data[i + 2] = 230; data[i + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, n, n);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1 / tile, 1 / tile);
  // mipmapped, or from a few metres the threads alias into stripes
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

/** The three cloths over a `w` by `d` table `h` tall, as one sheet: down the left end (from the DJ's side), across the
 *  front (-z, where the crowd is) and down the right end. Each cloth turns over the board's edge, hangs in folds that
 *  grow toward the hem, rounds out at the corners and pools on the sand. UVs in metres to match `tapestry`. */
export function drape(w: number, d: number, h: number, seed: number): THREE.BufferGeometry {
  const r = mulberry32(seed * 7 + 1);
  // the folds: a few long, soft waves and some short ones, each with its own phase, measured in metres along the edge
  const waves = Array.from({ length: 7 }, (_, i) => ({ k: (Math.PI * 2) / (0.09 + r() * (i < 3 ? 0.3 : 0.08)), ph: r() * Math.PI * 2, a: i < 3 ? 1 : 0.45 }));
  const fold = (s: number, t: number) => waves.reduce((sum, wv) => sum + wv.a * Math.sin(wv.k * s + wv.ph + t * 0.6), 0) / 3;
  const rows: { y: number; out: number; t: number; v: number }[] = [];
  // over the top: from 3 cm in on the board, round the edge
  rows.push({ y: h + 0.006, out: -0.03, t: 0, v: 0 }, { y: h + 0.005, out: -0.005, t: 0, v: 0.025 }, { y: h - 0.008, out: 0.008, t: 0, v: OVER });
  const drop = h - 0.008, N = 22;
  for (let i = 1; i <= N; i++) { const t = i / N; rows.push({ y: h - 0.008 - drop * t, out: 0.008 + 0.05 * t * t, t, v: OVER + drop * t }); }
  // the pool: what's left of the cloth lies out on the sand
  rows.push({ y: 0.006, out: 0.058 + POOL * 0.45, t: 1.05, v: OVER + drop + POOL * 0.5 }, { y: 0.004, out: 0.058 + POOL * 0.85, t: 1.1, v: OVER + drop + POOL });
  // along the edge: left end from the DJ's side to the front corner, the front, the right end back
  const segs = [{ n: 14, len: d }, { n: 10, len: 0 }, { n: 64, len: w }, { n: 10, len: 0 }, { n: 14, len: d }];
  const cols = segs.reduce((a, s) => a + s.n, 0) + 1;
  const pos: number[] = [], uv: number[] = [];
  for (const row of rows) {
    // the cloth hangs from the board's square corner and rounds out round it, wider as it flares toward the hem
    const R = row.out + 0.03 * Math.min(1, row.t) ** 1.5, ix = w / 2, iz = d / 2;
    let s = 0;
    const pt = (x: number, z: number, nx: number, nz: number, along: number, u: number) => {
      // a fold swings out from the board and back, but never in past it: cloth can't go through the table
      const a = row.t <= 0 ? 0 : Math.max(0.003 - row.out, (0.006 + 0.05 * row.t ** 1.2) * fold(along, row.t));
      pos.push(x + nx * a, row.y, z + nz * a); uv.push(u, row.v);
    };
    // left end: x = -(w/2 + out), z from +d/2 to -iz
    const endU = (z: number) => (d / 2 - z);
    for (let i = 0; i < segs[0]!.n; i++) { const z = d / 2 - ((d / 2 + iz) * i) / segs[0]!.n; pt(-(w / 2 + row.out), z, -1, 0, s + d / 2 - z, endU(z)); }
    s += d / 2 + iz;
    for (let i = 0; i < segs[1]!.n; i++) { const a = Math.PI + (Math.PI / 2) * (i / segs[1]!.n); pt(-ix + Math.cos(a) * R, -iz + Math.sin(a) * R, Math.cos(a), Math.sin(a), s + R * (Math.PI / 2) * (i / segs[1]!.n), d + (i / segs[1]!.n - 0.5) * 0.002); }
    s += R * Math.PI / 2;
    for (let i = 0; i < segs[2]!.n; i++) { const x = -ix + (2 * ix * i) / segs[2]!.n; pt(x, -(d / 2 + row.out), 0, -1, s + x + ix, d + (x + w / 2)); }
    s += 2 * ix;
    for (let i = 0; i < segs[3]!.n; i++) { const a = -Math.PI / 2 + (Math.PI / 2) * (i / segs[3]!.n); pt(ix + Math.cos(a) * R, -iz + Math.sin(a) * R, Math.cos(a), Math.sin(a), s + R * (Math.PI / 2) * (i / segs[3]!.n), d + w + (i / segs[3]!.n - 0.5) * 0.002); }
    s += R * Math.PI / 2;
    for (let i = 0; i <= segs[4]!.n; i++) { const z = -iz + ((d / 2 + iz) * i) / segs[4]!.n; pt(w / 2 + row.out, z, 1, 0, s + z + iz, d + w + (z + d / 2)); }
  }
  const index: number[] = [];
  for (let j = 0; j < rows.length - 1; j++) for (let i = 0; i < cols - 1; i++) {
    const a = j * cols + i, b = a + 1, c = a + cols, e = c + 1;
    index.push(a, c, b, b, c, e);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(index);
  geo.computeVertexNormals();
  return geo;
}

/** The cloth's material: cotton has no shine, only a soft sheen at grazing angles, and a weave you see up close. */
export function cotton(tex: THREE.CanvasTexture, seed: number, metres = true, drop = 0): THREE.MeshPhysicalMaterial {
  // the sheet's u and v are metres and the canvas covers the whole sheet, so scale them back to 0..1, v downward
  if (metres) { tex.repeat.set(PX / tex.image.width, -PX / tex.image.height); tex.offset.set(0, 1); }
  const m = new THREE.MeshPhysicalMaterial({
    map: tex, normalMap: weave(), normalScale: new THREE.Vector2(0.25, 0.25), roughness: 0.95,
    sheen: 0.3, sheenRoughness: 0.75, sheenColor: new THREE.Color(palette(seed).ground).multiplyScalar(0.6), side: THREE.DoubleSide,
  });
  if (metres && drop > 0) sway(m, OVER + drop);
  return m;
}

/** The night's wind on the cloth, in seconds: open-air.ts sets it each frame. */
export const clothTime = { value: 0 };
/**
 * The drop sways a centimetre or so in the wind, in slow travelling waves along the table, nothing at the top where
 * it's pinned over the board and nothing where it lies on the sand past `hem` (metres down the sheet, its v). In the
 * vertex shader, so it costs no work on the page.
 */
function sway(m: THREE.Material, hem: number) {
  m.onBeforeCompile = (sh) => {
    sh.uniforms.clothTime = clothTime;
    sh.vertexShader = "uniform float clothTime;\n" + sh.vertexShader.replace("#include <begin_vertex>", `#include <begin_vertex>
      float hang = smoothstep(${OVER.toFixed(3)}, ${(OVER + 0.45).toFixed(3)}, uv.y) * (1.0 - smoothstep(${(hem - 0.08).toFixed(3)}, ${hem.toFixed(3)}, uv.y));
      float gust = 0.55 + 0.45 * sin(clothTime * 0.31 + position.x * 0.4);
      transformed += objectNormal * hang * gust * 0.011 * sin(clothTime * 1.4 - position.x * 2.3 - position.z * 1.9);`);
  };
  m.customProgramCacheKey = () => `cloth-sway-${hem.toFixed(3)}`;
}

// ---- rugs on the sand: hand-knotted wool, laid where people stand and sit (Desert Gathering's booth, the kit, the bales)

/** A rug's wools: the field, the border's ground, then the knot colours. */
const RUG_WOOLS: readonly { field: string; border: string; knots: [string, string, string, string] }[] = [
  { field: "#7d2a22", border: "#26304a", knots: ["#d9ccb0", "#1c1a1c", "#b88a3e", "#3f5f6e"] },
  { field: "#2c3854", border: "#7a2b24", knots: ["#d8c9a8", "#151517", "#a9742f", "#8a3a2c"] },
  { field: "#a0673a", border: "#3a2622", knots: ["#e3d6b8", "#1d1716", "#6f2b22", "#47604e"] },
];

/** A knotted rug `w` by `d` metres as a texture: the field with its dye-lot bands (abrash), a medallion and corner
 *  spandrels, small motifs scattered in the field, a main border of rosettes between guard stripes, the pile worn thin
 *  down the middle where it's walked, and sand worked in. Its long side runs along u. */
export function rug(w: number, d: number, seed: number): THREE.CanvasTexture {
  const px = 200, c = document.createElement("canvas");
  c.width = Math.round(w * px); c.height = Math.round(d * px);
  const g = c.getContext("2d")!, W = c.width, H = c.height, r = mulberry32(seed * 13 + 5), wool = RUG_WOOLS[seed % RUG_WOOLS.length]!;
  g.fillStyle = wool.field; g.fillRect(0, 0, W, H);
  // abrash: each new batch of dyed wool a shade off, in bands across the warp
  for (let x = 0; x < W;) {
    const band = (0.05 + r() * 0.25) * px;
    g.globalAlpha = r() * 0.16; g.fillStyle = r() < 0.5 ? "#000" : "#fff"; g.fillRect(x, 0, band, H);
    x += band;
  }
  g.globalAlpha = 1;
  const bw = Math.min(W, H) * 0.16, inset = bw * 1.15;
  // the field's small motifs: hooked diamonds on a loose grid
  const step = 0.16 * px;
  for (let x = inset + step / 2; x < W - inset; x += step) for (let y = inset + step / 2; y < H - inset; y += step) {
    if (r() < 0.35) continue;
    const k = Math.floor(r() * 4), s = step * 0.2;
    g.fillStyle = wool.knots[k]!; g.globalAlpha = 0.85;
    g.beginPath(); g.moveTo(x, y - s); g.lineTo(x + s, y); g.lineTo(x, y + s); g.lineTo(x - s, y); g.fill();
    g.fillRect(x - s * 1.4, y - 1, s * 0.5, 2); g.fillRect(x + s * 0.9, y - 1, s * 0.5, 2);
  }
  g.globalAlpha = 1;
  // the medallion: stepped lozenges one inside the next, and a quarter of one in each corner of the field
  const lozenge = (cx: number, cy: number, rx: number, ry: number, steps: number) => {
    for (let i = 0; i < steps; i++) {
      const k = 1 - i / steps;
      g.fillStyle = [wool.border, wool.knots[0], wool.knots[2], wool.knots[1], wool.field][i % 5]!;
      g.beginPath();
      // a stepped outline, as knots make it: the diamond's edges drawn as stairs
      const n = 10;
      for (let j = 0; j <= n * 4; j++) {
        const q = j / (n * 4), a = q * Math.PI * 2, ex = Math.sign(Math.cos(a)) * Math.abs(Math.cos(a)) ** 1, ey = Math.sign(Math.sin(a)) * Math.abs(Math.sin(a)) ** 1;
        const sx = Math.round((cx + ex * rx * k) / 4) * 4, sy = Math.round((cy + ey * ry * k) / 4) * 4;
        j ? g.lineTo(sx, sy) : g.moveTo(sx, sy);
      }
      g.fill();
    }
  };
  lozenge(W / 2, H / 2, (W - inset * 2) * 0.26, (H - inset * 2) * 0.36, 5);
  g.save(); g.beginPath(); g.rect(inset, inset, W - inset * 2, H - inset * 2); g.clip();
  for (const [cx, cy] of [[inset, inset], [W - inset, inset], [inset, H - inset], [W - inset, H - inset]]) lozenge(cx!, cy!, (W - inset * 2) * 0.16, (H - inset * 2) * 0.24, 3);
  g.restore();
  // the borders: an outer guard, the main border of rosettes, an inner guard
  const frame = (o: number, t: number, color: string) => { g.strokeStyle = color; g.lineWidth = t; g.strokeRect(o + t / 2, o + t / 2, W - 2 * o - t, H - 2 * o - t); };
  frame(0, bw * 0.18, wool.knots[1]);
  frame(bw * 0.18, bw * 0.64, wool.border);
  frame(bw * 0.82, bw * 0.14, wool.knots[0]);
  frame(bw * 0.96, bw * 0.06, wool.knots[1]);
  const ros = bw * 0.64, rosR = ros * 0.32, along = (x0: number, y0: number, x1: number, y1: number) => {
    const n = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / (ros * 1.1)));
    for (let i = 0; i <= n; i++) {
      const x = x0 + ((x1 - x0) * i) / n, y = y0 + ((y1 - y0) * i) / n;
      g.fillStyle = wool.knots[(i % 2) * 2]!;
      for (let p = 0; p < 8; p++) { const a = (p / 8) * Math.PI * 2; g.fillRect(x + Math.cos(a) * rosR * 0.7 - 2, y + Math.sin(a) * rosR * 0.7 - 2, 4, 4); }
      g.fillStyle = wool.knots[3]; g.fillRect(x - rosR * 0.35, y - rosR * 0.35, rosR * 0.7, rosR * 0.7);
    }
  };
  const m = bw * 0.5;
  along(m, m, W - m, m); along(m, H - m, W - m, H - m); along(m, m, m, H - m); along(W - m, m, W - m, H - m);
  // the pile: knot by knot speckle, worn thin down the middle (the warp's pale shows through), sand in it
  for (let i = 0, n = Math.round(W * H / 5); i < n; i++) {
    const x = r() * W, y = r() * H;
    g.globalAlpha = 0.08 + r() * 0.1; g.fillStyle = r() < 0.5 ? "#000" : "#fff"; g.fillRect(x, y, 1.5, 1.5);
  }
  const wear = g.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.55);
  wear.addColorStop(0, "rgba(214,196,160,0.28)"); wear.addColorStop(1, "rgba(214,196,160,0)");
  g.globalAlpha = 1; g.fillStyle = wear; g.fillRect(0, 0, W, H);
  g.globalAlpha = 0.16; g.fillStyle = "#b08c62"; g.fillRect(0, 0, W, H);
  for (let i = 0, n = Math.round(W * H / 30); i < n; i++) { g.globalAlpha = r() * 0.3; g.fillStyle = "#c4a77c"; g.fillRect(r() * W, r() * H, 1, 1); }
  g.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  return tex;
}

/** A rug as it lies on the sand: `w` by `d`, a centimetre thick, a few soft rucks where it was kicked, and the white
 *  cotton fringe at both ends (the warp's ends, knotted off). Its long side along x. */
export function rugMesh(w: number, d: number, seed: number): THREE.Group {
  const r = mulberry32(seed * 3 + 11), g = new THREE.Group();
  const geo = new THREE.PlaneGeometry(w, d, 48, 24).rotateX(-Math.PI / 2), p = geo.attributes.position!;
  const rucks = Array.from({ length: 2 }, () => ({ x: (r() - 0.5) * w * 0.8, z: (r() - 0.5) * d * 0.8, a: r() * Math.PI, h: 0.008 + r() * 0.012, wide: 0.12 + r() * 0.1 }));
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    let y = 0.011;
    for (const k of rucks) { const across = (x - k.x) * Math.cos(k.a) + (z - k.z) * Math.sin(k.a), along = (x - k.x) * -Math.sin(k.a) + (z - k.z) * Math.cos(k.a); y += k.h * Math.exp(-((across / k.wide) ** 2)) * Math.exp(-((along / 0.6) ** 2)); }
    // the edges curl down to the sand
    const edge = Math.min(w / 2 - Math.abs(x), d / 2 - Math.abs(z));
    if (edge < 0.02) y *= Math.max(0.3, edge / 0.02);
    p.setY(i, y);
  }
  geo.computeVertexNormals();
  const top = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: rug(w, d, seed), roughness: 1, normalMap: weave(0.004), normalScale: new THREE.Vector2(0.5, 0.5) }));
  top.receiveShadow = true;
  g.add(top);
  // the fringe: tassels of warp along both short ends, lying on the sand at a slant
  const pos: number[] = [];
  for (const side of [-1, 1]) for (let z = -d / 2 + 0.01; z < d / 2; z += 0.012) {
    const len = 0.05 + r() * 0.03, lean = (r() - 0.5) * 0.03, x0 = side * w / 2;
    pos.push(x0, 0.006, z, x0 + side * len, 0.002, z + lean);
  }
  g.add(new THREE.LineSegments(new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)), new THREE.LineBasicMaterial({ color: "#d9d0bc" })));
  return g;
}

/** An open-air room's rugs where it lays them (room.ts Outdoor `rugs`), each from the room's seed. */
export function rugs(out: { rugs?: { at: [number, number]; yaw: number; w: number; d: number }[]; seed: number }): THREE.Group {
  const g = new THREE.Group();
  (out.rugs ?? []).forEach((rg, i) => { const m = rugMesh(rg.w, rg.d, out.seed + i * 7); m.position.set(rg.at[0], 0, rg.at[1]); m.rotation.y = rg.yaw; g.add(m); });
  return g;
}
