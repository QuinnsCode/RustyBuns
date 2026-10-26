// The 3D park. Game coordinates (x east, y north, h up) map to three.js as
// X = x, Y = h, Z = -y. Yaw 0 faces north; a model facing +Z turns by PI - yaw.
//
// The look is an illustrated poster of the park: a gradient sky, flat warm
// colours, and ridge after ridge fading into the haze towards the horizon, so the
// fog colour is the sky's horizon colour and far things melt into it.

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { hashString, rng } from "../geo.ts";
import { HUNT, circleAt, type ActorView, type Circle, type Cue, type Disguise, type DisguiseKind, type Look, type View } from "../hunt/game.ts";
import { clearSky, type Sky, type TimeOfDay } from "../hunt/sim.ts";
import { zoneById, zoneLoaded, type Prop, type PropKind, type Zone } from "../zones/zone.ts";
import { makeBigfoot, makeCharacter, nameTag, pose, type Character } from "./characters.ts";

export const toThree = (x: number, y: number, h: number) => new THREE.Vector3(x, h, -y);

/** A prop-hunt camper is drawn as the prop they've turned into. */
interface PropBody { prop: THREE.Mesh | null; propKey: string }
interface Remote extends PropBody { ch: Character; x: number; y: number; yaw: number; pitch: number; tx: number; ty: number; tyaw: number; crouch: boolean; prone: boolean; climb: boolean; seenAt: number; speed: number; light: boolean; caught: boolean; disguise: Disguise | null }

// top: the sky overhead; sky: at the horizon, which is also the fog, so far ridges melt into it.
// ridge: the nearest silhouette ridge (the farther ones fade towards the horizon).
const SKY: Record<TimeOfDay, { top: string; sky: string; fog: string; ridge: string; near: number; far: number; hemi: [string, string, number]; sun: [string, number]; elev: number; exposure: number }> = {
  day: { top: "#6fa6bd", sky: "#f1dcb0", fog: "#e2cfa4", ridge: "#6e7f6a", near: 60, far: 420, hemi: ["#fff1d6", "#5b6236", 0.95], sun: ["#ffe6bb", 2.5], elev: 0.9, exposure: 1.05 },
  dusk: { top: "#2f2549", sky: "#f2803f", fog: "#cf6a45", ridge: "#5a2c3a", near: 30, far: 240, hemi: ["#ffb48a", "#3a2430", 0.62], sun: ["#ff9a52", 1.6], elev: 0.1, exposure: 1.15 },
  night: { top: "#0a1530", sky: "#2a4678", fog: "#1d3254", ridge: "#16233d", near: 14, far: 150, hemi: ["#7f9fd8", "#1c2230", 0.85], sun: ["#b4ccff", 0.7], elev: 0.7, exposure: 1.15 },
};
/** What cloud and fog wash the sky towards. */
const GREY: Record<TimeOfDay, { cloud: string; mist: string }> = {
  day: { cloud: "#8f989f", mist: "#b8bfc4" },
  dusk: { cloud: "#6e6466", mist: "#8c7f7a" },
  night: { cloud: "#1a2230", mist: "#232b38" },
};
/** Rain and snow fall in a box this big round the camera. */
const PRECIP = { half: 22, height: 14, rain: 3500, snow: 2200 };

interface Precip { obj: THREE.LineSegments | THREE.Points; pos: Float32Array; n: number; snow: boolean; wind: number }

/** A geyser's steam: a wisp most of the time, a tall column when it goes off. */
interface Plume { steam: THREE.Mesh; water: THREE.Mesh; size: number; period: number; offset: number }
/** Seconds a geyser erupts for. */
const ERUPTS = 14;
/** How far bushes sit into the ground. */
const BUSH_SINK = 0.1;
/** How far up the trunk a climbing camper is drawn. */
const CLIMB_HEIGHT = 3;

// Bushes, boulders and logs: placed by the thousand in a zone, or one at a time as a prop-hunt camper.
const PROP_GEO: Record<DisguiseKind, () => THREE.BufferGeometry> = {
  bush: () => new THREE.IcosahedronGeometry(1, 1).scale(1, 0.75, 1).translate(0, 0.55, 0),
  boulder: () => new THREE.DodecahedronGeometry(1, 0).scale(1, 0.75, 1.1),
  log: () => new THREE.CylinderGeometry(0.35, 0.4, 4, 9).rotateZ(Math.PI / 2).translate(0, 0.3, 0),
};
/** How far each sits into the ground. */
const PROP_SINK: Record<DisguiseKind, number> = { bush: BUSH_SINK, boulder: -0.1, log: 0 };
/** A disguise's colour: the middle of what that kind is tinted in a zone. */
const PROP_COLOR: Record<DisguiseKind, THREE.Color> = {
  bush: new THREE.Color().setHSL(0.24, 0.42, 0.28),
  boulder: new THREE.Color().setHSL(0.07, 0.08, 0.5),
  log: new THREE.Color("#6b432a"),
};

/** The sky: a gradient from the horizon up, with a glow round the sun. */
function skyDome(): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color() }, horizon: { value: new THREE.Color() }, sun: { value: new THREE.Color() }, sunDir: { value: new THREE.Vector3(0, 1, 0) }, glow: { value: 0 } },
    vertexShader: "varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 sun; uniform vec3 sunDir; uniform float glow; varying vec3 vDir;
      void main() {
        float h = max(vDir.y, 0.0);
        vec3 c = mix(horizon, top, pow(h, 0.55));
        float s = max(dot(normalize(vDir), normalize(sunDir)), 0.0);
        c += sun * glow * (pow(s, 12.0) * 0.6 + pow(s, 400.0) * 1.5);
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(1000, 32, 16), mat);
  m.renderOrder = -10;
  m.frustumCulled = false;
  return m;
}
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
  private tmp = new THREE.Vector3();
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
  private plumes: Plume[] = [];
  private dome = skyDome();
  /** The valley floor, then silhouette ridges round the zone, nearest first; their colours follow the sky. */
  private ridges: THREE.Mesh[] = [];
  private propMats: Record<DisguiseKind, THREE.Material>;
  private propGeos: Record<DisguiseKind, THREE.BufferGeometry>;
  private meProp: PropBody = { prop: null, propKey: "" };

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
    this.scene.add(this.wall, this.dome);
    this.propGeos = { bush: PROP_GEO.bush(), boulder: PROP_GEO.boulder(), log: PROP_GEO.log() };
    const pm = (k: DisguiseKind, flat: boolean) => new THREE.MeshStandardMaterial({ color: PROP_COLOR[k], roughness: 0.9, flatShading: flat });
    this.propMats = { bush: this.swaying(pm("bush", true), 0.14), boulder: pm("boulder", true), log: pm("log", false) };
  }

  // Bend the top of a mesh in the wind, more the higher up (k per local metre).
  private swaying<M extends THREE.Material>(mat: M, k: number): M {
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = this.sway.uTime; sh.uniforms.uWind = this.sway.uWind;
      sh.vertexShader = "uniform float uTime;\nuniform float uWind;\n" + sh.vertexShader.replace("#include <begin_vertex>", `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 swayAt = instanceMatrix[3].xyz;
        #else
          vec3 swayAt = modelMatrix[3].xyz;
        #endif
        float sw = uWind * ${k.toFixed(4)} * max(0.0, position.y);
        transformed.x += sin(uTime * (1.2 + uWind) + swayAt.x * 0.37 + swayAt.z * 0.21) * sw;
        transformed.z += cos(uTime * (0.9 + uWind) + swayAt.x * 0.19 - swayAt.z * 0.31) * sw * 0.6;`);
    };
    mat.customProgramCacheKey = () => `sway${k}`;
    return mat;
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
    if (this.zone?.data.id === id || !zoneLoaded(id)) return;
    const z = zoneById(id);
    this.zone = z;
    this.zoneGroup.clear();
    this.plumes = [];
    for (const r of this.remotes.values()) this.scene.remove(r.ch.root);
    this.remotes.clear();
    this.zoneGroup.add(this.terrain(z), ...this.props(z), ...(this.ridges = this.makeRidges(z)));
    this.skyKey = "";
  }

  /**
   * Three rings of ridgeline beyond the zone's edge, each a flat silhouette a
   * shade closer to the horizon than the one in front: the far valley walls.
   */
  private makeRidges(z: Zone): THREE.Mesh[] {
    let lo = Infinity, hi = 0;
    for (const h of z.h) { lo = Math.min(lo, h); hi = Math.max(hi, h); }
    const r = rng(hashString(z.data.id + ":ridges"));
    // The valley floor out to the far ridges, under the zone's square of terrain.
    const floor = new THREE.Mesh(new THREE.CircleGeometry(z.R * 3.6, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: "#000", fog: false }));
    floor.position.y = lo - 0.5;
    floor.renderOrder = -6;
    return [floor, ...[1.5, 2.3, 3.5].map((k, layer) => {
      const n = 160, pos = new Float32Array((n + 1) * 2 * 3), idx: number[] = [];
      const phase = [r() * 6, r() * 6, r() * 6], base = lo - 40;
      for (let i = 0; i <= n; i++) {
        const a = (i / n) * Math.PI * 2, R = z.R * k;
        // A few octaves of ridge, taller the farther out, so each layer peeks over the last.
        const bumps = 0.5 + 0.3 * Math.sin(a * 3 + phase[0]) + 0.15 * Math.sin(a * 7 + phase[1]) + 0.08 * Math.sin(a * 17 + phase[2]) + 0.04 * Math.sin(a * 41 + layer);
        const top = hi * (0.45 + 0.35 * layer) + 25 + bumps * (40 + 60 * layer);
        pos.set([Math.cos(a) * R, top, Math.sin(a) * R, Math.cos(a) * R, base, Math.sin(a) * R], i * 6);
        if (i < n) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      geo.setIndex(idx);
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: "#000", fog: false, side: THREE.DoubleSide }));
      m.frustumCulled = false;
      m.renderOrder = -5 + layer;
      return m;
    })];
  }

  private terrain(z: Zone): THREE.Mesh {
    const n = z.n, size = 2 * z.R;
    const geo = new THREE.PlaneGeometry(size, size, n - 1, n - 1);
    geo.rotateX(-Math.PI / 2); // now in XZ, row 0 at Z = -size/2 (north)
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const r = rng(hashString(z.data.id + ":ground"));
    // Warm and flat: ochre meadows, olive under the trees, rust-brown dirt, pinkish granite.
    const grass = new THREE.Color("#a39a4c"), forest = new THREE.Color("#5e6a34"), dirt = new THREE.Color("#a5784a"), rock = new THREE.Color("#9d8d86"), pale = new THREE.Color("#d1c3b2");
    // Pale sinter round geysers and hot pools, where nothing grows.
    const sinter = new THREE.Color("#d9d3c2"), hot = z.props.filter((p) => p.kind === "geyser" || p.kind === "pool");
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = -pos.getZ(i);
      const h = z.height(x, y), s = z.slope(x, y);
      pos.setY(i, h);
      // Rock on the steep, grass on the flat, a little noise so it isn't flat paint.
      if (s > 1.0) c.copy(rock).lerp(pale, Math.min(1, (s - 1) * 0.8));
      else if (s > 0.55) c.copy(dirt).lerp(rock, (s - 0.55) / 0.45);
      else c.copy(grass).lerp(forest, 0.4 + r() * 0.4).lerp(dirt, Math.max(0, s - 0.3));
      const bare = hot.reduce((m, p) => Math.min(m, Math.hypot(p.x - x, p.y - y) - p.r), Infinity);
      if (bare < 12) c.lerp(sinter, Math.min(1, (12 - bare) / 6));
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
    const swaying = <M extends THREE.Material>(mat: M, k: number) => this.swaying(mat, k);
    const r = rng(hashString(z.data.id + ":tint"));
    // Pines: a trunk and three stacked cones.
    const pineTrunk = new THREE.CylinderGeometry(0.18, 0.3, 4, 7).translate(0, 2, 0);
    const pineTop = mergeGeometries([
      new THREE.ConeGeometry(2.6, 5, 9).translate(0, 5, 0),
      new THREE.ConeGeometry(2.1, 4.4, 9).translate(0, 7.6, 0),
      new THREE.ConeGeometry(1.4, 3.8, 9).translate(0, 10.2, 0),
    ])!;
    const pines = by.get("pine") ?? [];
    place(pineTrunk, m("#6b3f2a"), pines, (p) => [p.size, p.size, p.size], undefined, 0.2);
    // Deep teal-green pines, flat-shaded so each tier reads as one shape.
    place(pineTop, swaying(m("#ffffff", { flatShading: true }), 0.025), pines, (p) => [p.size, p.size, p.size], (_, c) => c.setHSL(0.38 + r() * 0.06, 0.28 + r() * 0.12, 0.16 + r() * 0.06));
    // Sequoias: huge red trunks, crowns high up.
    const seqs = by.get("sequoia") ?? [];
    place(new THREE.CylinderGeometry(1.1, 2.0, 30, 12).translate(0, 15, 0), m("#8a4a2b"), seqs, (p) => [p.size, p.size, p.size], undefined, 0.5);
    place(mergeGeometries([
      new THREE.DodecahedronGeometry(4.5).scale(1, 0.8, 1).translate(0, 30, 0),
      new THREE.DodecahedronGeometry(3.5).scale(1, 0.8, 1).translate(1.5, 35, 0.5),
      new THREE.DodecahedronGeometry(3).scale(1, 0.8, 1).translate(-1.2, 26, -1),
    ])!, swaying(m("#ffffff", { flatShading: true }), 0.01), seqs, (p) => [p.size, p.size, p.size], (_, c) => c.setHSL(0.28, 0.4, 0.2 + r() * 0.05));
    // Bushes: soft lumps you can crouch in.
    place(PROP_GEO.bush(), swaying(m("#ffffff", { flatShading: true }), 0.14), by.get("bush") ?? [],
      (p) => [p.size, p.size, p.size], (_, c) => c.copy(PROP_COLOR.bush).offsetHSL((r() - 0.5) * 0.08, 0, (r() - 0.5) * 0.08), PROP_SINK.bush);
    place(PROP_GEO.boulder(), m("#8b8a84", { flatShading: true }), by.get("boulder") ?? [],
      (p) => [p.size, p.size, p.size], (_, c) => c.copy(PROP_COLOR.boulder).offsetHSL(0, 0, (r() - 0.5) * 0.15), PROP_SINK.boulder);
    place(PROP_GEO.log(), m("#ffffff"), by.get("log") ?? [], (p) => [p.size, p.size, p.size], (_, c) => c.copy(PROP_COLOR.log), PROP_SINK.log);
    place(new THREE.ConeGeometry(1.6, 2.1, 4).translate(0, 1.05, 0), m("#ffffff"), by.get("tent") ?? [], () => [1, 1, 1],
      (_, c) => c.set(["#e0702b", "#2b78c2", "#e3b52b", "#3f8f4a"][Math.floor(r() * 4)]));
    place(mergeGeometries([new THREE.BoxGeometry(1.8, 0.08, 0.8).translate(0, 0.75, 0), new THREE.BoxGeometry(1.8, 0.06, 0.3).translate(0, 0.45, 0.55), new THREE.BoxGeometry(1.8, 0.06, 0.3).translate(0, 0.45, -0.55), new THREE.BoxGeometry(0.1, 0.75, 1.4).translate(0.7, 0.37, 0), new THREE.BoxGeometry(0.1, 0.75, 1.4).translate(-0.7, 0.37, 0)])!,
      m("#7a5a3a"), by.get("table") ?? [], () => [1, 1, 1]);
    for (const p of by.get("outhouse") ?? []) out.push(this.building(z, p, 1.3, 2.3, 1.3, "#6d5034", "#4a3a2a", "Restroom"));
    for (const p of by.get("cabin") ?? []) out.push(this.building(z, p, 7, 3.6, 6, "#7b5636", "#3f4a32", "Ranger Station"));
    for (const p of by.get("sign") ?? []) out.push(this.signpost(z, p));
    // Geysers: a sinter cone, and steam that's mostly a wisp until it erupts.
    place(new THREE.ConeGeometry(1.3, 1.2, 10, 1, true).translate(0, 0.5, 0), m("#cfc6ae", { flatShading: true, side: THREE.DoubleSide }), by.get("geyser") ?? [], (p) => [p.size, p.size, p.size], undefined, 0.1);
    const steam = new THREE.MeshBasicMaterial({ color: "#f4f6f8", transparent: true, opacity: 0.35, depthWrite: false });
    const water = new THREE.MeshBasicMaterial({ color: "#e4f1f7", transparent: true, opacity: 0.7, depthWrite: false });
    const column = new THREE.CylinderGeometry(1, 0.35, 1, 10, 1, true).translate(0, 0.5, 0);
    for (const p of by.get("geyser") ?? []) {
      const at = toThree(p.x, p.y, z.height(p.x, p.y) + 1.1 * p.size);
      const s = new THREE.Mesh(column, steam), w = new THREE.Mesh(column, water);
      s.position.copy(at); w.position.copy(at);
      out.push(s, w);
      // Old Faithful keeps its name: about every hour and a half, squeezed into a round.
      const h = hashString(p.label ?? "");
      this.plumes.push({ steam: s, water: w, size: p.size, period: /old faithful/i.test(p.label ?? "") ? 90 : 70 + (h % 150), offset: h % 997 });
    }
    // Hot pools: deep blue in the middle, rings of orange round the edge.
    const ring = document.createElement("canvas");
    ring.width = ring.height = 128;
    const rg = ring.getContext("2d")!, grad = rg.createRadialGradient(64, 64, 4, 64, 64, 64);
    for (const [at, col] of [[0, "#1d5fa8"], [0.45, "#3fa6c9"], [0.62, "#9fd4a8"], [0.74, "#e8c75a"], [0.86, "#d9772e"], [1, "rgba(200, 110, 60, 0)"]] as const) grad.addColorStop(at, col);
    rg.fillStyle = grad; rg.fillRect(0, 0, 128, 128);
    const poolTex = new THREE.CanvasTexture(ring);
    poolTex.colorSpace = THREE.SRGBColorSpace;
    const poolMat = new THREE.MeshStandardMaterial({ map: poolTex, transparent: true, roughness: 0.15, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    for (const p of by.get("pool") ?? []) {
      const disc = new THREE.Mesh(new THREE.CircleGeometry(p.r * 1.25, 32).rotateX(-Math.PI / 2), poolMat);
      disc.position.copy(toThree(p.x, p.y, z.height(p.x, p.y) + 0.12));
      disc.rotation.y = p.rot;
      out.push(disc);
    }
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
    const paint = () => {
      x.fillStyle = "#5a3d22"; x.fillRect(0, 0, 512, 128);
      x.strokeStyle = "#e8d9b0"; x.lineWidth = 6; x.strokeRect(8, 8, 496, 112);
      x.fillStyle = "#f3e7c4"; x.font = "46px Lacquer, Georgia, serif"; x.textAlign = "center"; x.textBaseline = "middle";
      let label = p.label ?? "";
      while (x.measureText(label).width > 470 && label.length > 4) label = label.slice(0, -2) + "…";
      x.fillText(label, 256, 66);
    };
    paint();
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    // On a cold load Lacquer can still be on its way: paint the board again once it's here.
    if (document.fonts && !document.fonts.check("46px Lacquer")) void document.fonts.load("46px Lacquer").then(() => { paint(); tex.needsUpdate = true; }).catch(() => {});
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
    const skyCol = new THREE.Color(s.sky), fogCol = new THREE.Color(s.fog), topCol = new THREE.Color(s.top);
    let hemi = s.hemi[2], sun = s.sun[1], near = s.near, far = s.far;
    if (sky.overcast || sky.rain > 0.2) {
      skyCol.lerp(new THREE.Color(grey.cloud), 0.7); fogCol.lerp(new THREE.Color(grey.cloud), 0.6); topCol.lerp(new THREE.Color(grey.cloud), 0.8);
      hemi *= 0.75; sun *= 0.35;
    }
    if (sky.fog > 0) {
      fogCol.lerp(new THREE.Color(grey.mist), sky.fog);
      skyCol.lerp(fogCol, sky.fog); topCol.lerp(fogCol, sky.fog);
      near *= 1 - 0.85 * sky.fog; far *= 1 - 0.8 * sky.fog;
    }
    const u = (this.dome.material as THREE.ShaderMaterial).uniforms;
    u.top.value.copy(topCol); u.horizon.value.copy(fogCol);
    u.sun.value.set(s.sun[0]);
    u.glow.value = tod === "night" || sky.overcast ? 0.15 : tod === "dusk" ? 1 : 0.5;
    u.sunDir.value.set(-60, 80 * s.elev + 20, 40).normalize();
    this.renderer.toneMappingExposure = s.exposure;
    // Each ridge a step from the nearest one's colour towards the haze.
    const ridge = new THREE.Color(s.ridge).lerp(fogCol, sky.fog * 0.7);
    this.ridges.forEach((m, i) => (m.material as THREE.MeshBasicMaterial).color.copy(ridge).lerp(fogCol, i ? 0.25 + 0.27 * (i - 1) : 0.2));
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
  frame(v: View, me: { x: number; y: number; yaw: number; pitch: number; crouch: boolean; prone: boolean; climb: boolean; speed: number; light: boolean } | null, look: Look, cam: { mode: "first" | "third"; dist: number }, now: number, follow: { x: number; y: number; yaw: number } | null = null) {
    const dt = Math.min(0.1, this.clock.getDelta());
    const z = this.zone;
    if (!z || !this.tod) return;
    this.fog.near = this.fogNear; this.fog.far = this.fogFar;
    this.sway.uTime.value += dt;
    this.erupt();
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
        rem = { ch, x: a.x, y: a.y, yaw: a.yaw, pitch: a.pitch, tx: a.x, ty: a.y, tyaw: a.yaw, crouch: a.crouch, prone: a.prone, climb: a.climb, seenAt: now, speed: 0, light: a.light, caught: false, disguise: null, prop: null, propKey: "" };
        this.remotes.set(a.id, rem);
      }
      rem.tx = a.x; rem.ty = a.y; rem.tyaw = a.yaw; rem.pitch = a.pitch; rem.crouch = a.crouch; rem.prone = a.prone; rem.climb = a.climb; rem.light = a.light; rem.caught = a.caughtAt !== null; rem.disguise = a.disguise;
    }
    for (const [id, rem] of this.remotes) if (!live.has(id)) { this.scene.remove(rem.ch.root); this.dress(rem, null, z, 0, 0); this.remotes.delete(id); }
    for (const rem of this.remotes.values()) {
      const k = Math.min(1, dt * 10);
      const ox = rem.x, oy = rem.y;
      rem.x += (rem.tx - rem.x) * k; rem.y += (rem.ty - rem.y) * k;
      rem.yaw += Math.atan2(Math.sin(rem.tyaw - rem.yaw), Math.cos(rem.tyaw - rem.yaw)) * k;
      rem.speed = Math.hypot(rem.x - ox, rem.y - oy) / Math.max(dt, 1e-3);
      this.placeChar(rem.ch, z, rem.x, rem.y, rem.yaw, rem.pitch, rem.crouch, rem.speed, rem.light, dt, rem.caught, rem.climb);
      rem.ch.root.visible = !this.dress(rem, rem.disguise, z, rem.x, rem.y);
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
      this.placeChar(this.me, z, me.x, me.y, me.yaw, me.pitch, me.crouch, me.speed, me.light, dt, false, me.climb);
      // Your own flashlight works in first person too.
      if (this.me.light) { this.me.light.castShadow = true; this.me.light.shadow.mapSize.set(1024, 1024); }
      if (this.me.beam && !third) this.me.beam.visible = false;
      // As a prop you see the prop in third person; in first person it would wrap the camera.
      const d = r?.you?.disguise ?? null;
      this.dress(this.meProp, third ? d : null, z, me.x, me.y);
      if (d) this.me.root.visible = false;
      else this.me.root.visible = true;
    } else this.dress(this.meProp, null, z, 0, 0);

    this.cues(v, z, now);
    this.circle(r?.circle ?? null, z, now, v.phase === "hunt");
    if (me) this.place(z, me, cam);
    else if (follow) this.follow(z, follow.x, follow.y, follow.yaw);
    this.fall(dt);
    this.dome.position.copy(this.camera.position);
    this.renderer.render(this.scene, this.camera);
  }

  /** Draw a disguised camper as their prop (true), or take the prop away (false). */
  private dress(b: PropBody, d: Disguise | null, z: Zone, x: number, y: number): boolean {
    const key = d ? `${d.kind}/${d.size}/${d.rot}` : "";
    if (key !== b.propKey) {
      if (b.prop) { this.scene.remove(b.prop); b.prop = null; }
      if (d) {
        b.prop = new THREE.Mesh(this.propGeos[d.kind], this.propMats[d.kind]);
        b.prop.castShadow = b.prop.receiveShadow = true;
        b.prop.scale.setScalar(d.size);
        b.prop.rotation.y = d.rot;
        this.scene.add(b.prop);
      }
      b.propKey = key;
    }
    if (b.prop && d) b.prop.position.copy(toThree(x, y, z.height(x, y) - PROP_SINK[d.kind]));
    return !!d;
  }

  /** Where a remote actor is drawn right now (smoothed), for the spectator camera. */
  drawnAt(id: string): { x: number; y: number; yaw: number } | null {
    const r = this.remotes.get(id);
    return r ? { x: r.x, y: r.y, yaw: r.yaw } : null;
  }

  private placeChar(ch: Character, z: Zone, x: number, y: number, yaw: number, pitch: number, crouch: boolean, speed: number, light: boolean, dt: number, caught: boolean, climb = false) {
    ch.root.position.copy(toThree(x, y, z.height(x, y) + (climb ? CLIMB_HEIGHT : 0)));
    ch.root.rotation.y = Math.PI - yaw;
    pose(ch, speed, crouch, pitch, dt);
    // Crouched in a bush, your head and hat still poke out of the top. You're only drawn for someone
    // close enough to see you, so this shows them what they can see instead of hiding it in leaves.
    const b = crouch && !caught ? z.bushAt(x, y) : null;
    let lift = 0;
    if (b) {
      ch.root.updateMatrixWorld(true);
      lift = Math.max(0, z.height(b.x, b.y) + b.tall - BUSH_SINK - ch.head.getWorldPosition(this.tmp).y);
    }
    ch.root.userData.lift = (ch.root.userData.lift ?? 0) + (lift - (ch.root.userData.lift ?? 0)) * Math.min(1, dt * 6);
    ch.root.position.y += ch.root.userData.lift;
    // Caught campers sit down and glow a little, so it's clear they're out.
    if (caught) { ch.body.position.y = -0.5; ch.tag.material.color.set("#9a9a9a"); }
    const on = light && this.tod !== "day";
    if (ch.light) ch.light.intensity = on ? 60 : 0;
    if (ch.beam) ch.beam.visible = on;
  }

  /** Where the camera goes: your eyes, or behind your shoulder. */
  private place(z: Zone, me: { x: number; y: number; yaw: number; pitch: number; crouch: boolean; prone?: boolean; climb?: boolean } | null, cam: { mode: "first" | "third"; dist: number }) {
    if (!me) return;
    const eye = me.prone ? 0.4 : me.crouch ? 0.95 : 1.6;
    const head = toThree(me.x, me.y, z.height(me.x, me.y) + eye + (me.climb ? CLIMB_HEIGHT : 0));
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
      const color = c.kind === "rustle" ? "#9be36b" : c.kind === "step" ? "#f2d17b" : c.kind === "thud" ? "#ff8a3d" : c.kind === "call" ? "#ffb347" : c.kind === "howl" ? "#c08cff" : "#ff5a4a";
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false, fog: false }));
      ring.rotation.x = -Math.PI / 2;
      const g = new THREE.Group();
      g.add(ring);
      if (c.kind === "rustle" || c.kind === "step" || c.kind === "howl" || c.kind === "thud") {
        const mark = nameTag(c.kind === "rustle" ? "rustle?" : c.kind === "howl" ? "a howl?" : c.kind === "thud" ? "a thud!" : "footsteps", color);
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

  /** Geysers on the wall clock, so everyone in a round sees the same eruption. */
  private erupt() {
    const now = Date.now() / 1000;
    for (const g of this.plumes) {
      const t = (now + g.offset) % g.period;
      // Up fast, die down slower; a wisp of steam the rest of the time.
      const k = t < ERUPTS ? Math.min(1, t / 2) * Math.min(1, (ERUPTS - t) / 6) : 0;
      const wisp = 1 + Math.sin(now * 0.7 + g.offset) * 0.25;
      g.steam.scale.set(g.size * (0.8 + k * 2.5), g.size * (3 * wisp + k * 28), g.size * (0.8 + k * 2.5));
      g.water.visible = k > 0.05;
      g.water.scale.set(g.size * 0.35, g.size * k * 20, g.size * 0.35);
    }
  }

  /** Lobby: slowly circle the zone. */
  orbit(t: number) {
    const z = this.zone;
    if (!z || !this.tod) return;
    this.erupt();
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
    this.dome.position.copy(this.camera.position);
    this.renderer.render(this.scene, this.camera);
    this.hemi.intensity = this.hemiBase;
  }
}

export type { ActorView };
