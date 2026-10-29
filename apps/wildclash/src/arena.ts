// The arena's look. The layout (a ring of radius ARENA.radius, a lake past x = ARENA.lake.x, a low
// ceiling for flyers) is the sim's and never changes; a skin only repaints it, so a new stadium is a
// new entry in SKINS, not new rules.
import * as THREE from "three";
import { ARENA } from "./sim.ts";

export interface Skin {
  name: string;
  sky: number; fog: number; ground: number; line: number; water: number; rim: number; prop: number;
  props: "stands" | "rocks" | "clouds" | "trees";
}
export const SKINS: Record<string, Skin> = {
  stadium: { name: "Stadium", sky: 0x9fc7e8, fog: 0xbcd6ea, ground: 0x5f9b4c, line: 0xf2f2e6, water: 0x2f78b8, rim: 0xc9c2b0, prop: 0x8a8f99, props: "stands" },
  volcano: { name: "Volcano", sky: 0x2a1410, fog: 0x3a1c14, ground: 0x3b3430, line: 0xff7a2f, water: 0x3a9a9a, rim: 0x55301f, prop: 0x241c18, props: "rocks" },
  sky: { name: "Sky island", sky: 0x7fb6ff, fog: 0xd8ecff, ground: 0xc8d8a8, line: 0xffffff, water: 0x7fd0ff, rim: 0x9a8a70, prop: 0xffffff, props: "clouds" },
  // The world's regions (src/world/regions.ts) each wear one of these; `ground` also tints their land on the map.
  pines: { name: "Pine barrens", sky: 0xa8bfd0, fog: 0xc8d2c8, ground: 0x8a9a5b, line: 0xe8dcc0, water: 0x6b4a2a, rim: 0xc8b48a, prop: 0x2f4a2a, props: "trees" },
  hollow: { name: "Mountain hollow", sky: 0x8a9aa8, fog: 0xa8b0b0, ground: 0x4f7a3a, line: 0xe0e0d0, water: 0x3a6a78, rim: 0x6a5a48, prop: 0x2a4a28, props: "trees" },
  northwoods: { name: "North woods", sky: 0x9ab8d8, fog: 0xc0d0d8, ground: 0x3f6a3a, line: 0xf0f0e8, water: 0x2a5a80, rim: 0x7a6040, prop: 0x1f3a24, props: "trees" },
  rainforest: { name: "Rain forest", sky: 0x7a8a90, fog: 0x9aa8a8, ground: 0x2f5a30, line: 0xd8e8d0, water: 0x2a5a6a, rim: 0x5a4a38, prop: 0x183a20, props: "trees" },
  lakeshore: { name: "Lakeshore", sky: 0x9fc7e8, fog: 0xbcd6ea, ground: 0x6a9a50, line: 0xf2f2e6, water: 0x2f6aa8, rim: 0xb8a888, prop: 0x2f5a30, props: "trees" },
  desert: { name: "Desert", sky: 0xe8c890, fog: 0xf0d8a8, ground: 0xc89a60, line: 0xfff4e0, water: 0x5aa0b0, rim: 0x9a6a40, prop: 0xa8603a, props: "rocks" },
  bayou: { name: "Bayou", sky: 0x8a9a80, fog: 0x9aa890, ground: 0x5a6a38, line: 0xe0d8b0, water: 0x4a5a30, rim: 0x5a4a30, prop: 0x3a4a28, props: "trees" },
  plains: { name: "Plains", sky: 0xa8c8e8, fog: 0xd0e0e8, ground: 0x9aa860, line: 0xffffff, water: 0x4a80b0, rim: 0xa89070, prop: 0x5a6a3a, props: "trees" },
  highland: { name: "Highland", sky: 0x90b0d8, fog: 0xb8c8d8, ground: 0x7a8a50, line: 0xf0e8d8, water: 0x3a7090, rim: 0x8a6a50, prop: 0x6a5a4a, props: "rocks" },
  jungle: { name: "Jungle", sky: 0x88a8a0, fog: 0x98b8a0, ground: 0x2a6a2a, line: 0xf0f0c0, water: 0x5a7a40, rim: 0x6a5030, prop: 0x1a4a1a, props: "trees" },
  isles: { name: "Isles", sky: 0x7fc8f0, fog: 0xc8e8f8, ground: 0xd8c890, line: 0xffffff, water: 0x2aa8c8, rim: 0xe8d8a8, prop: 0x3a8a4a, props: "trees" },
  andes: { name: "High peaks", sky: 0x6a98d8, fog: 0xd0e0f0, ground: 0x8a8070, line: 0xffffff, water: 0x4a90c0, rim: 0x6a6058, prop: 0xe8eef4, props: "rocks" },
  fjords: { name: "Fjords", sky: 0x7a90a8, fog: 0xa8b8c8, ground: 0x4a6a48, line: 0xf0f4f8, water: 0x1f4a6a, rim: 0x5a5a58, prop: 0x5a6068, props: "rocks" },
  moor: { name: "Moor", sky: 0x8898a8, fog: 0xa8b0b8, ground: 0x7a7a48, line: 0xe8e0d0, water: 0x2a3a48, rim: 0x6a5a4a, prop: 0x6a6a68, props: "rocks" },
  tundra: { name: "Tundra", sky: 0xb0c8e0, fog: 0xe0e8f0, ground: 0xa8b0a0, line: 0x405060, water: 0x4a7898, rim: 0x8a8a88, prop: 0xf0f4f8, props: "rocks" },
  shrine: { name: "Shrine", sky: 0xe8b8a0, fog: 0xf0d0c0, ground: 0x6a8a50, line: 0xd83a2a, water: 0x3a7a8a, rim: 0xc83a2a, prop: 0x2a4a2a, props: "trees" },
};

export function buildArena(scene: THREE.Scene, skin: Skin): THREE.Group {
  const g = new THREE.Group();
  scene.background = new THREE.Color(skin.sky);
  scene.fog = new THREE.Fog(skin.fog, 30, 90);
  const R = ARENA.radius;
  const mat = (color: number, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.9, ...extra });

  const floor = new THREE.Mesh(new THREE.CylinderGeometry(R, R * 0.92, 1.2, 64), mat(skin.ground));
  floor.position.y = -0.6; floor.receiveShadow = true; g.add(floor);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(R, 0.12, 8, 96), mat(skin.rim));
  rim.rotation.x = Math.PI / 2; rim.position.y = 0.02; g.add(rim);
  const centre = new THREE.Mesh(new THREE.RingGeometry(2.4, 2.55, 48), new THREE.MeshBasicMaterial({ color: skin.line }));
  centre.rotation.x = -Math.PI / 2; centre.position.y = 0.01; g.add(centre);

  // The lake: the slice of the ring past x = lake.x.
  const a = Math.acos(ARENA.lake.x / R), shape = new THREE.Shape();
  shape.moveTo(ARENA.lake.x, -Math.sin(a) * R);
  shape.absarc(0, 0, R - 0.05, -a, a, false);
  shape.lineTo(ARENA.lake.x, -Math.sin(a) * R);
  const lake = new THREE.Mesh(new THREE.ShapeGeometry(shape, 32), mat(skin.water, { roughness: 0.2, metalness: 0.1, transparent: true, opacity: 0.85 }));
  lake.rotation.x = -Math.PI / 2; lake.rotation.z = 0; lake.scale.y = -1; lake.position.y = 0.03; g.add(lake);

  // Props sit outside the ring: scenery, not walls.
  const ring = (n: number, r: number, make: (i: number) => THREE.Object3D) => {
    for (let i = 0; i < n; i++) { const o = make(i), t = (i / n) * Math.PI * 2; o.position.x += Math.cos(t) * r; o.position.z += Math.sin(t) * r; o.rotation.y = -t; g.add(o); }
  };
  if (skin.props === "stands") ring(24, R + 9, () => { const m = new THREE.Mesh(new THREE.BoxGeometry(3, 4, 4.4), mat(skin.prop)); m.position.y = -1; return m; });
  if (skin.props === "rocks") {
    ring(18, R + 7, (i) => { const m = new THREE.Mesh(new THREE.ConeGeometry(2 + (i % 3), 5 + (i % 4) * 2, 6), mat(skin.prop)); m.position.y = -2; return m; });
    const lava = new THREE.Mesh(new THREE.CircleGeometry(R + 30, 48), new THREE.MeshBasicMaterial({ color: 0xff5a1f }));
    lava.rotation.x = -Math.PI / 2; lava.position.y = -7; g.add(lava);
  }
  if (skin.props === "trees") ring(28, R + 8, (i) => { const m = new THREE.Mesh(new THREE.ConeGeometry(1.4 + (i % 3) * 0.4, 6 + (i % 4) * 1.5, 7), mat(skin.prop)); m.position.y = 1.5 + (i % 4) * 0.75; m.position.x += (i % 2) * 3; return m; });
  if (skin.props === "clouds") ring(14, R + 12, (i) => { const m = new THREE.Mesh(new THREE.SphereGeometry(3 + (i % 3), 12, 8), mat(skin.prop, { transparent: true, opacity: 0.8 })); m.position.y = -6 + (i % 4); m.scale.y = 0.45; return m; });

  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(-12, 24, 10); sun.castShadow = true;
  sun.shadow.camera.left = sun.shadow.camera.bottom = -22; sun.shadow.camera.right = sun.shadow.camera.top = 22;
  sun.shadow.mapSize.set(1024, 1024);
  g.add(sun, new THREE.HemisphereLight(skin.sky, skin.ground, 1.1));
  scene.add(g);
  return g;
}
