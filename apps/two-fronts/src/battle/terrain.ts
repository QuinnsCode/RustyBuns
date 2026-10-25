// The world a ground battle is fought in, for the eye only: the sim stays a flat plain, and none
// of this changes a shot or a step. Doren, the forest moon, is the look: redwoods going up into
// haze, sun coming down through the canopy in shafts, ferns everywhere, a red dirt trail worn
// between the posts. The floor rolls a little (units stand on it), and rises into wooded banks
// past the edge of the field. The jungle is the same idea, closer, wetter and full of vines; the
// canyon is red rock under an open sky with the gas giant hanging in it.
//
// On the Wooka's end of the field the trees are lived in: huts up the trunks, rope bridges
// between them, and totems wearing the helmets of Marines who came this way before.
import * as THREE from "three";
import { FLOORS, buildFoliage, foliageQuality, instancer, makeWind, mergeAll } from "./foliage.ts";
import { hut, lumpy, texture, totem } from "./models.ts";
import { LANDMARKS } from "./landmarks.ts";
import { WORLDS } from "./worlds.ts";
import { EYE, POST_RADIUS, type Battle, type Block, type Tree } from "./sim.ts";
import { buildSea, coastOf, headland } from "./worlds/beach.ts";

export interface World {
  heightAt(x: number, z: number): number;
  // Each frame: where the camera is and what it looks at, for the sun's shadow box and the motes.
  update(t: number, eye: THREE.Vector3, at: { x: number; z: number }): void;
}

const SUN_DIR = new THREE.Vector3(0.42, 0.8, 0.43).normalize();

// --- Noise: value noise and its octaves, the same for a seed every time. ---
function noise(seed: number) {
  const hash = (i: number, j: number) => {
    let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ seed;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const sm = (t: number) => t * t * (3 - 2 * t);
  const n = (x: number, z: number) => {
    const i = Math.floor(x), j = Math.floor(z), fx = sm(x - i), fz = sm(z - j);
    const a = hash(i, j), b = hash(i + 1, j), c = hash(i, j + 1), d = hash(i + 1, j + 1);
    return (a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz) * 2 - 1;
  };
  return (x: number, z: number, octaves = 3) => {
    let s = 0, amp = 1, f = 1, total = 0;
    for (let o = 0; o < octaves; o++) { s += n(x * f + o * 17.3, z * f - o * 9.1) * amp; total += amp; amp *= 0.5; f *= 2; }
    return s / total;
  };
}
const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const segDist = (px: number, pz: number, a: { x: number; z: number }, b: { x: number; z: number }) => {
  const dx = b.x - a.x, dz = b.z - a.z, t = Math.max(0, Math.min(1, ((px - a.x) * dx + (pz - a.z) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(px - a.x - dx * t, pz - a.z - dz * t);
};
const blockGap = (k: Block, x: number, z: number) => Math.hypot(Math.max(0, Math.abs(x - k.x) - k.w / 2), Math.max(0, Math.abs(z - k.z) - k.d / 2));

// --- Textures, grey so a colour tints them. ---
const grey = (v: number, a = 1) => `rgba(${v | 0},${v | 0},${v | 0},${a})`;
// The forest floor up close: needles, leaf litter and pebbles.
const floorMap = () => texture("floor", 256, 256, [90, 90], (c, r) => {
  c.fillStyle = grey(175); c.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2600; i++) {
    const x = r() * 256, y = r() * 256, a = r() * Math.PI, l = 2 + r() * 7;
    c.strokeStyle = grey(110 + r() * 140, 0.55); c.lineWidth = 1 + r();
    c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); c.stroke();
  }
  for (let i = 0; i < 260; i++) { c.fillStyle = grey(90 + r() * 160, 0.6); c.beginPath(); c.ellipse(r() * 256, r() * 256, 1 + r() * 3, 1 + r() * 2, r() * 3, 0, 7); c.fill(); }
});
// Redwood bark: long fibrous ridges, split now and then.
const barkMap = () => texture("redwood-bark", 128, 512, [4, 24], (c, r) => {
  c.fillStyle = grey(150); c.fillRect(0, 0, 128, 512);
  for (let i = 0; i < 160; i++) {
    let x = r() * 128;
    const w = 1 + r() * 5;
    c.strokeStyle = grey(r() < 0.55 ? 60 + r() * 50 : 180 + r() * 60, 0.55); c.lineWidth = w;
    c.beginPath(); c.moveTo(x, 0);
    for (let y = 0; y <= 512; y += 32) { x += (r() - 0.5) * 3; c.lineTo(x, y); }
    c.stroke();
  }
  for (let i = 0; i < 90; i++) { c.fillStyle = grey(45, 0.55); c.fillRect(r() * 128, r() * 512, 2 + r() * 10, 1 + r() * 2); }
});
// A fern frond: a stem with leaflets down both sides, cut out with alpha.
const frondMap = () => texture("frond", 64, 256, [1, 1], (c, r) => {
  c.clearRect(0, 0, 64, 256);
  c.strokeStyle = grey(150); c.lineWidth = 2.5;
  c.beginPath(); c.moveTo(32, 256); c.lineTo(32, 6); c.stroke();
  for (let y = 250; y > 10; y -= 9) {
    const k = Math.sin(((256 - y) / 256) * Math.PI * 0.95), l = 6 + 22 * k;
    for (const s of [-1, 1]) {
      c.fillStyle = grey(200 + r() * 55);
      c.beginPath(); c.ellipse(32 + s * l * 0.55, y - 3, l * 0.55, 3.4, s * -0.35, 0, 7); c.fill();
    }
  }
});
// Red rock in layers.
const strataMap = () => texture("strata", 128, 256, [2, 2], (c, r) => {
  for (let y = 0; y < 256; y += 2) { c.fillStyle = grey(120 + 60 * Math.sin(y * 0.11 + Math.sin(y * 0.03) * 3) + r() * 25); c.fillRect(0, y, 128, 2); }
  for (let i = 0; i < 300; i++) { c.fillStyle = grey(r() < 0.5 ? 70 : 220, 0.35); c.fillRect(r() * 128, r() * 256, 1 + r() * 8, 1); }
});
// Concrete: panels, stains running down, and a band of window slits for the tall ones.
const concreteMap = () => texture("concrete", 128, 128, [1, 1], (c, r) => {
  c.fillStyle = grey(185); c.fillRect(0, 0, 128, 128);
  c.strokeStyle = grey(120, 0.7); c.strokeRect(0.5, 0.5, 127, 127); c.beginPath(); c.moveTo(0, 64); c.lineTo(128, 64); c.stroke();
  for (let i = 0; i < 26; i++) { c.fillStyle = grey(110, 0.18); c.fillRect(r() * 128, r() * 64, 1 + r() * 3, 20 + r() * 60); }
  c.fillStyle = grey(25); for (let x = 10; x < 128; x += 30) c.fillRect(x, 26, 16, 6);
});
// A soft blob: the sun's shafts, the dapples they leave, the motes.
const glowMap = (name: string, long: boolean) => texture(name, 64, long ? 256 : 64, [1, 1], (c) => {
  const h = long ? 256 : 64;
  if (long) {
    const g = c.createLinearGradient(0, 0, 64, 0);
    g.addColorStop(0, grey(255, 0)); g.addColorStop(0.5, grey(255, 1)); g.addColorStop(1, grey(255, 0));
    c.fillStyle = g; c.fillRect(0, 0, 64, h);
    const v = c.createLinearGradient(0, 0, 0, h);
    v.addColorStop(0, grey(0, 1)); v.addColorStop(0.25, grey(0, 0)); v.addColorStop(0.7, grey(0, 0)); v.addColorStop(1, grey(0, 1));
    c.globalCompositeOperation = "destination-out"; c.fillStyle = v; c.fillRect(0, 0, 64, h);
  } else {
    const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, grey(255, 1)); g.addColorStop(1, grey(255, 0));
    c.fillStyle = g; c.fillRect(0, 0, 64, 64);
  }
});

const std = (color: number, roughness = 0.9, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness, metalness: 0, ...extra });
const additive = (map: THREE.Texture | null, color: number, opacity: number) =>
  new THREE.MeshBasicMaterial({ map, color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, side: THREE.DoubleSide });

export function buildWorld(scene: THREE.Scene, b: Battle): World {
  const spec = b.spec;
  const look = WORLDS[spec.sector];
  const n = noise(spec.seed | 0);
  let s = (spec.seed ^ 0x9e3779b9) >>> 0;
  const r = () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), k = new THREE.Vector3(), col = new THREE.Color();
  const UP = new THREE.Vector3(0, 1, 0);
  const keep = b.posts.at(-1)!;
  const wookaSide = spec.factions.attacker === "wooka" ? "attacker" : spec.factions.defender === "wooka" ? "defender" : null;

  // The trail the fighting wears in: from the attacker's drop, through each post, to the keep and
  // on to the defender's end, wandering a little.
  const trail = [b.spawn.attacker, ...b.posts, b.spawn.defender];
  const wander = (x: number, z: number) => x + n(z / 40, 3.7) * 6;
  const onTrail = (x: number, z: number) => {
    const wx = wander(x, z);
    let d = Infinity;
    for (let i = 1; i < trail.length; i++) d = Math.min(d, segDist(wx, z, trail[i - 1]!, trail[i]!));
    return d;
  };

  // The floor: flat where the posts and the scenery stand (the sim's plain), rolling between, and
  // rising into banks past the edge of the field.
  const amp = look.amp, sea = look.sea;
  const heightAt = (x: number, z: number) => {
    let flat = 1;
    for (const post of b.posts) flat = Math.min(flat, smooth(POST_RADIUS + 2, POST_RADIUS + 16, Math.hypot(x - post.x, z - post.z)));
    for (const blk of b.blocks) flat = Math.min(flat, smooth(1, 7, blockGap(blk, x, z)));
    let h = (n(x / 34, z / 34, 3) * amp + n(x / 8, z / 8, 2) * 0.25) * flat;
    h -= 0.25 * (1 - smooth(1.5, 4, onTrail(x, z)));
    const out = Math.max(Math.abs(x), Math.abs(z)) - b.half;
    if (sea) {
      // The sand runs down into the shallows (ankle-deep by the edge), drops off into the sea past it,
      // and the banks give way to open water on that side; a headland of rock stands behind the gun.
      const coast = coastOf(b, n, x, z);
      h = h * (1 - smooth(-25, 5, coast)) - 0.007 * Math.max(0, coast) - 7 * (1 - Math.exp(-Math.max(0, x - b.half) / 25)) + headland(b, x, z);
      if (out > 0) h += look.bank * (1 - Math.exp(-out / 40)) * (0.75 + 0.5 * n(x / 60, z / 60, 2)) * (1 - smooth(b.half - 80, b.half, x));
      return h;
    }
    if (out > 0) h += look.bank * (1 - Math.exp(-out / 40)) * (0.75 + 0.5 * n(x / 60, z / 60, 2)) + n(x / 12, z / 12) * out * 0.04;
    return h;
  };

  // --- Sky, haze and light ---
  scene.background = new THREE.Color(look.sky);
  scene.fog = new THREE.FogExp2(look.sky, look.fog);
  const skyGeo = new THREE.SphereGeometry(900, 24, 12);
  const skyCols: number[] = [];
  const pos = skyGeo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    col.setHex(look.sky).lerp(new THREE.Color(look.zenith), smooth(0.05, 0.7, pos.getY(i) / 900));
    skyCols.push(col.r, col.g, col.b);
  }
  skyGeo.setAttribute("color", new THREE.Float32BufferAttribute(skyCols, 3));
  const sky = new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
  sky.renderOrder = -1;
  scene.add(sky);
  // The gas giant Doren circles, banded, with a thin ring; it shows through the gaps.
  const giant = new THREE.Group();
  const bands = texture("giant", 64, 128, [1, 1], (c, rr) => { for (let y = 0; y < 128; y += 4) { c.fillStyle = grey(150 + 70 * Math.sin(y * 0.2 + rr() * 2)); c.fillRect(0, y, 64, 4); } });
  giant.add(new THREE.Mesh(new THREE.SphereGeometry(120, 32, 16), new THREE.MeshBasicMaterial({ map: bands, color: 0xc9d8c8, fog: false, transparent: true, opacity: 0.55, depthWrite: false })));
  const giantRing = new THREE.Mesh(new THREE.RingGeometry(150, 200, 64), new THREE.MeshBasicMaterial({ color: 0xe8e0c8, fog: false, transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false }));
  giantRing.rotation.x = 1.25;
  giant.add(giantRing);
  giant.position.set(-380, 420, -620);
  giant.rotation.set(-0.6, 0, 0.35); // its bands face the field, not its pole
  giant.children.forEach((c) => (c.renderOrder = -1));
  if (look.giant) scene.add(giant);

  scene.add(new THREE.HemisphereLight(look.hemi[0], look.hemi[1], look.hemi[2]));
  const sun = new THREE.DirectionalLight(look.sun, look.sunI);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -70, right: 70, top: 70, bottom: -70, near: 1, far: 500 });
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.05;
  scene.add(sun, sun.target);

  // --- The floor ---
  const SIZE = b.half * 5, SEG = 260;
  const groundGeo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG).rotateX(-Math.PI / 2);
  const gp = groundGeo.attributes.position as THREE.BufferAttribute, gc: number[] = [];
  const base = new THREE.Color(look.ground), litter = new THREE.Color(look.litter), dirt = new THREE.Color(look.trail);
  const mossy = new THREE.Color(0x2f4a1c);
  const paved = new THREE.Color(look.pave ?? 0);
  const wetSand = new THREE.Color(0x9a8660), clearSand = new THREE.Color(0xd9d09a), seabed = new THREE.Color(0x3f7c84), trench = new THREE.Color(0x174a66), cliffRock = new THREE.Color(0x9b8d74);
  for (let i = 0; i < gp.count; i++) {
    const x = gp.getX(i), z = gp.getZ(i), h = heightAt(x, z);
    gp.setY(i, h);
    col.copy(base).lerp(litter, smooth(-0.3, 0.6, n(x / 14 + 40, z / 14, 3)));
    col.lerp(mossy, smooth(-0.1, 0.7, n(x / 10 - 30, z / 10 + 8, 3)) * FLOORS[spec.sector].mossAmount);
    if (sea) {
      // Wet sand at the waterline, then the sea floor darkening with depth, and bare rock up the headland.
      const depth = sea.level - h;
      col.lerp(wetSand, smooth(sea.level + 1, sea.level, h) * smooth(-10, 0, coastOf(b, n, x, z)) * 0.85).lerp(clearSand, smooth(0, 0.6, depth) * 0.45);
      col.lerp(seabed, smooth(0.5, 4, depth)).lerp(trench, smooth(3.5, 7, depth));
      col.lerp(cliffRock, smooth(1.2, 4.5, headland(b, x, z)) * 0.9);
    }
    if (look.strata) col.offsetHSL(0, 0, 0.06 * Math.sin(h * 1.7));
    const t = onTrail(x, z);
    col.lerp(dirt, 1 - smooth(1.5, 5.5, t + n(x / 3, z / 3) * 1.5));
    if (look.pave !== null) for (const post of b.posts) col.lerp(paved, 1 - smooth(POST_RADIUS + 4, POST_RADIUS + 9, Math.hypot(x - post.x, z - post.z) + n(x / 4, z / 4) * 2));
    col.multiplyScalar(0.85 + 0.3 * n(x / 5, z / 5, 2));
    gc.push(col.r, col.g, col.b);
  }
  groundGeo.setAttribute("color", new THREE.Float32BufferAttribute(gc, 3));
  groundGeo.computeVertexNormals();
  const ground = new THREE.Mesh(groundGeo, std(0xffffff, 1, { vertexColors: true, map: floorMap() }));
  ground.receiveShadow = true;
  scene.add(ground);

  // Where nothing grows: the posts' middles, the trail, the scenery and the trunks.
  const bare = (x: number, z: number, room = 1.5) =>
    onTrail(x, z) < 3.5 || (sea !== null && heightAt(x, z) < sea.level + 0.35) || b.posts.some((post) => Math.hypot(x - post.x, z - post.z) < 5) ||
    b.blocks.some((blk) => blockGap(blk, x, z) < room) || b.trees.some((t) => Math.hypot(x - t.x, z - t.z) < t.r + 0.3);
  const anywhere = (spread = 1) => ({ x: (r() - 0.5) * b.half * 2 * spread, z: (r() - 0.5) * b.half * 2 * spread });
  const { inst, put, done } = instancer(scene);
  const wind = makeWind(), Q = foliageQuality();

  // Fern fronds, and the leaf material every frond and clump shares: it sways, and bends away from units.
  const frond = new THREE.PlaneGeometry(0.55, 1.5, 1, 6).translate(0, 0.75, 0);
  const fp = frond.attributes.position as THREE.BufferAttribute;
  for (let v = 0; v < fp.count; v++) { const y = fp.getY(v), f = y / 1.5; fp.setXYZ(v, fp.getX(v), Math.sin(f * 2.1) * 0.75, -f * 1.25); }
  const fronds: THREE.BufferGeometry[] = [];
  const per = look.trees === "jungle" ? 9 : 8;
  for (let i = 0; i < per; i++) fronds.push(frond.clone().rotateX(-0.15 * (i % 3)).rotateY((i / per) * Math.PI * 2 + (i % 2) * 0.3));
  const fernGeo = mergeAll(fronds);
  fernGeo.computeVertexNormals();
  
  const frondTex = frondMap();
  const leafMat = wind.patch(std(0xffffff, 0.85, { map: frondTex, alphaTest: 0.45, side: THREE.DoubleSide }), { h: 1.5, amp: 0.1, bend: 1.4 });

  // --- The trees: the field's trunks (the sim's, which block), and more on the banks behind. ---
  let allTrees: Tree[] = b.trees;
  if (look.trees) {
    const jungle = look.trees === "jungle";
    const back: Tree[] = [];
    for (let i = 0; i < (jungle ? 420 : 320); i++) {
      const a = r() * Math.PI * 2, d = b.half + 4 + r() * b.half * 1.3;
      const x = Math.max(-1, Math.min(1, Math.cos(a) * 1.5)) * d, z = Math.max(-1, Math.min(1, Math.sin(a) * 1.5)) * d;
      back.push({ x, z, r: jungle ? 0.6 + r() : 1.4 + r() * 2.6 });
    }
    const all = [...b.trees, ...back];
    allTrees = all;
    const trunkGeo = jungle
      ? new THREE.LatheGeometry([[0, -0.02], [1.6, -0.02], [1.15, 0.015], [1, 0.04], [0.85, 0.5], [0.6, 1]].map(([x, y]) => new THREE.Vector2(x, y)), 10)
      : new THREE.LatheGeometry([[0, -0.02], [2.1, -0.02], [1.45, 0.008], [1.12, 0.025], [1, 0.05], [0.82, 0.55], [0.5, 1]].map(([x, y]) => new THREE.Vector2(x, y)), 16);
    const mossGeo = new THREE.LatheGeometry([[2.25, -0.02], [1.55, 0.008], [1.16, 0.022], [1.03, 0.034], [0, 0.034]].map(([x, y]) => new THREE.Vector2(x, y)), 16);
    const trunks = inst(trunkGeo, std(jungle ? 0x7a7050 : 0xa0532f, 0.95, { map: barkMap() }), all.length, true);
    const moss = inst(mossGeo, std(0x4a6224, 1, { map: barkMap() }), all.length);
    // Boughs: thin limbs off the upper trunk, each ending in a clump of needles; a few dead twigs lower down.
    const limbs = inst(new THREE.CylinderGeometry(0.5, 1, 1, 5).translate(0, 0.5, 0), std(0x5a3622, 1), all.length * 8, true);
    const clumps = inst(fernGeo, leafMat, all.length * (jungle ? 6 : 14), true);
    const branch = (x: number, y: number, z: number, a: number, len: number, droop: number, rad: number) => {
      q.setFromEuler(new THREE.Euler(0, a, Math.PI / 2 - droop, "YXZ"));
      put(limbs, m.compose(p.set(x, y, z), q, k.set(rad, len, rad)));
      return { x: x + Math.cos(a) * Math.cos(droop) * len, y: y - Math.sin(droop) * len, z: z - Math.sin(a) * Math.cos(droop) * len };
    };
    for (const t of all) {
      const y0 = heightAt(t.x, t.z), h = jungle ? 22 + r() * 18 : 75 + r() * 55, turn = r() * 6;
      put(trunks, m.compose(p.set(t.x, y0, t.z), q.setFromAxisAngle(UP, turn), k.set(t.r, h, t.r)));
      put(moss, m.compose(p.set(t.x, y0, t.z), q.setFromAxisAngle(UP, turn), k.set(t.r, h, t.r)));
      const limbsOn = jungle ? 3 : 8;
      for (let j = 0; j < limbsOn; j++) {
        const f = jungle ? 0.7 + r() * 0.25 : 0.35 + (j / limbsOn) * 0.6, a = r() * Math.PI * 2;
        const rr = t.r * (1 - f * (jungle ? 0.4 : 0.5)), len = (jungle ? 4 : 6 + (1 - f) * 10) * (0.7 + r() * 0.6);
        const end = branch(t.x + Math.cos(a) * rr, y0 + h * f, t.z - Math.sin(a) * rr, a, len, jungle ? -0.3 : 0.1 + r() * 0.3, jungle ? 0.25 : 0.18 + t.r * 0.06);
        if (!jungle && f < 0.5) continue; // the low ones are bare, dead twigs
        for (let c = 0; c < (jungle ? 2 : 3); c++) {
          const w = (jungle ? 2.6 : 2 + (1 - f) * 2.5) * (0.7 + r() * 0.6);
          col.setHSL(jungle ? 0.27 + r() * 0.06 : 0.24 + r() * 0.06, 0.5, (jungle ? 0.3 : 0.26) + r() * 0.1);
          put(clumps, m.compose(p.set(end.x + (r() - 0.5) * 3, end.y - 1 + r() * 2, end.z + (r() - 0.5) * 3), q.setFromEuler(new THREE.Euler((r() - 0.5) * 0.5, r() * 6, (r() - 0.5) * 0.5)), k.set(w, w * 0.8, w)), col);
        }
      }
      // A crown on top, lost in the haze.
      col.setHSL(0.26, 0.45, 0.22 + r() * 0.06);
      put(clumps, m.compose(p.set(t.x, y0 + h * 0.97, t.z), q.setFromAxisAngle(UP, r() * 6), k.set(t.r * 2 + 3, 4, t.r * 2 + 3)), col);
    }
    done(limbs, clumps, trunks, moss);

    // The undergrowth: ferns most of all, bushes, logs, stumps, mushrooms.
    const nFerns = Math.round((jungle ? 3200 : 3000) * Q);
    const ferns = inst(fernGeo, leafMat, nFerns);
    for (let i = 0; i < nFerns * 3 && ferns.count < nFerns; i++) {
      // Ferns crowd round the trunks and thin out in the open.
      const nearTree = r() < 0.55 ? all[Math.floor(r() * b.trees.length)] : undefined;
      const at = nearTree ? { x: nearTree.x + (r() - 0.5) * 14, z: nearTree.z + (r() - 0.5) * 14 } : anywhere(1.15);
      if (bare(at.x, at.z)) continue;
      const sz = (jungle ? 1.1 : 0.9) + r() * 1.6;
      col.setHSL(0.21 + r() * 0.08, 0.5 + r() * 0.2, 0.3 + r() * 0.16);
      put(ferns, m.compose(p.set(at.x, heightAt(at.x, at.z) - 0.05, at.z), q.setFromAxisAngle(UP, r() * 6), k.set(sz, sz * (0.8 + r() * 0.4), sz)), col);
    }
    const nBush = Math.round(320 * Q), bushes = inst(fernGeo, leafMat, nBush, true);
    for (let i = 0; i < 1200 && bushes.count < nBush; i++) {
      const at = anywhere(1.2);
      if (bare(at.x, at.z, 3)) continue;
      const w = 2.4 + r() * 2;
      col.setHSL(0.24 + r() * 0.07, 0.45, 0.2 + r() * 0.08);
      put(bushes, m.compose(p.set(at.x, heightAt(at.x, at.z) - 0.1, at.z), q.setFromAxisAngle(UP, r() * 6), k.set(w, w * 1.1, w)), col);
    }
    // Round, cheerful bushes: lumpy green balls in bunches, some with red and yellow berries or little
    // flowers on them, a touch toy-like. Thick enough to hide a Wooka's silhouette, never in the way.
    const nPuff = jungle ? 90 : 150;
    const puffGeo = lumpy(1, 2, 0.12, 21, true);
    const puffs = inst(puffGeo, wind.patch(std(0xffffff, 0.8), { h: 2, amp: 0.06, bend: 1 }), nPuff * 4, true);
    const dots = inst(new THREE.SphereGeometry(0.16, 6, 4), std(0xffffff, 0.5), nPuff * 10, true);
    for (let i = 0, made = 0; i < 1200 && made < nPuff; i++) {
      const at = anywhere(1.15);
      if (bare(at.x, at.z, 3) || onTrail(at.x, at.z) < 3) continue;
      made++;
      const w = 1.1 + r() * 1.3, hue = 0.25 + r() * 0.08, fruit = r() < 0.55 ? (r() < 0.5 ? 0.0 : 0.13) : -1;
      for (let j = 0; j < 4; j++) {
        const px = at.x + (r() - 0.5) * w * 1.6, pz = at.z + (r() - 0.5) * w * 1.6, ps = w * (0.55 + r() * 0.45);
        col.setHSL(hue + (r() - 0.5) * 0.03, 0.55, 0.3 + r() * 0.12);
        put(puffs, m.compose(p.set(px, heightAt(px, pz) + ps * 0.6, pz), q.setFromAxisAngle(UP, r() * 6), k.set(ps, ps * 0.8, ps)), col);
        if (fruit >= 0) for (let d = 0; d < 2; d++) {
          const a = r() * 6.28, e = 0.3 + r() * 0.9;
          col.setHSL(fruit, 0.9, 0.5);
          put(dots, m.compose(p.set(px + Math.cos(a) * ps * 0.85 * Math.cos(e), heightAt(px, pz) + ps * (0.6 + Math.sin(e) * 0.7), pz + Math.sin(a) * ps * 0.85 * Math.cos(e)), q.identity(), k.set(1, 1, 1)), col);
        }
      }
    }
    for (const mesh of [puffs, dots]) { mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true; }
    const logs = inst(new THREE.CylinderGeometry(1, 1, 1, 12), std(0x6a4128, 0.95, { map: barkMap() }), 18, true);
    const logMoss = inst(new THREE.CylinderGeometry(1.05, 1.05, 0.98, 12, 1, true, Math.PI / 2 - 0.9, 1.8), std(0x3d5520, 1, { map: barkMap() }), 18);
    for (let i = 0; i < 200 && logs.count < 18; i++) {
      const at = anywhere(0.95);
      if (bare(at.x, at.z, 4) || onTrail(at.x, at.z) < 8) continue;
      const len = 10 + r() * 14, rad = 0.6 + r() * 0.6;
      q.setFromEuler(new THREE.Euler(0, r() * Math.PI, Math.PI / 2, "YXZ"));
      m.compose(p.set(at.x, heightAt(at.x, at.z) + rad * 0.8, at.z), q, k.set(rad, len, rad));
      put(logs, m); put(logMoss, m);
    }
    const stumps = inst(new THREE.CylinderGeometry(0.85, 1.15, 1, 12), std(0x7a4a2c, 0.95, { map: barkMap() }), 26, true);
    const stumpTops = inst(new THREE.CircleGeometry(0.85, 12).rotateX(-Math.PI / 2).translate(0, 0.5, 0), std(0xc89a68, 0.9), 26);
    for (let i = 0; i < 200 && stumps.count < 26; i++) {
      const at = anywhere(1);
      if (bare(at.x, at.z, 2)) continue;
      const rad = 0.6 + r() * 1.2, h = 0.6 + r() * 1.6;
      m.compose(p.set(at.x, heightAt(at.x, at.z) + h / 2 - 0.1, at.z), q.setFromAxisAngle(UP, r() * 6), k.set(rad, h, rad));
      put(stumps, m); put(stumpTops, m);
    }
    const shrooms = inst(new THREE.SphereGeometry(0.18, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), std(0xffffff, 0.6, jungle ? { emissive: 0x2a6a5a } : {}), 240);
    for (let i = 0; i < 40; i++) {
      const t = b.trees[Math.floor(r() * b.trees.length)];
      if (!t) break;
      const a = r() * 6;
      for (let j = 0; j < 6; j++) {
        const x = t.x + Math.cos(a + j * 0.25) * (t.r + 0.5 + r()), z = t.z + Math.sin(a + j * 0.25) * (t.r + 0.5 + r()), sz = 0.5 + r() * 1.3;
        col.setHex(jungle ? 0x9ff0d8 : r() < 0.5 ? 0xd8c8a0 : 0xb8502c);
        put(shrooms, m.compose(p.set(x, heightAt(x, z) + 0.05, z), q.identity(), k.set(sz, sz * 0.7, sz)), col);
      }
    }
  }

  // The forest floor and the jungle's storeys: foliage.ts.
  const foliage = buildFoliage({
    scene, b, kind: spec.sector, r, n, heightAt, bare, trees: allTrees, trail, shiftAt: (z) => n(z / 40, 3.7) * 6,
    fernGeo, frond: frondTex, bark: barkMap(), wind, fog: new THREE.Color(look.sky),
  });

  // Rocks, mossy in the woods, red in the canyon.
  const rocks = inst(lumpy(1, 2, 0.22, 3, false), std(look.rock.color, 0.95, { map: strataMap() }), look.rock.n, true);
  for (let i = 0; i < 1000 && rocks.count < rocks.instanceMatrix.count; i++) {
    const at = anywhere(1.3);
    if (bare(at.x, at.z, 2)) continue;
    const out = Math.max(Math.abs(at.x), Math.abs(at.z)) > b.half;
    const sz = out ? 2 + r() * 6 : 0.4 + r() * 1.1;
    col.setHSL(look.rock.h, look.rock.s, 0.7 + r() * 0.3);
    put(rocks, m.compose(p.set(at.x, heightAt(at.x, at.z) + sz * 0.2, at.z), q.setFromEuler(new THREE.Euler(r(), r() * 6, r())), k.set(sz * 1.3, sz * 0.8, sz)), col);
  }

  // --- The Wooka's end: huts up the trunks nearest their drop, bridges between, and totems. ---
  if (wookaSide && look.trees) {
    const home = b.spawn[wookaSide];
    const near = [...b.trees].filter((t) => t.r > 1).sort((a, c) => Math.hypot(a.x - home.x, a.z - home.z) - Math.hypot(c.x - home.x, c.z - home.z)).slice(0, 6);
    const decks: THREE.Vector3[] = [];
    near.forEach((t, i) => {
      const h = hut(), y = heightAt(t.x, t.z) + (look.trees === "jungle" ? 9 : 13) + (i % 3) * 3;
      h.position.set(t.x, y, t.z);
      h.rotation.y = r() * 6;
      h.scale.setScalar(look.trees === "jungle" ? 0.75 : 1);
      scene.add(h);
      decks.push(new THREE.Vector3(t.x, y + 0.2, t.z));
    });
    const ropeMat = std(0xb89a5a, 1), plankMat = std(0x7a4f2a, 1);
    for (let i = 1; i < decks.length; i++) {
      const a = decks[i - 1]!, c = decks[i]!, len = a.distanceTo(c);
      if (len > 45) continue;
      const mid = a.clone().lerp(c, 0.5).add(new THREE.Vector3(0, -len * 0.12, 0));
      const curve = new THREE.QuadraticBezierCurve3(a, mid, c);
      scene.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.5, 4, false), plankMat));
      for (const side of [-1, 1]) {
        const off = new THREE.Vector3(-(c.z - a.z), 0, c.x - a.x).normalize().multiplyScalar(side * 0.7).add(new THREE.Vector3(0, 1.1, 0));
        scene.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(a.clone().add(off), mid.clone().add(off), c.clone().add(off)), 24, 0.05, 4, false), ropeMat));
      }
    }
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + r() * 0.4, d = 14 + r() * 12;
      const x = home.x + Math.cos(a) * d, z = home.z + Math.sin(a) * d;
      if (bare(x, z, 2)) continue;
      const t = totem();
      t.position.set(x, heightAt(x, z), z);
      t.rotation.y = Math.atan2(-(0 - x), -(0 - z)) + (r() - 0.5) * 0.6; // they face the field
      scene.add(t);
    }
  }

  // --- The scenery the sim laid out: walls of sandbags, and buildings, bunkers or rock. ---
  const bag = new THREE.CapsuleGeometry(0.17, 0.45, 2, 6).rotateZ(Math.PI / 2).scale(1, 0.85, 1.4);
  let nBags = 0;
  for (const blk of b.blocks) if (blk.h < EYE && !blk.kind) nBags += Math.ceil(blk.w / 0.85) * Math.ceil(blk.d / 0.55) * Math.ceil(blk.h / 0.3);
  const bags = inst(bag, std(0xffffff, 1), nBags, true);
  const rockMat = std(look.rocky ? 0xa45a36 : look.stone, 0.95, { map: strataMap() });
  const builtMat = std(look.built, 0.85, { map: concreteMap() });
  const rocky = look.rocky;
  // Cover in the woods: rocks, stumps and fallen logs, and the Wooka's trench lines, earth
  // banked up behind a row of sharpened stakes leaning out at whoever's coming.
  const barkMat = std(look.wood, 0.95, { map: barkMap() }), cutMat = std(0xc89a62, 0.9), dirtMat = std(0x5a3b22, 1, { flatShading: true }), stakeMat = std(0x8a6a44, 0.9);
  const plankMat = std(0x6a4a2a, 0.95, { map: barkMap() }), bannerMat = std(0xb3261e, 0.9, { side: THREE.DoubleSide }), lanternMat = new THREE.MeshBasicMaterial({ color: 0xffb347 }), sackMat = std(0xb89a5a, 1, { flatShading: true });
  const solidAt = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, ry = 0) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.rotation.y = ry;
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh);
  };
  let nStakes = 0;
  for (const blk of b.blocks) if (blk.kind === "trench") nStakes += Math.ceil(blk.w / 0.9);
  const stakes = inst(new THREE.ConeGeometry(0.09, 1.6, 5), stakeMat, nStakes, true);
  for (const blk of b.blocks) {
    if (!blk.kind) continue;
    const y = heightAt(blk.x, blk.z), along = blk.w >= blk.d;
    if (blk.kind === "rock") solidAt(lumpy(1, 2, 0.25, Math.floor(r() * 50), false).scale(blk.w * 0.6, blk.h * 0.75, blk.d * 0.6), rockMat, blk.x, y + blk.h * 0.35, blk.z, r() * 6);
    else if (blk.kind === "stump") {
      const rad = Math.min(blk.w, blk.d) / 2;
      solidAt(new THREE.CylinderGeometry(rad * 0.9, rad * 1.15, blk.h, 12), barkMat, blk.x, y + blk.h / 2, blk.z);
      solidAt(new THREE.CylinderGeometry(rad * 0.88, rad * 0.88, 0.04, 12), cutMat, blk.x, y + blk.h + 0.02, blk.z);
      for (let i = 0; i < 4; i++) solidAt(new THREE.CylinderGeometry(0.12, 0.3, rad * 1.4, 5).rotateZ(Math.PI / 2.6), barkMat, blk.x + Math.cos(i * 1.6) * rad, y + 0.15, blk.z + Math.sin(i * 1.6) * rad, -i * 1.6);
    } else if (blk.kind === "log") {
      const len = Math.max(blk.w, blk.d), rad = Math.min(blk.w, blk.d) / 2;
      solidAt(new THREE.CylinderGeometry(rad, rad * 1.1, len, 12).rotateZ(Math.PI / 2), barkMat, blk.x, y + rad * 0.9, blk.z, along ? 0 : Math.PI / 2);
      for (const e of [-1, 1]) solidAt(new THREE.CylinderGeometry(rad * 0.95, rad * 0.95, 0.04, 12).rotateZ(Math.PI / 2), cutMat, blk.x + (along ? e * len / 2 : 0), y + rad * 0.9, blk.z + (along ? 0 : e * len / 2), along ? 0 : Math.PI / 2);
    } else {
      // The berm, then a row of stakes along the side facing the enemy, now and then a skull on one.
      const berm = new THREE.BoxGeometry(blk.w, blk.h + 0.6, blk.d + 1.2, 8, 2, 2);
      const bp = berm.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < bp.count; i++) if (bp.getY(i) > 0) bp.setXYZ(i, bp.getX(i), bp.getY(i) + n(blk.x + bp.getX(i), blk.z, 3) * 0.25, bp.getZ(i) * 0.7);
      berm.computeVertexNormals();
      solidAt(berm, dirtMat, blk.x, y + (blk.h - 0.6) / 2, blk.z);
      const out = blk.z > 0 ? -1 : 1; // the Wooka hold the far half: the stakes lean towards the middle
      for (let x = -blk.w / 2 + 0.5; x < blk.w / 2; x += 0.9) {
        put(stakes, m.compose(p.set(blk.x + x, y + blk.h * 0.7, blk.z + out * (blk.d / 2 + 0.4)), q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), out * 0.7 + (r() - 0.5) * 0.2), k.set(1, 0.8 + r() * 0.4, 1)));
        if (r() < 0.06) solidAt(lumpy(0.22, 1, 0.05, 7, false), std(0xeee6cf, 0.6), blk.x + x, y + blk.h + 0.6, blk.z + out * (blk.d / 2 + 0.9));
      }
      // The trench itself behind the berm: a dark cut with duckboards, a row of lashed log posts
      // along the lip, hide banners and a lantern now and then.
      const back = -out;
      solidAt(new THREE.BoxGeometry(blk.w, 0.12, 1.4), plankMat, blk.x, y + 0.1, blk.z + back * (blk.d / 2 + 1.1));
      for (let x = -blk.w / 2 + 1.2; x < blk.w / 2; x += 3.2) {
        solidAt(new THREE.CylinderGeometry(0.14, 0.18, blk.h + 1.6, 6), barkMat, blk.x + x, y + (blk.h + 1.6) / 2, blk.z + back * (blk.d / 2 + 0.4));
        if (r() < 0.35) solidAt(new THREE.PlaneGeometry(0.9, 1.3).translate(0, -0.65, 0), bannerMat, blk.x + x + 0.3, y + blk.h + 1.5, blk.z + back * (blk.d / 2 + 0.4), r() * 0.4);
        if (r() < 0.2) solidAt(new THREE.SphereGeometry(0.15, 8, 6), lanternMat, blk.x + x, y + blk.h + 1.35, blk.z + back * (blk.d / 2 + 0.55));
      }
      for (let x = -blk.w / 2 + 0.6; x < blk.w / 2; x += 2.3) if (r() < 0.6) solidAt(lumpy(0.3, 1, 0.2, 5, false), sackMat, blk.x + x, y + blk.h * 0.55, blk.z + back * (blk.d / 2 + 0.9)); // loot sacks
    }
  }
  stakes.instanceMatrix.needsUpdate = true;
  for (const blk of b.blocks) {
    if (blk.kind) continue;
    const y = heightAt(blk.x, blk.z);
    if (blk.h < EYE) {
      const nx = Math.ceil(blk.w / 0.85), nz = Math.ceil(blk.d / 0.55), ny = Math.ceil(blk.h / 0.3);
      for (let iy = 0; iy < ny; iy++) for (let ix = 0; ix < nx; ix++) for (let iz = 0; iz < nz; iz++) {
        // Only the outside of the pile shows, so only the outside is built.
        if (ix > 0 && ix < nx - 1 && iz > 0 && iz < nz - 1 && iy < ny - 1) continue;
        col.setHSL(0.11, 0.25, rocky ? 0.3 + r() * 0.08 : 0.42 + r() * 0.1);
        put(bags, m.compose(
          p.set(blk.x - blk.w / 2 + (ix + 0.5 + (iy % 2) * 0.4) * (blk.w / nx), y + 0.15 + iy * (blk.h / ny), blk.z - blk.d / 2 + (iz + 0.5) * (blk.d / nz)),
          q.setFromAxisAngle(UP, (r() - 0.5) * 0.15), k.set(blk.w / nx / 0.85, 1, blk.d / nz / 0.55)), col);
      }
      continue;
    }
    // Rock, or a bunker: a box, its corners knocked about by the noise if it's rock.
    const geo = new THREE.BoxGeometry(blk.w, blk.h + 1, blk.d, rocky ? 6 : 1, rocky ? 6 : 1, rocky ? 6 : 1).translate(0, (blk.h + 1) / 2 - 1, 0);
    if (rocky) {
      const bp = geo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < bp.count; i++) {
        const vx = bp.getX(i) + blk.x, vy = bp.getY(i), vz = bp.getZ(i) + blk.z;
        if (vy < 0) continue;
        const push = 1.6 * n(vx / 5 + vy / 7, vz / 5 - vy / 9, 2);
        bp.setXYZ(i, bp.getX(i) * (1 + push * 0.06), vy + (vy > blk.h - 1 ? push : 0), bp.getZ(i) * (1 + push * 0.06));
      }
      geo.computeVertexNormals();
    }
    const mesh = new THREE.Mesh(geo, rocky || look.lowRock && blk.h < 10 ? rockMat : builtMat);
    mesh.position.set(blk.x, y, blk.z);
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh);
    if (!rocky && look.moss) {
      // Moss and vines take the tops back.
      const top = new THREE.Mesh(lumpy(1, 1, 0.3, 11, false), std(0x4f6e2a, 1, { flatShading: true }));
      top.scale.set(blk.w * 0.45, 0.6, blk.d * 0.45);
      top.position.set(blk.x, y + blk.h, blk.z);
      scene.add(top);
    }
  }
  bags.instanceMatrix.needsUpdate = true;

  // The sea over the shallows, with its waves and surf.
  const tide = sea ? buildSea(scene, b, n, sea.level, heightAt) : null;

  // The landmarks by the keep, only for show.
  const ky = heightAt(keep.x, keep.z);
  const solid = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh);
    return mesh;
  };
  const landmark = LANDMARKS[spec.sector]({ b, keep, ky, heightAt, solid, add: (o) => scene.add(o), std, builtMat, r, n, bare, anywhere, inst: instancer(scene) });

  // --- Sunlight: shafts down through the haze, the dapples they leave, and dust hanging in them. ---
  const rays: THREE.Group[] = [];
  const shaftMat = additive(glowMap("shaft", true), look.sun, look.ray);
  const dappleMat = additive(glowMap("dapple", false), look.sun, look.ray * 2.2);
  const nRays = look.rays;
  for (let i = 0; i < nRays; i++) {
    const at = i < 8 && i < b.posts.length + trail.length ? (i % 2 ? trail[i % trail.length]! : b.posts[i % b.posts.length]!) : anywhere(0.9);
    const x = at.x + (r() - 0.5) * 30, z = at.z + (r() - 0.5) * 30, y = heightAt(x, z), w = 4 + r() * 9, len = 150;
    const shaft = new THREE.Group();
    for (const turn of [0, Math.PI / 2]) {
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(w, len).translate(0, len / 2, 0), shaftMat);
      plane.rotation.y = turn;
      shaft.add(plane);
    }
    shaft.position.set(x, y, z);
    shaft.quaternion.setFromUnitVectors(UP, SUN_DIR);
    shaft.userData.phase = r() * 6;
    scene.add(shaft);
    rays.push(shaft);
    const dapple = new THREE.Mesh(new THREE.PlaneGeometry(w * 1.6, w * 1.6).rotateX(-Math.PI / 2), dappleMat);
    dapple.position.set(x, y + 0.08, z);
    scene.add(dapple);
  }
  // Motes round the camera: a box of them that follows it, each wrapped back in when it drifts out.
  const MOTES = 700, BOX = 50;
  const motePos = new Float32Array(MOTES * 3);
  for (let i = 0; i < MOTES; i++) motePos.set([(r() - 0.5) * BOX, r() * 18, (r() - 0.5) * BOX], i * 3);
  const moteGeo = new THREE.BufferGeometry();
  moteGeo.setAttribute("position", new THREE.BufferAttribute(motePos, 3));
  const motes = new THREE.Points(moteGeo, new THREE.PointsMaterial({ size: look.mote.size, map: glowMap("dapple", false), color: look.mote.color, transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending }));
  motes.frustumCulled = false;
  scene.add(motes);
  const drift = Float32Array.from({ length: MOTES }, () => r() * 6);

  return {
    heightAt,
    update(t, eye, at) {
      foliage.update(t, eye);
      sun.target.position.set(at.x, heightAt(at.x, at.z), at.z);
      sun.position.copy(sun.target.position).addScaledVector(SUN_DIR, 200);
      sky.position.copy(eye);
      giant.position.set(eye.x - 380, 420, eye.z - 620); // (not in the scene when the world has none)
      shaftMat.opacity = look.ray * (0.85 + 0.15 * Math.sin(t * 0.3));
      for (const [i, ray] of rays.entries()) ray.scale.x = 0.9 + 0.1 * Math.sin(t * 0.4 + ray.userData.phase + i);
      landmark?.(t);
      tide?.(t);
      for (let i = 0; i < MOTES; i++) {
        let x = motePos[i * 3]! + Math.sin(t * 0.3 + drift[i]!) * 0.004, y = motePos[i * 3 + 1]! + Math.sin(t * 0.2 + drift[i]! * 2) * 0.003, z = motePos[i * 3 + 2]!;
        // Wrap round the camera.
        x = ((((x - eye.x + BOX / 2) % BOX) + BOX) % BOX) + eye.x - BOX / 2;
        z = ((((z - eye.z + BOX / 2) % BOX) + BOX) % BOX) + eye.z - BOX / 2;
        motePos.set([x, y, z], i * 3);
      }
      motes.position.y = heightAt(eye.x, eye.z); // the box sits on the floor under the camera
      moteGeo.attributes.position!.needsUpdate = true;
    },
  };
}
