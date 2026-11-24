// A studio drum kit as a drummer sets it up, in metres, the drummer's throne at +z looking down -z (their right +x):
// a 22" kick on spurs with claws and a ported resonant head, a 14" snare on its basket stand with its wires and
// throw-off, 10" and 12" rack toms off the kick's mount, a 16" floor tom on three legs, and six cymbals of five kinds
// (hi-hats, two crashes, a ride, a splash, a china) on their own stands, each turned on a lathe the way bronze is: a
// bell, a bow and an edge with their own thickness, lathe grooves and hammer peens, and the house brand stamped on top
// (RUSTYBUNS, our own made-up cymbal works). Around it the gear a kit collects in a studio: clip mics on the toms and
// snare, a pencil mic over the hats, a kick mic in the port, a stick bag on the floor tom, a stick holder and a
// tambourine on the hat stand, a cowbell on the mount, gel on the snare, a drum key, a cymbal bag and a set list
// taped to the floor.
//
// Mobile first: everything that doesn't move on a hit is merged into one mesh per material, and the textures are
// painted once on small canvases (512 px for a cymbal's face, 256 for a head) and shared. `quality: "low"` (what a
// phone gets) paints them at half that and cuts the round segments, so a phone still sees the grooves and the stamp.
//
//   const kit = drumKit({ shell: "#b23a2e" });
//   scene.add(kit.group);                    // kit.pieces: what flashes and moves when each part is hit
//   kit.throne.position.set(0, 0, 0.8);     // the drummer's seat, placed by the caller
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { mulberry32 } from "@rustybuns/util";

/** What a drum track can play on the kit. */
export type DrumPart = "kick" | "snare" | "hi" | "mid" | "tom" | "hat" | "crash" | "crash2" | "ride" | "splash" | "china";
/** The cymbal kinds the kit has, each its own shape. */
export type CymbalKind = "hat" | "crash" | "ride" | "splash" | "china";
/** How a cymbal is finished: buffed bright, lathed traditional, or raw hand-hammered bronze. */
export type Finish = "brilliant" | "traditional" | "raw";

/** One drum or cymbal: what moves on a hit (a head flexes, a cymbal rocks) and its own copies of the materials that flash. */
export interface DrumPiece { part: DrumPart; obj: THREE.Object3D; flash: THREE.MeshStandardMaterial[]; cymbal: boolean }
export interface DrumKit {
  group: THREE.Group;
  pieces: DrumPiece[];
  /** The kick pedal's beater: turns about x from `rest` to `hit` (radians). */
  beater: { obj: THREE.Object3D; rest: number; hit: number };
  /** Where the drummer's feet go: the kick pedal's footboard (right foot) and the hi-hat's (left), each a point on its
   *  top where the ball of the foot presses, +z toward the heel. */
  pedals: { kick: THREE.Object3D; hat: THREE.Object3D };
  /** The drummer's throne, not yet in `group`: the caller puts it where the seat is. */
  throne: THREE.Group;
  /** Where each mic's cable leaves it, in the kit's frame (the caller runs the cables to its stage box). */
  mics: { name: string; at: THREE.Vector3 }[];
}

export interface DrumKitOptions {
  /** The shells' lacquer colour. */
  shell?: string;
  /** `low` paints the textures at half size and uses fewer segments. */
  quality?: "low" | "high";
  /** Materials the app's own kit gives (photographed metal, vinyl, rubber); plain ones otherwise. */
  look?: Partial<DrumLook>;
}

/** The materials the kit is made of, so an app can hand in its own photographed ones. */
export interface DrumLook { chrome: THREE.Material; steel: THREE.Material; rubber: THREE.Material; vinyl: THREE.Material; fabric: THREE.Material }

/** The house brand on every cymbal and the kick's front head. Ours, made up. */
export const BRAND = "RUSTYBUNS";

/** Each cymbal on the kit: kind, size (inches), finish, the name stamped under the brand. */
export const CYMBALS: { part: DrumPart; kind: CymbalKind; inches: number; finish: Finish; model: string }[] = [
  { part: "hat", kind: "hat", inches: 14, finish: "traditional", model: "14\" QUICK HATS" },
  { part: "crash", kind: "crash", inches: 16, finish: "brilliant", model: "16\" THIN CRASH" },
  { part: "crash2", kind: "crash", inches: 18, finish: "traditional", model: "18\" MEDIUM CRASH" },
  { part: "ride", kind: "ride", inches: 21, finish: "raw", model: "21\" DRY RIDE" },
  { part: "splash", kind: "splash", inches: 10, finish: "brilliant", model: "10\" SPLASH" },
  { part: "china", kind: "china", inches: 18, finish: "raw", model: "18\" CHINA" },
];

const IN = 0.0254;
const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const UP = v3(0, 1, 0);
const canPaint = () => typeof document !== "undefined";

// ---- the cymbal's shape -------------------------------------------------------------------------------------------

/** Each kind's proportions, against its radius: the bell's width and rise, the bow's rise, the china's flange, the
 *  bronze at the bell and at the edge (metres). */
const SHAPE: Record<CymbalKind, { bell: number; bellRise: number; bow: number; flange: number; thick: number; edge: number; cupped: number }> = {
  hat: { bell: 0.3, bellRise: 0.085, bow: 0.085, flange: 0, thick: 0.0032, edge: 0.0016, cupped: 0.7 },
  crash: { bell: 0.27, bellRise: 0.085, bow: 0.105, flange: 0, thick: 0.0024, edge: 0.001, cupped: 0.55 },
  ride: { bell: 0.31, bellRise: 0.09, bow: 0.1, flange: 0, thick: 0.0036, edge: 0.0018, cupped: 0.75 },
  splash: { bell: 0.28, bellRise: 0.08, bow: 0.09, flange: 0, thick: 0.0015, edge: 0.0007, cupped: 0.5 },
  china: { bell: 0.27, bellRise: 0.1, bow: 0.03, flange: 0.11, thick: 0.0022, edge: 0.0012, cupped: 0.3 },
};

/** The cymbal's cross-section, center hole out along the top and back along the bottom: a closed profile a lathe turns. */
export function cymbalProfile(kind: CymbalKind, r: number): THREE.Vector2[] {
  const s = SHAPE[kind], hole = 0.0065, rb = s.bell * r, rise = s.bow * r, bell = s.bellRise * r;
  const top = (x: number) => {
    if (x <= rb) {
      // the bell: a dome, flatter at its top for a china's squared-off bell
      const t = x / rb, dome = kind === "china" ? 1 - Math.pow(t, 6) : Math.pow(1 - t * t, 0.75);
      return rise + bell * dome;
    }
    const t = (x - rb) / (r - rb);
    let y = rise * Math.pow(1 - t, 1 + s.cupped); // the bow, falling to the edge
    if (s.flange) y += s.flange * r * Math.pow(Math.max(0, (t - 0.78) / 0.22), 2) - 0.012 * r * Math.sin(Math.min(1, t / 0.78) * Math.PI); // a china's upturned edge
    return y;
  };
  const thick = (x: number) => s.edge + (s.thick - s.edge) * Math.pow(1 - x / r, 1.4);
  const n = 18, xs: number[] = [];
  for (let i = 0; i <= n; i++) xs.push(hole + (r - hole) * Math.pow(i / n, 1.35)); // closer together in the bell, where it curves
  const pts = xs.map((x) => new THREE.Vector2(x, top(x)));
  pts.push(new THREE.Vector2(r, top(r) - thick(r) * 0.5)); // the edge, rounded a little
  for (let i = xs.length - 1; i >= 0; i--) pts.push(new THREE.Vector2(xs[i]!, top(xs[i]!) - thick(xs[i]!)));
  return pts.reverse(); // the lathe draws the outside when the profile runs bottom first
}

/** A cymbal of `kind` and radius `r` as geometry, its UVs laid flat from above (the face's painting is top-down). */
function cymbalGeometry(kind: CymbalKind, r: number, segments: number): THREE.BufferGeometry {
  const g = new THREE.LatheGeometry(cymbalProfile(kind, r), segments);
  const p = g.attributes.position!, uv = g.attributes.uv!;
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / (2 * r) + 0.5, 0.5 - p.getZ(i) / (2 * r));
  g.computeVertexNormals();
  return g;
}

// ---- painting ---------------------------------------------------------------------------------------------------

function canvas(n: number, draw: (g: CanvasRenderingContext2D) => void): HTMLCanvasElement | null {
  if (!canPaint()) return null;
  const c = document.createElement("canvas");
  c.width = c.height = n;
  const g = c.getContext("2d");
  if (!g) return null;
  draw(g);
  return c;
}
function texture(c: HTMLCanvasElement | null, srgb: boolean): THREE.CanvasTexture | null {
  if (!c) return null;
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Text along a circle about the canvas middle: `smile` runs along the bottom with its letters' tops toward the middle,
 *  as a stamp reads to the drummer; otherwise along the top. */
function arcText(g: CanvasRenderingContext2D, text: string, cx: number, cy: number, radius: number, font: string, spacing: number, smile: boolean) {
  g.font = font;
  g.textAlign = "center"; g.textBaseline = "middle";
  const widths = [...text].map((ch) => g.measureText(ch).width + spacing), total = widths.reduce((a, b) => a + b, 0) - spacing;
  let a = (smile ? Math.PI / 2 : -Math.PI / 2) + (smile ? 1 : -1) * (total / radius) / 2;
  [...text].forEach((ch, i) => {
    const w = widths[i]!, mid = a + (smile ? -1 : 1) * ((w - spacing) / 2) / radius;
    g.save();
    g.translate(cx + Math.cos(mid) * radius, cy + Math.sin(mid) * radius);
    g.rotate(mid + (smile ? -Math.PI / 2 : Math.PI / 2));
    g.fillText(ch, 0, 0);
    g.restore();
    a += (smile ? -1 : 1) * w / radius;
  });
}

const BRONZE: Record<Finish, { color: string; rough: number; metal: number }> = {
  brilliant: { color: "#e3be78", rough: 0.2, metal: 1 },
  traditional: { color: "#c99f5c", rough: 0.36, metal: 1 },
  raw: { color: "#8f6d3f", rough: 0.55, metal: 0.85 },
};

/** A cymbal's face from above: lathe grooves ring it (none on a raw one's bell, which is left as cast), hammer peens
 *  pock it, a raw one carries a patina, and the brand and model are stamped near the drummer's side. */
function cymbalFace(c: (typeof CYMBALS)[number], n: number): HTMLCanvasElement | null {
  const s = SHAPE[c.kind], seed = [...c.model].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 11);
  return canvas(n, (g) => {
    const rnd = mulberry32(seed), m = n / 2, f = BRONZE[c.finish];
    g.fillStyle = f.color; g.fillRect(0, 0, n, n);
    // tone bands: bronze isn't one colour across, the lathe leaves wider and narrower rings of shine
    for (let k = 0; k < 10; k++) {
      const r0 = (0.15 + rnd() * 0.85) * m;
      g.strokeStyle = `rgba(${rnd() < 0.5 ? "60,35,10" : "255,240,200"},${0.04 + rnd() * 0.06})`;
      g.lineWidth = 2 + rnd() * 10;
      g.beginPath(); g.arc(m, m, r0, 0, Math.PI * 2); g.stroke();
    }
    // lathe grooves, ring by ring out from the bell (the raw ones' bells untouched)
    const from = c.finish === "raw" ? s.bell * m : 4;
    for (let r0 = from; r0 < m; r0 += 1.6 + rnd() * 0.5) {
      g.strokeStyle = `rgba(${rnd() < 0.55 ? "50,30,8" : "255,236,190"},${0.07 + rnd() * 0.12})`;
      g.lineWidth = 0.7;
      g.beginPath(); g.arc(m, m, r0, 0, Math.PI * 2); g.stroke();
    }
    // a raw finish: the bronze dulled and blotched brown and a little green where hands and air have been at it
    if (c.finish === "raw") for (let k = 0; k < 70; k++) {
      const a = rnd() * Math.PI * 2, rr = Math.sqrt(rnd()) * m, x = m + Math.cos(a) * rr, y = m + Math.sin(a) * rr, w = 6 + rnd() * 26;
      const gr = g.createRadialGradient(x, y, 0, x, y, w);
      gr.addColorStop(0, rnd() < 0.2 ? "rgba(70,90,60,0.18)" : "rgba(40,24,10,0.18)"); gr.addColorStop(1, "rgba(40,24,10,0)");
      g.fillStyle = gr; g.fillRect(x - w, y - w, w * 2, w * 2);
    }
    // hammer peens: small round dents, dark in the middle and catching the light at their rim; wider across near the
    // bell as the hammer struck it in rows
    const peens = c.finish === "raw" ? 900 : c.finish === "traditional" ? 420 : 160;
    for (let k = 0; k < peens; k++) {
      const a = rnd() * Math.PI * 2, rr = (0.1 + Math.sqrt(rnd()) * 0.88) * m, x = m + Math.cos(a) * rr, y = m + Math.sin(a) * rr, w = (n / 512) * (2 + rnd() * 3.5);
      g.fillStyle = `rgba(40,22,6,${0.12 + rnd() * 0.18})`;
      g.beginPath(); g.ellipse(x, y, w, w * 0.75, a, 0, Math.PI * 2); g.fill();
      g.strokeStyle = `rgba(255,235,190,${0.1 + rnd() * 0.12})`; g.lineWidth = 0.8;
      g.beginPath(); g.ellipse(x + 0.5, y + 0.5, w, w * 0.75, a, 0.2, 2.2); g.stroke();
    }
    // the bell's top, buffed (or for a raw one, cast-dark) and the hole
    const bell = g.createRadialGradient(m, m, 0, m, m, s.bell * m);
    bell.addColorStop(0, c.finish === "raw" ? "rgba(45,28,12,0.45)" : "rgba(255,240,205,0.25)"); bell.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = bell; g.beginPath(); g.arc(m, m, s.bell * m, 0, Math.PI * 2); g.fill();
    // the stamp: the brand in a wide serif along an arc, the model under it in a narrow sans, and a little seal, inked black
    const ink = c.finish === "raw" ? "rgba(18,12,6,0.82)" : "rgba(16,12,8,0.88)", k = n / 512;
    g.fillStyle = ink;
    arcText(g, BRAND, m, m, m * 0.66, `700 ${Math.round(30 * k)}px "Times New Roman", Georgia, serif`, 4 * k, true);
    arcText(g, c.model, m, m, m * 0.56, `600 ${Math.round(14 * k)}px "Helvetica Neue", Arial, sans-serif`, 1.5 * k, true);
    arcText(g, "B20 BRONZE · HAND HAMMERED", m, m, m * 0.5, `500 ${Math.round(9 * k)}px "Helvetica Neue", Arial, sans-serif`, 1.2 * k, true);
    // the seal: a ring with a little cymbal on a stand inside, by the brand's start
    const sx = m + Math.cos(Math.PI / 2 + 0.62) * m * 0.66, sy = m + Math.sin(Math.PI / 2 + 0.62) * m * 0.66;
    g.strokeStyle = ink; g.lineWidth = 2 * k;
    g.beginPath(); g.arc(sx, sy, 13 * k, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.ellipse(sx, sy - 3 * k, 9 * k, 2.5 * k, 0, 0, Math.PI * 2); g.fill();
    g.fillRect(sx - 0.8 * k, sy - 3 * k, 1.6 * k, 11 * k);
    // the far side gets the brand's small mark too, upside down to the drummer as on a real one
    arcText(g, BRAND, m, m, m * 0.7, `700 ${Math.round(12 * k)}px "Times New Roman", Georgia, serif`, 2 * k, false);
  });
}

/** The grooves alone in grey, shared by every cymbal as its roughness and bump: rough in the grooves, smooth on the lands. */
function grooves(n: number): HTMLCanvasElement | null {
  return canvas(n, (g) => {
    const rnd = mulberry32(5), m = n / 2;
    g.fillStyle = "#c8c8c8"; g.fillRect(0, 0, n, n);
    for (let r0 = 3; r0 < m; r0 += 1.6 + rnd() * 0.5) {
      const v = Math.round(110 + rnd() * 140);
      g.strokeStyle = `rgb(${v},${v},${v})`; g.lineWidth = 0.9;
      g.beginPath(); g.arc(m, m, r0, 0, Math.PI * 2); g.stroke();
    }
    for (let k = 0; k < 500; k++) {
      const a = rnd() * Math.PI * 2, rr = Math.sqrt(rnd()) * m, w = (n / 512) * (2 + rnd() * 3);
      g.fillStyle = `rgba(255,255,255,${0.2 + rnd() * 0.2})`;
      g.beginPath(); g.arc(m + Math.cos(a) * rr, m + Math.sin(a) * rr, w, 0, Math.PI * 2); g.fill();
    }
  });
}

/** A coated head: white with a mottled coating, the collar darker where it turns over the edge, and grey where sticks
 *  have worn it (a patch toward the drummer, a little off middle), or a kick's beater patch. */
function coatedHead(n: number, wear: "stick" | "beater" | "none", seed: number): HTMLCanvasElement | null {
  return canvas(n, (g) => {
    const rnd = mulberry32(seed), m = n / 2;
    g.fillStyle = "#eeeade"; g.fillRect(0, 0, n, n);
    for (let k = 0; k < 2500; k++) { g.fillStyle = `rgba(${rnd() < 0.5 ? "120,110,90" : "255,255,250"},${0.05 + rnd() * 0.07})`; g.fillRect(rnd() * n, rnd() * n, 1 + rnd() * 2, 1 + rnd() * 2); }
    const collar = g.createRadialGradient(m, m, m * 0.9, m, m, m);
    collar.addColorStop(0, "rgba(90,80,60,0)"); collar.addColorStop(1, "rgba(90,80,60,0.35)");
    g.fillStyle = collar; g.fillRect(0, 0, n, n);
    if (wear === "stick") {
      const x = m * 1.02, y = m * 1.12, w = m * 0.42, gr = g.createRadialGradient(x, y, 0, x, y, w);
      gr.addColorStop(0, "rgba(110,100,85,0.38)"); gr.addColorStop(1, "rgba(110,100,85,0)");
      g.fillStyle = gr; g.fillRect(0, 0, n, n);
      for (let k = 0; k < 160; k++) {
        const a = rnd() * Math.PI * 2, rr = Math.sqrt(rnd()) * w * 0.8, px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
        g.fillStyle = `rgba(70,60,50,${0.15 + rnd() * 0.25})`;
        g.beginPath(); g.ellipse(px, py, 1.5 + rnd() * 2.5, 1 + rnd(), rnd() * Math.PI, 0, Math.PI * 2); g.fill();
      }
    }
    if (wear === "beater") {
      g.fillStyle = "rgba(40,38,36,0.85)"; g.beginPath(); g.arc(m, m * 0.85, m * 0.2, 0, Math.PI * 2); g.fill(); // an impact patch
      g.fillStyle = "rgba(90,80,70,0.5)"; g.beginPath(); g.arc(m, m * 0.85, m * 0.12, 0, Math.PI * 2); g.fill();
    }
  });
}

/** The kick's front head: black, the house brand in cream over the middle, a ring under it. */
function kickFront(n: number): HTMLCanvasElement | null {
  return canvas(n, (g) => {
    const m = n / 2, k = n / 256;
    g.fillStyle = "#141414"; g.fillRect(0, 0, n, n);
    g.strokeStyle = "#e9dfc6"; g.lineWidth = 3 * k;
    g.beginPath(); g.arc(m, m, m * 0.62, 0, Math.PI * 2); g.stroke();
    g.fillStyle = "#e9dfc6"; g.textAlign = "center"; g.textBaseline = "middle";
    g.font = `700 ${Math.round(30 * k)}px "Times New Roman", Georgia, serif`;
    g.fillText(BRAND, m, m - 4 * k);
    g.font = `600 ${Math.round(11 * k)}px "Helvetica Neue", Arial, sans-serif`;
    g.fillText("DRUM WORKS", m, m + 20 * k);
  });
}

/** Maple under lacquer: grain running round the shell, lighter and darker streaks, in grey for the lacquer to tint. */
function grain(n: number): HTMLCanvasElement | null {
  return canvas(n, (g) => {
    const rnd = mulberry32(17);
    g.fillStyle = "#d8d8d8"; g.fillRect(0, 0, n, n);
    for (let y = 0; y < n; y += 1 + rnd() * 3) {
      const v = Math.round(170 + rnd() * 85);
      g.strokeStyle = `rgba(${v},${v},${v},0.6)`; g.lineWidth = 0.6 + rnd() * 1.6;
      g.beginPath(); g.moveTo(0, y);
      for (let x = 0; x <= n; x += n / 8) g.lineTo(x, y + Math.sin(x * 0.03 + y) * 1.5);
      g.stroke();
    }
    // the lacquer's sheen catches a flame figure here and there
    for (let k = 0; k < 40; k++) { g.fillStyle = `rgba(255,255,255,${0.04 + rnd() * 0.06})`; g.fillRect(rnd() * n, 0, 2 + rnd() * 6, n); }
  });
}

/** A set list, handwritten-ish in marker on copier paper. */
function setList(n: number): HTMLCanvasElement | null {
  return canvas(n, (g) => {
    g.fillStyle = "#f3f1ea"; g.fillRect(0, 0, n, n);
    g.fillStyle = "#1b1b1b"; g.font = `700 ${Math.round(n / 11)}px "Marker Felt", "Comic Sans MS", sans-serif`; g.textBaseline = "top";
    ["1. WARM UP", "2. GROOVE IN G", "3. SLOW ONE", "4. THE FAST ONE", "5. JAM >>"].forEach((l, i) => g.fillText(l, n * 0.08, n * (0.08 + i * 0.17)));
  });
}

// ---- building ---------------------------------------------------------------------------------------------------

/** Meshes that don't move, kept to be merged into one per material at the end. */
class Bin {
  private by = new Map<THREE.Material, THREE.BufferGeometry[]>();
  add(geo: THREE.BufferGeometry, mat: THREE.Material, m: THREE.Matrix4) {
    const g = geo.clone().applyMatrix4(m);
    for (const k of Object.keys(g.attributes)) if (k !== "position" && k !== "normal" && k !== "uv") g.deleteAttribute(k);
    if (!g.index) g.setIndex([...Array(g.attributes.position!.count).keys()]);
    this.by.set(mat, [...(this.by.get(mat) ?? []), g]);
  }
  meshes(): THREE.Mesh[] {
    return [...this.by].flatMap(([m, gs]) => { const g = mergeGeometries(gs); return g ? [Object.assign(new THREE.Mesh(g, m), { castShadow: true, receiveShadow: true })] : []; });
  }
}

/** Gather every mesh under `root` that isn't in a moving piece into the bin, in `root`'s frame, and take it out. */
function settle(root: THREE.Object3D, bin: Bin) {
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert(), still: [THREE.Mesh, THREE.Material][] = [];
  const walk = (o: THREE.Object3D) => {
    if (o.userData.live) return;
    if (o instanceof THREE.Mesh && o.material instanceof THREE.Material) still.push([o, o.material]);
    for (const c of o.children) walk(c);
  };
  walk(root);
  for (const [o, mat] of still) { bin.add(o.geometry, mat, inv.clone().multiply(o.matrixWorld)); o.removeFromParent(); }
}

export function drumKit(opts: DrumKitOptions = {}): DrumKit {
  const high = opts.quality !== "low", seg = high ? 40 : 28, round = high ? 12 : 8, px = high ? 1 : 0.5;
  const group = new THREE.Group(); group.name = "drum-kit";
  const pieces: DrumPiece[] = [], mics: DrumKit["mics"] = [];
  const std = (color: string, p: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, ...p });
  const look: DrumLook = {
    chrome: std("#9a9ea3", { metalness: 1, roughness: 0.2 }),
    steel: std("#1c1d20", { metalness: 0.6, roughness: 0.45 }),
    rubber: std("#101112", { roughness: 0.9 }),
    vinyl: std("#121212", { roughness: 0.6 }),
    fabric: std("#1e1f22", { roughness: 1 }),
    ...opts.look,
  };
  const { chrome, steel, rubber } = look;
  const lugMetal = std("#e6e8ea", { metalness: 1, roughness: 0.18 });
  const felt = std("#4a4440", { roughness: 1 }), whiteFelt = std("#e8e2d4", { roughness: 1 });
  const stickWood = std("#d9b98a", { roughness: 0.6 });
  const black = std("#0d0d0e", { roughness: 0.5 }), micGrille = std("#9a9ea4", { metalness: 0.9, roughness: 0.35 });

  // what the shells are made of: maple grain under a tinted clear coat, raw birch inside
  const grainTex = texture(grain(256 * px), false);
  if (grainTex) { grainTex.wrapS = grainTex.wrapT = THREE.RepeatWrapping; grainTex.repeat.set(3, 1); }
  const shellMat = new THREE.MeshPhysicalMaterial({ color: opts.shell ?? "#b23a2e", map: grainTex, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.06 });
  const inside = std("#caa67a", { roughness: 0.85, side: THREE.BackSide });
  const clear = std("#3a3733", { roughness: 0.12, metalness: 0, envMapIntensity: 1.3 });

  const heads = new Map<string, THREE.MeshStandardMaterial>();
  const headMat = (wear: "stick" | "beater" | "none", seed: number) => {
    const id = `${wear}:${seed}`;
    let m = heads.get(id);
    if (!m) heads.set(id, (m = std("#ffffff", { map: texture(coatedHead(256 * px, wear, seed), true), roughness: 0.78 })));
    if (!m.map) m.color.set("#e9e5d9");
    return m;
  };

  const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material, to: THREE.Object3D, x = 0, y = 0, z = 0) => {
    const o = new THREE.Mesh(geo, mat); o.position.set(x, y, z); o.castShadow = true; o.receiveShadow = true; to.add(o); return o;
  };
  const tube = (r: number, a: THREE.Vector3, b: THREE.Vector3, mat: THREE.Material, to: THREE.Object3D = group, sides = round) => {
    const o = mesh(new THREE.CylinderGeometry(r, r, a.distanceTo(b), sides), mat, to);
    o.position.copy(a).add(b).multiplyScalar(0.5);
    o.quaternion.setFromUnitVectors(UP, b.clone().sub(a).normalize());
    return o;
  };

  /** A drum: shell, top (batter) and bottom heads, flanged hoops, lugs and tension rods round it, laid along its own y
   *  (the batter up). Returns the drum's group and its batter head (which flexes on a hit). */
  const drum = (r: number, depth: number, lugs: number, wear: "stick" | "beater", seed: number, double = true) => {
    const d = new THREE.Group();
    mesh(new THREE.CylinderGeometry(r, r, depth, seg, 1, true), shellMat, d);
    mesh(new THREE.CylinderGeometry(r - 0.006, r - 0.006, depth, seg, 1, true), inside, d);
    const batter = mesh(new THREE.CircleGeometry(r * 0.985, seg).rotateX(-Math.PI / 2), headMat(wear, seed).clone(), d, 0, depth / 2 + 0.006, 0);
    mesh(new THREE.CircleGeometry(r * 0.985, seg).rotateX(Math.PI / 2), clear, d, 0, -depth / 2 - 0.006, 0);
    for (const y of [depth / 2 + 0.006, -depth / 2 - 0.006]) {
      // a triple-flanged hoop: the rolled top edge and the band under it
      mesh(new THREE.TorusGeometry(r + 0.006, 0.0045, 6, seg).rotateX(Math.PI / 2), chrome, d, 0, y + Math.sign(y) * 0.008, 0);
      mesh(new THREE.CylinderGeometry(r + 0.008, r + 0.008, 0.018, seg, 1, true), chrome, d, 0, y, 0);
    }
    const lugGeo = new THREE.CapsuleGeometry(0.0075, double ? Math.min(0.05, depth * 0.35) : 0.02, 3, 8).scale(1, 1, 0.75);
    for (let k = 0; k < lugs; k++) {
      const a = (k / lugs) * Math.PI * 2 + Math.PI / lugs, c = Math.cos(a), s = Math.sin(a);
      const lug = mesh(lugGeo, lugMetal, d, c * (r + 0.008), 0, s * (r + 0.008));
      lug.rotation.y = -a;
      for (const side of [1, -1]) {
        if (!double && side < 0) continue;
        const top = depth / 2 + 0.016, rodR = r + 0.014;
        tube(0.0022, v3(c * rodR, side * top, s * rodR), v3(c * rodR, side * (double ? 0.03 : 0.012), s * rodR), chrome, d, 6);
        mesh(new THREE.BoxGeometry(0.007, 0.006, 0.007), chrome, d, c * rodR, side * (top + 0.003), s * rodR); // the rod's square head
      }
    }
    return { d, batter };
  };
  /** Register a moving piece: `obj` moves, `mats` (own copies) flash. */
  const piece = (part: DrumPart, obj: THREE.Object3D, mats: THREE.MeshStandardMaterial[], cymbal = false) => {
    obj.userData.live = true;
    pieces.push({ part, obj, flash: mats, cymbal });
  };
  /** A clip-on dynamic mic on a drum's hoop at angle `a` (drum frame), its nose at the head, and where its cable leaves. */
  const clipMic = (name: string, d: THREE.Group, r: number, top: number, a: number) => {
    group.updateMatrixWorld(true);
    const m = new THREE.Group(), out = v3(Math.cos(a) * (r + 0.03), top + 0.05, Math.sin(a) * (r + 0.03));
    m.position.copy(out); d.add(m);
    m.lookAt(d.localToWorld(v3(Math.cos(a) * r * 0.55, top, Math.sin(a) * r * 0.55)));
    mesh(new THREE.CylinderGeometry(0.016, 0.012, 0.09, round).rotateX(Math.PI / 2), black, m, 0, 0, -0.02);
    mesh(new THREE.SphereGeometry(0.019, round, 8), micGrille, m, 0, 0, 0.03);
    mesh(new THREE.BoxGeometry(0.012, 0.05, 0.012), steel, m, 0, -0.03, -0.02); // the clamp down to the hoop
    group.updateMatrixWorld(true);
    mics.push({ name, at: group.worldToLocal(m.localToWorld(v3(0, 0, -0.07))) });
  };

  // ---- the kick ----
  const kickR = 11 * IN, kickD = 16 * IN, kickZ = -0.2;
  const kick = new THREE.Group(); kick.position.set(0, kickR + 0.032, kickZ); group.add(kick);
  const kickShell = shellMat.clone();
  mesh(new THREE.CylinderGeometry(kickR, kickR, kickD, seg, 1, true).rotateX(Math.PI / 2), kickShell, kick);
  mesh(new THREE.CylinderGeometry(kickR - 0.007, kickR - 0.007, kickD, seg, 1, true).rotateX(Math.PI / 2), inside, kick);
  const kickHead = (map: THREE.Texture | null) => std(map ? "#ffffff" : "#151515", { map, roughness: 0.55 });
  const kickBatter = mesh(new THREE.CircleGeometry(kickR * 0.985, seg), headMat("beater", 3).clone(), kick, 0, 0, kickD / 2 + 0.006);
  // the front head, with its port hole off-centre, the brand on it, and a ring round the port
  const front = new THREE.Shape().absarc(0, 0, kickR * 0.985, 0, Math.PI * 2, false);
  const port = { x: 0.12, y: -0.07, r: 0.05 };
  front.holes.push(new THREE.Path().absarc(port.x, port.y, port.r, 0, Math.PI * 2, true));
  const frontGeo = new THREE.ShapeGeometry(front, seg);
  { const p = frontGeo.attributes.position!, uv = frontGeo.attributes.uv!; for (let i = 0; i < p.count; i++) uv.setXY(i, 0.5 + p.getX(i) / (2 * kickR), p.getY(i) / (2 * kickR) + 0.5); }
  frontGeo.rotateY(Math.PI);
  mesh(frontGeo, kickHead(texture(kickFront(256 * px), true)), kick, 0, 0, -kickD / 2 - 0.006);
  mesh(new THREE.TorusGeometry(port.r, 0.004, 6, 24), black, kick, -port.x, port.y, -kickD / 2 - 0.008);
  // wooden hoops in the shell's lacquer with a chrome inlay, claws and T-rods round them
  for (const z of [kickD / 2 + 0.008, -kickD / 2 - 0.008]) {
    mesh(new THREE.CylinderGeometry(kickR + 0.012, kickR + 0.012, 0.03, seg, 1, true).rotateX(Math.PI / 2), shellMat, kick, 0, 0, z);
    mesh(new THREE.TorusGeometry(kickR + 0.013, 0.0025, 4, seg), chrome, kick, 0, 0, z);
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2 + 0.31, c = Math.cos(a), s = Math.sin(a), rr = kickR + 0.022, zz = z - Math.sign(z) * 0.035;
      mesh(new THREE.BoxGeometry(0.01, 0.018, 0.03), chrome, kick, c * rr, s * rr, z - Math.sign(z) * 0.008).rotation.z = a; // the claw
      tube(0.0025, v3(c * rr, s * rr, z - Math.sign(z) * 0.02), v3(c * rr, s * rr, zz - Math.sign(z) * 0.03), chrome, kick, 6);
      tube(0.003, v3(c * rr - s * 0.012, s * rr + c * 0.012, zz), v3(c * rr + s * 0.012, s * rr - c * 0.012, zz), chrome, kick, 6); // the T-handle
      mesh(new THREE.CapsuleGeometry(0.008, 0.04, 3, 8), lugMetal, kick, c * (kickR + 0.008), s * (kickR + 0.008), 0).rotation.x = Math.PI / 2;
    }
  }
  // spurs out the front sides, rubber tipped, and the tom mount's block on top
  for (const sx of [-1, 1]) {
    const from = v3(sx * kickR * 0.95, 0.2, kickZ - 0.1), to = v3(sx * (kickR + 0.12), 0.012, kickZ - 0.06);
    mesh(new THREE.BoxGeometry(0.02, 0.04, 0.03), chrome, group, from.x, from.y, from.z);
    tube(0.006, from, to, chrome);
    mesh(new THREE.CylinderGeometry(0.009, 0.011, 0.024, round), rubber, group, to.x, 0.012, to.z);
  }
  const mountY = kickR * 2 + 0.05;
  mesh(new THREE.BoxGeometry(0.06, 0.035, 0.09), chrome, group, 0, mountY, kickZ);
  piece("kick", kickBatter, [kickShell, kickBatter.material as THREE.MeshStandardMaterial]);

  // the pedal: a hinged footboard with a heel plate, two posts, a cam and chain, the beater shaft and its felt
  const pedalZ = kickZ + kickD / 2 + 0.006;
  mesh(new THREE.BoxGeometry(0.11, 0.008, 0.3), steel, group, 0.06, 0.005, pedalZ + 0.17); // base plate
  const board = mesh(new THREE.BoxGeometry(0.075, 0.012, 0.22), chrome, group, 0.06, 0.05, pedalZ + 0.16); board.rotation.x = -0.2;
  mesh(new THREE.BoxGeometry(0.075, 0.016, 0.06), steel, group, 0.06, 0.015, pedalZ + 0.29);
  const kickPedal = new THREE.Object3D(); kickPedal.position.set(0.06, 0.066, pedalZ + 0.12); kickPedal.rotation.x = -0.2; group.add(kickPedal);
  for (const sx of [-1, 1]) tube(0.006, v3(0.06 + sx * 0.05, 0.01, pedalZ + 0.05), v3(0.06 + sx * 0.05, 0.13, pedalZ + 0.05), steel);
  tube(0.005, v3(0.01, 0.13, pedalZ + 0.05), v3(0.11, 0.13, pedalZ + 0.05), chrome);
  mesh(new THREE.TorusGeometry(0.018, 0.004, 6, 16).rotateY(Math.PI / 2), steel, group, 0.06, 0.13, pedalZ + 0.05);
  tube(0.002, v3(0.06, 0.115, pedalZ + 0.065), v3(0.06, 0.06, pedalZ + 0.07), steel, group, 4); // chain
  mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.06, 8), chrome, group, 0.115, 0.09, pedalZ + 0.05); // spring
  const beater = new THREE.Group(); beater.position.set(0.06, 0.13, pedalZ + 0.05); group.add(beater);
  mesh(new THREE.CylinderGeometry(0.0035, 0.0035, 0.2, 8), chrome, beater, 0, 0.1, 0);
  const ball = mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.045, round).rotateZ(Math.PI / 2), whiteFelt.clone(), beater, 0, 0.2, 0);
  beater.userData.live = true;
  pieces.find((p) => p.part === "kick")!.flash.push(ball.material as THREE.MeshStandardMaterial);

  // ---- the snare, on its basket stand ----
  const snR = 7 * IN, snD = 5.5 * IN, snAt = v3(-0.28, 0.6, 0.28);
  const snare = drum(snR, snD, 10, "stick", 7, false);
  snare.d.position.copy(snAt); snare.d.rotation.x = 0.12; snare.d.rotation.z = -0.04; group.add(snare.d);
  // the wires under the bottom head, the throw-off and its butt end
  for (let k = 0; k < 16; k++) mesh(new THREE.BoxGeometry(0.0012, 0.0012, snR * 1.5), chrome, snare.d, (k - 7.5) * 0.004, -snD / 2 - 0.009, 0);
  for (const z of [-snR * 0.76, snR * 0.76]) mesh(new THREE.BoxGeometry(0.07, 0.002, 0.012), chrome, snare.d, 0, -snD / 2 - 0.009, z);
  mesh(new THREE.BoxGeometry(0.022, 0.05, 0.03), chrome, snare.d, 0, 0, -snR - 0.016);
  mesh(new THREE.BoxGeometry(0.008, 0.04, 0.012), black, snare.d, 0, 0.02, -snR - 0.033).rotation.x = 0.4; // the lever
  mesh(new THREE.BoxGeometry(0.018, 0.035, 0.022), chrome, snare.d, 0, 0, snR + 0.013);
  // two squares of gel by the rim, damping its ring
  const gel = std("#4aa8d8", { roughness: 0.2, transparent: true, opacity: 0.85 });
  for (const [x, z] of [[-0.11, -0.08], [-0.13, -0.03]] as const) mesh(new THREE.BoxGeometry(0.03, 0.004, 0.03), gel, snare.batter, x, 0.002, z);
  piece("snare", snare.batter, [snare.batter.material as THREE.MeshStandardMaterial]);
  clipMic("snare", snare.d, snR, snD / 2, Math.PI * 0.78);
  {
    const base = v3(snAt.x, 0, snAt.z), basket = snAt.y - snD / 2 - 0.05;
    tube(0.011, base.clone().setY(0.25), base.clone().setY(basket), chrome);
    tube(0.014, base.clone().setY(0.05), base.clone().setY(0.3), chrome);
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + 0.5, foot = v3(base.x + Math.cos(a) * 0.24, 0.012, base.z + Math.sin(a) * 0.24);
      tube(0.007, base.clone().setY(0.26), foot, chrome);
      tube(0.004, base.clone().setY(0.13), base.clone().lerp(foot, 0.55).setY(0.13), chrome);
      mesh(new THREE.CylinderGeometry(0.01, 0.012, 0.024, round), rubber, group, foot.x, 0.012, foot.z);
      // the basket's arm up to the bottom hoop, a rubber cup on its end
      const a2 = a + 0.3, hold = v3(snAt.x + Math.cos(a2) * (snR + 0.004), snAt.y - snD / 2 - 0.01 - Math.sin(a2) * 0.02, snAt.z + Math.sin(a2) * (snR + 0.004));
      tube(0.004, base.clone().setY(basket), hold, chrome);
      mesh(new THREE.BoxGeometry(0.014, 0.022, 0.014), rubber, group, hold.x, hold.y + 0.01, hold.z);
    }
  }

  // ---- rack toms off the kick's mount, and the floor tom on its legs ----
  const toms: [DrumPart, number, number, THREE.Vector3, number, number][] = [
    ["hi", 5 * IN, 7 * IN, v3(-0.165, 0.86, -0.07), 0.36, 0.1],
    ["mid", 6 * IN, 8 * IN, v3(0.19, 0.86, -0.07), 0.36, -0.12],
  ];
  for (const [part, r, depth, at, tip, roll] of toms) {
    const t = drum(r, depth, 6, "stick", part === "hi" ? 11 : 13);
    t.d.position.copy(at); t.d.rotation.set(tip, 0, roll); group.add(t.d);
    piece(part, t.batter, [t.batter.material as THREE.MeshStandardMaterial]);
    clipMic(part, t.d, r, depth / 2, -Math.PI / 2 + (part === "hi" ? -0.5 : 0.5));
    // the suspension mount on the shell's back and the L-arm down to the kick's block
    group.updateMatrixWorld(true);
    const back = t.d.localToWorld(v3(0, 0, -r - 0.02));
    group.worldToLocal(back);
    mesh(new THREE.BoxGeometry(0.04, 0.05, 0.025), chrome, t.d, 0, 0, -r - 0.014);
    const elbow = v3(back.x * 0.5, mountY + 0.08, kickZ - 0.02);
    tube(0.0085, v3(0, mountY + 0.015, kickZ), elbow, chrome);
    tube(0.0085, elbow, back, chrome);
    mesh(new THREE.SphereGeometry(0.014, round, 8), chrome, group, elbow.x, elbow.y, elbow.z);
  }
  const ftR = 8 * IN, ftD = 14 * IN, ftAt = v3(0.52, 0.43, 0.24);
  const ft = drum(ftR, ftD, 8, "stick", 19);
  ft.d.position.copy(ftAt); ft.d.rotation.set(0.06, 0, -0.04); group.add(ft.d);
  piece("tom", ft.batter, [ft.batter.material as THREE.MeshStandardMaterial]);
  clipMic("tom", ft.d, ftR, ftD / 2, -Math.PI * 0.4);
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + 0.9, c = Math.cos(a), s = Math.sin(a);
    const top = v3(ftAt.x + c * (ftR + 0.03), ftAt.y + 0.07, ftAt.z + s * (ftR + 0.03)), foot = v3(ftAt.x + c * (ftR + 0.07), 0.015, ftAt.z + s * (ftR + 0.07));
    mesh(new THREE.BoxGeometry(0.03, 0.04, 0.03), chrome, group, top.x - c * 0.012, top.y - 0.02, top.z - s * 0.012);
    tube(0.0055, top, foot, chrome);
    mesh(new THREE.CylinderGeometry(0.011, 0.013, 0.03, round), rubber, group, foot.x, 0.015, foot.z);
  }
  // a drum key left on the floor tom's hoop, and the stick bag hung off its side with sticks in it
  {
    group.updateMatrixWorld(true);
    const keyAt = ft.d.localToWorld(v3(-ftR * 0.7, ftD / 2 + 0.024, ftR * 0.7)); group.worldToLocal(keyAt);
    mesh(new THREE.BoxGeometry(0.03, 0.004, 0.008), chrome, group, keyAt.x, keyAt.y, keyAt.z).rotation.y = 0.6;
    const bag = new THREE.Group(); bag.position.copy(ftAt).add(v3(ftR + 0.04, ftD / 2 - 0.25, 0.02)); bag.rotation.y = Math.PI / 2; group.add(bag);
    mesh(new THREE.BoxGeometry(0.26, 0.42, 0.025), look.fabric, bag);
    mesh(new THREE.BoxGeometry(0.27, 0.012, 0.028), std("#7a6a4a", { roughness: 0.9 }), bag, 0, 0.2, 0); // the binding
    for (let k = 0; k < 6; k++) tube(0.0068, v3(-0.09 + k * 0.035, 0.1, 0.006), v3(-0.09 + k * 0.035 + (k % 2) * 0.01, 0.31 + (k % 3) * 0.02, 0.006), stickWood, bag, 8);
    for (const x of [-0.08, 0.08]) tube(0.0025, v3(x, 0.21, 0), v3(x, 0.26, -0.03), chrome, bag, 4); // the hooks over the hoop
  }

  // ---- cymbals and their stands ----
  const groovesTex = texture(grooves(512 * px), false);
  /** A cymbal stand from `base` on the floor: tripod and braces, two tubes with a clamp and memory lock, and either a
   *  tilter straight up at `top` or a boom arm from `boomAt` out to it, with a counterweight on its back end. */
  const stand = (base: THREE.Vector3, top: THREE.Vector3, boomAt?: number) => {
    const head = boomAt ? base.clone().setY(boomAt) : top.clone().setY(top.y - 0.05);
    const mid = base.clone().setY(Math.min(head.y - 0.1, 0.62));
    tube(0.0125, base.clone().setY(0.06), mid, chrome);
    tube(0.0095, mid, head, chrome);
    mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.045, round), steel, group, mid.x, mid.y, mid.z);
    mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.012, round), black, group, mid.x, mid.y - 0.04, mid.z); // memory lock
    mesh(new THREE.BoxGeometry(0.035, 0.008, 0.008), steel, group, mid.x + 0.025, mid.y, mid.z); // wing bolt
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + base.x * 3, foot = v3(base.x + Math.cos(a) * 0.3, 0.012, base.z + Math.sin(a) * 0.3);
      tube(0.008, base.clone().setY(0.3), foot, chrome);
      tube(0.0045, base.clone().setY(0.16), base.clone().lerp(foot, 0.5).setY(0.15), chrome);
      mesh(new THREE.CylinderGeometry(0.011, 0.013, 0.024, round), rubber, group, foot.x, 0.012, foot.z);
    }
    if (boomAt) {
      const dir = top.clone().sub(head), back = head.clone().addScaledVector(dir.clone().normalize(), -0.14), tip = top.clone().setY(top.y - 0.04);
      mesh(new THREE.SphereGeometry(0.02, round, 8), steel, group, head.x, head.y, head.z);
      tube(0.008, back, tip, chrome);
      tube(0.019, back, back.clone().lerp(head, 0.35), steel); // counterweight
      tube(0.006, tip, top.clone().setY(top.y - 0.012), chrome);
    } else mesh(new THREE.CylinderGeometry(0.012, 0.009, 0.035, round), steel, group, top.x, top.y - 0.03, top.z); // the tilter
    mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.012, round), felt, group, top.x, top.y - 0.012, top.z); // bottom felt
  };
  /** A cymbal of the table's row, its centre hole at `at` tipped toward the drummer by `tip`, and its felt, sleeve and
   *  wing nut on top. Those stay on the rod while the cymbal rocks under them (unless `bare`: the bottom hat has none). */
  const cymbal = (c: (typeof CYMBALS)[number], at: THREE.Vector3, tip: number, lean: number, flip = false, bare = false) => {
    const r = (c.inches / 2) * IN, f = BRONZE[c.finish];
    const face = texture(cymbalFace(c, 512 * px), true);
    const mat = std(face ? "#ffffff" : f.color, { map: face, roughness: f.rough, metalness: f.metal, roughnessMap: groovesTex, bumpMap: groovesTex, bumpScale: 0.4, envMapIntensity: 1.25 });
    const g = new THREE.Group(); g.position.copy(at); g.rotation.set(tip, 0, lean); group.add(g);
    const cy = mesh(cymbalGeometry(c.kind, r, high ? 48 : 32), mat, g);
    if (flip) { cy.rotation.z = Math.PI; cy.position.y = 0.004; } // a china hung upside down
    const s = SHAPE[c.kind], peak = flip ? 0.012 : s.bow * r + s.bellRise * r;
    if (!bare) {
      const fix = new THREE.Group(); fix.position.copy(at); fix.rotation.copy(g.rotation); group.add(fix);
      mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.012, round), felt, fix, 0, peak + 0.006, 0);
      mesh(new THREE.CylinderGeometry(0.0045, 0.0045, 0.05, 6), chrome, fix, 0, peak - 0.01, 0);
      const nut = mesh(new THREE.BoxGeometry(0.04, 0.012, 0.006), steel, fix, 0, peak + 0.02, 0); nut.rotation.y = 0.5;
    }
    return { g, mat, r };
  };
  const row = (part: DrumPart) => CYMBALS.find((c) => c.part === part)!;

  const hatPedal = new THREE.Object3D();
  // the hi-hats: two cymbals on a stand with its pedal toward the drummer's left foot, the clutch on the top one
  {
    const at = v3(-0.6, 0.95, 0.2), base = at.clone().setY(0);
    const top = cymbal(row("hat"), at.clone().setY(at.y + 0.016), 0.04, 0.02);
    const bottom = cymbal(row("hat"), at, 0.04, 0.02, false, true);
    bottom.g.userData.live = true;
    top.g.add(bottom.g); bottom.g.position.set(0, -0.016, 0); bottom.g.rotation.set(0, 0, 0);
    bottom.g.scale.set(1, -1, 1); // the bottom hat, bell down
    mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.035, round), steel, group, at.x, at.y + 0.06, at.z); // the clutch
    piece("hat", top.g, [top.mat, bottom.mat], true);
    tube(0.0045, base.clone().setY(0.1), at.clone().setY(at.y + 0.04), chrome); // pull rod
    tube(0.0125, base.clone().setY(0.08), at.clone().setY(at.y - 0.06), chrome);
    mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.045, round), steel, group, base.x, 0.62, base.z);
    for (const a of [-Math.PI / 2, -Math.PI / 2 + 2.1, -Math.PI / 2 - 2.1]) {
      const foot = v3(base.x + Math.cos(a) * 0.27, 0.012, base.z + Math.sin(a) * 0.27);
      tube(0.008, base.clone().setY(0.32), foot, chrome);
      mesh(new THREE.CylinderGeometry(0.011, 0.013, 0.024, round), rubber, group, foot.x, 0.012, foot.z);
    }
    mesh(new THREE.BoxGeometry(0.08, 0.01, 0.3), chrome, group, base.x, 0.03, base.z + 0.17).rotation.x = -0.12; // footboard
    hatPedal.position.set(base.x, 0.04, base.z + 0.13); hatPedal.rotation.x = -0.12; group.add(hatPedal);
    tube(0.0035, base.clone().setY(0.04), v3(base.x, 0.05, base.z + 0.1), steel, group, 6);
    // a pencil mic over the hats on a little arm, a stick holder and a tambourine clamped to the stand
    const arm0 = base.clone().setY(0.78), arm1 = v3(base.x - 0.2, 1.12, base.z - 0.05);
    tube(0.006, arm0, arm1, steel);
    tube(0.0095, arm1, v3(base.x - 0.08, 1.04, base.z - 0.08), std("#b9bdc2", { metalness: 0.9, roughness: 0.3 }));
    mics.push({ name: "hat", at: arm1.clone() });
    const cup = v3(base.x + 0.06, 0.7, base.z - 0.05);
    mesh(new THREE.CylinderGeometry(0.03, 0.026, 0.18, round, 1, true), black, group, cup.x, cup.y, cup.z);
    for (let k = 0; k < 4; k++) tube(0.0068, v3(cup.x - 0.012 + k * 0.008, cup.y - 0.06, cup.z + (k % 2) * 0.01 - 0.005), v3(cup.x - 0.02 + k * 0.014, cup.y + 0.26, cup.z + (k % 2) * 0.02), stickWood, group, 8);
    const tam = new THREE.Group(); tam.position.set(base.x - 0.05, 0.5, base.z + 0.06); tam.rotation.set(Math.PI / 2 - 0.3, 0, 0.2); group.add(tam);
    mesh(new THREE.TorusGeometry(0.09, 0.012, 6, 24), std("#1c1c1e", { roughness: 0.5 }), tam);
    for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.004, 10).rotateX(Math.PI / 2), lugMetal, tam, Math.cos(a) * 0.09, Math.sin(a) * 0.09, 0); }
  }
  // the rest, each on its own stand (booms where they reach over the drums)
  const placed: [DrumPart, THREE.Vector3, number, number, THREE.Vector3, number | undefined, boolean][] = [
    ["crash", v3(-0.5, 1.27, -0.34), 0.34, 0.12, v3(-0.82, 0, -0.1), 0.98, false],
    ["splash", v3(-0.02, 1.24, -0.44), 0.38, 0, v3(-0.25, 0, -0.75), 0.92, false],
    ["crash2", v3(0.42, 1.36, -0.42), 0.3, -0.1, v3(0.62, 0, -0.78), 1.05, false],
    ["ride", v3(0.68, 1.04, 0.0), 0.2, -0.12, v3(0.98, 0, 0.2), 0.84, false],
    ["china", v3(0.88, 1.33, -0.28), 0.22, -0.18, v3(1.05, 0, -0.6), 1.02, true],
  ];
  for (const [part, at, tip, lean, base, boom, flip] of placed) {
    const c = cymbal(row(part), at, tip, lean, flip);
    piece(part, c.g, [c.mat], true);
    stand(base, at, boom);
  }

  // a cowbell clamped to the tom mount, its beater side to the drummer
  {
    const bell = mesh(new THREE.CylinderGeometry(0.03, 0.045, 0.12, 4, 1, true).rotateY(Math.PI / 4).scale(1, 1, 0.6), std("#141414", { metalness: 0.6, roughness: 0.4, side: THREE.DoubleSide }), group, 0.03, mountY + 0.1, kickZ - 0.1);
    bell.rotation.x = Math.PI / 2 + 0.5;
    tube(0.006, v3(0, mountY + 0.02, kickZ), v3(0.03, mountY + 0.08, kickZ - 0.07), chrome);
  }
  // the kick's mic, an egg-shaped dynamic on a short boom, looking in through the port
  {
    const at = v3(-port.x, kickR + 0.032 + port.y, kickZ - kickD / 2 - 0.09), base = v3(at.x - 0.05, 0, at.z - 0.22);
    tube(0.009, base.clone().setY(0.02), base.clone().setY(0.2), steel);
    tube(0.006, base.clone().setY(0.2), at.clone().add(v3(0, 0, -0.06)), steel);
    const egg = mesh(new THREE.SphereGeometry(0.035, round, 10).scale(1, 1, 1.5), black, group, at.x, at.y, at.z);
    egg.lookAt(v3(at.x, at.y, at.z + 1));
    mesh(new THREE.CircleGeometry(0.026, round), micGrille, group, at.x, at.y, at.z + 0.052);
    for (let k = 0; k < 3; k++) { const a = (k / 3) * Math.PI * 2; tube(0.006, base.clone().setY(0.06), v3(base.x + Math.cos(a) * 0.14, 0.01, base.z + Math.sin(a) * 0.14), steel); }
    mics.push({ name: "kick", at: at.clone().add(v3(0, 0, -0.07)) });
  }
  // a cymbal bag on the floor behind the hats, and a set list taped down by the hat pedal
  mesh(new THREE.CylinderGeometry(0.27, 0.27, 0.07, round * 2), look.fabric, group, -1.02, 0.037, -0.78).rotation.z = 0.01;
  mesh(new THREE.TorusGeometry(0.27, 0.006, 4, round * 2).rotateX(Math.PI / 2), std("#3b3b3d", { roughness: 0.7 }), group, -1.02, 0.074, -0.78);
  {
    const paper = mesh(new THREE.PlaneGeometry(0.21, 0.297).rotateX(-Math.PI / 2), std("#ffffff", { map: texture(setList(256 * px), true), roughness: 0.9 }), group, -0.38, 0.003, 0.62);
    paper.rotation.y = 0.35;
    const tape = std("#cfc9b4", { roughness: 0.8, transparent: true, opacity: 0.8 });
    for (const [x, z] of [[-0.1, -0.14], [0.1, 0.14]] as const) mesh(new THREE.PlaneGeometry(0.06, 0.02).rotateX(-Math.PI / 2), tape, paper, x, 0.001, z);
  }

  // merge everything that stays still, per material: a handful of draw calls for the whole kit
  const bin = new Bin();
  settle(group, bin);
  for (const m of bin.meshes()) group.add(m);

  return { group, pieces, beater: { obj: beater, rest: 0.42, hit: -0.36 }, pedals: { kick: kickPedal, hat: hatPedal }, throne: throne(look, round), mics };
}

/** A drum throne: a thick round seat in vinyl with piping, a threaded spindle, and a double-braced tripod. */
export function throne(look: Pick<DrumLook, "vinyl" | "chrome" | "rubber">, round = 12): THREE.Group {
  const g = new THREE.Group(); g.name = "throne";
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; g.add(o); return o; };
  add(new THREE.CylinderGeometry(0.17, 0.165, 0.085, round * 3), look.vinyl, 0, 0.457, 0);
  add(new THREE.TorusGeometry(0.168, 0.006, 4, round * 3).rotateX(Math.PI / 2), look.vinyl, 0, 0.5, 0);
  add(new THREE.TorusGeometry(0.166, 0.006, 4, round * 3).rotateX(Math.PI / 2), look.vinyl, 0, 0.415, 0);
  add(new THREE.CylinderGeometry(0.1, 0.1, 0.02, round * 2), look.chrome, 0, 0.405, 0);
  add(new THREE.CylinderGeometry(0.014, 0.014, 0.14, round), look.chrome, 0, 0.33, 0);
  add(new THREE.CylinderGeometry(0.02, 0.02, 0.18, round), look.chrome, 0, 0.19, 0);
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + 0.5, foot = new THREE.Vector3(Math.cos(a) * 0.3, 0.012, Math.sin(a) * 0.3);
    for (const [from, to, r] of [[new THREE.Vector3(0, 0.28, 0), foot, 0.009], [new THREE.Vector3(0, 0.12, 0), foot.clone().multiplyScalar(0.55).setY(0.11), 0.005]] as const) {
      const o = add(new THREE.CylinderGeometry(r, r, from.distanceTo(to), 8), look.chrome, 0, 0, 0);
      o.position.copy(from).add(to).multiplyScalar(0.5);
      o.quaternion.setFromUnitVectors(UP, to.clone().sub(from).normalize());
    }
    add(new THREE.CylinderGeometry(0.012, 0.014, 0.024, 8), look.rubber, foot.x, 0.012, foot.z);
  }
  return g;
}
