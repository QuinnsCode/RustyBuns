// Weather and time of day. A mood is the whole look of a park's air at once: sky colours, sun, fog, cloud
// cover, and what falls (rain, snow, dust, drifting motes). Each park names one; `?weather=` overrides it.
// `Precip` is the falling stuff: a pooled box of particles that follows the camera and wraps round it, so a
// few thousand points fill the whole view however far the rider goes.
import { mulberry32 } from "@rustybuns/util";
import * as THREE from "three";

export type Fall = "none" | "rain" | "snow" | "dust" | "motes";

export type Mood = {
  haze: number; zenith: number; // horizon and overhead sky
  sun: [number, number, number]; sunColor: number; sunPower: number; // where it is (a direction), its colour and strength
  skyFill: number; groundFill: number; fill: number; // the hemisphere light
  fog: [number, number]; // near/far as a fraction of the park's usual fog distance
  cloud: number; cloudTone: number; // cover 0..1, and the colour of the cloud's underside
  exposure: number;
  fall: Fall; amount: number; // particles in the box, as a fraction of the pool
  wind: [number, number]; // m/s along x and z
  wet: number; snow: number; // 0..1: dark shiny ground, white ground
  lightning?: boolean;
};

const GOLDEN: Mood = {
  haze: 0xf2c49a, zenith: 0x6f9fd8, sun: [-60, 22, -30], sunColor: 0xffd2a0, sunPower: 2.4, skyFill: 0xbcd3ff, groundFill: 0x8a6a50, fill: 0.9,
  fog: [1, 1], cloud: 0.35, cloudTone: 0xf6b98f, exposure: 1, fall: "motes", amount: 0.25, wind: [1.5, 0.5], wet: 0, snow: 0,
};

export const MOODS = {
  golden: GOLDEN,
  noon: { ...GOLDEN, haze: 0xcfe0f0, zenith: 0x3f7fd0, sun: [-20, 60, -15], sunColor: 0xfff4e0, sunPower: 2.8, skyFill: 0xcfe2ff, groundFill: 0x8a7a60, cloud: 0.3, cloudTone: 0xd8e2ee, fog: [1.2, 1.3], amount: 0.12 },
  dusk: { ...GOLDEN, haze: 0xd9788a, zenith: 0x2b3a78, sun: [-70, 6, -20], sunColor: 0xff8a5a, sunPower: 1.6, skyFill: 0x8a8ad0, groundFill: 0x553a50, fill: 0.7, cloud: 0.45, cloudTone: 0xff7a7a, fog: [0.8, 0.9], exposure: 0.95 },
  overcast: { ...GOLDEN, haze: 0xb7bec6, zenith: 0x8a96a6, sun: [-30, 40, -20], sunColor: 0xe8eef5, sunPower: 0.9, skyFill: 0xc8d2de, groundFill: 0x77786c, fill: 1.25, cloud: 0.9, cloudTone: 0x8c96a2, fog: [0.5, 0.75], fall: "none", amount: 0, wind: [3, 1] },
  rain: { ...GOLDEN, haze: 0x8d98a4, zenith: 0x56626f, sun: [-30, 35, -20], sunColor: 0xcbd6e2, sunPower: 0.9, skyFill: 0xb4c0cf, groundFill: 0x6a7060, fill: 1.7, cloud: 1, cloudTone: 0x5d6772, fog: [0.25, 0.55], exposure: 0.95, fall: "rain", amount: 0.9, wind: [4, 1.5], wet: 1 },
  storm: { ...GOLDEN, haze: 0x59616e, zenith: 0x2a303b, sun: [-30, 30, -20], sunColor: 0x9fb0c8, sunPower: 0.5, skyFill: 0x8d9ab0, groundFill: 0x50564f, fill: 1.3, cloud: 1, cloudTone: 0x363d48, fog: [0.15, 0.4], exposure: 0.9, fall: "rain", amount: 1, wind: [9, 3], wet: 1, lightning: true },
  snow: { ...GOLDEN, haze: 0xdfe5ec, zenith: 0xa5b4c8, sun: [-30, 25, -20], sunColor: 0xeef3ff, sunPower: 1.2, skyFill: 0xdbe6f5, groundFill: 0xaab4c4, fill: 1.3, cloud: 0.85, cloudTone: 0xc4ccd8, fog: [0.2, 0.5], fall: "snow", amount: 0.8, wind: [1.5, 0.5], snow: 0.85 },
  dust: { ...GOLDEN, haze: 0xdcae7a, zenith: 0xb89870, sun: [-40, 28, -20], sunColor: 0xffc27a, sunPower: 1.8, skyFill: 0xe6c8a0, groundFill: 0x9a6a40, cloud: 0.15, cloudTone: 0xe6b88a, fog: [0.3, 0.6], fall: "dust", amount: 0.7, wind: [7, 2] },
  mist: { ...GOLDEN, haze: 0xd7dccf, zenith: 0x9db4c8, sun: [-60, 12, -30], sunColor: 0xffe6c0, sunPower: 1.5, skyFill: 0xcfdcea, groundFill: 0x7f8a70, cloud: 0.5, cloudTone: 0xe8e4d8, fog: [0.1, 0.45], amount: 0.3, wind: [0.5, 0.2], wet: 0.35 },
} satisfies Record<string, Mood>;

export type MoodName = keyof typeof MOODS;
export const isMood = (s: string | null | undefined): s is MoodName => !!s && s in MOODS;
/** `?weather=rain` beats the park's own mood; anything unknown falls back to golden hour. */
export const moodFor = (search: string, parkMood?: string): Mood => {
  const w = new URLSearchParams(search).get("weather");
  return MOODS[isMood(w) ? w : isMood(parkMood) ? parkMood : "golden"];
};

/** A soft round dot, so flakes and motes aren't squares. */
const dot = () => {
  if (typeof document === "undefined") return null; // headless tests have no canvas
  const c = document.createElement("canvas");
  c.width = c.height = 32;
  const g = c.getContext("2d")!, grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
};

const BOX = { w: 60, h: 30 }; // the box of falling things round the camera
const POOL = 3000;

/** Rain streaks, snowflakes, dust and motes in a box that rides with the camera. */
export class Precip {
  readonly object = new THREE.Group();
  private seed = new Float32Array(POOL * 3); // fixed per particle: where it sits in the box, and its own speed
  private streak: THREE.LineSegments | null = null;
  private points: THREE.Points | null = null;
  n = 0;
  private t = 0;
  private fall: Fall = "none";
  private wind: [number, number] = [0, 0];

  constructor(seed = 7) {
    const r = mulberry32(seed);
    for (let i = 0; i < POOL * 3; i++) this.seed[i] = r();
  }

  /** Starts a mood's weather: rebuilds the particles for what falls and how much. */
  begin(m: Mood) {
    this.fall = m.fall;
    this.wind = m.wind;
    this.n = Math.round(POOL * (m.fall === "none" ? 0 : m.amount));
    this.object.clear();
    this.streak = this.points = null;
    if (!this.n) return;
    const color = m.fall === "rain" ? 0xcfd9e6 : m.fall === "dust" ? 0xd9b98a : m.fall === "snow" ? 0xffffff : 0xfff0cc;
    const geo = new THREE.BufferGeometry();
    if (m.fall === "rain") {
      geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(this.n * 6), 3));
      this.streak = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.4, depthWrite: false, fog: false }));
      this.streak.frustumCulled = false;
      this.object.add(this.streak);
    } else {
      geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(this.n * 3), 3));
      const size = m.fall === "snow" ? 0.22 : m.fall === "dust" ? 0.16 : 0.1;
      this.points = new THREE.Points(geo, new THREE.PointsMaterial({ color, size, map: dot(), transparent: true, opacity: m.fall === "motes" ? 0.55 : 0.75, depthWrite: false, sizeAttenuation: true, fog: false }));
      this.points.frustumCulled = false;
      this.object.add(this.points);
    }
  }

  /** Where particle i is now, wrapped into the box round the camera. */
  at(i: number, cam: { x: number; y: number; z: number }, out = new THREE.Vector3()) {
    const a = this.seed[i * 3]!, b = this.seed[i * 3 + 1]!, c = this.seed[i * 3 + 2]!, t = this.t;
    const fallSpeed = this.fall === "rain" ? 14 + c * 6 : this.fall === "snow" ? 1.1 + c * 0.9 : this.fall === "dust" ? 0.1 : 0.05 + c * 0.1;
    const sway = this.fall === "snow" ? Math.sin(t * (0.6 + c) + a * 40) * 0.8 : this.fall === "motes" ? Math.sin(t * 0.4 + b * 30) * 1.2 : 0;
    const wrap = (v: number, size: number) => ((v % size) + size) % size;
    return out.set(
      cam.x - BOX.w / 2 + wrap(a * BOX.w + this.wind[0] * t + sway, BOX.w),
      cam.y - 4 + wrap(c * BOX.h - fallSpeed * t, BOX.h),
      cam.z - BOX.w / 2 + wrap(b * BOX.w + this.wind[1] * t + sway * 0.5, BOX.w),
    );
  }

  update(dt: number, cam: { x: number; y: number; z: number }) {
    this.t += dt;
    if (!this.n) return;
    const p = new THREE.Vector3();
    if (this.streak) {
      const a = this.streak.geometry.getAttribute("position") as THREE.BufferAttribute;
      for (let i = 0; i < this.n; i++) {
        this.at(i, cam, p);
        a.setXYZ(i * 2, p.x, p.y, p.z);
        a.setXYZ(i * 2 + 1, p.x - this.wind[0] * 0.04, p.y + 0.7, p.z - this.wind[1] * 0.04); // a streak leans into the wind
      }
      a.needsUpdate = true;
    } else if (this.points) {
      const a = this.points.geometry.getAttribute("position") as THREE.BufferAttribute;
      for (let i = 0; i < this.n; i++) { this.at(i, cam, p); a.setXYZ(i, p.x, p.y, p.z); }
      a.needsUpdate = true;
    }
  }
}

/** A storm's lightning: a flash 0..1 that spikes at random moments and dies in a third of a second. */
export class Lightning {
  level = 0;
  private next: number;
  constructor(private rng = mulberry32(3)) { this.next = 3 + this.rng() * 6; }
  update(dt: number) {
    this.next -= dt;
    if (this.next <= 0) { this.level = 0.6 + this.rng() * 0.4; this.next = 4 + this.rng() * 9; }
    this.level = Math.max(0, this.level - dt * 3);
    return this.level;
  }
}
