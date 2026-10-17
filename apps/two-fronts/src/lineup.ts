// The model lineup, for working on the models: `bun run dev`, then open /lineup.html.
// Every model in models.ts on a turntable, in the battle's light. ?row=marines|wooka|vehicles|space
// picks one row and frames it; drag to spin the lot. ?walk=1 walks them on the spot, and
// everything fires (or swings) every second and a half.
import * as THREE from "three";
import { animate, cruiser, fighter, gunship, marine, speeder, tank, turret, walker, wooka } from "./battle/models.ts";

const canvas = document.getElementById("lineup") as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8fa48a);
scene.add(new THREE.HemisphereLight(0xd6e8c4, 0x2f2a1a, 1.5));
const sun = new THREE.DirectionalLight(0xfff1d0, 1.6);
sun.position.set(30, 60, 20);
sun.castShadow = true;
Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, far: 200 });
sun.shadow.mapSize.set(2048, 2048);
scene.add(sun);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshLambertMaterial({ color: 0x3b4a26 }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

const rows: Record<string, { make: () => THREE.Object3D; gap: number; y?: number }[]> = {
  marines: [marine(true), marine(false, "assault"), marine(false, "heavy"), marine(false, "sniper"), marine(false, "engineer")].map((m) => ({ make: () => m, gap: 2.4 })),
  wooka: [wooka(true), wooka(), wooka(false, "chub"), wooka(false, "mossback"), turret("wooka"), turret("marines")].map((m, i) => ({ make: () => m, gap: i === 3 ? 5.5 : i > 3 ? 5 : 2.4 })),
  vehicles: [tank(), speeder(), walker(), gunship()].map((m, i) => ({ make: () => m, gap: i === 3 ? 12 : 8, y: i === 3 ? 6 : 0 })),
  space: [fighter("marines", true), fighter("marines"), fighter("wooka", true), fighter("wooka")].map((m) => ({ make: () => m, gap: 8, y: 3 })),
};
const pick = new URLSearchParams(location.search).get("row");
const spin: THREE.Object3D[] = [];
let z = 0, width = 0;
for (const [name, row] of Object.entries(rows)) {
  if (pick && pick !== name) continue;
  const total = row.reduce((n, r) => n + r.gap, 0);
  let x = -total / 2;
  for (const r of row) {
    const m = r.make();
    m.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    m.position.set(x + r.gap / 2, r.y ?? 0, z);
    x += r.gap;
    scene.add(m);
    spin.push(m);
  }
  width = Math.max(width, total);
  z -= name === "vehicles" ? 16 : 6;
}
if (pick === "cruisers" || !pick) {
  for (const [i, f] of (["marines", "wooka"] as const).entries()) {
    const c = cruiser(f);
    c.scale.setScalar(pick ? 1 : 0.25);
    c.position.set((i - 0.5) * (pick ? 80 : 30), pick ? 20 : 8, pick ? 0 : z - 10);
    scene.add(c);
    spin.push(c);
  }
  if (pick) width = 160;
}

const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 2000);
const frame = () => {
  const d = Math.max(6, width * 0.95);
  camera.position.set(0, d * 0.32 + 1, d + (pick ? 0 : 10));
  camera.lookAt(0, pick === "cruisers" ? 20 : pick === "vehicles" ? 3 : 1, pick ? 0 : -10);
};
const resize = () => {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
};
addEventListener("resize", resize);
resize();
frame();

const walk = new URLSearchParams(location.search).has("walk");
let turn = Math.PI + 0.6, drag: number | null = null, t0 = performance.now();
canvas.addEventListener("pointerdown", (e: PointerEvent) => (drag = e.clientX));
addEventListener("pointerup", () => (drag = null));
addEventListener("pointermove", (e: PointerEvent) => { if (drag !== null) { turn += (e.clientX - drag) * 0.01; drag = e.clientX; } });
// ?t=1.2 freezes the turntable at that angle, for screenshots.
const fixed = new URLSearchParams(location.search).get("t");
if (fixed) turn = Number(fixed);
renderer.setAnimationLoop((now) => {
  const dt = (now - t0) / 1000;
  if (!fixed && drag === null) turn += dt / 4;
  t0 = now;
  for (const m of spin) {
    m.rotation.y = turn;
    animate(m, { t: now / 1000, dt, moved: walk ? dt * (m.userData.model === "walker" ? 3.5 : 5) : 0, since: (now / 1000 + m.id * 0.2) % 1.5 });
  }
  renderer.render(scene, camera);
});
