// The galaxy's air (land3d.ts): the sky, sun, fog, bloom and what falls or floats, blending to the mood of the land you
// stand on, and each plot's own chimney smoke and flying cars. Everything here is ours: a neighbour's mood is only the
// bounded numbers and colours land.ts checked.
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { DAY, type Mood } from "./land.ts";

const COLOURS = ["top", "low", "fog", "sun", "sky", "dirt"] as const;
const NUMBERS = ["near", "far", "power", "fill", "bloom"] as const;
const FALLING = ["rain", "snow", "fireflies"] as const;
const calm = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
let seed = 3;
const rnd = (a: number, b: number) => a + ((seed = (seed * 16807) % 2147483647) / 2147483647) * (b - a);

/** A soft round dot, for fireflies and snow. */
function dot() {
  const c = document.createElement("canvas");
  c.width = c.height = 32;
  const g = c.getContext("2d")!, soft = g.createRadialGradient(16, 16, 1, 16, 16, 15);
  soft.addColorStop(0, "#fff"); soft.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = soft; g.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
}

/** What falls or floats around you, one kind each, faded in by how much of its weather you are in. */
function weathers(scene: THREE.Scene) {
  const round = dot();
  const points = (n: number, high: number, color: string, size: number) => {
    const at = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) at.set([rnd(-70, 70), rnd(0.8, high), rnd(-70, 70)], i * 3);
    return new THREE.Points(new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(at, 3)),
      new THREE.PointsMaterial({ color, map: round, size, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  };
  const drops = new Float32Array(1800 * 6);
  for (let i = 0; i < drops.length; i += 6) { const x = rnd(-70, 70), y = rnd(0, 60), z = rnd(-70, 70); drops.set([x, y, z, x - 0.15, y - 2.2, z], i); }
  const kinds = {
    rain: new THREE.LineSegments(new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(drops, 3)), new THREE.LineBasicMaterial({ color: "#9fc4ff", transparent: true, depthWrite: false })),
    snow: points(1200, 45, "#ffffff", 0.9),
    fireflies: points(220, 10, "#ffe28a", 1.1),
  };
  const strength = { rain: 0, snow: 0, fireflies: 0 };
  for (const k of FALLING) { kinds[k].frustumCulled = false; scene.add(kinds[k]); }
  return {
    step(want: Mood["weather"], at: THREE.Vector3, dt: number, t: number) {
      for (const k of FALLING) {
        strength[k] += ((want === k ? 1 : 0) - strength[k]) * Math.min(1, dt * 1.6);
        const o = kinds[k];
        o.visible = strength[k] > 0.03;
        if (!o.visible) continue;
        o.material.opacity = strength[k] * (k === "rain" ? 0.45 : k === "snow" ? 0.8 : 0.65 + 0.35 * Math.sin(t * 3));
        o.position.set(at.x + (k === "fireflies" ? Math.sin(t * 0.3) * 3 : 0), at.y + (k === "fireflies" ? Math.sin(t * 0.9) * 0.6 : 0), at.z);
        if (calm() || k === "fireflies") continue;
        const p = o.geometry.getAttribute("position"), fall = (k === "rain" ? 55 : 7) * dt, each = k === "rain" ? 2 : 1;
        for (let i = 0; i < p.count; i += each) {
          const up = p.getY(i + each - 1) - fall < 0 ? 60 : 0;
          for (let j = i; j < i + each; j++) p.setY(j, p.getY(j) - fall + up);
        }
        p.needsUpdate = true;
      }
    },
    dispose() { round.dispose(); },
  };
}

const glowing = (color: string, power: number) => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: power });

/** A plot's moving things: smoke over its chimneys and cars crossing over it. Null for a plot with neither. */
export function effects(mood: Mood): { group: THREE.Group; tick: (t: number) => void } | null {
  const spots = mood.smoke ?? [];
  if (!spots.length && !mood.cars) return null;
  const group = new THREE.Group(), moves: ((t: number) => void)[] = [];
  if (spots.length) {
    const puffs = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.9, 1), new THREE.MeshStandardMaterial({ color: "#f3ead9", transparent: true, opacity: 0.5, depthWrite: false }), spots.length * 6);
    const one = new THREE.Object3D();
    puffs.frustumCulled = false;
    group.add(puffs);
    moves.push((t) => {
      spots.forEach((s, n) => {
        for (let i = 0; i < 6; i++) {
          const k = (i / 6 + t * 0.12) % 1;
          one.position.set(s.x + k * 3, s.y + k * 9, s.z);
          one.scale.setScalar(0.6 + k * 1.8);
          one.updateMatrix();
          puffs.setMatrixAt(n * 6 + i, one.matrix);
        }
      });
      puffs.instanceMatrix.needsUpdate = true;
    });
  }
  if (mood.cars) for (let i = 0; i < 6; i++) {
    const car = new THREE.Group();
    const part = (w: number, h: number, d: number, x: number, material: THREE.Material) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material); m.position.x = x; car.add(m); };
    part(5, 1.2, 2.2, 0, glowing("#5a4f8a", 0.25));
    part(0.4, 0.5, 1.8, 2.6, glowing("#dff6ff", 3));
    part(4, 0.2, 0.3, -4, glowing("#ff3b5c", 2.4));
    group.add(car);
    const way = i % 2 ? 1 : -1, speed = 10 + ((i * 7) % 12), from = (i * 61) % 180;
    moves.push((t) => {
      car.position.set((((from + t * speed) % 180) - 90) * way, 36 + (i % 3) * 12, -70 + ((i * 37) % 140));
      car.rotation.y = way > 0 ? 0 : Math.PI;
    });
  }
  return { group, tick: (t) => { for (const move of moves) move(calm() ? 0 : t); } };
}

/** The renderer, sky, lights and bloom. `draw` blends them toward `want` and draws one frame. */
export function airs(canvas: HTMLCanvasElement, scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  let ratio = Math.min(1.5, devicePixelRatio || 1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const now = Object.fromEntries(COLOURS.map((k) => [k, new THREE.Color(DAY[k])])) as Record<(typeof COLOURS)[number], THREE.Color>;
  const num = Object.fromEntries(NUMBERS.map((k) => [k, DAY[k]])) as Record<(typeof NUMBERS)[number], number>;
  const goal = new THREE.Color();
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1100, 24, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: now.top }, low: { value: now.low } },
    vertexShader: "varying vec3 p; void main(){ p = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }",
    fragmentShader: "uniform vec3 top; uniform vec3 low; varying vec3 p; void main(){ float h = clamp(normalize(p).y * 2.4, 0., 1.); gl_FragColor = vec4(mix(low, top, pow(h, .7)), 1.);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}",
  }));
  dome.frustumCulled = false;
  const fog = new THREE.Fog(DAY.fog, DAY.near, DAY.far);
  scene.fog = fog;
  const hemi = new THREE.HemisphereLight(), sun = new THREE.DirectionalLight();
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.6;
  Object.assign(sun.shadow.camera, { left: -90, right: 90, top: 90, bottom: -90, near: 1, far: 400 });
  sun.shadow.camera.updateProjectionMatrix();
  scene.add(dome, hemi, sun, sun.target);
  const sky = weathers(scene);

  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), DAY.bloom, 0.5, 0.85), out = new OutputPass();
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(bloom);
  composer.addPass(out);

  let last = 0, wide = 1, tall = 1, weather: Mood["weather"] = "clear", fps = 60, slow = 0;
  const resize = () => {
    renderer.setPixelRatio(ratio);
    renderer.setSize(wide, tall, false);
    composer.setPixelRatio(ratio);
    composer.setSize(wide, tall);
  };
  return {
    /** The sun and the sky's fill, for whoever must light a layer of its own. */
    lights: [sun, hemi] as const,
    /** Draw one layer again over the frame just drawn, in front of everything. */
    over(layer: number) {
      renderer.autoClear = false;
      renderer.clearDepth();
      camera.layers.set(layer);
      renderer.render(scene, camera);
      camera.layers.set(0);
      renderer.autoClear = true;
    },
    size(w: number, h: number) { wide = w; tall = h; resize(); },
    now: () => ({ weather, fps: Math.round(fps), top: `#${now.top.getHexString()}`, bloom: Math.round(num.bloom * 100) / 100 }),
    /** One frame, `at` being where you stand and `down` how far under the cloud you have come (0 to 1). */
    draw(want: Mood, at: THREE.Vector3, down: number) {
      const ms = performance.now(), took = last ? (ms - last) / 1000 : 0, dt = Math.min(0.1, took);
      // The first frame takes the mood as it is; after that it blends.
      const k = last ? Math.min(1, dt * 1.6) : 1;
      last = ms;
      weather = want.weather;
      for (const c of COLOURS) now[c].lerp(goal.set(want[c]), k);
      for (const n of NUMBERS) num[n] += (want[n] - num[n]) * k;
      // From high above, the fog stands back so the map still reads.
      fog.color.copy(now.fog);
      fog.near = num.near + (1 - down) * 260;
      fog.far = num.far + (1 - down) * 420;
      hemi.color.copy(now.sky);
      hemi.groundColor.copy(now.dirt);
      hemi.intensity = num.fill * 1.2;
      sun.color.copy(now.sun);
      sun.intensity = num.power;
      sun.position.set(at.x - 80, at.y + 70, at.z + 45);
      sun.target.position.copy(at);
      dome.position.copy(at);
      bloom.strength = num.bloom;
      bloom.threshold = 0.9;
      sky.step(want.weather, at, dt, ms / 1000);
      composer.render();
      // A device that can't keep up gives up sharpness first, then shadows.
      if (took > 0 && took < 0.5) fps += (1 / took - fps) * 0.05;
      slow = fps < 33 ? slow + dt : 0;
      if (slow > 2) {
        slow = 0;
        if (ratio > 1) { ratio = 1; resize(); }
        else if (sun.castShadow) sun.castShadow = false;
      }
    },
    dispose() {
      sky.dispose();
      bloom.dispose();
      out.dispose();
      composer.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
