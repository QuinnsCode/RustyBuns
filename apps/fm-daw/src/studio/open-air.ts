// An open-air party, drawn (room.ts `outdoor`; the desert rave, rooms/desert-rave.ts): the night in place of look.ts's
// lit room. A sky fading from deep blue overhead to a dusty glow on the horizon, stars and a full moon; sand out to the
// dunes, under the moon's cold light; the speaker stacks from Sound Guy Simulator's desert night (packages/models gear:
// a 21" horn bin, a mid-bass horn and a mid-high horn on a sand dolly); a truss behind the stage with moving heads that
// sweep the floor and lasers that fan over the crowd; bulbs strung on poles round the dance floor; the generator off
// to one side with its jerry cans; saguaro, barrel cactus and prickly pear out in the dark. On high a strong bloom, so
// the beams and the bulbs glow. Every light moves on the clock it's given (`render`), the same for everyone.
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { mulberry32 } from "@rustybuns/util";
import { gear, gearLook } from "@rustybuns/models/gear";
import { barrel, pear, saguaro } from "@rustybuns/models/flora";
import type { Outdoor, StudioDef } from "./room.ts";
import { metreUV, surface, type Look, type Quality } from "./look.ts";

/** The beams' colours, cycling across the heads: magenta, cyan, amber, violet. */
export const BEAMS = ["#ff2bd6", "#22e3ff", "#ffb02b", "#8a5bff"] as const;
/** Where the lasers fan from on the truss, and how many. */
const LASERS = 10;

/** The ground's height at (x, z): flat where people walk, rising into dunes past `flat` metres from the middle. */
export function duneAt(x: number, z: number, flat: number): number {
  const r = Math.hypot(x, z), k = Math.min(1, Math.max(0, (r - flat) / 40));
  const swell = Math.sin(x * 0.045 + Math.cos(z * 0.03) * 2) * 0.5 + Math.sin(z * 0.06 + x * 0.02) * 0.5;
  return k * k * (4 + 5 * swell);
}

/** Where a head on the truss points at time `t` seconds: pan and tilt in radians, each head out of step with the next. */
export function headAim(i: number, n: number, t: number): { pan: number; tilt: number } {
  const ph = (i / n) * Math.PI * 2;
  return { pan: Math.sin(t * 0.6 + ph) * 0.7, tilt: 0.55 + Math.sin(t * 0.43 + ph * 1.7) * 0.3 };
}

export function openAir(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, def: StudioDef, quality: Quality): Look {
  const out: Outdoor = def.outdoor ?? { stacks: [], truss: { at: [0, -def.size.d / 2 + 1], yaw: 0, w: 8, h: 4 }, seed: 1 };
  const high = quality === "high";
  // a room's lens stops at 80 m; out here the sky and the dunes are further than that
  camera.far = 400; camera.updateProjectionMatrix();
  renderer.info.autoReset = false;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = high;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setPixelRatio(Math.min(high ? 1.5 : 1, devicePixelRatio));
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.12; // a little sheen on the metal, no room light
  pm.dispose();

  const group = new THREE.Group();
  group.name = "open-air";
  scene.add(group);
  const rnd = mulberry32(out.seed);
  const horizon = new THREE.Color("#1c1a34"), zenith = new THREE.Color("#03040c");
  scene.background = zenith;
  scene.fog = new THREE.Fog(horizon, 60, 200);

  // ---- the sky: a dome shaded from the horizon's glow to the deep blue overhead, stars, the moon
  const dome = new THREE.SphereGeometry(190, 32, 16), col: number[] = [], p = dome.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const k = Math.max(0, Math.min(1, p.getY(i) / 190));
    const c = new THREE.Color("#3a2436").lerp(horizon, Math.min(1, k * 6)).lerp(new THREE.Color("#0b0f26"), Math.min(1, k * 2.5)).lerp(zenith, Math.max(0, k * 1.4 - 0.3));
    col.push(c.r, c.g, c.b);
  }
  dome.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  group.add(new THREE.Mesh(dome, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false })));
  const stars: number[] = [];
  for (let i = 0; i < 1800; i++) {
    const a = rnd() * Math.PI * 2, y = 0.08 + rnd() * 0.92, r = Math.sqrt(1 - y * y);
    stars.push(Math.cos(a) * r * 180, y * 180, Math.sin(a) * r * 180);
  }
  const starGeo = new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(stars, 3));
  group.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: "#dfe6ff", size: 1.4, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.85 })));
  const moonAt = new THREE.Vector3(-70, 62, -120);
  const moon = new THREE.Mesh(new THREE.SphereGeometry(6, 24, 16), new THREE.MeshBasicMaterial({ color: "#f6f0da", fog: false }));
  moon.position.copy(moonAt);
  group.add(moon);
  const moonlight = new THREE.DirectionalLight("#9fb2e8", 0.9);
  moonlight.position.copy(moonAt).normalize().multiplyScalar(40);
  moonlight.castShadow = high;
  moonlight.shadow.mapSize.set(2048, 2048);
  Object.assign(moonlight.shadow.camera, { left: -25, right: 25, top: 25, bottom: -25, near: 1, far: 100 });
  moonlight.shadow.bias = -0.0005;
  group.add(moonlight, moonlight.target);
  group.add(new THREE.HemisphereLight("#33406e", "#2a1d14", 0.55));

  // ---- the ground: sand to the dunes, laid in metres so its ripples come out their real size
  const flat = Math.max(def.size.w, def.size.d) / 2 + 6;
  const ground = new THREE.PlaneGeometry(360, 360, 120, 120).rotateX(-Math.PI / 2);
  const gp = ground.attributes.position;
  for (let i = 0; i < gp.count; i++) gp.setY(i, duneAt(gp.getX(i), gp.getZ(i), flat));
  ground.computeVertexNormals();
  const sand = new THREE.Mesh(metreUV(ground), surface("sand", "#a88a66"));
  sand.receiveShadow = true;
  group.add(sand);

  // ---- the stacks: bin, mid-bass horn, mid-high horn, on a sand dolly
  const look = gearLook();
  for (const s of out.stacks) {
    const st = new THREE.Group();
    st.position.set(s.at[0], 0, s.at[1]); st.rotation.y = s.yaw;
    let y = 0;
    for (const id of ["sand-dolly", "horn-sub-21", "stack-mid-bass", "stack-mid-high"] as const) {
      const g = gear(id, { look });
      g.position.y = y;
      st.add(g);
      y += new THREE.Box3().setFromObject(g).getSize(new THREE.Vector3()).y;
    }
    group.add(st);
  }

  // ---- the truss: two towers and a span of box truss, the heads hung under it, the lasers on top
  const truss = new THREE.Group(), tr = out.truss;
  truss.position.set(tr.at[0], 0, tr.at[1]); truss.rotation.y = tr.yaw;
  group.add(truss);
  const alu = surface("metal", "#c9ccd1");
  const chord = (len: number, along: "x" | "y") => {
    const sec = new THREE.Group(), r = 0.025, off = 0.14;
    for (const [a, b] of [[-1, -1], [-1, 1], [1, -1], [1, 1]] as const) {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 8), alu);
      if (along === "x") { c.rotation.z = Math.PI / 2; c.position.set(0, a * off, b * off); } else c.position.set(a * off, 0, b * off);
      sec.add(c);
    }
    // the zig-zag lacing between the chords, one draw call
    const n = Math.floor(len / 0.3), lace = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.012, 0.012, 0.4, 6), alu, n * 2), m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    for (let i = 0; i < n; i++) for (const side of [-1, 1]) {
      const t = -len / 2 + (i + 0.5) * 0.3;
      e.set(along === "x" ? 0 : (i % 2 ? 0.8 : -0.8), 0, along === "x" ? (i % 2 ? 0.8 : -0.8) + Math.PI / 2 : 0);
      q.setFromEuler(e);
      lace.setMatrixAt(i * 2 + (side > 0 ? 1 : 0), m.compose(along === "x" ? new THREE.Vector3(t, 0, side * off) : new THREE.Vector3(side * off, t, 0), q, new THREE.Vector3(1, 1, 1)));
    }
    sec.add(lace);
    return sec;
  };
  for (const x of [-tr.w / 2, tr.w / 2]) { const tw = chord(tr.h, "y"); tw.position.set(x, tr.h / 2, 0); truss.add(tw); }
  const span = chord(tr.w + 0.3, "x"); span.position.y = tr.h; truss.add(span);

  // the moving heads: a yoke and a head each, a spot light and its beam, seen in the dust
  const heads: { yoke: THREE.Group; head: THREE.Group; light: THREE.SpotLight; beam: THREE.Mesh }[] = [];
  const n = 6, black = surface("plastic", "#121316");
  const beamGeo = new THREE.CylinderGeometry(0.05, 1.6, 22, 24, 1, true).translate(0, -11, 0);
  for (let i = 0; i < n; i++) {
    const yoke = new THREE.Group();
    yoke.position.set(-tr.w / 2 + 1 + (i * (tr.w - 2)) / (n - 1), tr.h - 0.25, 0.1);
    const arms = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.24, 0.12), black);
    arms.position.y = -0.1;
    const head = new THREE.Group();
    head.position.y = -0.3;
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.16, 0.36, 18), black);
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.12, 18).rotateX(Math.PI / 2).translate(0, -0.185, 0), new THREE.MeshBasicMaterial({ color: BEAMS[i % BEAMS.length] }));
    lens.userData.looked = true;
    const color = new THREE.Color(BEAMS[i % BEAMS.length]);
    const beam = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.08, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    const light = new THREE.SpotLight(color, 160, 30, 0.12, 0.5, 1.6);
    light.position.set(0, -0.2, 0);
    light.target.position.set(0, -10, 0);
    head.add(body, lens, beam, light, light.target);
    yoke.add(arms, head);
    truss.add(yoke);
    heads.push({ yoke, head, light, beam });
  }

  // the lasers: thin green and cyan lines fanning out over the crowd from the top of the truss
  const lasers: THREE.Mesh[] = [];
  const laserGeo = new THREE.CylinderGeometry(0.012, 0.012, 60, 4).translate(0, 30, 0).rotateX(Math.PI / 2);
  for (let i = 0; i < LASERS; i++) {
    const m = new THREE.Mesh(laserGeo, new THREE.MeshBasicMaterial({ color: i % 2 ? "#3dff6a" : "#28d8ff", transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    m.position.set(0, tr.h + 0.3, 0);
    truss.add(m);
    lasers.push(m);
  }
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.18, 0.4), black);
  box.position.set(0, tr.h + 0.22, 0);
  truss.add(box);

  // ---- bulbs strung round the dance floor, on poles, sagging between them
  const bulbs: THREE.Vector3[] = [];
  const poles: THREE.Vector3[] = [];
  if (out.festoon) {
    const [x0, z0, x1, z1] = out.festoon, corners: [number, number][] = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
    for (let c = 0; c < 4; c++) {
      const [ax, az] = corners[c]!, [bx, bz] = corners[(c + 1) % 4]!, len = Math.hypot(bx - ax, bz - az), segs = Math.max(1, Math.round(len / 6)) | 1;
      for (let s = 0; s < segs; s++) {
        const a = new THREE.Vector3(ax + ((bx - ax) * s) / segs, 3.6, az + ((bz - az) * s) / segs);
        const b = new THREE.Vector3(ax + ((bx - ax) * (s + 1)) / segs, 3.6, az + ((bz - az) * (s + 1)) / segs);
        poles.push(a);
        for (let k = 0; k < 8; k++) { const t = k / 8, q = a.clone().lerp(b, t); q.y -= Math.sin(t * Math.PI) * 0.55; bulbs.push(q); }
      }
    }
    const wood = surface("wood", "#4a3826");
    for (const q of poles) { const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 3.7, 8), wood); pole.position.set(q.x, 1.85, q.z); group.add(pole); }
    const bulbMat = new THREE.MeshStandardMaterial({ color: "#000", emissive: "#ffcf86", emissiveIntensity: 2.2 });
    const inst = new THREE.InstancedMesh(new THREE.SphereGeometry(0.06, 10, 8), bulbMat, bulbs.length), m = new THREE.Matrix4();
    bulbs.forEach((q, i) => inst.setMatrixAt(i, m.makeTranslation(q.x, q.y, q.z)));
    inst.userData.looked = true;
    group.add(inst);
    // the wire: one line through every bulb, each run its own strip
    const wire = new THREE.LineBasicMaterial({ color: "#1a1612" });
    for (let i = 0; i < bulbs.length; i += 8) group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([...bulbs.slice(i, i + 8), poles[(i / 8 + 1) % poles.length]!]), wire));
    // a few warm lights, so the floor and the faces near the edge catch the glow
    for (const q of [poles[0], poles[Math.floor(poles.length / 4)], poles[Math.floor(poles.length / 2)], poles[Math.floor((poles.length * 3) / 4)]]) {
      if (!q) continue;
      const l = new THREE.PointLight("#ffc278", 12, 14, 1.8);
      l.position.set(q.x, 3.2, q.z);
      group.add(l);
    }
  }

  // ---- the generator and its jerry cans, off to the side
  if (out.generator) {
    const g = gear("generator-7kva", { look });
    g.position.set(out.generator.at[0], 0, out.generator.at[1]); g.rotation.y = out.generator.yaw;
    group.add(g);
    for (let i = 0; i < 3; i++) {
      const c = gear("jerry-can-20l", { look });
      c.position.set(out.generator.at[0] + 1 + i * 0.4, 0, out.generator.at[1] + 0.6); c.rotation.y = rnd() * 0.4;
      group.add(c);
    }
  }

  // ---- the plants, out past the dance floor: one instanced mesh per kind, each copy turned and sized from the seed
  const plantMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 });
  const keepOut = (x: number, z: number) => Math.abs(x) < def.size.w / 2 + 2 && Math.abs(z) < def.size.d / 2 + 2;
  for (const [grow, count, near] of [[saguaro, 26, 26], [barrel, 60, 22], [pear, 50, 22]] as const) {
    const geo = grow(Math.floor(rnd() * 1e6)), inst = new THREE.InstancedMesh(geo, plantMat, count), m = new THREE.Matrix4();
    for (let i = 0; i < count; i++) {
      let x = 0, z = 0;
      for (let tries = 0; tries < 20; tries++) { const a = rnd() * Math.PI * 2, r = near + rnd() * 70; x = Math.cos(a) * r; z = Math.sin(a) * r; if (!keepOut(x, z)) break; }
      const s = 0.7 + rnd() * 0.6;
      m.compose(new THREE.Vector3(x, duneAt(x, z, flat) - 0.05, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * Math.PI * 2), new THREE.Vector3(s, s, s));
      inst.setMatrixAt(i, m);
    }
    inst.castShadow = high;
    group.add(inst);
  }

  // ---- the post: a strong bloom, so the beams, the lenses and the bulbs glow
  let composer: EffectComposer | null = null;
  const post: string[] = [];
  if (high) {
    composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.5, 0.35, 0.82));
    composer.addPass(new OutputPass());
    post.push("bloom");
  }

  // every solid mesh casts and takes shadows from the moon (the beams and the sky don't)
  function walk() {
    scene.traverse((o) => {
      if (!(o instanceof THREE.Mesh) || o.userData.looked) return;
      o.userData.looked = true;
      const mat = o.material, see = !(mat instanceof THREE.Material && (mat.transparent || mat instanceof THREE.MeshBasicMaterial));
      o.castShadow = high && see;
      o.receiveShadow = see;
    });
  }
  walk();

  let frames = 0, fps = 0, since = performance.now(), count = 0;
  const lights = 2 + heads.length + 4;
  return {
    quality,
    render(cam) {
      if (frames++ % 60 === 0) walk();
      renderer.info.reset();
      const now = performance.now(), t = now / 1000;
      count++;
      if (now - since > 1000) { fps = Math.round((count * 1000) / (now - since)); count = 0; since = now; }
      heads.forEach((h, i) => {
        const a = headAim(i, heads.length, t);
        h.yoke.rotation.y = a.pan;
        // tilt the head out toward the floor (+z, in the truss's frame)
        h.head.rotation.x = -a.tilt;
      });
      lasers.forEach((l, i) => {
        const spread = ((i / (LASERS - 1)) - 0.5) * 1.3;
        l.rotation.set(-0.06 - Math.abs(Math.sin(t * 0.7)) * 0.12, spread + Math.sin(t * 0.9) * 0.25, 0);
        l.visible = Math.sin(t * 0.25) > -0.3; // they go out now and then, and come back
      });
      if (composer) composer.render(); else renderer.render(scene, cam);
    },
    resize(wpx, hpx) {
      renderer.setSize(wpx, hpx, false);
      if (composer) { composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(wpx, hpx); }
    },
    state: () => ({ quality, lights, shadows: high ? 1 : 0, post, tone: "aces", exposure: renderer.toneMappingExposure, drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles, fps, ground: 0, env: "generated" }),
  };
}
