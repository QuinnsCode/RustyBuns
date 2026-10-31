// The arena's look. The layout (a ring of radius ARENA.radius, a lake past x = ARENA.lake.x, a low
// ceiling for flyers) is the sim's and never changes; a skin only repaints it, so a new stadium is a
// new entry in SKINS, not new rules.
import * as THREE from "three";
import { mulberry32 } from "@rustybuns/util";
import { ARENA } from "./sim.ts";

/** A floor's grain: soft light and dark patches (turf, rock, cloud) around white, so `color` still sets the tint. */
function mottle(seed: number): THREE.CanvasTexture {
  const S = 256, c = document.createElement("canvas"), rnd = mulberry32(seed);
  c.width = c.height = S;
  const x = c.getContext("2d")!;
  x.fillStyle = "#e6e6e6"; x.fillRect(0, 0, S, S);
  for (let i = 0; i < 900; i++) {
    const r = 2 + rnd() * (i < 120 ? 34 : 7), v = Math.round(200 + rnd() * 55);
    x.fillStyle = `rgba(${v},${v},${v},${0.18 + rnd() * 0.22})`;
    const cx = rnd() * S, cy = rnd() * S;
    // drawn wrapped, so the tile has no seam
    for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) { x.beginPath(); x.arc(cx + dx, cy + dy, r, 0, Math.PI * 2); x.fill(); }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(6, 6); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

export interface Skin {
  name: string;
  sky: number; fog: number; ground: number; line: number; water: number; rim: number; prop: number;
  props: "stands" | "rocks" | "clouds" | "trees";
  /** What glows far below the ring, if anything (the volcano's lava). */
  under?: number;
}
export const SKINS: Record<string, Skin> = {
  stadium: { name: "Stadium", sky: 0x9fc7e8, fog: 0xbcd6ea, ground: 0x5f9b4c, line: 0xf2f2e6, water: 0x2f78b8, rim: 0xc9c2b0, prop: 0x8a8f99, props: "stands" },
  volcano: { name: "Volcano", sky: 0x2a1410, fog: 0x3a1c14, ground: 0x3b3430, line: 0xff7a2f, water: 0x3a9a9a, rim: 0x55301f, prop: 0x241c18, props: "rocks", under: 0xff5a1f },
  sky: { name: "Sky island", sky: 0x7fb6ff, fog: 0xd8ecff, ground: 0xc8d8a8, line: 0xffffff, water: 0x7fd0ff, rim: 0x9a8a70, prop: 0xffffff, props: "clouds" },
};

export function buildArena(scene: THREE.Scene, skin: Skin): THREE.Group {
  const g = new THREE.Group();
  scene.background = new THREE.Color(skin.sky);
  scene.fog = new THREE.Fog(skin.fog, 30, 90);
  const R = ARENA.radius;
  const mat = (color: number, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.9, ...extra });

  const floor = new THREE.Mesh(new THREE.CylinderGeometry(R, R * 0.92, 1.2, 64), mat(skin.ground, { map: mottle(7) }));
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
  const lake = new THREE.Mesh(new THREE.ShapeGeometry(shape, 32), mat(skin.water, { roughness: 0.55, metalness: 0, envMapIntensity: 0.3, transparent: true, opacity: 0.85 }));
  lake.rotation.x = -Math.PI / 2; lake.rotation.z = 0; lake.scale.y = -1; lake.position.y = 0.03; g.add(lake);

  // Props sit outside the ring: scenery, not walls.
  const ring = (n: number, r: number, make: (i: number) => THREE.Object3D) => {
    for (let i = 0; i < n; i++) { const o = make(i), t = (i / n) * Math.PI * 2; o.position.x += Math.cos(t) * r; o.position.z += Math.sin(t) * r; o.rotation.y = -t; g.add(o); }
  };
  if (skin.props === "stands") g.add(stands(R, skin.prop));
  if (skin.props === "rocks") {
    ring(18, R + 7, (i) => { const m = new THREE.Mesh(new THREE.ConeGeometry(2 + (i % 3), 5 + (i % 4) * 2, 6), mat(skin.prop)); m.position.y = -2; return m; });
  }
  if (skin.props === "trees") ring(28, R + 8, (i) => {
    const t = new THREE.Group(), h = 5 + (i % 4) * 1.5;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, 2, 6), mat(skin.rim));
    trunk.position.y = -0.5;
    const crown = new THREE.Mesh(new THREE.ConeGeometry(1.4 + (i % 3) * 0.4, h, 7), mat(skin.prop));
    crown.position.y = 0.5 + h / 2;
    t.add(trunk, crown); t.position.x = (i % 2) * 2.5; return t;
  });
  if (skin.under !== undefined) {
    const glow = new THREE.Mesh(new THREE.CircleGeometry(R + 30, 48), new THREE.MeshBasicMaterial({ color: skin.under }));
    glow.rotation.x = -Math.PI / 2; glow.position.y = -7; g.add(glow);
  }
  if (skin.props === "clouds") ring(14, R + 12, (i) => { const m = new THREE.Mesh(new THREE.SphereGeometry(3 + (i % 3), 12, 8), mat(skin.prop, { transparent: true, opacity: 0.8 })); m.position.y = -6 + (i % 4); m.scale.y = 0.45; return m; });

  g.add(skyDome(skin), hills(skin));
  // the lake's bank: a strip of wet sand where the turf meets the water, so the shore isn't a cut
  const chord = 2 * Math.sin(a) * R;
  const bank = new THREE.Mesh(new THREE.PlaneGeometry(1.1, chord - 0.4), mat(new THREE.Color(skin.ground).lerp(new THREE.Color(0xd8c8a0), 0.6).getHex(), { roughness: 0.75 }));
  bank.rotation.x = -Math.PI / 2; bank.position.set(ARENA.lake.x - 0.35, 0.015, 0); bank.receiveShadow = true; g.add(bank);
  const foam = new THREE.Mesh(new THREE.PlaneGeometry(0.22, chord - 0.4), new THREE.MeshBasicMaterial({ color: 0xf4f8f8, transparent: true, opacity: 0.55, depthWrite: false }));
  foam.rotation.x = -Math.PI / 2; foam.position.set(ARENA.lake.x + 0.3, 0.035, 0); g.add(foam);

  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(-12, 24, 10); sun.castShadow = true;
  sun.shadow.camera.left = sun.shadow.camera.bottom = -22; sun.shadow.camera.right = sun.shadow.camera.top = 22;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03; sun.shadow.radius = 3;
  // a cool light from behind the far side: an edge of light along every back and head, so a black hide reads
  const back = new THREE.DirectionalLight(0xcfe0ff, 1.6);
  back.name = "rim"; // main.ts keeps it opposite the camera, so it always edges the side you see
  back.position.set(14, 9, -16);
  g.add(sun, back, new THREE.HemisphereLight(skin.sky, skin.ground, 0.8));
  scene.add(g);
  return g;
}

/** A sky that fades from a deeper blue overhead to the fog's colour at the horizon, so the ring sits in air, not on a flat card. */
function skyDome(skin: Skin): THREE.Mesh {
  const top = new THREE.Color(skin.sky).multiplyScalar(0.78), horizon = new THREE.Color(skin.fog);
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: top }, horizon: { value: horizon } },
    vertexShader: "varying float h; void main() { h = normalize(position).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: "uniform vec3 top; uniform vec3 horizon; varying float h; void main() { gl_FragColor = vec4(mix(horizon, top, smoothstep(-0.05, 0.55, h)), 1.0);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}",
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(240, 32, 16), m);
  dome.renderOrder = -1;
  return dome;
}

/** Low hills all the way round, far enough out that the fog hazes them: a horizon instead of the sky meeting the floor. */
function hills(skin: Skin): THREE.Mesh {
  const N = 160, r = 58, pos: number[] = [], idx: number[] = [], rnd = mulberry32(11);
  const peaks = Array.from({ length: 9 }, () => [rnd() * Math.PI * 2, 4 + rnd() * 10, 0.2 + rnd() * 0.5] as const);
  for (let i = 0; i <= N; i++) {
    const t = (i / N) * Math.PI * 2;
    let y = 3;
    for (const [at, hgt, w] of peaks) { const d = Math.atan2(Math.sin(t - at), Math.cos(t - at)) / w; y += hgt * Math.exp(-d * d); }
    pos.push(Math.cos(t) * r, -8, Math.sin(t) * r, Math.cos(t) * r, y, Math.sin(t) * r);
    if (i < N) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(idx); geo.computeVertexNormals();
  const color = new THREE.Color(skin.prop).lerp(new THREE.Color(skin.ground), 0.3);
  return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 1, side: THREE.DoubleSide }));
}

/** A stadium bowl: concrete terraces stepping up and back from the ring, with a crowd in coloured shirts on them. */
function stands(R: number, prop: number): THREE.Group {
  const g = new THREE.Group(), STEPS = 7, RUN = 1.5, RISE = 0.85, inner = R + 3.5, base = -0.6;
  const profile = [new THREE.Vector2(inner, -4)];
  for (let i = 0; i < STEPS; i++) {
    const r = inner + i * RUN, y = base + i * RISE;
    profile.push(new THREE.Vector2(r, y + RISE), new THREE.Vector2(r + RUN, y + RISE));
  }
  profile.push(new THREE.Vector2(inner + STEPS * RUN, base + STEPS * RISE + 1.4), new THREE.Vector2(inner + STEPS * RUN + 0.4, base + STEPS * RISE + 1.4), new THREE.Vector2(inner + STEPS * RUN + 0.4, -4));
  const bowl = new THREE.Mesh(new THREE.LatheGeometry(profile, 96), new THREE.MeshStandardMaterial({ color: prop, roughness: 0.95, side: THREE.DoubleSide, map: (() => { const t = mottle(3); t.repeat.set(40, 3); return t; })() }));
  bowl.receiveShadow = true;
  g.add(bowl);
  // the front wall facing the ring, darker, with a painted band along its top
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(inner, inner, 0.5, 96, 1, true), new THREE.MeshStandardMaterial({ color: 0x2c5a8a, roughness: 0.6, side: THREE.DoubleSide }));
  wall.position.y = base + RISE - 0.2; g.add(wall);
  const rnd = mulberry32(5), shirts = [0xc8423a, 0x2f6fb8, 0xe8e2d0, 0x3a3a42, 0xe0a83a, 0x4a8a4a, 0x8a4ab0, 0xd87a9a, 0x6a5040];
  const spots: THREE.Matrix4[] = [], colors: THREE.Color[] = [];
  for (let i = 0; i < STEPS; i++) {
    const r = inner + i * RUN + RUN * 0.55, y = base + (i + 1) * RISE, n = Math.floor((Math.PI * 2 * r) / 0.62);
    for (let j = 0; j < n; j++) {
      if (rnd() < 0.18) continue; // empty seats
      const t = ((j + rnd() * 0.4) / n) * Math.PI * 2, h = 0.36 + rnd() * 0.14;
      spots.push(new THREE.Matrix4().compose(new THREE.Vector3(Math.cos(t) * r, y + h / 2, Math.sin(t) * r), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -t, 0)), new THREE.Vector3(0.24, h, 0.3)));
      colors.push(new THREE.Color(shirts[Math.floor(rnd() * shirts.length)]!).lerp(new THREE.Color(0x707070), 0.4)); // muted at a distance, so the crowd sits behind the fight
    }
  }
  // a body in its shirt and a head on top in one of a few skin tones: people at a glance, not pills
  const crowd = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.42, 0.5, 1, 7).translate(0, -0.12, 0), new THREE.MeshStandardMaterial({ roughness: 0.9 }), spots.length);
  const heads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.5, 8, 6), new THREE.MeshStandardMaterial({ roughness: 0.8 }), spots.length);
  const skins = [0xe8c4a0, 0xc89870, 0x8a5a3a, 0x5a3a28, 0xf0d0b0], hm = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
  spots.forEach((m, i) => {
    crowd.setMatrixAt(i, m); crowd.setColorAt(i, colors[i]!);
    m.decompose(p, q, sc);
    p.y += sc.y * 0.5 + 0.09; sc.set(0.19, 0.2, 0.19);
    heads.setMatrixAt(i, hm.compose(p, q, sc)); heads.setColorAt(i, new THREE.Color(skins[i % skins.length]!));
  });
  g.add(crowd, heads);
  return g;
}
