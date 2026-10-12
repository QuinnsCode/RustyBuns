// The look: codeSplitter's paper. White ground, white blocks drawn with black
// hairlines, one orange. You are a glossy black clay figure (figure.ts); the conflicts holding a
// compound are orange ones, and a compound's lines go from orange to black when it's merged.
// Files agents mostly wrote are black glass, roads join folders that import each other, and a
// compound with a failing check burns until it's merged.

import * as THREE from "three";
import type { CodeMap } from "../sim/codemap.ts";
import { contourStep } from "../sim/terrain.ts";
import type { Game } from "../sim/game.ts";
import { HEIGHT, ROLL_TIME, type Soldier } from "../sim/game.ts";
import { buildFigure, pose, setHead, type BuildId, type Figure, type Pose } from "./figure.ts";
import { buildHead, HEADS, type HeadDef } from "./heads.ts";
import { BRANCH_RADIUS, HEAD_RADIUS } from "../sim/missions.ts";

export const INK = 0x1f1f1f, ORANGE = 0xe8590c, PAPER = 0xffffff, GREY = 0xbdbdbd;

/** What you picked on the menu: your head and build. */
export interface Look { head: HeadDef; build: BuildId }

export interface World {
  scene: THREE.Scene;
  terrainMesh: THREE.Mesh;
  /** Everything a shot can be aimed at: ground and blocks. */
  solids: THREE.Object3D[];
  sync(game: Game, dt: number): void;
  boom(x: number, y: number, z: number, r: number): void;
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
  return s.crouch ? "kneel" : "stand";
}

/** A blame tag: a ghost the soldier's size, drawn over everything, so you see it through walls. */
function ghost(): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(0.4, HEIGHT - 0.8, 6, 16), new THREE.MeshBasicMaterial({ color: ORANGE, transparent: true, opacity: 0.45, depthTest: false, depthWrite: false }));
  m.position.y = HEIGHT / 2;
  m.renderOrder = 10;
  m.visible = false;
  return m;
}

/** How long a downed soldier kneels with its hands up, then sinks away. */
const SURRENDER = 1.4, SINK = 0.8;

export function buildWorld(map: CodeMap, you: Look = { head: HEADS[0]!, build: "average" }): World {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PAPER);
  scene.fog = new THREE.Fog(PAPER, 70, 230);

  const hemi = new THREE.HemisphereLight(0xffffff, 0xe9e9e9, 2.1);
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(-60, 120, 40);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera as THREE.OrthographicCamera;
  sc.left = sc.bottom = -map.terrain.R;
  sc.right = sc.top = map.terrain.R;
  sc.far = 400;
  sun.shadow.bias = -0.0005;
  scene.add(hemi, sun);

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
      .replace("#include <common>", `#include <common>\nvarying vec3 vWorld;\nvarying vec3 vN;\nuniform float uR;\nuniform float uStep;\nuniform float uWater;`)
      .replace(
        "#include <dithering_fragment>",
        `#include <dithering_fragment>
        // Rock: diagonal hatching, denser the steeper the face, instead of a grey fill.
        float steep = smoothstep(0.3, 0.75, 1.0 - clamp(vN.y, 0.0, 1.0));
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

  // Blocks: white boxes with hairline edges. Compound edges are orange until merged.
  const solids: THREE.Object3D[] = [terrainMesh];
  const boxMat = new THREE.MeshLambertMaterial({ color: PAPER });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x16191c, roughness: 0.18, metalness: 0.6 });
  const edgeInk = new THREE.LineBasicMaterial({ color: INK }), edgeGrey = new THREE.LineBasicMaterial({ color: GREY });
  const compoundEdges = map.compounds.map(() => new THREE.LineBasicMaterial({ color: ORANGE }));
  for (const b of map.blocks) {
    const box = new THREE.BoxGeometry(b.w, b.h, b.d);
    const m = new THREE.Mesh(box, b.agent ? glassMat : boxMat);
    m.position.set(b.x, b.y + b.h / 2, b.z);
    m.castShadow = m.receiveShadow = true;
    m.userData.path = b.path;
    const e = new THREE.LineSegments(new THREE.EdgesGeometry(box), b.compound >= 0 ? compoundEdges[b.compound]! : b.agent ? edgeGrey : edgeInk);
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

  const bodies = new Map<number, { fig: Figure; tag: THREE.Mesh; down: number }>();
  const shotMeshes = new Map<number, THREE.Mesh>();
  const shotGeo = new THREE.SphereGeometry(0.09, 8, 6), bigShotGeo = new THREE.SphereGeometry(0.22, 12, 8);
  const shotMat = { you: new THREE.MeshBasicMaterial({ color: INK }), conflict: new THREE.MeshBasicMaterial({ color: ORANGE }) };
  const booms: { m: THREE.Mesh; t: number; r: number }[] = [];
  const boomGeo = new THREE.SphereGeometry(1, 24, 16);

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

  return {
    scene,
    terrainMesh,
    solids,
    sync(game, dt) {
      const { soldiers, shots, cleared } = game;
      for (const s of soldiers) {
        let b = bodies.get(s.id);
        if (!b) {
          // Guards come in all builds: a heavy is thick, the rest average or lank.
          const build: BuildId = s.team === "you" ? you.build : s.heavy ? "thick" : s.id % 3 === 0 ? "lank" : "average";
          const fig = buildFigure(s.team === "you" ? INK : ORANGE, s.team === "you" ? 0.22 : 0.45, build);
          if (s.team === "you") setHead(fig, buildHead(you.head, fig.root.userData.mat, fig.head.userData.size));
          if (s.heavy) fig.root.scale.setScalar(1.25);
          const tag = ghost();
          fig.root.add(tag);
          bodies.set(s.id, (b = { fig, tag, down: -1 }));
          scene.add(fig.root);
        }
        const { fig } = b;
        b.down = s.alive ? -1 : b.down < 0 ? 0 : b.down + dt;
        fig.root.visible = s.alive || b.down < SURRENDER + SINK;
        fig.root.position.set(s.x, s.y - Math.max(0, b.down - SURRENDER) * 2.2, s.z);
        fig.root.rotation.y = s.yaw;
        b.tag.visible = s.alive && s.tagged > 0;
        pose(fig, {
          pose: s.alive ? poseOf(s) : "surrender",
          speed: Math.hypot(s.vx, s.vz),
          dt,
          roll: s.roll > 0 ? (ROLL_TIME - s.roll) / ROLL_TIME : 0,
          pitch: s.team === "you" ? s.pitch * 0.8 : 0,
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
      const o = game.objective;
      if (!ring && o.kind === "carry") placeRing(map.spawn.x, map.spawn.z, HEAD_RADIUS);
      if (!ring && o.kind === "defend") placeRing(o.x, o.z, BRANCH_RADIUS);
      if (o.kind === "carry") {
        commit.visible = !o.delivered;
        commit.position.set(o.x, o.y + (o.carried ? 0 : 1 + Math.sin(game.time * 2) * 0.15), o.z);
        commit.rotation.y = game.time * 1.5;
      }
      const live = new Set<number>();
      for (const p of shots) {
        live.add(p.id);
        let m = shotMeshes.get(p.id);
        if (!m) shotMeshes.set(p.id, (m = new THREE.Mesh(p.weapon === "commit" || p.weapon === "rebase" || p.weapon === "blame" || p.weapon === "revert" ? shotGeo : bigShotGeo, shotMat[p.team]))), scene.add(m);
        m.position.set(p.x, p.y, p.z);
      }
      for (const [id, m] of shotMeshes) if (!live.has(id)) scene.remove(m), shotMeshes.delete(id);
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
        const k = b.t / 0.5;
        b.m.scale.setScalar(b.r * (0.3 + k * 0.9));
        (b.m.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.55 * (1 - k));
        if (k >= 1) scene.remove(b.m);
      }
      for (let i = booms.length - 1; i >= 0; i--) if (booms[i]!.t >= 0.5) booms.splice(i, 1);
    },
    boom(x, y, z, r) {
      const m = new THREE.Mesh(boomGeo, new THREE.MeshBasicMaterial({ color: ORANGE, transparent: true, opacity: 0.55, depthWrite: false }));
      m.position.set(x, y, z);
      scene.add(m);
      booms.push({ m, t: 0, r });
    },
  };
}
