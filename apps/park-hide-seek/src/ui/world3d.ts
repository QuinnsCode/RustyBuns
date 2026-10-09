// The 3D park. Game coordinates (x east, y north, h up) map to three.js as
// X = x, Y = h, Z = -y. Yaw 0 faces north; a model facing +Z turns by PI - yaw.

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { hashString, rng } from "../geo.ts";
import { HUNT, circleAt, type ActorView, type Circle, type Cue, type Look, type View } from "../hunt/game.ts";
import { clearSky, type Sky, type TimeOfDay } from "../hunt/sim.ts";
import { zoneById, type Prop, type PropKind, type Zone } from "../zones/zone.ts";
import { makeBigfoot, makeCharacter, nameTag, pose, type Character } from "./characters.ts";

export const toThree = (x: number, y: number, h: number) => new THREE.Vector3(x, h, -y);

interface Remote { ch: Character; x: number; y: number; yaw: number; pitch: number; tx: number; ty: number; tyaw: number; crouch: boolean; seenAt: number; speed: number; light: boolean; caught: boolean }

const SKY: Record<TimeOfDay, { sky: string; fog: string; near: number; far: number; hemi: [string, string, number]; sun: [string, number]; elev: number }> = {
  day: { sky: "#9cc7e8", fog: "#c9dceb", near: 60, far: 420, hemi: ["#dfefff", "#4c5a33", 0.9], sun: ["#fff3dc", 2.4], elev: 0.9 },
  dusk: { sky: "#e79a6b", fog: "#b98a78", near: 30, far: 230, hemi: ["#ffcfae", "#2d2a2a", 0.55], sun: ["#ffb177", 1.3], elev: 0.12 },
  night: { sky: "#070b16", fog: "#05070d", near: 8, far: 95, hemi: ["#5d6f9e", "#0c0d12", 0.32], sun: ["#9fb4ff", 0.22], elev: 0.7 },
};
/** What cloud and fog wash the sky towards. */
const GREY: Record<TimeOfDay, { cloud: string; mist: string }> = {
  day: { cloud: "#8f989f", mist: "#b8bfc4" },
  dusk: { cloud: "#6e6466", mist: "#8c7f7a" },
  night: { cloud: "#05070b", mist: "#0d1014" },
};
/** Rain and snow fall in a box this big round the camera. */
const PRECIP = { half: 22, height: 14, rain: 3500, snow: 2200 };

interface Precip { obj: THREE.LineSegments | THREE.Points; pos: Float32Array; n: number; snow: boolean; wind: number }

export class World3D {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(70, 1, 0.1, 1200);
  zone: Zone | null = null;
  private zoneGroup = new THREE.Group();
  private hemi = new THREE.HemisphereLight();
  private sun = new THREE.DirectionalLight();
  private stars: THREE.Points | null = null;
  private remotes = new Map<string, Remote>();
  private me: Character | null = null;
  private bigfoot: Character | null = null;
  private meKey = "";
  private wall: THREE.Mesh;
  private wallTex: THREE.CanvasTexture;
  private cueMeshes = new Map<number, { obj: THREE.Object3D; at: number; kind: Cue["kind"] }>();
  private tod: TimeOfDay | null = null;
  private skyKey = "";
  private fogNear = 1;
  private fogFar = 2;
  private hemiBase = 1;
  private precip: Precip | null = null;
  /** Shared by every swaying material: bushes and treetops move in the wind. */
  private sway = { uTime: { value: 0 }, uWind: { value: 0 } };
  private fog = new THREE.Fog("#000", 1, 2);
  private clock = new THREE.Clock();

  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.scene.add(this.zoneGroup, this.hemi, this.sun, this.sun.target);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -70; sc.right = sc.top = 70; sc.near = 1; sc.far = 600;
    this.sun.shadow.bias = -0.0005;
    // The search area: a striped wall that closes in.
    const stripes = document.createElement("canvas");
    stripes.width = 64; stripes.height = 64;
    const sg = stripes.getContext("2d")!;
    sg.fillStyle = "rgba(255, 120, 40, 0.0)"; sg.fillRect(0, 0, 64, 64);
    sg.strokeStyle = "rgba(255, 150, 60, 0.9)"; sg.lineWidth = 10;
    for (let k = -64; k < 128; k += 32) { sg.beginPath(); sg.moveTo(k, 64); sg.lineTo(k + 64, 0); sg.stroke(); }
    const tex = new THREE.CanvasTexture(stripes);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    this.wallTex = tex;
    this.wall = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 128, 1, true),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }));
    this.wall.renderOrder = 5;
    this.scene.add(this.wall);
  }

  resize() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (!w || !h) return;
    const c = this.renderer.domElement;
    if (c.width !== Math.round(w * this.renderer.getPixelRatio()) || c.height !== Math.round(h * this.renderer.getPixelRatio())) {
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
  }

  // ---- building a zone ----------------------------------------------------------

  setZone(id: string) {
    if (this.zone?.data.id === id) return;
    const z = zoneById(id);
    this.zone = z;
    this.zoneGroup.clear();
    for (const r of this.remotes.values()) this.scene.remove(r.ch.root);
    this.remotes.clear();
    this.zoneGroup.add(this.terrain(z), ...this.props(z));
  }

  private terrain(z: Zone): THREE.Mesh {
    const n = z.n, size = 2 * z.R;
    const geo = new THREE.PlaneGeometry(size, size, n - 1, n - 1);
    geo.rotateX(-Math.PI / 2); // now in XZ, row 0 at Z = -size/2 (north)
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const r = rng(hashString(z.data.id + ":ground"));
    const grass = new THREE.Color("#6d8a4a"), forest = new THREE.Color("#4d6634"), dirt = new THREE.Color("#8b7a55"), rock = new THREE.Color("#8f8d86"), pale = new THREE.Color("#b9b6ac");
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = -pos.getZ(i);
      const h = z.height(x, y), s = z.slope(x, y);
      pos.setY(i, h);
      // Rock on the steep, grass on the flat, a little noise so it isn't flat paint.
      if (s > 1.0) c.copy(rock).lerp(pale, Math.min(1, (s - 1) * 0.8));
      else if (s > 0.55) c.copy(dirt).lerp(rock, (s - 0.55) / 0.45);
      else c.copy(grass).lerp(forest, 0.4 + r() * 0.4).lerp(dirt, Math.max(0, s - 0.3));
      c.offsetHSL(0, 0, (r() - 0.5) * 0.04);
      if (!z.inside(x, y)) c.multiplyScalar(0.75);
      colors.set([c.r, c.g, c.b], i * 3);
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: false }));
    mesh.receiveShadow = true;
    return mesh;
  }

  private props(z: Zone): THREE.Object3D[] {
    const out: THREE.Object3D[] = [];
    const by = new Map<PropKind, Prop[]>();
    for (const p of z.props) { if (!by.has(p.kind)) by.set(p.kind, []); by.get(p.kind)!.push(p); }
    const m = (c: string, o: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9, ...o });
    const place = (geo: THREE.BufferGeometry, material: THREE.Material, list: Prop[], scale: (p: Prop) => [number, number, number], tint?: (p: Prop, c: THREE.Color) => void, sink = 0) => {
      if (!list.length) return;
      const mesh = new THREE.InstancedMesh(geo, material, list.length);
      const o = new THREE.Object3D(), col = new THREE.Color();
      list.forEach((p, i) => {
        o.position.copy(toThree(p.x, p.y, z.height(p.x, p.y) - sink));
        o.rotation.set(0, p.rot, 0);
        o.scale.set(...scale(p));
        o.updateMatrix();
        mesh.setMatrixAt(i, o.matrix);
        if (tint) { tint(p, col); mesh.setColorAt(i, col); }
      });
      mesh.castShadow = true; mesh.receiveShadow = true;
      out.push(mesh);
    };
    // Bend the top of a mesh in the wind, more the higher up (k per local metre).
    const swaying = <M extends THREE.Material>(mat: M, k: number): M => {
      mat.onBeforeCompile = (sh) => {
        sh.uniforms.uTime = this.sway.uTime; sh.uniforms.uWind = this.sway.uWind;
        sh.vertexShader = "uniform float uTime;\nuniform float uWind;\n" + sh.vertexShader.replace("#include <begin_vertex>", `#include <begin_vertex>
          #ifdef USE_INSTANCING
            vec3 swayAt = instanceMatrix[3].xyz;
          #else
            vec3 swayAt = vec3(0.0);
          #endif
          float sw = uWind * ${k.toFixed(4)} * max(0.0, position.y);
          transformed.x += sin(uTime * (1.2 + uWind) + swayAt.x * 0.37 + swayAt.z * 0.21) * sw;
          transformed.z += cos(uTime * (0.9 + uWind) + swayAt.x * 0.19 - swayAt.z * 0.31) * sw * 0.6;`);
      };
      mat.customProgramCacheKey = () => `sway${k}`;
      return mat;
    };
    const r = rng(hashString(z.data.id + ":tint"));
    // Pines: a trunk and three stacked cones.
    const pineTrunk = new THREE.CylinderGeometry(0.18, 0.3, 4, 7).translate(0, 2, 0);
    const pineTop = mergeGeometries([
      new THREE.ConeGeometry(2.6, 5, 9).translate(0, 5, 0),
      new THREE.ConeGeometry(2.1, 4.4, 9).translate(0, 7.6, 0),
      new THREE.ConeGeometry(1.4, 3.8, 9).translate(0, 10.2, 0),
    ])!;
    const pines = by.get("pine") ?? [];
    place(pineTrunk, m("#5b4029"), pines, (p) => [p.size, p.size, p.size], undefined, 0.2);
    place(pineTop, swaying(m("#ffffff"), 0.025), pines, (p) => [p.size, p.size, p.size], (_, c) => c.setHSL(0.3 + r() * 0.06, 0.35 + r() * 0.15, 0.17 + r() * 0.06));
    // Sequoias: huge red trunks, crowns high up.
    const seqs = by.get("sequoia") ?? [];
    place(new THREE.CylinderGeometry(1.1, 2.0, 30, 12).translate(0, 15, 0), m("#8a4a2b"), seqs, (p) => [p.size, p.size, p.size], undefined, 0.5);
    place(mergeGeometries([
      new THREE.DodecahedronGeometry(4.5).scale(1, 0.8, 1).translate(0, 30, 0),
      new THREE.DodecahedronGeometry(3.5).scale(1, 0.8, 1).translate(1.5, 35, 0.5),
      new THREE.DodecahedronGeometry(3).scale(1, 0.8, 1).translate(-1.2, 26, -1),
    ])!, swaying(m("#ffffff", { flatShading: true }), 0.01), seqs, (p) => [p.size, p.size, p.size], (_, c) => c.setHSL(0.28, 0.4, 0.2 + r() * 0.05));
    // Bushes: soft lumps you can crouch in.
    place(new THREE.IcosahedronGeometry(1, 1).scale(1, 0.75, 1).translate(0, 0.55, 0), swaying(m("#ffffff", { flatShading: true }), 0.14), by.get("bush") ?? [],
      (p) => [p.size, p.size, p.size], (_, c) => c.setHSL(0.24 + r() * 0.08, 0.45, 0.22 + r() * 0.08), 0.1);
    place(new THREE.DodecahedronGeometry(1, 0).scale(1, 0.75, 1.1), m("#8b8a84", { flatShading: true }), by.get("boulder") ?? [],
      (p) => [p.size, p.size, p.size], (_, c) => c.setHSL(0.1, 0.05, 0.42 + r() * 0.15), -0.1);
    place(new THREE.CylinderGeometry(0.35, 0.4, 4, 9).rotateZ(Math.PI / 2).translate(0, 0.3, 0), m("#6b4a2e"), by.get("log") ?? [], (p) => [p.size, p.size, p.size]);
    place(new THREE.ConeGeometry(1.6, 2.1, 4).translate(0, 1.05, 0), m("#ffffff"), by.get("tent") ?? [], () => [1, 1, 1],
      (_, c) => c.set(["#e0702b", "#2b78c2", "#e3b52b", "#3f8f4a"][Math.floor(r() * 4)]));
    place(mergeGeometries([new THREE.BoxGeometry(1.8, 0.08, 0.8).translate(0, 0.75, 0), new THREE.BoxGeometry(1.8, 0.06, 0.3).translate(0, 0.45, 0.55), new THREE.BoxGeometry(1.8, 0.06, 0.3).translate(0, 0.45, -0.55), new THREE.BoxGeometry(0.1, 0.75, 1.4).translate(0.7, 0.37, 0), new THREE.BoxGeometry(0.1, 0.75, 1.4).translate(-0.7, 0.37, 0)])!,
      m("#7a5a3a"), by.get("table") ?? [], () => [1, 1, 1]);
    for (const p of by.get("outhouse") ?? []) out.push(this.building(z, p, 1.3, 2.3, 1.3, "#6d5034", "#4a3a2a", "Restroom"));
    for (const p of by.get("cabin") ?? []) out.push(this.building(z, p, 7, 3.6, 6, "#7b5636", "#3f4a32", "Ranger Station"));
    for (const p of by.get("sign") ?? []) out.push(this.signpost(z, p));
    return out;
  }

  private building(z: Zone, p: Prop, w: number, h: number, d: number, wall: string, roof: string, label: string): THREE.Group {
    const g = new THREE.Group();
    const walls = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color: wall, roughness: 0.9 }));
    walls.position.y = h / 2;
    const top = new THREE.Mesh(new THREE.ConeGeometry(Math.max(w, d) * 0.78, h * 0.55, 4), new THREE.MeshStandardMaterial({ color: roof, roughness: 0.8 }));
    top.position.y = h + h * 0.27;
    top.rotation.y = Math.PI / 4;
    top.scale.set(w / Math.max(w, d), 1, d / Math.max(w, d));
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.9, 0.05), new THREE.MeshStandardMaterial({ color: "#3a2717" }));
    door.position.set(0, 0.95, d / 2 + 0.03);
    const window_ = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.6, 0.05), new THREE.MeshStandardMaterial({ color: "#ffd98a", emissive: "#ffb347", emissiveIntensity: 0.8 }));
    window_.position.set(w * 0.3, h * 0.6, d / 2 + 0.03);
    for (const o of [walls, top]) { o.castShadow = true; o.receiveShadow = true; }
    g.add(walls, top, door, window_);
    const tag = nameTag(label, "#e8c547");
    tag.position.y = h * 1.7;
    tag.scale.multiplyScalar(1.6);
    g.add(tag);
    g.position.copy(toThree(p.x, p.y, z.height(p.x, p.y) - 0.3));
    // p.rot is a math angle in the ground plane (from east, counterclockwise);
    // turn the door (local +Z) to face along it.
    g.rotation.y = p.rot + Math.PI / 2;
    return g;
  }

  private signpost(z: Zone, p: Prop): THREE.Group {
    const g = new THREE.Group();
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2, 0.12), new THREE.MeshStandardMaterial({ color: "#5b4029" }));
    post.position.y = 1;
    const c = document.createElement("canvas");
    c.width = 512; c.height = 128;
    const x = c.getContext("2d")!;
    x.fillStyle = "#5a3d22"; x.fillRect(0, 0, 512, 128);
    x.strokeStyle = "#e8d9b0"; x.lineWidth = 6; x.strokeRect(8, 8, 496, 112);
    x.fillStyle = "#f3e7c4"; x.font = "46px Ultra, Georgia, serif"; x.textAlign = "center"; x.textBaseline = "middle";
    let label = p.label ?? "";
    while (x.measureText(label).width > 470 && label.length > 4) label = label.slice(0, -2) + "…";
    x.fillText(label, 256, 66);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const board = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.45, 0.06), [
      ...Array(4).fill(new THREE.MeshStandardMaterial({ color: "#5a3d22" })),
      new THREE.MeshStandardMaterial({ map: tex }), new THREE.MeshStandardMaterial({ map: tex }),
    ]);
    board.position.y = 1.8;
    post.castShadow = board.castShadow = true;
    g.add(post, board);
    g.position.copy(toThree(p.x, p.y, z.height(p.x, p.y)));
    g.rotation.y = p.rot;
    return g;
  }

  // ---- time of day --------------------------------------------------------------

  setTime(tod: TimeOfDay) { this.setSky(clearSky(tod)); }

  /** Light, fog, cloud, rain and wind for a round's conditions. */
  setSky(sky: Sky) {
    const key = JSON.stringify(sky);
    if (this.skyKey === key) return;
    this.skyKey = key;
    const tod = this.tod = sky.tod;
    const s = SKY[tod], grey = GREY[tod];
    const skyCol = new THREE.Color(s.sky), fogCol = new THREE.Color(s.fog);
    let hemi = s.hemi[2], sun = s.sun[1], near = s.near, far = s.far;
    if (sky.overcast || sky.rain > 0.2) {
      skyCol.lerp(new THREE.Color(grey.cloud), 0.7); fogCol.lerp(new THREE.Color(grey.cloud), 0.6);
      hemi *= 0.75; sun *= 0.35;
    }
    if (sky.fog > 0) {
      fogCol.lerp(new THREE.Color(grey.mist), sky.fog);
      skyCol.lerp(fogCol, sky.fog);
      near *= 1 - 0.85 * sky.fog; far *= 1 - 0.8 * sky.fog;
    }
    this.fogNear = near; this.fogFar = far; this.hemiBase = hemi;
    this.scene.background = skyCol;
    this.fog.color.copy(fogCol);
    this.scene.fog = this.fog;
    this.hemi.color.set(s.hemi[0]); this.hemi.groundColor.set(s.hemi[1]); this.hemi.intensity = hemi;
    this.sun.color.set(s.sun[0]); this.sun.intensity = sun;
    this.sun.castShadow = tod !== "night";
    this.sway.uWind.value = sky.wind;
    if (this.stars) { this.scene.remove(this.stars); this.stars = null; }
    // Clouds or fog hide the stars (and the moon: that's why it's darker).
    if (tod === "night" && !sky.overcast && sky.fog < 0.5) {
      const r = rng(7), pts = new Float32Array(1500 * 3);
      for (let i = 0; i < 1500; i++) {
        const a = r() * Math.PI * 2, e = Math.asin(0.05 + r() * 0.95), d = 900;
        pts.set([Math.cos(a) * Math.cos(e) * d, Math.sin(e) * d, Math.sin(a) * Math.cos(e) * d], i * 3);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pts, 3));
      this.stars = new THREE.Points(geo, new THREE.PointsMaterial({ color: "#dfe7ff", size: 2, sizeAttenuation: false, fog: false }));
      this.scene.add(this.stars);
    }
    if (this.precip) { this.scene.remove(this.precip.obj); this.precip.obj.geometry.dispose(); this.precip = null; }
    if (sky.rain > 0.05) this.precip = this.makePrecip(sky);
  }

  /** Rain as falling streaks, snow as drifting flakes, in a box that follows the camera. */
  private makePrecip(sky: Sky): Precip {
    const { half, height } = PRECIP;
    const n = Math.round((sky.snow ? PRECIP.snow : PRECIP.rain) * Math.min(1, sky.rain));
    const r = rng(11);
    const per = sky.snow ? 3 : 6;
    const pos = new Float32Array(n * per);
    for (let i = 0; i < n; i++) {
      const x = (r() * 2 - 1) * half, y = (r() * 2 - 1) * height, z = (r() * 2 - 1) * half;
      pos.set(sky.snow ? [x, y, z] : [x, y, z, x, y - 0.5, z], i * per);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const night = sky.tod === "night";
    const obj = sky.snow
      ? new THREE.Points(geo, new THREE.PointsMaterial({ color: night ? "#7d8594" : "#f4f7fb", size: 0.09, transparent: true, opacity: 0.9, depthWrite: false }))
      : new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: night ? "#4c5666" : "#b4c2d2", transparent: true, opacity: 0.5, depthWrite: false }));
    obj.frustumCulled = false;
    this.scene.add(obj);
    return { obj, pos, n, snow: sky.snow, wind: sky.wind };
  }

  private fall(dt: number) {
    const p = this.precip;
    if (!p) return;
    const { half, height } = PRECIP;
    const fall = (p.snow ? 1.3 : 11) * dt, drift = (p.snow ? 2.5 : 4) * p.wind * dt;
    const per = p.snow ? 3 : 6, slant = p.wind * 0.18, t = this.sway.uTime.value;
    for (let i = 0; i < p.n; i++) {
      const o = i * per;
      let x = p.pos[o] + drift + (p.snow ? Math.sin(t * 1.5 + i) * 0.4 * dt : 0), y = p.pos[o + 1] - fall;
      if (y < -height) { y += 2 * height; x = (Math.random() * 2 - 1) * half; }
      if (x > half) x -= 2 * half;
      p.pos[o] = x; p.pos[o + 1] = y;
      if (!p.snow) { p.pos[o + 3] = x + slant; p.pos[o + 4] = y - 0.5; p.pos[o + 5] = p.pos[o + 2]; }
    }
    (p.obj.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    p.obj.position.copy(this.camera.position);
  }

  // ---- per frame ----------------------------------------------------------------

  /**
   * Draw a frame. `me` is your own body (moved locally, so it never lags); the
   * view brings everyone else you're allowed to see.
   */
  frame(v: View, me: { x: number; y: number; yaw: number; pitch: number; crouch: boolean; speed: number; light: boolean } | null, look: Look, cam: { mode: "first" | "third"; dist: number }, now: number, follow: { x: number; y: number; yaw: number } | null = null) {
    const dt = Math.min(0.1, this.clock.getDelta());
    const z = this.zone;
    if (!z || !this.tod) return;
    this.fog.near = this.fogNear; this.fog.far = this.fogFar;
    this.sway.uTime.value += dt;
    const r = v.round;
    if (this.stars) this.stars.position.copy(this.camera.position);

    // Remote actors: ease towards the latest known position.
    const live = new Set<string>();
    for (const a of r?.others ?? []) {
      live.add(a.id);
      let rem = this.remotes.get(a.id);
      if (rem && (rem.ch.role !== a.role)) { this.scene.remove(rem.ch.root); rem = undefined; }
      if (!rem) {
        const p = v.players.find((q) => q.id === a.id);
        const ch = makeCharacter(a.role, p?.look ?? look, p?.name ?? "?");
        this.scene.add(ch.root);
        rem = { ch, x: a.x, y: a.y, yaw: a.yaw, pitch: a.pitch, tx: a.x, ty: a.y, tyaw: a.yaw, crouch: a.crouch, seenAt: now, speed: 0, light: a.light, caught: false };
        this.remotes.set(a.id, rem);
      }
      rem.tx = a.x; rem.ty = a.y; rem.tyaw = a.yaw; rem.pitch = a.pitch; rem.crouch = a.crouch; rem.light = a.light; rem.caught = a.caughtAt !== null;
    }
    for (const [id, rem] of this.remotes) if (!live.has(id)) { this.scene.remove(rem.ch.root); this.remotes.delete(id); }
    for (const rem of this.remotes.values()) {
      const k = Math.min(1, dt * 10);
      const ox = rem.x, oy = rem.y;
      rem.x += (rem.tx - rem.x) * k; rem.y += (rem.ty - rem.y) * k;
      rem.yaw += Math.atan2(Math.sin(rem.tyaw - rem.yaw), Math.cos(rem.tyaw - rem.yaw)) * k;
      rem.speed = Math.hypot(rem.x - ox, rem.y - oy) / Math.max(dt, 1e-3);
      this.placeChar(rem.ch, z, rem.x, rem.y, rem.yaw, rem.pitch, rem.crouch, rem.speed, rem.light, dt, rem.caught);
    }

    // Bigfoot, when you can see him: crouched in his bush, standing tall once he's found.
    const bf = r?.bigfoot ?? null;
    if (bf && !this.bigfoot) { this.bigfoot = makeBigfoot(); this.scene.add(this.bigfoot.root); }
    if (this.bigfoot) {
      this.bigfoot.root.visible = !!bf;
      if (bf) {
        this.placeChar(this.bigfoot, z, bf.x, bf.y, bf.yaw, 0, !bf.foundBy, 0, false, dt, false);
        this.bigfoot.tag.visible = !!bf.foundBy;
      }
    }

    // You.
    const meRole = r?.you?.role ?? null;
    const key = meRole ? `${meRole}:${JSON.stringify(look)}` : "";
    if (key !== this.meKey) {
      if (this.me) this.scene.remove(this.me.root);
      this.me = meRole ? makeCharacter(meRole, look, "You") : null;
      if (this.me) { this.me.tag.visible = false; this.scene.add(this.me.root); }
      this.meKey = key;
    }
    if (this.me && me) {
      // First person: hide your body, but not your flashlight (a light inside a
      // hidden object doesn't shine). The beam cone would wrap the camera, so it goes too.
      const third = cam.mode === "third";
      this.me.root.traverse((o) => { if ((o as THREE.Mesh).isMesh || (o as THREE.Sprite).isSprite) o.visible = third; });
      this.me.tag.visible = false;
      this.placeChar(this.me, z, me.x, me.y, me.yaw, me.pitch, me.crouch, me.speed, me.light, dt, false);
      // Your own flashlight works in first person too.
      if (this.me.light) { this.me.light.castShadow = true; this.me.light.shadow.mapSize.set(1024, 1024); }
      if (this.me.beam && !third) this.me.beam.visible = false;
    }

    this.cues(v, z, now);
    this.circle(r?.circle ?? null, z, now, v.phase === "hunt");
    if (me) this.place(z, me, cam);
    else if (follow) this.follow(z, follow.x, follow.y, follow.yaw);
    this.fall(dt);
    this.renderer.render(this.scene, this.camera);
  }

  /** Where a remote actor is drawn right now (smoothed), for the spectator camera. */
  drawnAt(id: string): { x: number; y: number; yaw: number } | null {
    const r = this.remotes.get(id);
    return r ? { x: r.x, y: r.y, yaw: r.yaw } : null;
  }

  private placeChar(ch: Character, z: Zone, x: number, y: number, yaw: number, pitch: number, crouch: boolean, speed: number, light: boolean, dt: number, caught: boolean) {
    ch.root.position.copy(toThree(x, y, z.height(x, y)));
    ch.root.rotation.y = Math.PI - yaw;
    pose(ch, speed, crouch, pitch, dt);
    // Caught campers sit down and glow a little, so it's clear they're out.
    if (caught) { ch.body.position.y = -0.5; ch.tag.material.color.set("#9a9a9a"); }
    const on = light && this.tod !== "day";
    if (ch.light) ch.light.intensity = on ? 60 : 0;
    if (ch.beam) ch.beam.visible = on;
  }

  /** Where the camera goes: your eyes, or behind your shoulder. */
  private place(z: Zone, me: { x: number; y: number; yaw: number; pitch: number; crouch: boolean } | null, cam: { mode: "first" | "third"; dist: number }) {
    if (!me) return;
    const eye = me.crouch ? 0.95 : 1.6;
    const head = toThree(me.x, me.y, z.height(me.x, me.y) + eye);
    const fwd = new THREE.Vector3(Math.sin(me.yaw) * Math.cos(me.pitch), Math.sin(me.pitch), -Math.cos(me.yaw) * Math.cos(me.pitch));
    if (cam.mode === "first") {
      this.camera.position.copy(head).addScaledVector(fwd, 0.15);
    } else {
      // Back off along the view, up a little, and not through the ground.
      const back = head.clone().addScaledVector(fwd, -cam.dist).add(new THREE.Vector3(0, 0.6, 0));
      const right = new THREE.Vector3(Math.cos(me.yaw), 0, Math.sin(me.yaw));
      back.addScaledVector(right, 0.55);
      const ground = z.height(back.x, -back.z) + 0.4;
      if (back.y < ground) back.y = ground;
      this.camera.position.copy(back);
    }
    this.camera.lookAt(head.clone().addScaledVector(fwd, 20));
    // Keep the sun's shadow box centred on you.
    this.sun.position.copy(head).add(new THREE.Vector3(-60, 80 * SKY[this.tod ?? "day"].elev + 20, 40));
    this.sun.target.position.copy(head);
  }

  /** Spectating: orbit someone. */
  follow(z: Zone, x: number, y: number, yaw: number) {
    this.place(z, { x, y, yaw, pitch: -0.35, crouch: false }, { mode: "third", dist: 7 });
  }

  private circle(c: Circle | null, z: Zone, now: number, show: boolean) {
    this.wall.visible = show && !!c;
    if (!c || !show) return;
    const k = circleAt(c, now);
    // A tall band from below the valley floor to above the rim; stripes stay ~3 m wide whatever the size.
    let hMax = 0;
    for (let i = 0; i < z.h.length; i += 53) hMax = Math.max(hMax, z.h[i]);
    const height = hMax + 30;
    this.wall.position.copy(toThree(k.x, k.y, height / 2 - 10));
    this.wall.scale.set(k.r, height, k.r);
    this.wallTex.repeat.set(Math.round((2 * Math.PI * k.r) / 3), height / 3);
  }

  private cues(v: View, z: Zone, now: number) {
    const live = new Set<number>();
    for (const c of v.round?.cues ?? []) {
      if (c.kind === "caught" && c.by === v.me) continue;
      live.add(c.id);
      if (this.cueMeshes.has(c.id)) continue;
      const color = c.kind === "rustle" ? "#9be36b" : c.kind === "step" ? "#f2d17b" : c.kind === "call" ? "#ffb347" : c.kind === "howl" ? "#c08cff" : "#ff5a4a";
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false, fog: false }));
      ring.rotation.x = -Math.PI / 2;
      const g = new THREE.Group();
      g.add(ring);
      if (c.kind === "rustle" || c.kind === "step" || c.kind === "howl") {
        const mark = nameTag(c.kind === "rustle" ? "rustle?" : c.kind === "howl" ? "a howl?" : "footsteps", color);
        mark.position.y = 2.2;
        g.add(mark);
      }
      g.position.copy(toThree(c.x, c.y, z.height(c.x, c.y) + 0.2));
      this.scene.add(g);
      this.cueMeshes.set(c.id, { obj: g, at: c.at, kind: c.kind });
    }
    for (const [id, m] of this.cueMeshes) {
      const age = (now - m.at) / 1000;
      if (!live.has(id) || age > 5) { this.scene.remove(m.obj); this.cueMeshes.delete(id); continue; }
      const ring = m.obj.children[0] as THREE.Mesh;
      // A call spreads out to how far it carries, then fades.
      const grow = m.kind === "call" ? Math.min(HUNT.callRadius, 4 + age * 40) : m.kind === "howl" ? Math.min(HUNT.howlJitter, 3 + age * 12) : 1 + age * 2.5;
      ring.scale.setScalar(grow);
      (ring.material as THREE.MeshBasicMaterial).opacity = Math.max(0, (m.kind === "call" ? 0.7 - age / 2 : 0.9 - age / 5));
    }
  }

  /** Lobby: slowly circle the zone. */
  orbit(t: number) {
    const z = this.zone;
    if (!z || !this.tod) return;
    // From up here the whole zone should show, even on a dark night.
    this.fog.near = 250; this.fog.far = 900;
    if (this.tod === "night") this.hemi.intensity = 0.6;
    const a = t * 0.00005;
    const d = z.R * 1.25;
    const target = toThree(0, 0, z.height(0, 0) + 10);
    let hMax = 0;
    for (let i = 0; i < z.h.length; i += 37) hMax = Math.max(hMax, z.h[i]);
    this.camera.position.set(Math.cos(a) * d, hMax + 45, Math.sin(a) * d);
    this.camera.lookAt(target);
    this.sun.position.set(-80, 150, 60);
    this.sun.target.position.set(0, 0, 0);
    this.renderer.render(this.scene, this.camera);
    this.hemi.intensity = this.hemiBase;
  }
}

export type { ActorView };
