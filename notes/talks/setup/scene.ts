// The talk's opening shot: the rocket roadster from @rustybuns/models lapping a desert loop among the same
// seeded saguaros, barrels, prickly pear and shrubs the games grow. Dusk light, one instanced mesh per plant
// kind, and it stops drawing while it's off screen. Reduced motion gets one still frame.
import * as THREE from "three";
import { barrel, pear, roadster, saguaro, shrub } from "../../../packages/models/src/index.ts";

const canvas = document.querySelector<HTMLCanvasElement>("#stage");
if (canvas) start(canvas);

function start(canvas: HTMLCanvasElement) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x2a2140, 40, 140);
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 400);

  scene.add(new THREE.HemisphereLight(0xffc9a0, 0x2a2140, 1.1));
  const sun = new THREE.DirectionalLight(0xffa868, 2.6);
  sun.position.set(-30, 18, -20);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, far: 120 });
  scene.add(sun);

  const ground = new THREE.Mesh(new THREE.CircleGeometry(160, 64), new THREE.MeshLambertMaterial({ color: 0xc98a5a }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const LOOP = 18;
  const road = new THREE.Mesh(new THREE.RingGeometry(LOOP - 2.2, LOOP + 2.2, 96), new THREE.MeshLambertMaterial({ color: 0x8a5a40 }));
  road.rotation.x = -Math.PI / 2;
  road.position.y = 0.02;
  road.receiveShadow = true;
  scene.add(road);

  // Plants scattered off the road, the same seeds every load.
  const plants = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const kinds: [THREE.BufferGeometry, number, number][] = [
    [saguaro(3), 22, 0.9], [saguaro(11), 14, 0.75], [barrel(5), 40, 1], [pear(9), 34, 1], [shrub(2, { berries: true }), 50, 0.8],
  ];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  for (const [geo, count, size] of kinds) {
    const mesh = new THREE.InstancedMesh(geo, plants, count);
    mesh.castShadow = true;
    for (let i = 0; i < count; i++) {
      let r = 0, a = 0;
      do { r = 4 + rand() * 70; a = rand() * Math.PI * 2; } while (Math.abs(r - LOOP) < 4.5);
      const s = size * (0.7 + rand() * 0.6);
      m.compose(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r), q.setFromAxisAngle(up, rand() * 6.28), new THREE.Vector3(s, s, s));
      mesh.setMatrixAt(i, m);
    }
    scene.add(mesh);
  }

  const car = roadster();
  car.group.traverse((o) => { o.castShadow = true; });
  scene.add(car.group);
  // A soft glow on each rear nozzle, standing in for the games' plumes.
  const glow = new THREE.MeshBasicMaterial({ color: 0xffb070, transparent: true, opacity: 0.7, depthWrite: false });
  for (const n of car.nozzles) if (n.group === "rear") n.mount.add(new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.7, 8).translate(0, 0.35, 0), glow));

  const resize = () => {
    const { clientWidth: w, clientHeight: h } = canvas;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(h, 1);
    camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(canvas);
  resize();

  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const look = new THREE.Vector3();
  const draw = (t: number) => {
    const a = t * 0.22;
    car.group.position.set(Math.cos(a) * LOOP, 0, Math.sin(a) * LOOP);
    car.group.rotation.y = -a; // nose (+z) along the circle's tangent
    glow.opacity = 0.55 + Math.sin(t * 30) * 0.15;
    const c = a - 0.55;
    camera.position.set(Math.cos(c) * (LOOP + 9), 3.2, Math.sin(c) * (LOOP + 9));
    look.copy(car.group.position).y = 0.8;
    camera.lookAt(look);
    renderer.render(scene, camera);
  };

  if (still) { draw(2); return; }
  let visible = true, last = performance.now(), clock = 2;
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(canvas);
  renderer.setAnimationLoop((now) => {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    if (!visible || document.hidden) return;
    draw((clock += dt));
  });
}
