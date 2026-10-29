// The arena's look. The layout (a ring of radius ARENA.radius, a lake past x = ARENA.lake.x, a low
// ceiling for flyers) is the sim's and never changes; a skin only repaints it, so a new stadium is a
// new entry in SKINS, not new rules.
import * as THREE from "three";
import { ARENA } from "./sim.ts";

export interface Skin {
  name: string;
  sky: number; fog: number; ground: number; line: number; water: number; rim: number; prop: number;
  props: "stands" | "rocks" | "clouds";
}
export const SKINS: Record<string, Skin> = {
  stadium: { name: "Stadium", sky: 0x9fc7e8, fog: 0xbcd6ea, ground: 0x5f9b4c, line: 0xf2f2e6, water: 0x2f78b8, rim: 0xc9c2b0, prop: 0x8a8f99, props: "stands" },
  volcano: { name: "Volcano", sky: 0x2a1410, fog: 0x3a1c14, ground: 0x3b3430, line: 0xff7a2f, water: 0x3a9a9a, rim: 0x55301f, prop: 0x241c18, props: "rocks" },
  sky: { name: "Sky island", sky: 0x7fb6ff, fog: 0xd8ecff, ground: 0xc8d8a8, line: 0xffffff, water: 0x7fd0ff, rim: 0x9a8a70, prop: 0xffffff, props: "clouds" },
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
  if (skin.props === "clouds") ring(14, R + 12, (i) => { const m = new THREE.Mesh(new THREE.SphereGeometry(3 + (i % 3), 12, 8), mat(skin.prop, { transparent: true, opacity: 0.8 })); m.position.y = -6 + (i % 4); m.scale.y = 0.45; return m; });

  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(-12, 24, 10); sun.castShadow = true;
  sun.shadow.camera.left = sun.shadow.camera.bottom = -22; sun.shadow.camera.right = sun.shadow.camera.top = 22;
  sun.shadow.mapSize.set(1024, 1024);
  g.add(sun, new THREE.HemisphereLight(skin.sky, skin.ground, 1.1));
  scene.add(g);
  return g;
}
