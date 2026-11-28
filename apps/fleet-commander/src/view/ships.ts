// Every hull, built piece by piece from its drawing sheet (`sheets.ts`): seeded three.js, no files. Each piece is its
// own group in the hull's frame (metres), so a piece can be looked at alone or pulled apart (`ships.html`), and
// `sheetModel` puts them together at the game's scale with a cheap far level for the Theater's top-down board.
// Each piece is baked to one mesh per material, so a whole hull is a couple of dozen draw calls.
// The navy's wedges are built here, the Compact's yard work in `rim-ships.ts`.
import * as THREE from "three";
import { clamp, mulberry32 } from "@rustybuns/util";
import type { ShipKind } from "../names.ts";
import { Piece, V, beam, rod } from "./piece.ts";
import { bulwarkPieces, corvettePieces, girderPieces, hivePieces, minelayerPieces, stationPieces } from "./rim-ships.ts";
import { ARGUS, BASTION, CORVETTE, HIVE, LANCE, ORBITAL, SHEETS, SOVEREIGN, SOWER, TIDEWALL, WARDEN, type Antennae, type DreadnoughtSheet, type Fin, type Hangar, type InterdictorSheet, type LanceSheet, type Plan, type SensorSheet, type Spinal, type WedgeSheet } from "./sheets.ts";

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
type Form = ReturnType<typeof wedgeForm>;

/** The hull slab: the plan's outline at the edge's thickness, roofed up to the spine and keeled down under it. */
function wedgeHull(s: WedgeSheet, form: Form) {
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
  g.computeVertexNormals();
  return g;
}

// What the navy's wedges share: the pieces any of their sheets describe.

const hullPiece = (s: WedgeSheet, form: Form) => new Piece().add(wedgeHull(s, form), "hull");

/** A spinal gun `z` out from the spine: two rails along the deck, the barrel between them, coil rings, a muzzle collar. */
function spinalGun(gun: Piece, s: WedgeSheet, form: Form, sp: Spinal, z = 0) {
  const along = (x: number, up = 0, dz = 0) => V(x, form.deck(x, z) + up, z + dz);
  const runs: [number, number][] = [[sp.to, s.roofFullAt], [s.roofFullAt, sp.from]];
  for (const [a, b] of runs) {
    for (const k of [-1, 1]) gun.add(beam(along(a, sp.trenchDeep / 2, (k * sp.trenchWide) / 2), along(b, sp.trenchDeep / 2, (k * sp.trenchWide) / 2), 7, sp.trenchDeep), "dark");
    gun.add(rod(along(a, sp.radius * 0.8), along(b, sp.radius * 0.8), sp.radius, 10), "plate");
  }
  for (let x = sp.to - sp.ringPitch; x > sp.from + 20; x -= sp.ringPitch) {
    const ring = new THREE.TorusGeometry(sp.radius * 1.35, sp.radius * 0.3, 6, 12).rotateY(Math.PI / 2);
    gun.add(ring, "dark", along(x, sp.radius * 0.8));
  }
  return gun.add(rod(along(sp.to - 4, sp.radius * 0.8), along(sp.to + 26, sp.radius * 0.8), sp.radius * 1.4, 10), "dark");
}

/** A command fin standing at height `y`, `z` out from the spine, with a row of lit windows under its top edge. */
function finBlade(fin: Piece, f: Fin, y: number, z = 0) {
  const [fa, fb] = f.foot;
  const blade = new THREE.Shape();
  blade.moveTo(fa, 0); blade.lineTo(fa - f.sweep, f.tall); blade.lineTo(fa - f.sweep - f.topLength, f.tall); blade.lineTo(fb, 0); blade.closePath();
  fin.add(new THREE.ExtrudeGeometry(blade, { depth: f.thick, bevelEnabled: false }).translate(0, y - 2, z - f.thick / 2), "hull");
  const wy = y + f.tall * 0.82, wx0 = fa - f.sweep * 0.82 - 10, wx1 = fa - f.sweep - f.topLength * 0.92;
  for (let i = 0; i < f.windows; i++) {
    const x = wx0 + ((wx1 - wx0) * i) / Math.max(1, f.windows - 1);
    for (const k of [-1, 1]) fin.add(new THREE.BoxGeometry(12, 7, 1.5), "window", V(x, wy, z + (k * f.thick) / 2 + k * 0.6));
  }
  return fin.add(new THREE.BoxGeometry(f.topLength + 10, 5, f.thick + 6), "dark", V(fa - f.sweep - f.topLength / 2, y + f.tall + 1, z));
}

/** The stern block across the stern, its square drive bells sunk in its back face, lit white-blue. */
function sternDrives(s: WedgeSheet) {
  const dr = new Piece(), [bl, bw, bh] = s.drives.block, stern = s.plan.at(-1)![0], back = stern - bl / 2, by = bh * 0.32;
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
  return dr;
}

/** A dark slot in the belly with a lit lip down each side. */
function hangarSlot(form: Form, hs: Hangar) {
  const hg = new Piece(), hx = (hs.from + hs.to) / 2, hl = Math.abs(hs.from - hs.to), belly = form.keel(hx, 0);
  hg.add(new THREE.BoxGeometry(hl, hs.deep, hs.wide), "dark", V(hx, belly + hs.deep / 2 - 1.5, 0));
  for (const z of [-1, 1]) hg.add(new THREE.BoxGeometry(hl, 2, 4), "window", V(hx, belly - 1.6, (z * (hs.wide + 4)) / 2));
  return hg;
}

/** A pair of turrets per station, each a round base, a housing and twin barrels laid forward. */
function deckTurrets(s: WedgeSheet, form: Form) {
  const tu = new Piece(), t = s.turrets, k = t.base / 34;
  for (const [x, across] of t.at) for (const side of [1, -1]) {
    const z = side * across * form.half(x), y = form.deck(x, z), tilt = new THREE.Euler(side * Math.atan(form.fall(x)), 0, 0);
    tu.add(new THREE.CylinderGeometry(t.base / 2, t.base / 2 + 3 * k, 6 * k, 12), "dark", V(x, y + 2 * k, z), tilt);
    tu.add(new THREE.BoxGeometry(t.base * 0.8, 11 * k, t.base * 0.62), "hull", V(x, y + 10 * k, z), tilt);
    for (const dz of [-1, 1]) tu.add(rod(V(x + t.base * 0.3, y + 11 * k, z + dz * t.base * 0.16), V(x + t.base * 0.3 + t.barrel, y + 12 * k, z + dz * t.base * 0.16), 2.6 * k, 6), "dark");
  }
  return tu;
}

/** Small blisters along both edges, spaced about `pitch` apart with a little play. */
function edgeDefence(s: WedgeSheet, form: Form, rand: () => number) {
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
  return pd;
}

/** Two masts at height `y`, at x0 and x1, and a dish between them looking up and aft. */
function mastsAndDish(a: Antennae, x0: number, x1: number, y: number) {
  const an = new Piece();
  for (const [x, k] of [[x0, 1], [x1, 0.7]] as const) an.add(rod(V(x, y, 0), V(x - 14, y + a.tall * k, 0), 1.6, 5), "dark");
  return an.add(new THREE.SphereGeometry(a.dish / 2, 12, 5, 0, Math.PI * 2, 0, Math.PI / 2.6), "plate", V((x0 + x1) / 2, y + 4, 0), new THREE.Euler(0, 0, 0.5));
}

/** Panel plates on the deck, a shade off the hull's grey, each laid on the deck's fall. */
function deckPanels(s: WedgeSheet, form: Form, rand: () => number) {
  const pl = new Piece(), stern = s.plan.at(-1)![0];
  for (let i = 0; i < s.panels.count; i++) {
    const x = stern + 40 + rand() * (s.plan[0]![0] - stern - 160), h = form.half(x), across = 0.12 + rand() * 0.72;
    if (h < 60) continue;
    const w = s.panels.size * (0.4 + rand() * 0.6), d = s.panels.size * (0.3 + rand() * 0.5);
    for (const side of [1, -1]) {
      const z = side * across * h;
      pl.add(new THREE.BoxGeometry(w, 1.4, d), "plate", V(x, form.deck(x, z) + 0.5, z), new THREE.Euler(side * Math.atan(form.fall(x)), 0, 0));
    }
  }
  return pl;
}

/** Lit windows scattered over the deck, thickest aft: the size of the thing. */
function deckLights(s: WedgeSheet, form: Form, rand: () => number) {
  const li = new Piece(), stern = s.plan.at(-1)![0];
  for (let i = 0; i < s.lights.count; i++) {
    const k = Math.sqrt(rand()), x = s.plan[0]![0] - 80 - k * (s.plan[0]![0] - stern - 120), h = form.half(x);
    const z = (rand() * 2 - 1) * h * 0.85, sz = s.lights.size;
    li.add(new THREE.BoxGeometry(sz, 1.6, sz * 0.6), "window", V(x, form.deck(x, z) + 0.4, z), new THREE.Euler(Math.sign(z) * Math.atan(form.fall(x)), 0, 0));
  }
  return li;
}

/** The Lance-class destroyer's pieces, in the order they go on. */
function lancePieces(s: LanceSheet): Record<string, Piece> {
  const form = wedgeForm(s), rand = mulberry32(s.seed), deckTop = s.edge / 2 + s.roof, f = s.fin;
  const back = f.foot[0] - f.sweep;
  return {
    hull: hullPiece(s, form),
    spinal: spinalGun(new Piece(), s, form, s.spinal),
    fin: finBlade(new Piece(), f, deckTop),
    drives: sternDrives(s),
    hangar: hangarSlot(form, s.hangar),
    turrets: deckTurrets(s, form),
    pointDefence: edgeDefence(s, form, rand),
    antennae: mastsAndDish(s.antennae, back - f.topLength * 0.2, back - f.topLength * 0.8, deckTop + f.tall + 3),
    panels: deckPanels(s, form, rand),
    lights: deckLights(s, form, rand),
  };
}

/** The Sovereign-class dreadnought's pieces. */
function dreadnoughtPieces(s: DreadnoughtSheet): Record<string, Piece> {
  const form = wedgeForm(s), rand = mulberry32(s.seed), deckTop = s.edge / 2 + s.roof;
  const spinal = new Piece(), fins = new Piece(), citadel = new Piece();
  for (const side of [1, -1]) {
    spinalGun(spinal, s, form, s.spinal, side * s.spinal.z);
    finBlade(fins, s.fins, form.deck(s.fins.foot[1], s.fins.z), side * s.fins.z);
  }
  // The citadel: terraces stepping up, the lowest sunk to meet the deck where it falls away, windows along each flank.
  let top = deckTop;
  s.citadel.tiers.forEach(([x, len, wide, high], i) => {
    const bottom = i ? top : form.deck(x - len / 2, wide / 2) - 6;
    top += high;
    citadel.add(new THREE.BoxGeometry(len, top - bottom, wide), "hull", V(x, (top + bottom) / 2, 0));
    citadel.add(new THREE.BoxGeometry(len + 12, 8, wide + 12), "dark", V(x, top, 0));
    for (let k = 0; k < s.citadel.windows; k++) {
      const wx = x - len * 0.44 + (len * 0.88 * k) / Math.max(1, s.citadel.windows - 1);
      for (const side of [1, -1]) citadel.add(new THREE.BoxGeometry(18, 12, 2), "window", V(wx, top - high * 0.4, side * (wide / 2 + 1)));
    }
  });
  const [tx, tl] = s.citadel.tiers.at(-1)!;
  return {
    hull: hullPiece(s, form),
    spinal,
    citadel,
    fins,
    drives: sternDrives(s),
    hangar: hangarSlot(form, s.hangar),
    turrets: deckTurrets(s, form),
    pointDefence: edgeDefence(s, form, rand),
    antennae: mastsAndDish(s.antennae, tx + tl * 0.3, tx - tl * 0.3, top + 4),
    panels: deckPanels(s, form, rand),
    lights: deckLights(s, form, rand),
  };
}

/** The Warden interdictor's pieces: the well projectors are what sets it apart. */
function interdictorPieces(s: InterdictorSheet): Record<string, Piece> {
  const form = wedgeForm(s), rand = mulberry32(s.seed);
  const wells = new Piece(), coils = new Piece();
  for (const [x, z, r] of s.wells.at) for (const side of [1, -1]) {
    const zz = side * z, y = form.deck(x, zz) + r * 0.16;
    wells.add(new THREE.CylinderGeometry(r, r * 1.08, r * 0.7, 16), "dark", V(x, y - r * 0.2, zz));
    wells.add(new THREE.SphereGeometry(r * 0.82, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2), "plate", V(x, y + r * 0.15, zz));
    coils.add(new THREE.TorusGeometry(r * 0.94, r * 0.07, 6, 20).rotateX(Math.PI / 2), "window", V(x, y + r * 0.18, zz));
    for (let i = 0; i < s.wells.coils; i++) {
      const a = (i / s.wells.coils) * Math.PI * 2;
      coils.add(new THREE.BoxGeometry(r * 0.18, r * 0.38, r * 0.18), "hull", V(x + Math.cos(a) * r, y + r * 0.2, zz + Math.sin(a) * r));
    }
    coils.add(rod(V(x, y + r * 0.9, zz), V(x, y + r * 1.4, zz), r * 0.05, 6), "dark");
  }
  const bridge = new Piece(), [bl, bh, bw] = s.bridge.size, by = form.deck(s.bridge.x, bw / 2) - 4;
  const high = form.deck(s.bridge.x, 0) + bh - by;
  bridge.add(new THREE.BoxGeometry(bl, high, bw), "hull", V(s.bridge.x, by + high / 2, 0));
  bridge.add(new THREE.BoxGeometry(bl + 6, 5, bw + 8), "dark", V(s.bridge.x, by + high + 2, 0));
  for (let i = 0; i < s.bridge.windows; i++) {
    const z = -bw * 0.4 + (bw * 0.8 * i) / Math.max(1, s.bridge.windows - 1);
    bridge.add(new THREE.BoxGeometry(1.5, 6, 7), "window", V(s.bridge.x + bl / 2 + 0.8, by + high - 10, z));
  }
  return {
    hull: hullPiece(s, form),
    wells,
    coils,
    bridge,
    drives: sternDrives(s),
    turrets: deckTurrets(s, form),
    pointDefence: edgeDefence(s, form, rand),
    panels: deckPanels(s, form, rand),
    lights: deckLights(s, form, rand),
  };
}

/** The Argus sensor ship's pieces: the dish, the booms and the aerials. */
function sensorPieces(s: SensorSheet): Record<string, Piece> {
  const form = wedgeForm(s), rand = mulberry32(s.seed);
  // The dish: a shallow bowl on a pylon, both faces drawn, a feed held out in front of it.
  const dish = new Piece(), d = s.dish, foot = form.deck(d.x, 0), hub = V(d.x, foot + d.lift, 0);
  const bowl = Array.from({ length: 6 }, (_, i) => new THREE.Vector2((d.radius * i) / 5, d.radius * 0.34 * (i / 5) ** 2));
  const tip = new THREE.Euler(0, 0, -d.tilt), up = V(0, 1, 0).applyEuler(tip);
  dish.add(new THREE.LatheGeometry(bowl, 20), "plate", hub, tip);
  dish.add(new THREE.LatheGeometry([...bowl].reverse(), 20), "hull", hub, tip);
  dish.add(new THREE.TorusGeometry(d.radius, 4, 4, 24).rotateX(Math.PI / 2), "dark", hub.clone().addScaledVector(up, d.radius * 0.34), tip);
  const feed = hub.clone().addScaledVector(up, d.radius * 0.8);
  dish.add(rod(hub, feed, 3, 6), "dark");
  dish.add(new THREE.SphereGeometry(9, 8, 6), "window", feed);
  dish.add(beam(V(d.x, foot - 4, 0), hub, 24, 24), "dark");
  // The booms: a spar out to each side, receiver plates hung along its outer part.
  const booms = new Piece(), b = s.booms;
  for (const side of [1, -1]) {
    booms.add(beam(V(b.x, 0, 0), V(b.x, 0, side * (b.span - 4)), 8, 8), "dark");
    const inner = form.half(b.x) + 6;
    for (let i = 0; i < b.plates; i++) {
      const z = side * (b.span - b.plate / 2 - (i * (b.span - b.plate - inner)) / Math.max(1, b.plates - 1));
      booms.add(new THREE.BoxGeometry(b.plate * 1.5, 3, b.plate), "plate", V(b.x, 0, z));
      booms.add(new THREE.BoxGeometry(b.plate * 0.5, 4, b.plate * 0.2), "window", V(b.x, 0, z));
    }
  }
  const aerials = new Piece(), a = s.aerials;
  for (let i = 0; i < a.count; i++) {
    const x = a.from + ((a.to - a.from) * i) / Math.max(1, a.count - 1), y = form.deck(x, 0), tall = a.tall * (0.5 + (0.5 * (i + 1)) / a.count);
    aerials.add(rod(V(x, y - 2, 0), V(x, y + tall, 0), 1.8, 5), "dark");
    for (const k of [0.6, 0.9]) aerials.add(new THREE.BoxGeometry(2, 2, tall * 0.35 * (1.5 - k)), "plate", V(x, y + tall * k, 0));
  }
  const whiskers = new Piece(), nose = s.plan[0]![0];
  for (const [dy, dz] of [[0, 0], [10, 14], [10, -14]] as const) whiskers.add(rod(V(nose - 50, dy / 2, dz / 2), V(nose + s.whiskers.length - (dz ? 24 : 0), dy, dz), 2.2, 5), "dark");
  return {
    hull: hullPiece(s, form),
    dish,
    booms,
    aerials,
    whiskers,
    drives: sternDrives(s),
    turrets: deckTurrets(s, form),
    pointDefence: edgeDefence(s, form, rand),
    panels: deckPanels(s, form, rand),
    lights: deckLights(s, form, rand),
  };
}

/** What a far level keeps: the pieces that make the silhouette from above. */
const FAR: Record<ShipKind, string[]> = {
  dreadnought: ["hull", "spinal", "citadel", "fins", "drives"],
  destroyer: ["hull", "spinal", "fin", "drives"],
  frigate: ["hull", "wells", "bridge", "drives"],
  sensor: ["hull", "dish", "booms", "drives"],
  corvette: ["spine", "prow", "drive", "cannon"],
  cruiser: ["spine", "prow", "ribs", "drive"],
  carrier: ["keel", "head", "combs", "drives"],
  station: ["spindle", "ring", "spokes", "docks"],
  bulwark: ["body", "belly", "belts", "drives"],
  minelayer: ["spine", "prow", "ribs", "drive"],
};
const BUILD: Record<ShipKind, () => Record<string, Piece>> = {
  dreadnought: () => dreadnoughtPieces(SOVEREIGN),
  destroyer: () => lancePieces(LANCE),
  frigate: () => interdictorPieces(WARDEN),
  sensor: () => sensorPieces(ARGUS),
  corvette: () => corvettePieces(CORVETTE),
  cruiser: () => girderPieces(BASTION),
  carrier: () => hivePieces(HIVE),
  station: () => stationPieces(ORBITAL),
  bulwark: () => bulwarkPieces(TIDEWALL),
  minelayer: () => minelayerPieces(SOWER),
};

export const isShip = (kind: string): kind is ShipKind => Object.hasOwn(SHEETS, kind);

const pieceCache = new Map<ShipKind, { name: string; group: THREE.Group }[]>();
/** A hull's pieces, each its own group in the hull's frame in metres, in the order they go on. Shared geometry: clone
 *  the groups before changing them. */
export function shipPieces(kind: ShipKind): { name: string; group: THREE.Group }[] {
  let p = pieceCache.get(kind);
  if (!p) { p = Object.entries(BUILD[kind]()).map(([name, b]) => ({ name, group: b.bake(`${kind}~${name}`) })); pieceCache.set(kind, p); }
  return p.map(({ name, group }) => ({ name, group: group.clone() }));
}

/** How far off (battle units) a hull drops to its far level: past the battle view, inside the Theater's. */
export const FAR_AT = 4500;

/** A hull at the game's scale, nose along +x: every piece up close, the silhouette's pieces far off. */
export function sheetModel(kind: ShipKind): THREE.Group {
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
