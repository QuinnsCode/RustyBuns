// The look: codeSplitter's paper. White ground, white blocks drawn with black
// hairlines, one orange. You are a glossy black clay figure (figure.ts); the conflicts holding a
// compound are orange ones, and a compound's lines go from orange to black when it's merged.
// Files agents mostly wrote are black glass, roads join folders that import each other, and a
// compound with a failing check burns until it's merged. Files sink as they lose lines and
// burst into paper chips when they're gone; rounds draw as tracers, the flamethrower as fire.
//
// Action is drawn like a comic, since glow vanishes on white paper: muzzle flashes are inked
// orange starbursts, blasts are an orange core under inked puffs of smoke with a shockwave ring
// running out along the ground, and each throws a short orange light on what's near it. A
// shield shows as an orange shimmer round the body when it takes a hit, and a band sweeping up
// it as it refills.

import * as THREE from "three";
import { structureOf, type CodeMap, type RepoSnapshot, type Structure } from "../sim/codemap.ts";
import { contourStep } from "../sim/terrain.ts";
import type { Game, GameEvent } from "../sim/game.ts";
import { HEIGHT, ROLL_TIME, type Soldier } from "../sim/game.ts";
import { WEAPONS } from "../sim/weapons.ts";
import { buildFigure, inked, pose, setGun, setHead, type BuildId, type Figure, type Pose } from "./figure.ts";
import { buildHead, HEADS, type HeadDef } from "./heads.ts";
import { BRANCH_RADIUS, HEAD_RADIUS } from "../sim/missions.ts";

export const INK = 0x1f1f1f, ORANGE = 0xe8590c, PAPER = 0xffffff, GREY = 0xbdbdbd;
/** The theirs side of a team battle: clay a shade off ink, so the two sides read apart. */
export const SLATE = 0x6e6e6e;

/** What you picked on the menu: your head and build. */
export interface Look { head: HeadDef; build: BuildId }

export interface World {
  scene: THREE.Scene;
  terrainMesh: THREE.Mesh;
  /** Everything a shot can be aimed at: ground and blocks. */
  solids: THREE.Object3D[];
  /** In a battle, how each player looks, by soldier id; anyone not in it wears the plain ball. */
  looks: Map<number, Look>;
  sync(game: Game, dt: number): void;
  /** Draws what an event leaves behind: a blast, chips, a muzzle flash, a file coming down. */
  event(game: Game, e: GameEvent): void;
}

function label(text: string, sub: string): THREE.Sprite {
  const c = document.createElement("canvas"), k = 2;
  c.width = 512 * k, c.height = 96 * k;
  const g = c.getContext("2d")!;
  g.scale(k, k);
  g.font = "600 30px ui-monospace, SFMono-Regular, Menlo, monospace";
  const w = Math.min(500, g.measureText(text).width + 28);
  g.fillStyle = "rgba(255,255,255,0.92)";
  g.fillRect((512 - w) / 2, 8, w, 80);
  g.strokeStyle = "#1f1f1f";
  g.lineWidth = 1.5;
  g.strokeRect((512 - w) / 2 + 0.75, 8.75, w - 1.5, 78.5);
  g.fillStyle = "#1f1f1f";
  g.textAlign = "center";
  g.fillText(text, 256, 46, 480);
  g.font = "400 20px ui-monospace, SFMono-Regular, Menlo, monospace";
  g.fillStyle = "#6b6b6b";
  g.fillText(sub, 256, 74, 480);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true }));
  s.scale.set(18, 3.375, 1);
  return s;
}

/** How a soldier looks this frame, from what it's doing. */
function poseOf(s: Soldier): Pose {
  if (s.roll > 0 && !s.prone) return "tuck";
  if (s.prone) return "prone";
  if (!s.grounded && Math.hypot(s.vx, s.vz) > 9) return "star";
  if (!s.grounded && Math.abs(s.vy) > 1.5) return "air";
  return s.crouch ? "kneel" : "stand";
}

/** The shield: a shell round the body, lit at its rim and in fine bands, flashed by `uFlash` and swept from the feet up by `uSweep` (0..1, or off below 0). */
function shell(color: number): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uColor: { value: new THREE.Color(color) }, uFlash: { value: 0 }, uSweep: { value: -1 }, uTime: { value: 0 } },
    vertexShader: `varying vec3 vN; varying vec3 vView; varying float vY;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal); vView = normalize(-mv.xyz); vY = position.y;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `uniform vec3 uColor; uniform float uFlash; uniform float uSweep; uniform float uTime;
      varying vec3 vN; varying vec3 vView; varying float vY;
      void main() {
        float rim = pow(1.0 - abs(dot(vN, vView)), 2.2);
        float bands = 0.75 + 0.25 * step(0.5, fract(vY * 10.0 - uTime * 3.0));
        float a = uFlash * (rim * 0.95 + 0.12) * bands;
        float y = (vY + 1.0) / 2.0;
        if (uSweep >= 0.0) a = max(a, (1.0 - smoothstep(0.0, 0.08, abs(y - uSweep))) * (0.25 + rim * 0.75));
        if (a < 0.01) discard;
        gl_FragColor = vec4(uColor, clamp(a, 0.0, 0.9));
      }`,
  });
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(0.55, 0.9, 6, 20), mat);
  m.renderOrder = 5;
  m.visible = false;
  return m;
}

/** An inked orange starburst, for muzzle flashes and the hot core of a blast. */
let burstTex: THREE.CanvasTexture | null = null;
function burst(): THREE.Sprite {
  if (!burstTex) {
    const c = document.createElement("canvas"), n = 256, g = c.getContext("2d")!;
    c.width = c.height = n;
    g.translate(n / 2, n / 2);
    const star = (spikes: number, outer: number, inner: number) => {
      g.beginPath();
      for (let i = 0; i <= spikes * 2; i++) {
        const r = i % 2 ? inner : outer * (0.8 + 0.2 * Math.sin(i * 2.3)), a = (i / (spikes * 2)) * Math.PI * 2;
        g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      g.closePath();
    };
    star(9, 120, 52);
    g.fillStyle = "#e8590c", g.fill();
    g.lineWidth = 7, g.strokeStyle = "#1f1f1f", g.lineJoin = "round", g.stroke();
    star(9, 64, 30);
    g.fillStyle = "#ffd8a8", g.fill();
    burstTex = new THREE.CanvasTexture(c);
    burstTex.colorSpace = THREE.SRGBColorSpace;
  }
  return new THREE.Sprite(new THREE.SpriteMaterial({ map: burstTex, depthWrite: false, transparent: true }));
}

/** A blame tag: a ghost the soldier's size, drawn over everything, so you see it through walls. */
function ghost(): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(0.4, HEIGHT - 0.8, 6, 16), new THREE.MeshBasicMaterial({ color: ORANGE, transparent: true, opacity: 0.45, depthTest: false, depthWrite: false }));
  m.position.y = HEIGHT / 2;
  m.renderOrder = 10;
  m.visible = false;
  return m;
}

/** Pieces joined into one geometry (positions and normals), so a structure is one mesh to aim at and sink. */
function joined(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const flat = parts.map((p) => (p.index ? p.toNonIndexed() : p));
  const g = new THREE.BufferGeometry();
  for (const name of ["position", "normal"]) {
    const arrays = flat.map((p) => p.getAttribute(name).array as Float32Array);
    const out = new Float32Array(arrays.reduce((n, a) => n + a.length, 0));
    arrays.reduce((at, a) => (out.set(a, at), at + a.length), 0);
    g.setAttribute(name, new THREE.BufferAttribute(out, 3));
  }
  return g;
}

/** A file's building, w by h by d and centred on the origin, inside the box that is its hitbox. */
function structure(kind: Structure, w: number, h: number, d: number): THREE.BufferGeometry {
  if (kind === "house") {
    // Walls and a pitched roof, the ridge running along the longer side.
    const wall = h * 0.62, roof = new THREE.Shape([new THREE.Vector2(-w / 2, 0), new THREE.Vector2(w / 2, 0), new THREE.Vector2(0, h - wall)]);
    const top = new THREE.ExtrudeGeometry(roof, { depth: d, bevelEnabled: false }).translate(0, wall - h / 2, -d / 2);
    return joined([new THREE.BoxGeometry(w, wall, d).translate(0, (wall - h) / 2, 0), top]);
  }
  if (kind === "silo") {
    // A drum with a cone cap.
    const r = Math.min(w, d) / 2, cap = Math.min(r * 0.8, h * 0.3), body = h - cap;
    return joined([
      new THREE.CylinderGeometry(r, r, body, 16).translate(0, (body - h) / 2, 0),
      new THREE.ConeGeometry(r, cap, 16).translate(0, h / 2 - cap / 2, 0),
    ]);
  }
  if (kind === "bunker") {
    // Sunk walls under an overhanging slab, a dark slit between them.
    const slab = Math.max(0.25, h * 0.22);
    return joined([
      new THREE.BoxGeometry(w * 0.84, h - slab, d * 0.84).translate(0, -slab / 2, 0),
      new THREE.BoxGeometry(w, slab, d).translate(0, h / 2 - slab / 2, 0),
    ]);
  }
  if (kind === "stack") {
    // Three tiers stepping in as they rise.
    const t = h / 3;
    return joined([0, 1, 2].map((i) => new THREE.BoxGeometry(w * (1 - i * 0.22), t, d * (1 - i * 0.22)).translate(0, -h / 2 + t * (i + 0.5), 0)));
  }
  return new THREE.BoxGeometry(w, h, d);
}

/** How long a downed soldier kneels with its hands up, then sinks away. */
const SURRENDER = 1.4, SINK = 0.8;
/** Half the width of ground the sun's shadows cover, round you. */
const SHADOW_REACH = 45;
/** How fast poses blend into each other, per second. */
const BLEND = 14;

/** How many metres of ground one printing of the code covers before it repeats. */
const TEXT_TILE = 44;

/**
 * The ground's print: the repo's own code, a few lines from each of its biggest files under an
 * orange header with the file's path, in columns like a newspaper page. Without any text (an
 * old cached load) it prints the file paths and line counts instead.
 */
function codePrint(map: CodeMap, text: RepoSnapshot["text"]): THREE.CanvasTexture {
  const n = 2048, c = document.createElement("canvas"), g = c.getContext("2d")!;
  c.width = c.height = n;
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, n, n);
  const cols = 4, lh = 16, rows = n / lh, colW = n / cols, perCol = rows;
  const files = text?.length ? text : [{ path: "files", lines: map.blocks.filter((b) => !b.wall).map((b) => `${b.path}  ${b.lines.toLocaleString()} lines`) }];
  const each = Math.max(4, Math.floor((cols * perCol) / files.length) - 2);
  const out: { s: string; head: boolean }[] = [];
  for (const f of files) {
    out.push({ s: `// ${f.path}`, head: true });
    for (const l of f.lines.slice(0, each)) out.push({ s: l, head: false });
    out.push({ s: "", head: false });
  }
  g.textBaseline = "top";
  out.slice(0, cols * perCol).forEach((line, i) => {
    const col = Math.floor(i / perCol), row = i % perCol;
    g.font = `${line.head ? 600 : 400} 13px ui-monospace, SFMono-Regular, Menlo, monospace`;
    g.fillStyle = line.head ? "#e8590c" : "#3a3a3a";
    g.fillText(line.s, col * colW + 10, row * lh + 1, colW - 16);
  });
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

export function buildWorld(map: CodeMap, you: Look = { head: HEADS[0]!, build: "average" }, text?: RepoSnapshot["text"]): World {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PAPER);
  scene.fog = new THREE.Fog(PAPER, 70, 230);

  const hemi = new THREE.HemisphereLight(0xffffff, 0xe9e9e9, 2.1);
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(-60, 120, 40);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  // The shadows cover the ground round you, not the whole level, so they stay crisp; the sun follows you.
  const sc = sun.shadow.camera as THREE.OrthographicCamera;
  sc.left = sc.bottom = -SHADOW_REACH;
  sc.right = sc.top = SHADOW_REACH;
  sc.far = 400;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  scene.add(hemi, sun, sun.target);
  // Muzzles and blasts light up what's near them: a small pool of lights, always there and dark
  // when idle, so the shaders never rebuild for a light coming or going.
  const lamps = Array.from({ length: 4 }, () => {
    const l = new THREE.PointLight(ORANGE, 0, 10, 1.6);
    scene.add(l);
    return { l, t: 1, life: 1, peak: 0 };
  });
  let nextLamp = 0;
  function flare(x: number, y: number, z: number, peak: number, reach: number, life: number) {
    const k = lamps[nextLamp++ % lamps.length]!;
    k.l.position.set(x, y, z), k.l.distance = reach;
    Object.assign(k, { t: 0, life, peak });
  }

  // Ground: a fine grid of the terrain, paper white, with contour lines spaced for
  // this level's relief so the shape reads without colour, and rock faces hatched in ink.
  const R = map.terrain.R, seg = 220;
  const geo = new THREE.PlaneGeometry(2 * R + 40, 2 * R + 40, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), y = map.terrain.height(x, z);
    pos.setY(i, y);
    if (Math.hypot(x, z) < R) lo = Math.min(lo, y), hi = Math.max(hi, y);
  }
  geo.computeVertexNormals();
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWorld;\nvarying vec3 vN;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvWorld = (modelMatrix * vec4(position, 1.0)).xyz;\nvN = normal;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>\nvarying vec3 vWorld;\nvarying vec3 vN;\nuniform float uR;\nuniform float uStep;\nuniform float uWater;\nuniform sampler2D uText;\nuniform float uTile;`)
      .replace(
        "#include <dithering_fragment>",
        `#include <dithering_fragment>
        // Rock: diagonal hatching, denser the steeper the face, instead of a grey fill.
        float steep = smoothstep(0.3, 0.75, 1.0 - clamp(vN.y, 0.0, 1.0));
        // The ground is printed with the repo's code; it fades out on rock faces.
        vec3 print = texture2D(uText, vec2(vWorld.x, -vWorld.z) / uTile).rgb;
        gl_FragColor.rgb *= mix(vec3(1.0), print, 0.62 * (1.0 - steep * 0.8));
        float hx = (vWorld.x + vWorld.z + vWorld.y) / 0.9, hf = fract(hx);
        float hatch = 1.0 - smoothstep(0.0, fwidth(hx) * 1.2 + 0.12 * (1.0 - steep), min(hf, 1.0 - hf));
        gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.32), hatch * steep * 0.55);
        float h = vWorld.y / uStep, f = fract(h);
        float line = 1.0 - smoothstep(0.0, fwidth(h) * 1.2, min(f, 1.0 - f));
        gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.78), line * 0.55);
        float shore = (vWorld.y - uWater) / 0.12;
        gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.12), (1.0 - smoothstep(0.0, fwidth(shore) * 1.5 + 0.5, abs(shore))) * 0.8);
        float edge = smoothstep(uR - 1.5, uR, length(vWorld.xz));
        gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.93), edge);`,
      );
    sh.uniforms.uR = { value: R };
    sh.uniforms.uStep = { value: contourStep(lo, hi) };
    sh.uniforms.uWater = { value: map.terrain.water ?? -1e6 };
    sh.uniforms.uText = { value: codePrint(map, text) };
    sh.uniforms.uTile = { value: TEXT_TILE };
  };
  const terrainMesh = new THREE.Mesh(geo, mat);
  terrainMesh.receiveShadow = true;
  scene.add(terrainMesh);

  // Standing water: a pale, flat sheet at the water table, ringed in ink where it meets the bank.
  if (map.terrain.water !== undefined) {
    const sheet = new THREE.Mesh(
      new THREE.CircleGeometry(R, 96).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xe3edf2, transparent: true, opacity: 0.85, depthWrite: false }),
    );
    sheet.position.y = map.terrain.water;
    sheet.renderOrder = 1;
    scene.add(sheet);
  }

  // The playable edge: a thin orange ring on the ground.
  const ringPts: THREE.Vector3[] = [];
  for (let i = 0; i <= 256; i++) {
    const a = (i / 256) * Math.PI * 2, x = Math.cos(a) * R, z = Math.sin(a) * R;
    ringPts.push(new THREE.Vector3(x, map.terrain.height(x, z) + 0.15, z));
  }
  scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(ringPts), new THREE.LineBasicMaterial({ color: ORANGE })));

  // Blocks: white buildings with hairline edges, shaped by the kind of file. Compound edges are orange until merged.
  const solids: THREE.Object3D[] = [terrainMesh];
  const boxMat = new THREE.MeshLambertMaterial({ color: PAPER });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x16191c, roughness: 0.18, metalness: 0.6 });
  const edgeInk = new THREE.LineBasicMaterial({ color: INK }), edgeGrey = new THREE.LineBasicMaterial({ color: GREY });
  const compoundEdges = map.compounds.map(() => new THREE.LineBasicMaterial({ color: ORANGE }));
  const files: { b: (typeof map.blocks)[number]; m: THREE.Mesh; tall: number; h: number }[] = [];
  const mud = new THREE.MeshLambertMaterial({ color: 0xc9ae82 }), mudEdge = new THREE.LineBasicMaterial({ color: 0x8a6d44 });
  for (const b of map.blocks) {
    if (b.wall) {
      // Mud-brick: a plain slab, with a lip of battlements on top of the curtain walls and a flat cap on the towers.
      const m = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d), mud);
      m.position.set(b.x, b.y + b.h / 2, b.z);
      m.castShadow = m.receiveShadow = true;
      m.add(new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry), mudEdge));
      const tower = b.h > 4;
      const cap = new THREE.Mesh(new THREE.BoxGeometry(b.w + (tower ? 0.5 : 0.2), 0.35, b.d + (tower ? 0.5 : 0.2)), mud);
      cap.position.y = b.h / 2 + 0.17;
      cap.castShadow = true;
      cap.add(new THREE.LineSegments(new THREE.EdgesGeometry(cap.geometry), mudEdge));
      m.add(cap);
      scene.add(m);
      solids.push(m);
      continue;
    }
    const box = structure(structureOf(b.path), b.w, b.h, b.d);
    const m = new THREE.Mesh(box, b.agent ? glassMat : boxMat);
    m.position.set(b.x, b.y + b.h / 2, b.z);
    m.castShadow = m.receiveShadow = true;
    m.userData.block = b;
    files.push({ b, m, tall: b.h, h: b.h });
    const e = new THREE.LineSegments(new THREE.EdgesGeometry(box, 30), b.compound >= 0 ? compoundEdges[b.compound]! : b.agent ? edgeGrey : edgeInk);
    m.add(e);
    scene.add(m);
    solids.push(m);
  }
  map.compounds.forEach((c) => {
    const s = label(c.folder, `${c.files} files · ${c.lines.toLocaleString()} lines${c.burning ? " · checks failing" : ""}`);
    s.position.set(c.x, map.terrain.height(c.x, c.z) + 13, c.z);
    scene.add(s);
    // The yard: a hairline circle round the compound.
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 96; i++) {
      const a = (i / 96) * Math.PI * 2, x = c.x + Math.cos(a) * c.r, z = c.z + Math.sin(a) * c.r;
      pts.push(new THREE.Vector3(x, map.terrain.height(x, z) + 0.06, z));
    }
    scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), compoundEdges[map.compounds.indexOf(c)]!));
  });

  // Roads: two grey hairlines and a dashed middle, yard edge to yard edge, laid on the ground.
  // A road is wider the more files import across it.
  const roadMat = new THREE.LineBasicMaterial({ color: GREY }), midMat = new THREE.LineDashedMaterial({ color: GREY, dashSize: 1, gapSize: 1.2 });
  for (const road of map.roads ?? []) {
    const a = map.compounds[road.a]!, b = map.compounds[road.b]!;
    const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz), ux = dx / len, uz = dz / len;
    const from = a.r + 0.5, to = len - b.r - 0.5, half = 0.9 + Math.min(1.2, road.weight * 0.15);
    if (to <= from) continue;
    for (const off of [-half, 0, half]) {
      const pts: THREE.Vector3[] = [];
      for (let t = from; t <= to; t += 1) {
        const x = a.x + ux * t - uz * off, z = a.z + uz * t + ux * off;
        pts.push(new THREE.Vector3(x, map.terrain.height(x, z) + 0.08, z));
      }
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), off ? roadMat : midMat);
      if (!off) line.computeLineDistances();
      scene.add(line);
    }
  }

  // Fires: flames on a burning compound's tallest files and smoke above them, out once it's merged.
  const flameGeo = new THREE.ConeGeometry(0.35, 1.2, 7), smokeGeo = new THREE.SphereGeometry(0.6, 10, 8);
  const flameMat = new THREE.MeshBasicMaterial({ color: ORANGE, transparent: true, opacity: 0.85 });
  const fires = map.compounds.map((c, ci) => {
    const g = new THREE.Group();
    if (c.burning) {
      const tall = map.blocks.filter((b) => b.compound === ci).sort((p, q) => q.h - p.h).slice(0, 3);
      tall.forEach((b, i) => {
        for (let k = 0; k < 3; k++) {
          const f = new THREE.Mesh(flameGeo, flameMat);
          f.position.set(b.x + (k - 1) * b.w * 0.25, b.y + b.h + 0.5, b.z + ((k % 2) - 0.5) * b.d * 0.3);
          f.userData.phase = i * 3 + k;
          g.add(f);
        }
        for (let k = 0; k < 4; k++) {
          const puff = new THREE.Mesh(smokeGeo, new THREE.MeshBasicMaterial({ color: GREY, transparent: true, opacity: 0.35, depthWrite: false }));
          puff.userData = { smoke: true, base: b.y + b.h + 1.2, x: b.x, z: b.z, phase: k / 4 };
          g.add(puff);
        }
      });
    }
    scene.add(g);
    return g;
  });

  interface Body {
    fig: Figure; tag: THREE.Mesh; fire: THREE.Group; down: number; shell: THREE.Mesh;
    /** Who it was built as: a battle slot taken by someone else gets a new body. */
    as: string;
    /** Recoil, a hit's jolt (and which side it came from), a landing's dip; the shell's flash and refill sweep. */
    kick: number; flinch: number; flinchSide: number; land: number; air: number; flash: number; sweep: number;
  }
  const bodies = new Map<number, Body>();
  const shotMeshes = new Map<number, THREE.Mesh>();
  // Bullets are tracers, a streak along their flight; the rest are balls; the flamethrower's puffs grow and fade.
  const tracerGeo = new THREE.BoxGeometry(0.05, 0.05, 2.4).translate(0, 0, 1.2), bigShotGeo = new THREE.SphereGeometry(0.22, 12, 8);
  const puffGeo = new THREE.IcosahedronGeometry(0.3, 0);
  const inkShot = new THREE.MeshBasicMaterial({ color: INK });
  const shotMat = { you: inkShot, ours: inkShot, theirs: new THREE.MeshBasicMaterial({ color: SLATE }), conflict: new THREE.MeshBasicMaterial({ color: ORANGE }) };
  const looks = new Map<number, Look>(), plain: Look = { head: HEADS[0]!, build: "average" };
  const tracer = (w: string) => WEAPONS[w as keyof typeof WEAPONS].splash === 0 && !WEAPONS[w as keyof typeof WEAPONS].homing && w !== "stash" && w !== "clean";
  // Chips and dust: small boxes thrown out of whatever got hit, falling under gravity.
  const chipGeo = new THREE.BoxGeometry(1, 1, 1), chipEdges = new THREE.EdgesGeometry(chipGeo);
  const chips: { m: THREE.Object3D; vx: number; vy: number; vz: number; spin: number; t: number; life: number }[] = [];
  function throwChips(x: number, y: number, z: number, n: number, size: number, speed: number, inked: boolean) {
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(chipGeo, inked ? boxMat : dustMat);
      if (inked) m.add(new THREE.LineSegments(chipEdges, edgeInk));
      const k = size * (0.5 + Math.random());
      m.scale.set(k, k * (0.4 + Math.random() * 0.6), k);
      m.position.set(x, y, z);
      scene.add(m);
      const a = Math.random() * Math.PI * 2, v = speed * (0.4 + Math.random() * 0.8);
      chips.push({ m, vx: Math.cos(a) * v, vy: speed * (0.6 + Math.random()), vz: Math.sin(a) * v, spin: (Math.random() - 0.5) * 12, t: 0, life: 0.9 + Math.random() * 0.8 });
    }
  }
  const dustMat = new THREE.MeshLambertMaterial({ color: GREY });
  const flashes: { m: THREE.Sprite; t: number; life: number; size: number }[] = [];
  function pop(x: number, y: number, z: number, size: number, life: number) {
    const m = burst();
    m.position.set(x, y, z);
    m.material.rotation = Math.random() * Math.PI;
    m.renderOrder = 6;
    scene.add(m);
    flashes.push({ m, t: 0, life, size });
  }
  /** Little flames over a soldier that's alight. */
  function onFire(): THREE.Group {
    const g = new THREE.Group();
    for (let k = 0; k < 4; k++) {
      const f = new THREE.Mesh(flameGeo, flameMat);
      f.position.set(Math.cos(k * 1.6) * 0.25, 0.9 + k * 0.25, Math.sin(k * 1.6) * 0.25);
      f.userData.phase = k;
      g.add(f);
    }
    g.visible = false;
    return g;
  }
  // A blast: an orange core that swells and is gone, inked puffs of smoke that billow up and shrink
  // away, and an ink ring running out along the ground.
  const booms: { m: THREE.Object3D; t: number; r: number; kind: "core" | "smoke" | "ring"; vx: number; vy: number; vz: number; life: number }[] = [];
  const boomGeo = new THREE.SphereGeometry(1, 24, 16), puffBall = new THREE.IcosahedronGeometry(1, 2);
  const smokeMat = new THREE.MeshLambertMaterial({ color: 0xf2f2f2 });
  const ringGeo = new THREE.RingGeometry(0.92, 1, 48).rotateX(-Math.PI / 2);

  // Crates: white boxes, orange-edged for ammo, an orange cross for health, solid orange for git reset --hard.
  const crateGeo = new THREE.BoxGeometry(0.8, 0.6, 0.8), crateEdges = new THREE.EdgesGeometry(crateGeo);
  const crossGeo = new THREE.BoxGeometry(0.5, 0.62, 0.14);
  const orangeMat = new THREE.MeshLambertMaterial({ color: ORANGE }), edgeOrange = new THREE.LineBasicMaterial({ color: ORANGE });
  function crate(kind: string): THREE.Object3D {
    const m = new THREE.Mesh(crateGeo, kind === "reset" ? orangeMat : boxMat);
    m.castShadow = true;
    m.add(new THREE.LineSegments(crateEdges, kind === "ammo" ? edgeOrange : edgeInk));
    if (kind === "health") {
      const a = new THREE.Mesh(crossGeo, orangeMat), b = a.clone();
      b.rotation.y = Math.PI / 2;
      m.add(a, b);
    }
    return m;
  }
  const crates = new Map<number, THREE.Object3D>();
  // Stashes: white boxes with ink edges, the ones you throw down.
  const stashes = new Map<number, THREE.Mesh>();
  const stashGeo = new THREE.BoxGeometry(1, 1, 1), stashEdges = new THREE.EdgesGeometry(stashGeo);
  // The mission on the ground: the commit to carry, and a ring for HEAD or the branch.
  const commit = new THREE.Mesh(new THREE.OctahedronGeometry(0.45), orangeMat);
  commit.visible = false;
  scene.add(commit);
  let ring: THREE.Line | null = null;
  function placeRing(x: number, z: number, r: number) {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 64; i++) {
      const a = (i / 64) * Math.PI * 2, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      pts.push(new THREE.Vector3(px, map.terrain.height(px, pz) + 0.1, pz));
    }
    ring = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineDashedMaterial({ color: ORANGE, dashSize: 0.8, gapSize: 0.5 }));
    ring.computeLineDistances();
    scene.add(ring);
  }

  /** A blast: an orange core, inked smoke billowing out, a ring along the ground, a starburst and a flash of light. */
  function explode(game: Game, x: number, y: number, z: number, r: number) {
    const add = (m: THREE.Object3D, kind: "core" | "smoke" | "ring", r: number, life: number, v = [0, 0, 0]) => {
      scene.add(m);
      booms.push({ m, t: 0, r, kind, life, vx: v[0]!, vy: v[1]!, vz: v[2]! });
    };
    const core = new THREE.Mesh(boomGeo, orangeMat);
    core.position.set(x, y, z);
    add(core, "core", r * 0.7, 0.35);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + Math.random(), out = r * (0.8 + Math.random() * 0.8);
      const puff = inked(new THREE.Mesh(puffBall, smokeMat));
      puff.position.set(x + Math.cos(a) * r * 0.25, y + 0.2, z + Math.sin(a) * r * 0.25);
      add(puff, "smoke", r * (0.3 + Math.random() * 0.25), 1.1 + Math.random() * 0.6, [Math.cos(a) * out, 1.5 + Math.random() * 2.5, Math.sin(a) * out]);
    }
    const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: INK, transparent: true, depthWrite: false }));
    ring.position.set(x, game.terrain.height(x, z) + 0.12, z);
    add(ring, "ring", r, 0.45);
    pop(x, y + 0.4, z, r * 1.6, 0.12);
    flare(x, y + 1, z, 260 * r, r * 6, 0.45);
    throwChips(x, y + 0.2, z, 10, 0.18, r * 1.8, false);
  }

  // Barrels: build artifacts, orange drums banded in ink.
  const barrelGeo = new THREE.CylinderGeometry(0.42, 0.42, 1.1, 18).translate(0, 0.55, 0), bandGeo = new THREE.CylinderGeometry(0.435, 0.435, 0.08, 18);
  const barrels = new Map<number, THREE.Object3D>();
  function barrel(): THREE.Object3D {
    const m = inked(new THREE.Mesh(barrelGeo, orangeMat));
    m.castShadow = true;
    for (const y of [0.25, 0.85]) {
      const band = new THREE.Mesh(bandGeo, inkMat);
      band.position.y = y;
      m.add(band);
    }
    const lid = new THREE.Mesh(new THREE.CircleGeometry(0.3, 16).rotateX(-Math.PI / 2), boxMat);
    lid.position.y = 1.105;
    m.add(lid);
    return m;
  }

  // The killstreak vehicles, paper white and inked like everything else, with orange trim.
  const inkMat = new THREE.MeshLambertMaterial({ color: INK });
  const piece = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, edged = true) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    if (edged) m.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 25), edgeInk));
    return m;
  };
  function buggy(): THREE.Group {
    const g = new THREE.Group();
    g.add(piece(new THREE.BoxGeometry(1.9, 0.45, 3.2), boxMat, 0, 0.75, 0));
    g.add(piece(new THREE.BoxGeometry(1.7, 0.3, 0.9), orangeMat, 0, 1.05, -1.1));
    g.add(piece(new THREE.BoxGeometry(1.95, 0.12, 0.5), inkMat, 0, 0.6, 1.55, false));
    // The roll cage: two hoops of ink tube.
    const tube = new THREE.TorusGeometry(0.85, 0.05, 6, 20, Math.PI);
    for (const z of [-0.2, 0.9]) g.add(piece(tube, inkMat, 0, 0.95, z, false));
    const wheels: THREE.Object3D[] = [];
    const wheelGeo = new THREE.CylinderGeometry(0.46, 0.46, 0.38, 16).rotateZ(Math.PI / 2), hubGeo = new THREE.BoxGeometry(0.4, 0.12, 0.6);
    for (const [x, z] of [[-1.05, -1.1], [1.05, -1.1], [-1.05, 1.15], [1.05, 1.15]] as const) {
      const w = inked(new THREE.Mesh(wheelGeo, inkMat));
      w.position.set(x, 0.46, z);
      w.castShadow = true;
      w.add(new THREE.Mesh(hubGeo, boxMat));
      wheels.push(w);
      g.add(w);
    }
    // The gun on the roll bar turns to where you aim.
    const gun = new THREE.Group();
    gun.position.set(0, 1.85, 0.3);
    gun.add(piece(new THREE.BoxGeometry(0.22, 0.22, 0.5), boxMat, 0, 0, 0));
    gun.add(piece(new THREE.CylinderGeometry(0.05, 0.05, 1, 10).rotateX(Math.PI / 2), inkMat, 0, 0, -0.7, false));
    g.add(gun);
    g.userData = { wheels, gun };
    return g;
  }
  function heli(): THREE.Group {
    const g = new THREE.Group(), body = new THREE.Group();
    body.position.y = 1.2;
    g.add(body);
    const hull = inked(new THREE.Mesh(new THREE.CapsuleGeometry(0.85, 1.9, 6, 18).rotateX(Math.PI / 2), boxMat));
    hull.castShadow = true;
    body.add(hull);
    const glass = new THREE.Mesh(new THREE.SphereGeometry(0.72, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(-Math.PI / 2 - 0.4), new THREE.MeshStandardMaterial({ color: 0x16191c, roughness: 0.15, metalness: 0.6 }));
    glass.position.set(0, 0.15, -1.25);
    body.add(glass);
    body.add(piece(new THREE.CylinderGeometry(0.16, 0.28, 3.6, 10).rotateX(Math.PI / 2), boxMat, 0, 0.25, 2.9));
    body.add(piece(new THREE.BoxGeometry(0.08, 1, 0.6), orangeMat, 0, 0.7, 4.5));
    for (const side of [-1, 1]) {
      body.add(piece(new THREE.CylinderGeometry(0.05, 0.05, 2.8, 8).rotateX(Math.PI / 2), inkMat, side * 0.75, -1.1, 0, false));
      body.add(piece(new THREE.BoxGeometry(0.05, 0.5, 0.05), inkMat, side * 0.75, -0.85, -0.7, false));
      body.add(piece(new THREE.BoxGeometry(0.05, 0.5, 0.05), inkMat, side * 0.75, -0.85, 0.7, false));
      // Rocket pods on stub wings.
      body.add(piece(new THREE.BoxGeometry(0.9, 0.08, 0.4), boxMat, side * 1.1, 0, 0));
      body.add(piece(new THREE.CylinderGeometry(0.17, 0.17, 0.8, 10).rotateX(Math.PI / 2), orangeMat, side * 1.45, -0.12, -0.1));
    }
    // The chin gun.
    body.add(piece(new THREE.CylinderGeometry(0.06, 0.06, 0.9, 8).rotateX(Math.PI / 2), inkMat, 0, -0.65, -1.6, false));
    const rotor = new THREE.Group();
    rotor.position.set(0, 1.05, 0);
    rotor.add(piece(new THREE.CylinderGeometry(0.1, 0.1, 0.3, 8), inkMat, 0, -0.15, 0, false));
    for (const a of [0, Math.PI / 2]) {
      const blade = piece(new THREE.BoxGeometry(7.5, 0.04, 0.28), inkMat, 0, 0, 0, false);
      blade.rotation.y = a;
      rotor.add(blade);
    }
    body.add(rotor);
    const tail = new THREE.Group();
    tail.position.set(0.12, 0.6, 4.6);
    tail.add(piece(new THREE.BoxGeometry(0.03, 1.3, 0.14), inkMat, 0, 0, 0, false));
    body.add(tail);
    g.userData = { body, rotor, tail };
    return g;
  }
  const rides = new Map<number, THREE.Group>();

  const tmp = new THREE.Vector3();
  return {
    scene,
    terrainMesh,
    solids,
    looks,
    sync(game, dt) {
      const { soldiers, shots, cleared } = game;
      for (const l of lamps) {
        l.t += dt;
        l.l.intensity = l.t < l.life ? l.peak * (1 - l.t / l.life) ** 2 : 0;
      }
      const you0 = game.you();
      sun.target.position.set(you0.x, you0.y, you0.z);
      sun.position.set(you0.x - 60, you0.y + 120, you0.z + 40);
      for (const s of soldiers) {
        let b = bodies.get(s.id);
        // A player wears their own look (on your own, yours); in a battle, theirs are slate.
        const player = !s.brain, look = player ? (looks.get(s.id) ?? (s.id === game.me ? you : plain)) : null;
        const as = look ? `${s.team}:${look.head.id}:${look.build}` : "guard";
        if (b && b.as !== as) scene.remove(b.fig.root), bodies.delete(s.id), (b = undefined);
        if (!b) {
          // Guards come in all builds: a heavy is thick, the rest average or lank.
          const build: BuildId = look ? look.build : s.heavy ? "thick" : s.id % 3 === 0 ? "lank" : "average";
          const fig = buildFigure(!look ? ORANGE : s.team === "theirs" ? SLATE : INK, look ? 0.22 : 0.45, build);
          if (look) setHead(fig, buildHead(look.head, fig.root.userData.mat, fig.head.userData.size));
          if (s.heavy) fig.root.scale.setScalar(1.25);
          const tag = ghost(), fire = onFire(), sh = shell(look ? ORANGE : INK);
          fig.root.add(tag, fire);
          fig.joints.tumble!.add(sh);
          bodies.set(s.id, (b = { fig, tag, fire, down: -1, shell: sh, as, kick: 0, flinch: 0, flinchSide: 0, land: 0, air: 0, flash: 0, sweep: -1 }));
          scene.add(fig.root);
        }
        const { fig } = b;
        // Landing after a real drop dips the knees, harder the longer it was in the air.
        if (!s.grounded) b.air += dt;
        else if (b.air > 0) b.land = Math.max(b.land, Math.min(1, b.air * 1.4)), b.air = 0;
        const ease = (v: number, rate: number) => v * Math.exp(-dt * rate);
        b.kick = ease(b.kick, 14), b.flinch = ease(b.flinch, 8), b.land = ease(b.land, 7), b.flash = ease(b.flash, 5);
        if (b.sweep >= 0) b.sweep += dt * 1.6;
        if (b.sweep > 1.1 || !s.alive) b.sweep = -1;
        const u = (b.shell.material as THREE.ShaderMaterial).uniforms;
        u.uFlash!.value = Math.min(1.5, b.flash), u.uSweep!.value = b.sweep, u.uTime!.value = game.time;
        b.shell.visible = s.alive && (b.flash > 0.02 || b.sweep >= 0);
        setGun(fig, s.weapon);
        b.down = s.alive ? -1 : b.down < 0 ? 0 : b.down + dt;
        const ride = s.vehicle >= 0 ? game.vehicles.find((v) => v.id === s.vehicle) : undefined;
        // Out of view in a battle, left it, or up in a helicopter: not drawn.
        fig.root.visible = !s.hidden && !s.gone && (s.alive || b.down < SURRENDER + SINK) && ride?.kind !== "heli";
        fig.root.position.set(s.x, s.y - Math.max(0, b.down - SURRENDER) * 2.2, s.z);
        fig.root.rotation.y = s.yaw;
        b.tag.visible = s.alive && s.tagged > 0;
        b.fire.visible = s.alive && s.burn > 0;
        if (b.fire.visible) for (const f of b.fire.children) f.scale.set(1, 0.6 + Math.abs(Math.sin(game.time * 11 + f.userData.phase * 2.1)) * 0.8, 1);
        // How it's moving against the way it faces, so it strafes and backs up rather than moonwalks.
        const fx = -Math.sin(s.yaw), fz = -Math.cos(s.yaw);
        pose(fig, {
          pose: !s.alive ? "surrender" : ride ? "kneel" : s.burn > 0 && s.grounded && s.roll <= 0 ? "star" : poseOf(s),
          reload: s.reload > 0 ? 1 - s.reload / WEAPONS[s.weapon].reload : 0,
          speed: Math.hypot(s.vx, s.vz),
          forward: s.vx * fx + s.vz * fz,
          side: s.vx * -fz + s.vz * fx,
          dt,
          roll: s.roll > 0 ? (ROLL_TIME - s.roll) / ROLL_TIME : 0,
          pitch: s.pitch * 0.8,
          kick: b.kick, flinch: b.flinch, flinchSide: b.flinchSide, land: b.land,
          blend: BLEND,
        });
      }
      const have = new Set<number>();
      for (const p of game.pickups) {
        have.add(p.id);
        let m = crates.get(p.id);
        if (!m) crates.set(p.id, (m = crate(p.kind))), scene.add(m);
        m.position.set(p.x, p.y + 0.45 + Math.sin(game.time * 2 + p.id) * 0.1, p.z);
        m.rotation.y = game.time * 0.8 + p.id;
      }
      for (const [id, m] of crates) if (!have.has(id)) scene.remove(m), crates.delete(id);
      have.clear();
      for (const st of game.stashes) {
        have.add(st.id);
        let m = stashes.get(st.id);
        if (!m) {
          stashes.set(st.id, (m = new THREE.Mesh(stashGeo, boxMat)));
          m.add(new THREE.LineSegments(stashEdges, edgeInk));
          m.scale.set(st.w, st.h, st.d);
          m.position.set(st.x, st.y + st.h / 2, st.z);
          m.castShadow = m.receiveShadow = true;
          scene.add(m);
        }
      }
      for (const [id, m] of stashes) if (!have.has(id)) scene.remove(m), stashes.delete(id);
      have.clear();
      for (const br of game.barrels) {
        have.add(br.id);
        let m = barrels.get(br.id);
        if (!m) barrels.set(br.id, (m = barrel())), m.position.set(br.x, br.y, br.z), scene.add(m);
        // Lit: it shakes before it goes.
        if (br.fuse >= 0) m.rotation.z = Math.sin(game.time * 80) * 0.08;
      }
      for (const [id, m] of barrels) if (!have.has(id)) scene.remove(m), barrels.delete(id);
      have.clear();
      const you1 = game.you();
      for (const v of game.vehicles) {
        have.add(v.id);
        let m = rides.get(v.id);
        if (!m) rides.set(v.id, (m = v.kind === "buggy" ? buggy() : heli())), m.rotation.order = "YXZ", scene.add(m);
        m.position.set(v.x, v.y, v.z);
        m.rotation.y = v.yaw;
        const u = m.userData, driven = v.driver >= 0;
        // The gun points along the driver's aim, against the vehicle's heading.
        const aimYaw = driven ? you1.yaw - v.yaw : 0, aimPitch = driven ? you1.pitch : 0;
        if (v.kind === "buggy") {
          for (const w of u.wheels as THREE.Object3D[]) w.rotation.x = -v.odo / 0.46;
          (u.gun as THREE.Object3D).rotation.set(aimPitch, aimYaw, 0, "YXZ");
        } else {
          const f = { x: -Math.sin(v.yaw), z: -Math.cos(v.yaw) }, ahead = v.vx * f.x + v.vz * f.z, side = v.vx * -f.z + v.vz * f.x;
          // It noses down to fly forward and banks into a strafe; the rotor spins up once someone's in.
          (u.body as THREE.Object3D).rotation.set(-ahead * 0.018, 0, -side * 0.02);
          const spin = driven || v.y > game.terrain.height(v.x, v.z) + 0.5 ? 34 : 4;
          (u.rotor as THREE.Object3D).rotation.y += spin * dt;
          (u.tail as THREE.Object3D).rotation.x += spin * 1.5 * dt;
        }
      }
      for (const [id, m] of rides) if (!have.has(id)) scene.remove(m), rides.delete(id);
      const o = game.objective;
      if (!ring && o.kind === "carry") placeRing(map.spawn.x, map.spawn.z, HEAD_RADIUS);
      if (!ring && o.kind === "defend") placeRing(o.x, o.z, BRANCH_RADIUS);
      if (o.kind === "carry") {
        commit.visible = !o.delivered;
        commit.position.set(o.x, o.y + (o.carried ? 0 : 1 + Math.sin(game.time * 2) * 0.15), o.z);
        commit.rotation.y = game.time * 1.5;
      }
      // Files sink as they lose lines; a file with none left is gone, from sight and from aim.
      for (const f of files) {
        if (f.b.h === f.h) continue;
        f.h = f.b.h;
        if (f.h <= 0) {
          scene.remove(f.m);
          const i = solids.indexOf(f.m);
          if (i >= 0) solids.splice(i, 1);
          continue;
        }
        f.m.scale.y = f.h / f.tall;
        f.m.position.y = f.b.y + f.h / 2;
      }
      const live = new Set<number>();
      for (const p of shots) {
        live.add(p.id);
        let m = shotMeshes.get(p.id);
        if (!m) {
          const flame = p.weapon === "clean";
          m = new THREE.Mesh(flame ? puffGeo : tracer(p.weapon) ? tracerGeo : bigShotGeo, flame ? flameMat.clone() : shotMat[p.team]);
          shotMeshes.set(p.id, m), scene.add(m);
        }
        m.position.set(p.x, p.y, p.z);
        if (p.weapon === "clean") {
          const k = p.age / WEAPONS.clean.life;
          m.scale.setScalar(0.5 + k * 2.6);
          m.rotation.set(p.id, p.age * 6, 0);
          (m.material as THREE.MeshBasicMaterial).opacity = 0.85 * (1 - k * k);
        } else if (tracer(p.weapon)) {
          // The streak trails behind the round, so it never pokes out ahead of what it hits.
          tmp.set(p.x - p.vx, p.y - p.vy, p.z - p.vz);
          m.lookAt(tmp);
        }
      }
      for (const [id, m] of shotMeshes) if (!live.has(id)) {
        scene.remove(m), shotMeshes.delete(id);
        if (m.geometry === puffGeo) (m.material as THREE.Material).dispose();
      }
      cleared.forEach((done, i) => compoundEdges[i]!.color.setHex(done ? INK : ORANGE));
      fires.forEach((g, i) => {
        g.visible = !cleared[i];
        if (!g.visible) return;
        for (const m of g.children) {
          const u = m.userData;
          if (u.smoke) {
            const k = (game.time * 0.25 + u.phase) % 1;
            m.position.set(u.x + Math.sin(k * 6 + u.phase * 9) * 0.6, u.base + k * 7, u.z);
            m.scale.setScalar(0.6 + k * 1.6);
            ((m as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.35 * (1 - k);
          } else m.scale.set(1, 0.7 + Math.abs(Math.sin(game.time * 9 + u.phase * 1.7)) * 0.6, 1);
        }
      });
      for (const b of booms) {
        b.t += dt;
        const k = Math.min(1, b.t / b.life);
        if (b.kind === "core") b.m.scale.setScalar(b.r * (0.35 + Math.sqrt(k) * 0.75) * (1 - k * k));
        else if (b.kind === "ring") {
          b.m.scale.setScalar(0.5 + b.r * 2.2 * Math.sqrt(k));
          ((b.m as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - k);
        } else {
          b.vx *= Math.exp(-dt * 3), b.vz *= Math.exp(-dt * 3), b.vy = b.vy * Math.exp(-dt * 2) + dt * 1.2;
          b.m.position.x += b.vx * dt, b.m.position.y += b.vy * dt, b.m.position.z += b.vz * dt;
          b.m.scale.setScalar(b.r * Math.sin(Math.min(1, k * 1.15) * Math.PI) ** 0.6);
        }
        if (k >= 1) scene.remove(b.m);
      }
      for (let i = booms.length - 1; i >= 0; i--) if (booms[i]!.t >= booms[i]!.life) booms.splice(i, 1);
      for (const c of chips) {
        c.t += dt, c.vy -= 22 * dt;
        c.m.position.x += c.vx * dt, c.m.position.y += c.vy * dt, c.m.position.z += c.vz * dt;
        const floor = game.terrain.height(c.m.position.x, c.m.position.z) + 0.03;
        if (c.m.position.y < floor) c.m.position.y = floor, c.vy *= -0.3, c.vx *= 0.5, c.vz *= 0.5, c.spin *= 0.5;
        c.m.rotation.x += c.spin * dt, c.m.rotation.z += c.spin * 0.7 * dt;
        if (c.t > c.life) c.m.scale.multiplyScalar(0.85);
      }
      for (let i = chips.length - 1; i >= 0; i--) if (chips[i]!.t > chips[i]!.life + 0.4) scene.remove(chips[i]!.m), chips.splice(i, 1);
      for (const f of flashes) f.t += dt, f.m.scale.setScalar(f.size * (0.6 + (f.t / f.life) * 0.8));
      for (let i = flashes.length - 1; i >= 0; i--) if (flashes[i]!.t > flashes[i]!.life) scene.remove(flashes[i]!.m), flashes[i]!.m.material.dispose(), flashes.splice(i, 1);
    },
    event(game, e) {
      if (e.kind === "boom") {
        explode(game, e.x, e.y, e.z, e.r);
      } else if (e.kind === "impact") {
        throwChips(e.x, e.y, e.z, 3, 0.07, 3.5, false);
        pop(e.x, e.y, e.z, 0.45, 0.06);
      } else if (e.kind === "hit") {
        const b = bodies.get(e.target), s = game.soldiers[e.target], by = game.soldiers[e.by];
        if (!b || !s) return;
        b.flinch = Math.min(1, b.flinch + Math.min(1, e.damage / 30) + 0.25);
        // Which side it came from, against the way the soldier faces: a hit from the right throws it left.
        if (by) b.flinchSide = Math.sign((by.x - s.x) * Math.cos(s.yaw) - (by.z - s.z) * Math.sin(s.yaw)) || 1;
        if (e.shield) b.flash = Math.max(b.flash, 1);
        else throwChips(s.x, s.y + 1.1, s.z, 3, 0.06, 2.5, false);
      } else if (e.kind === "shield") {
        const b = bodies.get(e.id), s = game.soldiers[e.id];
        if (!b || !s) return;
        if (e.state === "broke") {
          b.flash = 2.5;
          pop(s.x, s.y + 1, s.z, 1.4, 0.1);
          throwChips(s.x, s.y + 1, s.z, 10, 0.08, 4, true);
        } else if (e.state === "charging") b.sweep = 0;
        else b.flash = Math.max(b.flash, 0.6);
      } else if (e.kind === "razed") {
        // A file coming down: paper chips the size of its footprint, and a puff of dust.
        const n = Math.min(28, 8 + Math.round(e.w * e.d * e.h));
        throwChips(e.x, e.y + e.h * 0.4, e.z, n, Math.min(0.6, 0.15 + e.w * 0.1), 5, true);
        throwChips(e.x, e.y + 0.3, e.z, 10, 0.25, 2.5, false);
        // And it goes up: the bigger the file, the bigger the bang.
        explode(game, e.x, e.y + Math.min(1.5, e.h * 0.3), e.z, Math.min(3.5, 1.2 + Math.cbrt(e.w * e.d * Math.max(1, e.h)) * 0.6));
      } else if (e.kind === "vehicleHit") {
        const v = game.vehicles.find((o) => o.id === e.id);
        if (v) throwChips(v.x, v.y + 1, v.z, 3, 0.08, 4, true);
      } else if (e.kind === "fire") {
        const s = game.soldiers[e.id], b = bodies.get(e.id);
        if (!s) return;
        if (b) b.kick = Math.min(1.2, b.kick + Math.min(1, WEAPONS[e.weapon].kick * 12 + 0.3));
        if (e.weapon === "clean") return;
        const ride = game.vehicles.find((v) => v.id === s.vehicle);
        const at = ride ? { x: ride.x, y: ride.y + (ride.kind === "buggy" ? 1.9 : 0.6), z: ride.z } : game.muzzle(s), big = WEAPONS[e.weapon].splash > 0 || e.weapon === "add" || e.weapon === "rebase";
        pop(at.x, at.y, at.z, big ? 0.9 : 0.55, 0.05);
        flare(at.x, at.y, at.z, big ? 40 : 18, big ? 9 : 6, 0.08);
      }
    },
  };
}
