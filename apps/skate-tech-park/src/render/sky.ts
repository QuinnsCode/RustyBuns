// The air above the park: a dome that fades from a warm haze at the horizon to a clear blue overhead,
// and two rings of far ridges, each one hazier than the one before. The haze colour is the scene's
// fog colour, so the ground fades into the same colour the sky starts from.
import * as THREE from "three";
import type { Mood } from "./weather.ts";

export const HAZE = 0xf2c49a; // golden hour, the default

export function sky(haze = HAZE) {
  const group = new THREE.Group();
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(1, 24, 12),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        haze: { value: new THREE.Color(haze) }, zenith: { value: new THREE.Color(0x6f9fd8) }, sun: { value: new THREE.Vector3(-0.8, 0.25, -0.5).normalize() },
        sunColor: { value: new THREE.Color(0xffc880) }, cloud: { value: 0.35 }, cloudTone: { value: new THREE.Color(0xf6b98f) }, time: { value: 0 }, flash: { value: 0 },
      },
      vertexShader: "varying vec3 v; void main() { v = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
      fragmentShader: `uniform vec3 haze; uniform vec3 zenith; uniform vec3 sun; uniform vec3 sunColor; uniform vec3 cloudTone;
        uniform float cloud; uniform float time; uniform float flash; varying vec3 v;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }
        float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * noise(p); p = p * 2.03 + 11.7; a *= 0.5; } return s; }
        void main() {
          float up = clamp(v.y, 0.0, 1.0);
          vec3 c = mix(haze, zenith, pow(up, 0.55));
          float s = max(dot(v, sun), 0.0);
          c += sunColor * pow(s, 24.0) * 0.5 + sunColor * pow(s, 400.0) * 1.5; // glow round the sun, and its disc
          // Clouds on a plane overhead: they drift, thin toward the horizon, and the side facing the sun is lit.
          vec2 uv = v.xz / (v.y + 0.12) * 0.9 + vec2(time * 0.012, time * 0.005);
          float d = fbm(uv * 1.3) * 0.75 + fbm(uv * 3.1 + 5.0) * 0.25;
          float m = smoothstep(1.0 - cloud, 1.0 - cloud + 0.35, d) * smoothstep(0.0, 0.2, v.y);
          vec3 lit = mix(cloudTone, vec3(1.0), clamp(0.45 + s * 0.8 - (d - 0.5), 0.0, 1.0));
          c = mix(c, lit, m * 0.92);
          c += vec3(0.75, 0.8, 1.0) * flash * (0.35 + m * 0.65);
          gl_FragColor = vec4(c, 1.0);
        }`,
    }),
  );
  dome.renderOrder = -2;
  group.userData.dome = dome.material;
  group.add(dome);
  // Far ridges: jagged rings, nearest the darkest, each fading toward the haze.
  [[0.55, 0x8a8aa0, 0.0], [0.7, 0xa59aa5, 1.7]].forEach(([fade, color, phase], k) => {
    const n = 96, r = 0.9 - k * 0.03;
    const geo = new THREE.BufferGeometry(), pos: number[] = [];
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
      const h = (a: number) => 0.035 + 0.03 * Math.abs(Math.sin(a * 5 + phase!) * Math.cos(a * 3 + phase! * 2)) + 0.012 * Math.sin(a * 23);
      pos.push(Math.sin(a0) * r, 0, Math.cos(a0) * r, Math.sin(a1) * r, 0, Math.cos(a1) * r, Math.sin(a0) * r, h(a0), Math.cos(a0) * r);
      pos.push(Math.sin(a1) * r, 0, Math.cos(a1) * r, Math.sin(a1) * r, h(a1), Math.cos(a1) * r, Math.sin(a0) * r, h(a0), Math.cos(a0) * r);
    }
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    const ridge = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: new THREE.Color(color as number).lerp(new THREE.Color(haze), fade as number), side: THREE.DoubleSide, fog: false, depthWrite: false }));
    ridge.renderOrder = -1;
    group.add(ridge);
  });
  return group;
}

/** The dome is a unit sphere: scale it past the park and keep it centred on the camera. */
export function followCamera(g: THREE.Object3D, camera: THREE.Camera, radius = 900) {
  g.position.copy(camera.position);
  g.scale.setScalar(radius);
}

const RIDGES: [number, number][] = [[0x8a8aa0, 0.55], [0xa59aa5, 0.7]];
/** Paints the dome and ridges with a mood's colours. */
export function skyMood(g: THREE.Object3D, m: Mood) {
  const u = (g.userData.dome as THREE.ShaderMaterial).uniforms;
  u.haze!.value.set(m.haze); u.zenith!.value.set(m.zenith); u.sunColor!.value.set(m.sunColor);
  u.sun!.value.set(...m.sun).normalize(); u.cloud!.value = m.cloud; u.cloudTone!.value.set(m.cloudTone);
  g.children.slice(1).forEach((r, k) => ((r as THREE.Mesh).material as THREE.MeshBasicMaterial).color.set(RIDGES[k]![0]).lerp(new THREE.Color(m.haze), RIDGES[k]![1]));
}

/** Drifts the clouds; `flash` (0..1) is a lightning strike lighting the whole sky. */
export function skyTime(g: THREE.Object3D, time: number, flash = 0) {
  const u = (g.userData.dome as THREE.ShaderMaterial).uniforms;
  u.time!.value = time; u.flash!.value = flash;
}
