// The Compact's hulls, built piece by piece from their drawing sheets (`sheets.ts`): the girder ships (cruiser,
// corvette, minelayer), the Hive carrier, the Tidewall bulwark and the Orbital bastion. `ships.ts` puts them together.
import * as THREE from "three";
import { mulberry32 } from "@rustybuns/util";
import { Piece, V, beam, loft, rod, stationPoint, type Station } from "./piece.ts";
import type { BulwarkSheet, CorvetteSheet, GirderSheet, HiveSheet, MinelayerSheet, StationSheet } from "./sheets.ts";

/** The Bastion cruiser's pieces (and any girder-built Compact hull's), in the order they go on. */
export function girderPieces(s: GirderSheet): Record<string, Piece> {
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

/** The corvette: the girder ship at its least, with the gun slung under it. */
export function corvettePieces(s: CorvetteSheet): Record<string, Piece> {
  const cannon = new Piece(), c = s.cannon;
  cannon.add(rod(V(c.from, c.y, 0), V(c.to, c.y, 0), c.radius, 10), "iron");
  cannon.add(rod(V(c.to - 20, c.y, 0), V(c.to + 4, c.y, 0), c.radius * 1.5, 10), "ochre");
  cannon.add(new THREE.BoxGeometry(50, c.radius * 3, c.radius * 3), "rust", V(c.from + 25, c.y, 0));
  for (const x of [c.from + 30, (c.from + c.to) / 2]) cannon.add(new THREE.BoxGeometry(10, -c.y - s.spine.high / 2 + c.radius, 10), "iron", V(x, (c.y - s.spine.high / 2) / 2, 0));
  return { ...girderPieces(s), cannon };
}

/** A mine: a faceted ball with a spike out of each face it can reach with. */
function mine(p: Piece, at: THREE.Vector3, r: number) {
  p.add(new THREE.OctahedronGeometry(r * 0.72), "ochre", at);
  for (const d of [V(1, 0, 0), V(0, 1, 0), V(0, 0, 1)]) p.add(rod(at.clone().addScaledVector(d, -r), at.clone().addScaledVector(d, r), r * 0.09, 4), "iron");
  p.add(new THREE.BoxGeometry(r * 0.2, r * 0.2, r * 0.2), "fire", at.clone().add(V(0, r, 0)));
}

/** The minelayer: the girder ship with a rack of mines down each flank and a chute off the stern. */
export function minelayerPieces(s: MinelayerSheet): Record<string, Piece> {
  const racks = new Piece(), k = s.racks, pitch = (k.to - k.from) / k.count;
  for (const side of [1, -1]) {
    const z = side * k.z;
    for (const dy of [-k.mine, k.mine]) racks.add(beam(V(k.from, k.y + dy, z), V(k.to, k.y + dy, z), 6, 6), "iron");
    for (let i = 0; i <= k.count; i++) racks.add(new THREE.BoxGeometry(5, k.mine * 2, 5), "iron", V(k.from + i * pitch, k.y, z));
    for (let i = 0; i < k.count; i++) mine(racks, V(k.from + (i + 0.5) * pitch, k.y, z), Math.min(k.mine, pitch / 2) * 0.9);
    for (const x of [k.from, (k.from + k.to) / 2, k.to]) racks.add(beam(V(x, k.y, z), V(x, 0, side * s.spine.wide / 2), 8, 8), "iron");
  }
  const chute = new Piece(), c = s.chute, x0 = s.spine.from - s.drive.length, y0 = -s.spine.high / 2;
  const at = (u: number, z: number) => V(x0 + 60 - c.length * u, y0 - c.drop * u, z);
  for (const z of [-24, 24]) chute.add(beam(at(0, z), at(1, z), 7, 7), "iron");
  for (let i = 0; i <= 5; i++) chute.add(beam(at(i / 5, -24), at(i / 5, 24), 5, 5), "iron");
  for (let i = 0; i < c.count; i++) mine(chute, at((i + 0.6) / c.count, 0).add(V(0, 20, 0)), 18);
  return { ...girderPieces(s), racks, chute };
}

/** The Hive carrier's pieces. */
export function hivePieces(s: HiveSheet): Record<string, Piece> {
  const rand = mulberry32(s.seed), k = s.keel, c = s.combs;
  const keel = new Piece();
  keel.add(new THREE.BoxGeometry(k.to - k.from, k.high, k.wide), "rust", V((k.from + k.to) / 2, 0, 0));
  for (let x = k.from + k.bands / 2; x < k.to; x += k.bands) keel.add(new THREE.BoxGeometry(18, k.high + 14, k.wide + 14), "iron", V(x, 0, 0));

  const head = new Piece(), shape = new THREE.Shape();
  s.head.profile.forEach(([x, y], i) => (i ? shape.lineTo(x, y) : shape.moveTo(x, y)));
  shape.closePath();
  head.add(new THREE.ExtrudeGeometry(shape, { depth: s.head.wide, bevelEnabled: false }).translate(0, 0, -s.head.wide / 2), "rust");
  const front = Math.max(...s.head.profile.map(([x]) => x));
  head.add(new THREE.BoxGeometry(14, 10, s.head.wide + 16), "iron", V(front - 5, 0, 0));

  const combs = new Piece(), cells = new Piece(), len = c.to - c.from, mid = (c.from + c.to) / 2;
  for (const side of [1, -1]) {
    const z = side * c.z, face = z + (side * c.wide) / 2;
    combs.add(new THREE.BoxGeometry(len, c.high, c.wide), "ochre", V(mid, 0, z));
    for (const y of [c.high / 2, -c.high / 2]) combs.add(new THREE.BoxGeometry(len + 16, 12, c.wide + 12), "iron", V(mid, y, z));
    for (const x of c.pylons) combs.add(beam(V(x, 0, side * k.wide / 2), V(x, 0, z), 46, 36), "iron");
    // The comb: six-sided mouths, each row set half a cell along from the one under it, a lamp deep in most.
    const { rows, columns, radius } = s.cells, step = len / (columns + 0.5);
    for (let row = 0; row < rows; row++) for (let col = 0; col < columns; col++) {
      const at = V(c.from + step * (col + 0.5 + (row % 2) * 0.5), -c.high / 2 + (c.high / rows) * (row + 0.5), face);
      cells.add(new THREE.CylinderGeometry(radius, radius, 10, 6, 1, true).rotateX(Math.PI / 2), "iron", at.clone().add(V(0, 0, side * 4)));
      cells.add(new THREE.CircleGeometry(radius * 0.94, 6, Math.PI / 2).rotateY(side > 0 ? 0 : Math.PI), "iron", at.clone().add(V(0, 0, side)));
      if (rand() < 0.7) cells.add(new THREE.BoxGeometry(radius * 0.9, 4, 2), "lamp", at.clone().add(V(0, -radius * 0.45, side * 2)));
    }
  }

  const bridge = new Piece(), [bl, bh, bw] = s.bridge.size, by = k.high / 2 + s.bridge.lift + bh / 2, bx = s.bridge.x;
  bridge.add(new THREE.BoxGeometry(bl, bh, bw), "rust", V(bx, by, 0));
  bridge.add(new THREE.BoxGeometry(bl * 0.6, s.bridge.lift, bw * 0.4), "iron", V(bx - bl * 0.15, k.high / 2 + s.bridge.lift / 2, 0));
  bridge.add(rod(V(bx - bl * 0.3, by + bh / 2, 0), V(bx - bl * 0.3, by + bh / 2 + 50, 0), 4, 6), "iron");
  for (let i = 0; i < s.bridge.windows; i++) {
    const z = -bw * 0.42 + (bw * 0.84 * i) / Math.max(1, s.bridge.windows - 1);
    bridge.add(new THREE.BoxGeometry(2, 11, 9), "lamp", V(bx + bl / 2 + 1, by + bh * 0.1, z));
  }

  const drives = new Piece(), d = s.drives, x1 = k.from - d.length;
  for (const [z, y, r] of d.at) {
    drives.add(rod(V(k.from + 30, y, z), V(x1, y, z), r, 12), "rust");
    drives.add(new THREE.TorusGeometry(r + 2, 6, 4, 14).rotateY(Math.PI / 2), "iron", V(x1 + 18, y, z));
    drives.add(new THREE.CircleGeometry(r * 0.78, 12).rotateY(-Math.PI / 2), "fire", V(x1 - 1, y, z));
    if (Math.abs(z) > k.wide / 2 + r) drives.add(beam(V(k.from + 30, y, z), V(k.from + 30, y, Math.sign(z) * k.wide / 2), 30, 30), "iron");
  }

  const patches = new Piece(), lights = new Piece();
  for (let i = 0; i < s.patches.count; i++) {
    const x = k.from + 30 + rand() * (k.to - k.from - 60), w = s.patches.size * (0.4 + rand() * 0.6), h = s.patches.size * (0.3 + rand() * 0.5), side = rand() < 0.5 ? 1 : -1;
    if (rand() < 0.5) patches.add(new THREE.BoxGeometry(w, 2, h), "ochre", V(x, side * (k.high / 2 + 1), (rand() - 0.5) * (k.wide - h)));
    else patches.add(new THREE.BoxGeometry(w, h, 2), "rust", V(mid + (rand() - 0.5) * (len - w), (rand() - 0.5) * (c.high - h) * 0.5, side * (c.z - c.wide / 2 - 1)));
  }
  for (let i = 0; i < s.lights.count; i++) {
    const side = rand() < 0.5 ? 1 : -1, sz = s.lights.size;
    lights.add(new THREE.BoxGeometry(sz, sz * 0.6, 2), "lamp", V(k.from + 20 + rand() * (k.to - k.from - 40), (rand() - 0.5) * (k.high - 20), side * (k.wide / 2 + 1)));
  }
  return { keel, head, combs, cells, bridge, drives, patches, lights };
}

/** The body's cross-section at x, read between its stations. */
function sectionAt(stations: readonly Station[], x: number): Station {
  const i = Math.max(0, stations.findIndex((s, k) => k + 1 < stations.length && x <= stations[k + 1]![0]));
  const a = stations[i]!, b = stations[i + 1]!, u = (x - a[0]) / (b[0] - a[0]);
  const mix = (n: 1 | 2 | 3) => a[n] + (b[n] - a[n]) * u;
  return [x, mix(1), mix(2), mix(3)];
}

/** How many flat faces round the bulwark's body. */
const ROUND = 12;

/** The Tidewall bulwark's pieces. */
export function bulwarkPieces(s: BulwarkSheet): Record<string, Piece> {
  const rand = mulberry32(s.seed);
  const body = new Piece().add(loft(s.body, ROUND), "rust");
  const belly = new Piece().add(loft(s.belly.stations, 8).translate(0, -s.belly.drop, 0), "iron");

  const belts = new Piece();
  for (const i of s.belts.at) for (let k = 0; k < ROUND; k++) {
    const st = s.body[i]!;
    belts.add(beam(stationPoint(st, k, ROUND), stationPoint(st, k + 1, ROUND), s.belts.bar, s.belts.bar), "iron");
  }

  /** A point on the body at x, `a` radians round from starboard over the top, and the way out from there. */
  const skin = (x: number, a: number) => {
    const st = sectionAt(s.body, x), face = (a / (Math.PI * 2)) * ROUND, k = Math.floor(face);
    const at = stationPoint(st, k, ROUND).lerp(stationPoint(st, k + 1, ROUND), face - k);
    return { at, out: V(0, at.y / st[2] ** 2, at.z / st[1] ** 2).normalize() };
  };
  const stand = (out: THREE.Vector3) => new THREE.Euler().setFromQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), out));

  const blisters = new Piece(), size = s.blisters.size;
  for (const [x, count] of s.blisters.rings) for (let i = 0; i < count; i++) {
    const { at, out } = skin(x, ((i + 0.5) / count) * Math.PI), r = size * (0.7 + rand() * 0.3), turn = stand(out);
    blisters.add(new THREE.SphereGeometry(r, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.6, 1), "ochre", at, turn);
    blisters.add(new THREE.TorusGeometry(r, r * 0.12, 4, 10).rotateX(Math.PI / 2), "iron", at, turn);
  }

  const horns = new Piece();
  for (const x of s.horns.at) for (const a of [Math.PI / 4, (Math.PI * 3) / 4]) {
    const { at, out } = skin(x, a), end = at.clone().addScaledVector(out, s.horns.tall);
    horns.add(rod(at.clone().addScaledVector(out, -10), end, 12, 6), "iron");
    horns.add(new THREE.TorusGeometry(30, 6, 4, 12).rotateX(Math.PI / 2), "ochre", at.clone().lerp(end, 0.75), stand(out));
    horns.add(new THREE.SphereGeometry(17, 8, 6), "lamp", end);
  }

  const guns = new Piece(), g = s.guns;
  for (const x of g.at) for (const a of [0.12, Math.PI - 0.12]) {
    const { at, out } = skin(x, a), seat = at.clone().addScaledVector(out, g.block * 0.2);
    guns.add(new THREE.BoxGeometry(g.block, g.block * 0.7, g.block), "iron", seat);
    guns.add(rod(seat, seat.clone().add(V(g.barrel, 8, 0)), 9, 6), "iron");
  }

  const drives = new Piece(), d = s.drives, stern = s.body[0]![0];
  for (const [z, r] of d.at) {
    drives.add(rod(V(stern + 30, 0, z), V(stern - d.length, 0, z), r, 14), "iron");
    drives.add(new THREE.TorusGeometry(r, 9, 4, 16).rotateY(Math.PI / 2), "ochre", V(stern - d.length, 0, z));
    drives.add(new THREE.CircleGeometry(r * 0.8, 14).rotateY(-Math.PI / 2), "fire", V(stern - d.length - 4, 0, z));
  }

  const patches = new Piece(), lights = new Piece();
  const first = s.body[1]![0], last = s.body.at(-3)![0];
  for (let i = 0; i < s.patches.count; i++) {
    const { at, out } = skin(first + rand() * (last - first), rand() * Math.PI * 2), w = s.patches.size * (0.4 + rand() * 0.6);
    patches.add(new THREE.BoxGeometry(w, 6, w * 0.7), rand() < 0.5 ? "ochre" : "iron", at, stand(out));
  }
  for (let i = 0; i < s.lights.count; i++) {
    const { at, out } = skin(first + rand() * (last - first), rand() * Math.PI * 2);
    lights.add(new THREE.BoxGeometry(s.lights.size, 6, s.lights.size * 0.7), "lamp", at.addScaledVector(out, 1), stand(out));
  }
  return { body, belly, belts, blisters, horns, guns, drives, patches, lights };
}

/** The Orbital bastion's pieces. Its spindle stands along y: the scene turns it about that. */
export function stationPieces(s: StationSheet): Record<string, Piece> {
  const rand = mulberry32(s.seed), sp = s.spindle, r = s.ring;
  const round = (a: number, radius: number, y = 0) => V(Math.cos(a) * radius, y, Math.sin(a) * radius);

  const spindle = new Piece();
  spindle.add(new THREE.CylinderGeometry(sp.radius, sp.radius, sp.to - sp.from, 12), "rust", V(0, (sp.from + sp.to) / 2, 0));
  for (let i = 0; i < sp.collars; i++) {
    const y = sp.from + ((sp.to - sp.from) * (i + 0.5)) / sp.collars;
    spindle.add(new THREE.CylinderGeometry(sp.radius * 1.25, sp.radius * 1.25, 30, 12), "iron", V(0, y, 0));
  }

  const ring = new Piece(), spokes = new Piece();
  for (let i = 0; i < r.sides; i++) {
    const a = (i / r.sides) * Math.PI * 2, b = ((i + 1) / r.sides) * Math.PI * 2;
    ring.add(beam(round(a, r.radius), round(b, r.radius), r.wide, r.high), i % 3 ? "rust" : "ochre");
    ring.add(new THREE.BoxGeometry(r.wide * 1.2, r.high * 1.2, 30), "iron", round(a, r.radius), new THREE.Euler(0, -a, 0));
  }
  for (let i = 0; i < s.spokes.count; i++) {
    const a = (i / s.spokes.count) * Math.PI * 2;
    spokes.add(beam(round(a, sp.radius * 0.8), round(a, r.radius), s.spokes.wide, s.spokes.wide), "iron");
    spokes.add(beam(round(a, sp.radius * 0.9, sp.to * 0.7), round(a, r.radius * 0.72), 10, 10), "iron");
  }

  const modules = new Piece(), m = s.modules;
  for (let i = 0; i < m.count; i++) {
    const a = ((i + rand() * 0.6) / m.count) * Math.PI * 2, w = m.size * (0.5 + rand() * 0.5), h = m.size * (0.4 + rand() * 0.8);
    const up = rand() < 0.65 ? 1 : -1;
    modules.add(new THREE.BoxGeometry(r.wide * (0.7 + rand() * 0.4), h, w), rand() < 0.35 ? "ochre" : "rust", round(a, r.radius, up * (r.high / 2 + h / 2 - 4)), new THREE.Euler(0, -a, 0));
  }

  const docks = new Piece(), dk = s.docks;
  for (let i = 0; i < dk.count; i++) {
    const a = (i / dk.count) * Math.PI * 2, turn = new THREE.Euler(0, -a, 0);
    docks.add(beam(round(a, r.radius), round(a, dk.reach - 20), dk.wide, dk.wide), "iron");
    docks.add(new THREE.BoxGeometry(20, dk.wide * 0.8, dk.wide * 3), "rust", round(a, dk.reach - 10), turn);
    docks.add(new THREE.BoxGeometry(2, 8, dk.wide * 2.4), "lamp", round(a, dk.reach + 1), turn);
  }

  const guns = new Piece(), g = s.guns;
  for (let i = 0; i < g.count; i++) {
    // Set between the docks, on top of the ring, barrels out.
    const a = ((i + 0.5) / g.count) * Math.PI * 2, y = r.high / 2 + g.block * 0.4, turn = new THREE.Euler(0, -a, 0);
    guns.add(new THREE.BoxGeometry(g.block, g.block * 0.8, g.block), "iron", round(a, r.radius, y), turn);
    for (const off of [-0.012, 0.012]) guns.add(rod(round(a + off, r.radius + 20, y), round(a + off, r.radius + g.barrel, y + 6), 8, 6), "iron");
  }

  const dish = new Piece(), mast = new Piece(), d = s.dish, hub = V(sp.radius * 0.9, d.y, 0), tip = new THREE.Euler(0, 0, -0.55);
  const bowl = Array.from({ length: 5 }, (_, i) => new THREE.Vector2((d.radius * i) / 4, d.radius * 0.35 * (i / 4) ** 2));
  dish.add(new THREE.LatheGeometry(bowl, 16), "ochre", hub, tip);
  dish.add(new THREE.LatheGeometry([...bowl].reverse(), 16), "rust", hub, tip);
  dish.add(beam(V(0, sp.to, 0), hub, 26, 26), "iron");
  dish.add(rod(hub, hub.clone().add(V(0, d.radius * 0.7, 0).applyEuler(tip)), 6, 6), "iron");
  mast.add(rod(V(-40, sp.to, 0), V(-40, sp.to + s.mast.tall, 0), 10, 6), "iron");
  for (const u of [0.45, 0.75]) mast.add(new THREE.BoxGeometry(12, 8, 120 * (1.4 - u)), "iron", V(-40, sp.to + s.mast.tall * u, 0));
  mast.add(new THREE.SphereGeometry(14, 8, 6), "lamp", V(-40, sp.to + s.mast.tall, 0));

  const lights = new Piece();
  for (let i = 0; i < s.lights.count; i++) {
    const a = rand() * Math.PI * 2, sz = s.lights.size;
    if (rand() < 0.7) lights.add(new THREE.BoxGeometry(2, sz * 0.7, sz), "lamp", round(a, r.radius * Math.cos(Math.PI / r.sides) + r.wide / 2 + 3, (rand() - 0.5) * r.high * 0.6), new THREE.Euler(0, -a, 0));
    else lights.add(new THREE.BoxGeometry(2, sz, sz * 0.7), "lamp", round(a, sp.radius + 1, sp.from + rand() * (sp.to - sp.from)), new THREE.Euler(0, -a, 0));
  }
  return { spindle, ring, spokes, modules, docks, guns, dish, mast, lights };
}
