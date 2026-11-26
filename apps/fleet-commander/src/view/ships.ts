// The hulls with a drawing sheet (`sheets.ts`), built piece by piece from it: seeded three.js, no files. Each piece is
// its own group in the hull's frame (metres), so a piece can be looked at alone or pulled apart (`ships.html`), and
// `shipModel` puts them together at the game's scale with a cheap far level for the Theater's top-down board.
// Each piece is baked to one mesh per material, so a whole destroyer is a couple of dozen draw calls.
import * as THREE from "three";
import { clamp, mulberry32 } from "@rustybuns/util";
import { BASTION, LANCE, SHEETS, type GirderSheet, type Plan, type SheetKind, type WedgeSheet } from "./sheets.ts";

const ENGINE_BLUE = 0x9fd8ff, ENGINE_ORANGE = 0xffb36b;

/** One material per slot, shared by every hull (the scene swaps them for the holo table and back). */
const MAT = {
  hull: new THREE.MeshStandardMaterial({ color: 0xc9cdd3, roughness: 0.55, metalness: 0.35, flatShading: true }),
  plate: new THREE.MeshStandardMaterial({ color: 0xaeb3ba, roughness: 0.62, metalness: 0.35, flatShading: true }),
  dark: new THREE.MeshStandardMaterial({ color: 0x5f656e, roughness: 0.7, metalness: 0.3, flatShading: true }),
  window: new THREE.MeshBasicMaterial({ color: 0xfff1c8 }),
  engine: new THREE.MeshBasicMaterial({ color: ENGINE_BLUE }),
  // The Compact's: rusted plate, ochre where it was patched, black iron for the frames, amber lamps, orange fire.
  rust: new THREE.MeshStandardMaterial({ color: 0x9a6a45, roughness: 0.82, metalness: 0.25, flatShading: true }),
  ochre: new THREE.MeshStandardMaterial({ color: 0xb98a46, roughness: 0.78, metalness: 0.2, flatShading: true }),
  iron: new THREE.MeshStandardMaterial({ color: 0x3f322a, roughness: 0.9, metalness: 0.3, flatShading: true }),
  lamp: new THREE.MeshBasicMaterial({ color: 0xffd9a0 }),
  fire: new THREE.MeshBasicMaterial({ color: ENGINE_ORANGE }),
};
type Slot = keyof typeof MAT;

/** A piece while it is built: meshes in the hull's frame, each in a slot's material. */
class Piece {
  readonly parts: [THREE.BufferGeometry, Slot][] = [];
  add(geo: THREE.BufferGeometry, slot: Slot, at?: THREE.Vector3, rot?: THREE.Euler) {
    const m = new THREE.Matrix4().compose(at ?? new THREE.Vector3(), new THREE.Quaternion().setFromEuler(rot ?? new THREE.Euler()), new THREE.Vector3(1, 1, 1));
    this.parts.push([geo.applyMatrix4(m), slot]);
    return this;
  }
  /** One mesh per slot: every geometry's positions and normals, flat, in one buffer. */
  bake(name: string): THREE.Group {
    const g = new THREE.Group();
    g.name = name;
    for (const slot of Object.keys(MAT) as Slot[]) {
      const geos = this.parts.filter(([, s]) => s === slot).map(([geo]) => (geo.index ? geo.toNonIndexed() : geo));
      if (!geos.length) continue;
      const n = geos.reduce((k, geo) => k + geo.getAttribute("position").count, 0);
      const pos = new Float32Array(n * 3);
      let at = 0;
      for (const geo of geos) { const p = geo.getAttribute("position").array; pos.set(p, at); at += p.length; }
      const merged = new THREE.BufferGeometry();
      merged.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      merged.computeVertexNormals();
      const mesh = new THREE.Mesh(merged, MAT[slot]);
      mesh.name = `${name}:${slot}`;
      if (slot === "engine" || slot === "fire") mesh.userData.engine = true;
      g.add(mesh);
    }
    return g;
  }
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** A box from a to b (its length), `w` across and `h` high, its up kept as near +y as the run allows. */
function beam(a: THREE.Vector3, b: THREE.Vector3, w: number, h: number) {
  const len = a.distanceTo(b), g = new THREE.BoxGeometry(len, h, w);
  const dir = b.clone().sub(a).normalize(), q = new THREE.Quaternion().setFromUnitVectors(V(1, 0, 0), dir);
  return g.applyQuaternion(q).translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
}

/** A rod of radius r from a to b. */
function rod(a: THREE.Vector3, b: THREE.Vector3, r: number, seg = 8) {
  const g = new THREE.CylinderGeometry(r, r, a.distanceTo(b), seg);
  const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), b.clone().sub(a).normalize());
  return g.applyQuaternion(q).translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
}

/** A wedge hull's shape, read off its sheet: how wide it is at x, and where its deck and keel are at (x, z). */
export function wedgeForm(s: WedgeSheet) {
  const nose = s.plan[0]![0];
  const rise = (x: number) => clamp((nose - x) / (nose - s.roofFullAt), 0, 1);
  /** Half the beam at x: the starboard outline's widest point there. */
  const half = (x: number) => {
    let z = 0;
    for (let i = 0; i + 1 < s.plan.length; i++) {
      const [x1, z1] = s.plan[i]!, [x2, z2] = s.plan[i + 1]!;
      if (x < Math.min(x1, x2) || x > Math.max(x1, x2) || x1 === x2) continue;
      z = Math.max(z, z1 + ((x - x1) / (x2 - x1)) * (z2 - z1));
    }
    return z;
  };
  const share = (x: number, z: number) => { const h = half(x); return h > 0 ? clamp(1 - Math.abs(z) / h, 0, 1) : 0; };
  return {
    half,
    deck: (x: number, z: number) => s.edge / 2 + s.roof * rise(x) * share(x, z),
    keel: (x: number, z: number) => -s.edge / 2 - s.keel * rise(x) * share(x, z),
    /** How steeply the deck falls toward the edge at x (metres down per metre out). */
    fall: (x: number) => { const h = half(x); return h > 0 ? (s.roof * rise(x)) / h : 0; },
  };
}

/** The hull slab: the plan's outline at the edge's thickness, roofed up to the spine and keeled down under it. */
function wedgeHull(s: WedgeSheet, form: ReturnType<typeof wedgeForm>) {
  const tris: number[] = [];
  const tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => {
    // Wound so the face looks away from the spine (a point on the centreline, kept inside the hull's length).
    const n = b.clone().sub(a).cross(c.clone().sub(a)), mid = a.clone().add(b).add(c).divideScalar(3);
    const out = mid.clone().sub(V(clamp(mid.x, s.plan.at(-1)![0] + 60, s.plan[0]![0] - 60), 0, 0));
    if (n.dot(out) < 0) [b, c] = [c, b];
    tris.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  };
  const quad = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3) => { tri(a, b, c); tri(a, c, d); };
  for (const side of [1, -1]) {
    const o = (p: Plan, y: number) => V(p[0], y, p[1] * side);
    for (let i = 0; i + 1 < s.plan.length; i++) {
      const p = s.plan[i]!, q = s.plan[i + 1]!;
      const top = (r: Plan) => o(r, s.edge / 2), bot = (r: Plan) => o(r, -s.edge / 2);
      const ridge = (r: Plan) => V(r[0], form.deck(r[0], 0), 0), keel = (r: Plan) => V(r[0], form.keel(r[0], 0), 0);
      quad(top(p), top(q), ridge(q), ridge(p));
      quad(bot(p), bot(q), keel(q), keel(p));
      if (p[1] > 0 || q[1] > 0) quad(top(p), top(q), bot(q), bot(p));
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(tris, 3));
  return g;
}

/** The Lance-class destroyer's pieces, in the order they go on. */
function lancePieces(s: WedgeSheet): Record<string, Piece> {
  const form = wedgeForm(s), rand = mulberry32(s.seed), out: Record<string, Piece> = {};
  const stern = s.plan.at(-1)![0], deckTop = s.edge / 2 + s.roof;

  out.hull = new Piece().add(wedgeHull(s, form), "hull");

  // The spinal gun: two rails along the ridge, the barrel between them, coil rings down its length, a muzzle collar.
  const gun = new Piece(), sp = s.spinal;
  const along = (x: number, up = 0, z = 0) => V(x, form.deck(x, 0) + up, z);
  const runs: [number, number][] = [[sp.to, s.roofFullAt], [s.roofFullAt, sp.from]];
  for (const [a, b] of runs) {
    for (const z of [-1, 1]) gun.add(beam(along(a, sp.trenchDeep / 2, (z * sp.trenchWide) / 2), along(b, sp.trenchDeep / 2, (z * sp.trenchWide) / 2), 7, sp.trenchDeep), "dark");
    gun.add(rod(along(a, sp.radius * 0.8), along(b, sp.radius * 0.8), sp.radius, 10), "plate");
  }
  for (let x = sp.to - sp.ringPitch; x > sp.from + 20; x -= sp.ringPitch) {
    const ring = new THREE.TorusGeometry(sp.radius * 1.35, sp.radius * 0.3, 6, 12).rotateY(Math.PI / 2);
    gun.add(ring, "dark", along(x, sp.radius * 0.8));
  }
  gun.add(rod(along(sp.to - 4, sp.radius * 0.8), along(sp.to + 26, sp.radius * 0.8), sp.radius * 1.4, 10), "dark");
  out.spinal = gun;

  // The command fin: a swept blade on the spine with a row of lit windows under its top edge.
  const fin = new Piece(), f = s.fin, [fa, fb] = f.foot;
  const blade = new THREE.Shape();
  blade.moveTo(fa, 0); blade.lineTo(fa - f.sweep, f.tall); blade.lineTo(fa - f.sweep - f.topLength, f.tall); blade.lineTo(fb, 0); blade.closePath();
  fin.add(new THREE.ExtrudeGeometry(blade, { depth: f.thick, bevelEnabled: false }).translate(0, deckTop - 2, -f.thick / 2), "hull");
  const wy = deckTop + f.tall * 0.82, wx0 = fa - f.sweep * 0.82 - 10, wx1 = fa - f.sweep - f.topLength * 0.92;
  for (let i = 0; i < f.windows; i++) {
    const x = wx0 + ((wx1 - wx0) * i) / Math.max(1, f.windows - 1);
    for (const z of [-1, 1]) fin.add(new THREE.BoxGeometry(12, 7, 1.5), "window", V(x, wy, (z * f.thick) / 2 + z * 0.6));
  }
  fin.add(new THREE.BoxGeometry(f.topLength + 10, 5, f.thick + 6), "dark", V(fa - f.sweep - f.topLength / 2, deckTop + f.tall + 1, 0));
  out.fin = fin;

  // The stern block across the stern, its square drive bells sunk in its back face, lit white-blue.
  const dr = new Piece(), [bl, bw, bh] = s.drives.block, back = stern - bl / 2, by = bh * 0.32;
  dr.add(new THREE.BoxGeometry(bl, bh, bw), "dark", V(stern, by, 0));
  for (const [z, w, h] of s.drives.bells) {
    // A bell: a collar standing out of the block, a dark throat inside it, the fire a smaller square at its heart.
    const d = s.drives.depth, xb = back - d;
    for (const [dy, dz, ww, hh] of [[0, (w + 4) / 2, d, h + 8], [0, -(w + 4) / 2, d, h + 8], [(h + 4) / 2, 0, w + 8, d], [-(h + 4) / 2, 0, w + 8, d]] as const) {
      dr.add(new THREE.BoxGeometry(d, dy ? 6 : hh, dy ? ww : 6), "plate", V(back - d / 2, by + dy, z + dz));
    }
    dr.add(new THREE.BoxGeometry(2, h, w), "dark", V(back - 1, by, z));
    dr.add(new THREE.BoxGeometry(2, h * 0.62, w * 0.62), "engine", V(xb + 2, by, z));
  }
  out.drives = dr;

  // The hangar: a dark slot in the belly with a lit lip down each side.
  const hg = new Piece(), hs = s.hangar, hx = (hs.from + hs.to) / 2, hl = hs.from - hs.to, belly = form.keel(hx, 0);
  hg.add(new THREE.BoxGeometry(hl, hs.deep, hs.wide), "dark", V(hx, belly + hs.deep / 2 - 1.5, 0));
  for (const z of [-1, 1]) hg.add(new THREE.BoxGeometry(hl, 2, 4), "window", V(hx, belly - 1.6, (z * (hs.wide + 4)) / 2));
  out.hangar = hg;

  // Turrets: a pair per station, each a round base, a housing and twin barrels laid forward.
  const tu = new Piece(), t = s.turrets;
  for (const [x, across] of t.at) for (const side of [1, -1]) {
    const z = side * across * form.half(x), y = form.deck(x, z), tilt = new THREE.Euler(side * Math.atan(form.fall(x)), 0, 0);
    tu.add(new THREE.CylinderGeometry(t.base / 2, t.base / 2 + 3, 6, 12), "dark", V(x, y + 2, z), tilt);
    tu.add(new THREE.BoxGeometry(t.base * 0.8, 11, t.base * 0.62), "hull", V(x, y + 10, z), tilt);
    for (const dz of [-1, 1]) tu.add(rod(V(x + t.base * 0.3, y + 11, z + dz * t.base * 0.16), V(x + t.base * 0.3 + t.barrel, y + 12, z + dz * t.base * 0.16), 2.6, 6), "dark");
  }
  out.turrets = tu;

  // Point defence: small blisters along both edges, spaced about `pitch` apart with a little play.
  const pd = new Piece();
  for (let i = 0; i + 1 < s.plan.length; i++) {
    const [x1, z1] = s.plan[i]!, [x2, z2] = s.plan[i + 1]!;
    if (z1 === 0 && z2 === 0) continue;
    const len = Math.hypot(x2 - x1, z2 - z1), n = Math.max(1, Math.round(len / s.pointDefence.pitch));
    for (let k = 0; k < n; k++) {
      const u = (k + 0.5 + (rand() - 0.5) * 0.4) / n, x = x1 + (x2 - x1) * u, zz = (z1 + (z2 - z1) * u) * 0.94;
      for (const side of [1, -1]) {
        const z = zz * side, y = form.deck(x, z);
        pd.add(new THREE.SphereGeometry(s.pointDefence.size / 2, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), "dark", V(x, y, z));
        pd.add(rod(V(x, y + s.pointDefence.size * 0.3, z), V(x + s.pointDefence.size, y + s.pointDefence.size * 0.4, z), 1.2, 4), "dark");
      }
    }
  }
  out.pointDefence = pd;

  // Antennae: two masts on the fin's top edge and a dish between them, looking up and aft.
  const an = new Piece(), top = deckTop + f.tall + 3, ax0 = fa - f.sweep - f.topLength * 0.2, ax1 = fa - f.sweep - f.topLength * 0.8;
  for (const [x, k] of [[ax0, 1], [ax1, 0.7]] as const) an.add(rod(V(x, top, 0), V(x - 14, top + s.antennae.tall * k, 0), 1.6, 5), "dark");
  an.add(new THREE.SphereGeometry(s.antennae.dish / 2, 12, 5, 0, Math.PI * 2, 0, Math.PI / 2.6), "plate", V((ax0 + ax1) / 2, top + 4, 0), new THREE.Euler(0, 0, 0.5));
  out.antennae = an;

  // Panel plates on the deck, a shade off the hull's grey, each laid on the deck's fall.
  const pl = new Piece();
  for (let i = 0; i < s.panels.count; i++) {
    const x = stern + 40 + rand() * (s.plan[0]![0] - stern - 160), h = form.half(x), across = 0.12 + rand() * 0.72;
    if (h < 60) continue;
    const w = s.panels.size * (0.4 + rand() * 0.6), d = s.panels.size * (0.3 + rand() * 0.5);
    for (const side of [1, -1]) {
      const z = side * across * h;
      pl.add(new THREE.BoxGeometry(w, 1.4, d), "plate", V(x, form.deck(x, z) + 0.5, z), new THREE.Euler(side * Math.atan(form.fall(x)), 0, 0));
    }
  }
  out.panels = pl;

  // Lit windows scattered over the deck, thickest aft: the size of the thing.
  const li = new Piece();
  for (let i = 0; i < s.lights.count; i++) {
    const k = Math.sqrt(rand()), x = s.plan[0]![0] - 80 - k * (s.plan[0]![0] - stern - 120), h = form.half(x);
    const z = (rand() * 2 - 1) * h * 0.85, sz = s.lights.size;
    li.add(new THREE.BoxGeometry(sz, 1.6, sz * 0.6), "window", V(x, form.deck(x, z) + 0.4, z), new THREE.Euler(Math.sign(z) * Math.atan(form.fall(x)), 0, 0));
  }
  out.lights = li;
  return out;
}

/** What a far level keeps: the pieces that make the silhouette from above. */
const FAR: Record<SheetKind, string[]> = { destroyer: ["hull", "spinal", "fin", "drives"], cruiser: ["spine", "prow", "ribs", "drive"] };
const BUILD: Record<SheetKind, () => Record<string, Piece>> = { destroyer: () => lancePieces(LANCE), cruiser: () => girderPieces(BASTION) };

/** The Bastion cruiser's pieces (and any girder-built Compact hull's), in the order they go on. */
function girderPieces(s: GirderSheet): Record<string, Piece> {
  const rand = mulberry32(s.seed), out: Record<string, Piece> = {};
  const sp = s.spine, hw = sp.wide / 2, hh = sp.high / 2;

  // The keel girder: four chords and a zigzag of struts down each face, a box truss.
  const spine = new Piece();
  for (const [y, z] of [[hh, hw], [hh, -hw], [-hh, hw], [-hh, -hw]] as const) spine.add(beam(V(sp.from, y, z), V(sp.to, y, z), sp.bar, sp.bar), "iron");
  const bay = (sp.to - sp.from) / sp.bays;
  for (let i = 0; i < sp.bays; i++) {
    const x0 = sp.from + i * bay, x1 = x0 + bay, up = i % 2 ? 1 : -1;
    for (const z of [hw, -hw]) spine.add(beam(V(x0, -hh * up, z), V(x1, hh * up, z), sp.bar * 0.6, sp.bar * 0.6), "iron");
    for (const y of [hh, -hh]) spine.add(beam(V(x0, y, -hw * up), V(x1, y, hw * up), sp.bar * 0.6, sp.bar * 0.6), "iron");
  }
  // A plated core inside the truss, so it reads solid from afar.
  spine.add(new THREE.BoxGeometry(sp.to - sp.from, sp.high * 0.7, sp.wide * 0.7), "rust", V((sp.from + sp.to) / 2, 0, 0));
  out.spine = spine;

  // The ram: the side profile pushed across, a seam of iron round its waist.
  const prow = new Piece(), shape = new THREE.Shape();
  s.prow.profile.forEach(([x, y], i) => (i ? shape.lineTo(x, y) : shape.moveTo(x, y)));
  shape.closePath();
  prow.add(new THREE.ExtrudeGeometry(shape, { depth: s.prow.wide, bevelEnabled: true, bevelThickness: 10, bevelSize: 8, bevelSegments: 1 }).translate(0, 0, -s.prow.wide / 2), "rust");
  const px = s.prow.profile.map(([x]) => x), pFrom = Math.min(...px), pTo = Math.max(...px);
  prow.add(new THREE.BoxGeometry(pTo - pFrom - 30, 10, s.prow.wide + 22), "iron", V((pFrom + pTo) / 2 - 15, 0, 0));
  out.prow = prow;

  // The rib frames: flat-bar rectangles welded across the keel.
  const ribs = new Piece(), r = s.ribs, ribX = (i: number) => r.from + ((r.to - r.from) * i) / Math.max(1, r.count - 1);
  for (let i = 0; i < r.count; i++) {
    const x = ribX(i), w = r.wide / 2, h = r.high / 2;
    ribs.add(new THREE.BoxGeometry(r.bar, r.bar, r.wide + r.bar), "iron", V(x, h, 0));
    ribs.add(new THREE.BoxGeometry(r.bar, r.bar, r.wide + r.bar), "iron", V(x, -h, 0));
    for (const z of [w, -w]) ribs.add(new THREE.BoxGeometry(r.bar, r.high, r.bar), "iron", V(x, 0, z));
    // Gussets where the rib meets the keel.
    for (const z of [1, -1]) ribs.add(beam(V(x, hh, z * hw), V(x, h, z * w * 0.6), r.bar * 0.8, r.bar * 0.8), "iron");
  }
  out.ribs = ribs;

  // Modules: plate and cargo blocks bolted in the bays, up top, down below and on the flanks, each its own shade.
  const mods = new Piece(), bays = r.count - 1, bw = (r.to - r.from) / bays;
  for (let i = 0; i < s.modules.count; i++) {
    const b = Math.floor(rand() * bays), x = r.from + bw * (b + 0.5), face = Math.floor(rand() * 4);
    const len = bw * (0.5 + rand() * 0.4), a = s.modules.size * (0.5 + rand() * 0.5), d = s.modules.size * (0.4 + rand() * 0.6);
    const slot = rand() < 0.3 ? "ochre" : "rust";
    if (face < 2) { const y = (face ? 1 : -1) * (hh + d / 2); mods.add(new THREE.BoxGeometry(len, d, a), slot, V(x, y, (rand() - 0.5) * (r.wide - a) * 0.8)); }
    else { const z = (face === 2 ? 1 : -1) * (hw + d / 2); mods.add(new THREE.BoxGeometry(len, a, d), slot, V(x, (rand() - 0.5) * (r.high - a) * 0.6, z)); }
  }
  out.modules = mods;

  // The tanks: a long cylinder down each flank, banded where it is strapped to the ribs, capped round at each end.
  const tanks = new Piece(), t = s.tanks;
  for (const z of [t.z, -t.z]) {
    tanks.add(rod(V(t.from, t.y, z), V(t.to, t.y, z), t.radius, 14), "ochre");
    for (const x of [t.from, t.to]) tanks.add(new THREE.SphereGeometry(t.radius, 14, 8), "ochre", V(x, t.y, z));
    for (let k = 0; k < t.bands; k++) {
      const x = t.from + ((t.to - t.from) * (k + 0.5)) / t.bands;
      tanks.add(new THREE.TorusGeometry(t.radius + 1, 3, 4, 16).rotateY(Math.PI / 2), "iron", V(x, t.y, z));
    }
    tanks.add(beam(V((t.from + t.to) / 2, t.y + t.radius, z), V((t.from + t.to) / 2, -r.high / 2, Math.sign(z) * r.wide / 2), 8, 8), "iron");
  }
  out.tanks = tanks;

  // The bridge: a cab on four stilts over the keel, a band of lamps for windows round its front.
  const br = new Piece(), [bl, bh, bwid] = s.bridge.size, by = hh + s.bridge.lift + bh / 2, bx = s.bridge.x;
  br.add(new THREE.BoxGeometry(bl, bh, bwid), "rust", V(bx, by, 0));
  br.add(new THREE.BoxGeometry(bl * 0.7, 8, bwid * 0.8), "iron", V(bx - bl * 0.1, by + bh / 2 + 4, 0));
  for (const [dx, dz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) br.add(new THREE.BoxGeometry(8, s.bridge.lift, 8), "iron", V(bx + dx * bl * 0.35, hh + s.bridge.lift / 2, dz * bwid * 0.35));
  for (let i = 0; i < s.bridge.windows; i++) {
    const z = -bwid * 0.4 + (bwid * 0.8 * i) / Math.max(1, s.bridge.windows - 1);
    br.add(new THREE.BoxGeometry(1.5, 7, 6), "lamp", V(bx + bl / 2 + 0.8, by + bh * 0.15, z));
  }
  out.bridge = br;

  // Broadside guns: a block on a sponson at the rib tops, each side, one long barrel laid out sideways and forward.
  const guns = new Piece(), g = s.guns;
  for (const x of g.at) for (const side of [1, -1]) {
    const z = side * (r.wide / 2 + g.block * 0.3), y = r.high / 2 + g.block * 0.35;
    guns.add(new THREE.BoxGeometry(g.block * 1.6, g.block * 0.3, g.block * 1.4), "iron", V(x, r.high / 2 - 2, side * r.wide / 2));
    guns.add(new THREE.BoxGeometry(g.block * 1.2, g.block * 0.6, g.block), "rust", V(x, y, z));
    guns.add(rod(V(x + g.block * 0.4, y + 2, z), V(x + g.block * 0.4 + g.barrel * 0.8, y + 6, z + side * g.barrel * 0.25), 4, 6), "iron");
  }
  out.guns = guns;

  // The drive: a cylinder behind the keel, a flared bell with fire in its throat, two small drives either side.
  const dv = new Piece(), d = s.drive, x0 = sp.from, x1 = x0 - d.length;
  dv.add(rod(V(x0 + 10, 0, 0), V(x1, 0, 0), d.radius, 14), "rust");
  for (const x of [x0 - d.length * 0.25, x0 - d.length * 0.75]) dv.add(new THREE.TorusGeometry(d.radius + 2, 4, 4, 18).rotateY(Math.PI / 2), "iron", V(x, 0, 0));
  const bell = new THREE.CylinderGeometry(d.radius * 0.8, d.radius * 1.15, d.bell, 16, 1, true).rotateZ(Math.PI / 2);
  dv.add(bell, "iron", V(x1 - d.bell / 2, 0, 0));
  dv.add(new THREE.CircleGeometry(d.radius * 0.78, 16).rotateY(-Math.PI / 2), "fire", V(x1 - 2, 0, 0));
  for (const [z, rr] of d.aux) {
    dv.add(rod(V(x0 + 40, 0, z), V(x1 + 20, 0, z), rr, 10), "rust");
    dv.add(beam(V(x0 + 10, 0, z), V(x0 + 10, 0, Math.sign(z) * hw), 10, 10), "iron");
    dv.add(new THREE.CircleGeometry(rr * 0.8, 10).rotateY(-Math.PI / 2), "fire", V(x1 + 19, 0, z));
  }
  out.drive = dv;

  // Weld patches: lighter squares laid over the plates, where the yard mended her.
  const pa = new Piece();
  for (let i = 0; i < s.patches.count; i++) {
    const x = sp.from + rand() * (sp.to - sp.from), w = s.patches.size * (0.4 + rand() * 0.6), h = s.patches.size * (0.3 + rand() * 0.5);
    const top = rand() < 0.5, side = rand() < 0.5 ? 1 : -1;
    if (top) pa.add(new THREE.BoxGeometry(w, 1.2, h), "ochre", V(x, side * (sp.high * 0.35 + 0.8), (rand() - 0.5) * sp.wide * 0.5));
    else pa.add(new THREE.BoxGeometry(w, h, 1.2), "ochre", V(x, (rand() - 0.5) * sp.high * 0.5, side * (sp.wide * 0.35 + 0.8)));
  }
  out.patches = pa;

  // Lamps: a few amber points along the keel's flanks and the ram.
  const li = new Piece();
  for (let i = 0; i < s.lights.count; i++) {
    const x = sp.from + rand() * (pTo - 40 - sp.from), side = rand() < 0.5 ? 1 : -1, sz = s.lights.size;
    li.add(new THREE.BoxGeometry(sz, sz * 0.7, 1.4), "lamp", V(x, (rand() - 0.5) * sp.high * 0.5, side * (sp.wide * 0.35 + 1.6)));
  }
  out.lights = li;
  return out;
}

/** The kinds with a drawing sheet for this side, built from it. */
export const hasSheet = (kind: string, side?: "navy" | "rim"): kind is SheetKind => kind in SHEETS && (!side || SHEETS[kind as SheetKind].side === side);

const pieceCache = new Map<SheetKind, { name: string; group: THREE.Group }[]>();
/** A hull's pieces, each its own group in the hull's frame in metres, in the order they go on. Shared geometry: clone
 *  the groups before changing them. */
export function shipPieces(kind: SheetKind): { name: string; group: THREE.Group }[] {
  let p = pieceCache.get(kind);
  if (!p) { p = Object.entries(BUILD[kind]()).map(([name, b]) => ({ name, group: b.bake(`${kind}~${name}`) })); pieceCache.set(kind, p); }
  return p.map(({ name, group }) => ({ name, group: group.clone() }));
}

/** How far off (battle units) a sheet-built hull drops to its far level: past the battle view, inside the Theater's. */
export const FAR_AT = 4500;

/** A sheet-built hull at the game's scale, nose along +x: every piece up close, the silhouette's pieces far off. */
export function sheetModel(kind: SheetKind): THREE.Group {
  const sheet = SHEETS[kind], g = new THREE.Group(), lod = new THREE.LOD();
  const near = new THREE.Group(), far = new THREE.Group();
  for (const p of shipPieces(kind)) near.add(p.group);
  for (const p of shipPieces(kind)) if (FAR[kind].includes(p.name)) far.add(p.group);
  lod.addLevel(near, 0);
  lod.addLevel(far, FAR_AT);
  lod.name = `${kind}~lod`;
  g.add(lod);
  g.scale.setScalar(sheet.gameLength / sheet.length);
  g.userData.sheet = kind;
  return g;
}
