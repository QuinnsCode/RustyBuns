// The open world drawn: the supercontinent's ground cut into region pieces, the sea, an arena marker per
// North American region, a red beacon over the deadly south, mist along the borders still closed, you, and
// the map in the corner that fills in as you walk. A piece you can't enter yet lies low and grey, unformed;
// when its road opens it rises into its real relief. Walking is src/world/world.ts; this file turns keys
// into steps and steps into pictures.
import * as THREE from "three";
import { b64url } from "@rustybuns/util/bytes";
import { clamp, esc, lerp } from "@rustybuns/util";
import { actionOf } from "../binds.ts";
import { NO_STICK, push, type Stick } from "../controls.ts";
import { icon } from "../icons.ts";
import { tierOf } from "../tiers.ts";
import { Walker3d } from "./walker3d.ts";
import { body, creature, ROSTER, type Creature } from "../roster.ts";
import { REGIONS, type Biome, type Region } from "../regions.ts";
import { SECTIONS, sections } from "../journey.ts";
import { arenaOf, COLS, CELL, explore, explored, gateShut, setTravel, FOG, FOG_W, isSeen, meet, newSeen, openRegions, opensRoadTo, OWNER, regionAt, ROWS, sendHome, spawn, STEP, GROUND_N, surface, wildsNear, heightAt, type Wild } from "./world.ts";
import { flora, scatterFlora } from "./flora.ts";
import { cellAt, cellsApart, createStream, type Box } from "./stream.ts";
import { GRID } from "./places.ts";
import { BAND, bandAt, WORLD, newTrek, trailhead, trailWilds, TRAILS, trek, type Trail, type TrekEvent } from "./trail.ts";

const SAVE = "mythic-masters.world.beaten", SAVE_SEEN = "mythic-masters.world.seen", SAVE_VISITED = "mythic-masters.world.visited";
// The ground near you is drawn again at FINE metres a vertex with its fine detail (world.ts `surface`): a patch
// FINE_N vertices across that follows you in SNAP-metre jumps. The coarse land cuts a HOLE under it, and the
// detail fades out toward the hole's edge so the two meet without a step.
const FINE = 4, FINE_N = 129, HALF = ((FINE_N - 1) * FINE) / 2, SNAP = 64, HOLE = HALF - 24, FADE0 = HOLE - 60;
const CALM_MS = 90_000; // a den you fought stays quiet this long
const SEA = 0x2f6a98, SAND = 0xc8b890, ROCK = 0x8a8580, SNOW = 0xf2f4f8, CLOSED = 0x5a5e66, PARCHMENT = 0xf1e7cf;
const RISE = 2.8; // seconds a piece takes to rise when its road opens
const EASE_CAM = 0.9; // seconds the camera takes to climb to the shot of a rising piece, and to come back
const TIER = { playable: "", "high-level": "High level: deadly wild creatures", "coming-soon": "Coming soon" } as const;
// The land's colour: a built region's arena ground, else its biome's.
const BIOME: Record<Biome, number> = { "pine-barrens": 0xc9b98a, forest: 0x4f6b3a, rainforest: 0x3f5f32, lake: 0x7a9a5a, desert: 0xd09a5f, swamp: 0x4a5a2f,
  plains: 0x8a9a4a, highlands: 0x7a7a50, jungle: 0x3a6a2a, island: 0xc8c090, mountains: 0x8a8068, river: 0x6a8a48, coast: 0x6a8a58, savanna: 0xb0a058, tundra: 0xa8b0a0, steppe: 0xa8a068 };
const landOf = (g: Region) => g.skin?.ground ?? BIOME[g.biome];
/** The legends a region is known for; an unknown you haven't bound yet is "???" (`hide` takes a creature's name). */
const tales = (g: Region, hide: (name: string) => boolean = () => false) => g.folklore.filter((b) => !b.sacred).map((b) => (hide(b.name) ? "???" : b.name)).join(", ");
const ease = (t: number) => t * t * (3 - 2 * t);

export interface Foe { id: string; level: number }
export interface WorldHooks {
  /** Walked onto a region's arena: its mythic, once its trail is cleared. */
  arena(g: Region): void;
  /** A wild creature: one you walked into (`foe`), or the deadly south's ambush (none). */
  wild(g: Region, foe?: Foe): void;
  /** Reached the stone of section k, the next to clear on region g's trail. */
  keeper(g: Region, k: number): void;
  /** How many of region n's sections are cleared. */
  cleared(n: number): number;
  /** Whether creature `id` is bound already (the name tag marks the new ones). */
  owns(id: string): boolean;
  /** Stepped into region g, `fresh` the first time ever (src/director.ts sweeps round you then). */
  arrived?(g: Region, fresh: boolean): void;
  /** Walked into section k of region g's trail. */
  section?(g: Region, k: number): void;
}

export function worldView(scene: THREE.Scene, camera: THREE.PerspectiveCamera, hooks: WorldHooks) {
  const w = WORLD;
  const group = new THREE.Group();
  /** An unknown you haven't bound yet: a shrouded shape, its name and level hidden (src/tiers.ts). */
  const shrouded = (id: string) => tierOf(id) === "unknown" && !hooks.owns(id);
  const hiddenName = (name: string) => ROSTER.some((c) => c.name === name && shrouded(c.id));
  group.visible = false;
  scene.add(group);
  let beaten = new Set<number>(), seen = newSeen(), seenDirty = false;
  try { const s: unknown = JSON.parse(localStorage.getItem(SAVE) ?? "[]"); if (Array.isArray(s)) beaten = new Set(s.filter((n): n is number => typeof n === "number")); } catch { /* a private window: start fresh */ }
  try {
    const b = atob((localStorage.getItem(SAVE_SEEN) ?? "").replace(/-/g, "+").replace(/_/g, "/"));
    if (b.length === seen.length) seen = Uint8Array.from(b, (ch) => ch.charCodeAt(0));
  } catch { /* nothing seen yet, or nowhere to keep it */ }
  const save = () => { try { localStorage.setItem(SAVE, JSON.stringify([...beaten])); } catch { /* nowhere to keep it */ } };
  const saveSeen = () => { try { localStorage.setItem(SAVE_SEEN, b64url(seen)); } catch { /* nowhere to keep it */ } seenDirty = false; };

  // --- the ground: each sample's colour formed and unformed, and how far its piece has risen ------------------
  const N = COLS * ROWS, formed = new Float32Array(N * 3), unformed = new Float32Array(N * 3);
  // The piece a sample's seam is with: the other region's number when the next sample east or south is
  // another region's, else 0. The seam is a thin dark line drawn in shape() once both pieces have risen;
  // baked into the colours it ran down the slope between a risen piece and two unformed ones as a dark streak.
  const seamWith = new Uint8Array(N);
  const c = new THREE.Color(), tint = new THREE.Color();
  /** Sample i's colours formed and unformed, from its height now (so again when its region's fine ground comes in). */
  function colourOf(i: number) {
    const k = i % COLS, r = Math.floor(i / COLS), y = w.y[i]!, n = OWNER[i]!, g = n ? REGIONS[n - 1] : undefined;
    c.setHex(y < 0 || !g ? SAND : landOf(g));
    if (y < 0) c.lerp(tint.setHex(0x3a4a50), clamp(-y / 3, 0, 0.7));
    if (y > 14) c.lerp(tint.setHex(ROCK), clamp((y - 14) / 8, 0, 1));
    if (y > 24) c.lerp(tint.setHex(SNOW), clamp((y - 24) / 4, 0, 1));
    const other = (j: number) => { const o = OWNER[j]!; return o !== 0 && o !== n ? o : 0; };
    if (n) seamWith[i] = (k + 1 < COLS ? other(i + 1) : 0) || (r + 1 < ROWS ? other(i + COLS) : 0);
    formed.set([c.r, c.g, c.b], i * 3);
    c.lerp(tint.setHex(CLOSED), g?.tier === "coming-soon" ? 0.72 : 0.5);
    unformed.set([c.r, c.g, c.b], i * 3);
  }
  for (let i = 0; i < N; i++) colourOf(i);
  /** 0 = unformed, 1 = risen, per region number; `want` is where it's heading. */
  const rise = new Float32Array(REGIONS.length + 1).fill(1), want = new Float32Array(REGIONS.length + 1).fill(1);
  const pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
  /** The ground's height at (x, z) as drawn, so a thing stands on a lowered piece rather than at its real height. */
  const drawnY = (x: number, z: number) => {
    const fx = clamp(x / STEP, 0, COLS - 1.001), fz = clamp(z / STEP, 0, ROWS - 1.001), c0 = Math.floor(fx), r0 = Math.floor(fz), i = r0 * COLS + c0;
    const yy = (j: number) => pos[j * 3 + 1]!;
    return lerp(lerp(yy(i), yy(i + 1), fx - c0), lerp(yy(i + COLS), yy(i + COLS + 1), fx - c0), fz - r0);
  };
  // How risen each sample stands, eased across a border over a few samples, so a risen piece meets an
  // unformed one in a slope rather than a cliff stepped along the sample grid. Sea doesn't count either way.
  const lift = new Float32Array(N), smoothTmp = new Float32Array(N), SMOOTH_R = 2;
  /** `of(region)` per land sample, box-averaged over the land within SMOOTH_R samples into `out`; sea reads 1. */
  function smoothed(of: ArrayLike<number>, out: Float32Array, r0 = 0, r1 = ROWS - 1) {
    for (let r = Math.max(0, r0 - SMOOTH_R); r <= Math.min(ROWS - 1, r1 + SMOOTH_R); r++) for (let k = 0; k < COLS; k++) {
      let s = 0, m = 0;
      for (let d = -SMOOTH_R; d <= SMOOTH_R; d++) { const kk = k + d, n = kk >= 0 && kk < COLS ? OWNER[r * COLS + kk]! : 0; if (n) { s += of[n]!; m++; } }
      smoothTmp[r * COLS + k] = m ? s / m : -1;
    }
    for (let r = r0; r <= r1; r++) for (let k = 0; k < COLS; k++) {
      let s = 0, m = 0;
      for (let d = -SMOOTH_R; d <= SMOOTH_R; d++) { const rr = r + d, v = rr >= 0 && rr < ROWS ? smoothTmp[rr * COLS + k]! : -1; if (v >= 0) { s += v; m++; } }
      out[r * COLS + k] = m ? s / m : 1;
    }
  }
  // The rows each region's piece spans: a rise only redraws the band of rows its pieces (and their slopes) cover.
  const span = new Map<number, [number, number]>();
  for (let i = 0; i < N; i++) {
    const n = OWNER[i]!, r = Math.floor(i / COLS), sp = span.get(n);
    if (!n) continue;
    if (!sp) span.set(n, [r, r]); else { sp[0] = Math.min(sp[0], r); sp[1] = Math.max(sp[1], r); }
  }
  /** Redraws rows r0..r1 of the ground (all of it by default) from how far each piece has risen. */
  function shape(r0 = 0, r1 = ROWS - 1, c0 = 0, c1 = COLS - 1) {
    smoothed(rise, lift, r0, r1);
    for (let i = r0 * COLS; i < (r1 + 1) * COLS; i++) {
      const n = OWNER[i]!, f = n ? ease(rise[n]!) : 1, y = w.y[i]!;
      // Unformed land is a low grey slab with a ghost of the relief it will have.
      const fl = n ? ease(lift[i]!) : f;
      pos[i * 3 + 1] = y > 0 ? lerp(0.35 + y * 0.1, y, fl) : y;
      // The seam with the next piece darkens as the lower of the two rises, so none runs down a slope.
      const o = seamWith[i]!, dark = o ? lerp(1, 0.62, Math.min(f, ease(rise[o]!))) : 1;
      for (let k = 0; k < 3; k++) col[i * 3 + k] = lerp(unformed[i * 3 + k]!, formed[i * 3 + k]!, fl) * dark;
    }
    fineDirty = true;
    // No normals to compute: the land is flat-shaded, so its normals come from the triangles in the shader.
    for (const t of tiles) if (t.r0 <= r1 && t.r0 + PER >= r0 && t.c0 <= c1 && t.c0 + PER >= c0) t.dirty = true;
  }
  for (let r = 0; r < ROWS; r++) for (let k = 0; k < COLS; k++) { const i = r * COLS + k; pos[i * 3] = k * STEP; pos[i * 3 + 2] = r * STEP; }
  const hole = { value: new THREE.Vector2(-1e6, -1e6) };
  const landMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true });
  landMat.onBeforeCompile = (sh) => {
    sh.uniforms.uHole = hole;
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nvarying vec2 vGround;").replace("#include <begin_vertex>", "#include <begin_vertex>\nvGround = position.xz;");
    sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec2 vGround;\nuniform vec2 uHole;")
      .replace("void main() {", `void main() {\n  if (distance(vGround, uHole) < ${HOLE.toFixed(1)}) discard;`);
  };
  landMat.side = THREE.DoubleSide; // the skirts under a tile's edge hide the cracks between detail levels

  // --- the land as a mesh per region cell, at three levels of detail ----------------------------------------------
  // A cell is PER samples a side. Near you (within one cell: the nine regions whose fine ground is loaded) it is
  // drawn at every sample (33 a side), two cells out at every 2nd (17), beyond that at every 4th (9, which are the
  // coarse samples themselves), and past two cells not at all (the fog has taken it by then). Each tile reads the shared pos / col arrays that
  // shape() keeps, so a rising piece and an arriving file both redraw only the tiles they touch. A skirt hangs
  // from each tile's edge, so a fine tile next to a coarse one shows no crack.
  const PER = GROUND_N - 1, STRIDE = [1, 2, 4], SKIRT = 12, SHOW_R = 2;
  const land = new THREE.Group();
  const perimeter = (n: number) => {
    const out: number[] = [];
    for (let k = 0; k < n; k++) out.push(k);
    for (let r = 1; r < n; r++) out.push(r * n + n - 1);
    for (let k = n - 2; k >= 0; k--) out.push((n - 1) * n + k);
    for (let r = n - 2; r >= 1; r--) out.push(r * n);
    return out;
  };
  const tileIndex = STRIDE.map((st) => {
    const n = PER / st + 1, m = 4 * (n - 1), pr = perimeter(n), idx: number[] = [];
    for (let r = 0; r < n - 1; r++) for (let k = 0; k < n - 1; k++) { const a = r * n + k, b = a + 1, d = a + n, e = d + 1; idx.push(a, d, b, b, d, e); }
    for (let j = 0; j < m; j++) { const a = pr[j]!, b = pr[(j + 1) % m]!, sa = n * n + j, sb = n * n + (j + 1) % m; idx.push(a, sa, b, b, sa, sb); }
    return new THREE.BufferAttribute(new Uint16Array(idx), 1);
  });
  const tilePerimeter = STRIDE.map((st) => perimeter(PER / st + 1));
  interface Tile { r0: number; c0: number; cx: number; cz: number; mesh: THREE.Mesh; lod: number; dirty: boolean; shown: boolean }
  const tiles: Tile[] = [];
  for (let cz = 0; cz < GRID.h; cz++) for (let cx = 0; cx < GRID.w; cx++) {
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), landMat);
    mesh.receiveShadow = true; mesh.visible = false;
    land.add(mesh);
    tiles.push({ r0: cz * PER, c0: cx * PER, cx, cz, mesh, lod: -1, dirty: true, shown: false });
  }
  function drawTile(t: Tile, lod: number) {
    const st = STRIDE[lod]!, n = PER / st + 1, per = tilePerimeter[lod]!, V = n * n + per.length;
    let g = t.mesh.geometry;
    if (t.lod !== lod) {
      g.dispose();
      g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(V * 3), 3));
      g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(V * 3), 3));
      g.setIndex(tileIndex[lod]!);
      t.mesh.geometry = g; t.lod = lod;
    }
    const P = g.attributes.position as THREE.BufferAttribute, C = g.attributes.color as THREE.BufferAttribute;
    const put = (v: number, src: number, drop: number) => {
      P.setXYZ(v, pos[src * 3]!, pos[src * 3 + 1]! - drop, pos[src * 3 + 2]!);
      C.setXYZ(v, col[src * 3]!, col[src * 3 + 1]!, col[src * 3 + 2]!);
    };
    const at = (v: number) => (t.r0 + Math.floor(v / n) * st) * COLS + t.c0 + (v % n) * st;
    for (let v = 0; v < n * n; v++) put(v, at(v), 0);
    per.forEach((v, j) => put(n * n + j, at(v), SKIRT));
    P.needsUpdate = C.needsUpdate = true;
    g.computeBoundingSphere();
    t.dirty = false;
  }
  /** Picks every tile's detail from how many cells it is from yours, and redraws the ones that changed. */
  function drawLand() {
    const me_ = cellAt(me.x, me.z), reach = shot ? 5 : SHOW_R;
    for (const t of tiles) {
      const d = cellsApart([t.cx, t.cz], me_), lod = d <= 1 ? 0 : d === 2 ? 1 : 2, on = d <= reach;
      t.mesh.visible = on;
      if (on && (t.dirty || t.lod !== lod)) drawTile(t, lod);
    }
  }
  /** Land tiles that are drawn right now, by detail level (the probe reads it). */
  const landStats = () => { const by = [0, 0, 0]; for (const t of tiles) if (t.mesh.visible && t.lod >= 0) by[t.lod]!++; return by; };

  // --- the fine ground under your feet, and what grows on it ---------------------------------------------------
  const fineGeo = new THREE.BufferGeometry(), FN = FINE_N * FINE_N;
  const finePos = new Float32Array(FN * 3), fineCol = new Float32Array(FN * 3), fineIdx = new Uint32Array((FINE_N - 1) * (FINE_N - 1) * 6);
  for (let r = 0, j = 0; r < FINE_N - 1; r++) for (let k = 0; k < FINE_N - 1; k++) {
    const a = r * FINE_N + k, b = a + 1, d = a + FINE_N, e = d + 1;
    fineIdx.set([a, d, b, b, d, e], j); j += 6;
  }
  fineGeo.setAttribute("position", new THREE.BufferAttribute(finePos, 3));
  fineGeo.setAttribute("color", new THREE.BufferAttribute(fineCol, 3));
  fineGeo.setIndex(new THREE.BufferAttribute(fineIdx, 1));
  const fine = new THREE.Mesh(fineGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true }));
  fine.frustumCulled = false;
  const fineAt = { x: NaN, z: NaN };
  let fineDirty = true, floraDirty = true;
  /** A per-sample field (lift, a colour channel) read between samples. */
  const between = (f: ArrayLike<number>, x: number, z: number, stride = 1, o = 0) => {
    const fx = clamp(x / STEP, 0, COLS - 1.001), fz = clamp(z / STEP, 0, ROWS - 1.001), c0 = Math.floor(fx), r0 = Math.floor(fz), i = r0 * COLS + c0;
    const v = (j: number) => f[j * stride + o]!;
    return lerp(lerp(v(i), v(i + 1), fx - c0), lerp(v(i + COLS), v(i + COLS + 1), fx - c0), fz - r0);
  };
  /** The ground as the fine patch draws it: lowered with an unformed piece, its detail fading toward the hole's edge. */
  function fineY(x: number, z: number) {
    const fade = 1 - clamp((Math.hypot(x - fineAt.x, z - fineAt.z) - FADE0) / (HOLE - FADE0), 0, 1), lf = ease(between(lift, x, z));
    return surface(w, x, z, drawnY(x, z), fade * lf, lf);
  }
  function buildFine() {
    const x0 = fineAt.x - HALF, z0 = fineAt.z - HALF;
    for (let r = 0; r < FINE_N; r++) for (let k = 0; k < FINE_N; k++) {
      const i = r * FINE_N + k, x = x0 + k * FINE, z = z0 + r * FINE, base = drawnY(x, z), y = fineY(x, z);
      finePos[i * 3] = x; finePos[i * 3 + 1] = y; finePos[i * 3 + 2] = z;
      // Hollows a shade darker, knolls a shade lighter, and a little grain so no two vertices match.
      const shade = clamp(1 + (y - base) * 0.05, 0.84, 1.14) * (0.97 + 0.06 * (((k * 73856093) ^ (r * 19349663)) % 97) / 97);
      for (let ch = 0; ch < 3; ch++) fineCol[i * 3 + ch] = between(col, x, z, 3, ch) * shade;
    }
    for (const a of [fineGeo.attributes.position!, fineGeo.attributes.color!]) a.needsUpdate = true;
    hole.value.set(fineAt.x, fineAt.z);
    fineDirty = false;
  }
  const plants = flora(() => { floraDirty = true; });
  /** Plants only grow on a piece that has fully risen. */
  function regrow() {
    const open = openRegions(beaten);
    scatterFlora(plants, fineAt.x, fineAt.z, HOLE - 10, (x, z) => { const g = regionAt(x, z); return g && open.has(g.n) && rise[g.n] === 1 ? g : undefined; }, fineY, w);
    floraDirty = false;
  }
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(w.width * 3, w.depth * 3), new THREE.MeshStandardMaterial({ color: SEA, roughness: 0.25, transparent: true, opacity: 0.82 }));
  sea.rotation.x = -Math.PI / 2; sea.position.set(w.width / 2, 0, w.depth / 2);
  const sun = new THREE.DirectionalLight(0xffffff, 2);
  sun.position.set(-200, 300, -100);
  group.add(land, fine, plants.group, sea, sun, sun.target, new THREE.HemisphereLight(0xbcd6ea, 0x5f7a4c, 1.1));

  // --- markers: an arena ring and beacon per playable region, a red beacon over each high-level one --------
  const beacons = new Map<number, { mat: THREE.MeshBasicMaterial; parts: THREE.Object3D[] }>();
  /** Stands a region's beam (and ring) on the arena's ground as it is now. */
  function placeBeacon(g: Region, parts: THREE.Object3D[]) {
    const a = arenaOf(g), y = heightAt(w, a.x, a.z);
    parts[0]!.position.set(a.x, y + 30, a.z);
    parts[1]?.position.set(a.x, y + 0.2, a.z);
  }
  for (const g of REGIONS) if (g.tier !== "coming-soon") {
    const a = arenaOf(g), mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.55, depthWrite: false });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(g.tier === "high-level" ? 3 : 1.2, g.tier === "high-level" ? 3 : 1.2, 60, 16, 1, true), mat);
    const parts: THREE.Object3D[] = [beam];
    if (g.tier === "playable") {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(4, 0.25, 8, 48), mat);
      ring.rotation.x = Math.PI / 2;
      parts.push(ring);
    }
    placeBeacon(g, parts);
    group.add(...parts);
    beacons.set(g.n, { mat, parts });
  }

  // --- mist along every border between open ground and a piece you can't enter yet ------------------------------
  // Marching squares over the smoothed open mask, crossing where it passes ½, so the curtain follows the same
  // smooth curve as the slope a risen piece makes down to an unformed one, not the sample grid's steps.
  const mist = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
  group.add(mist);
  function drawMist(open: ReadonlySet<number>) {
    const v: number[] = [], vc: number[] = [], amber = new THREE.Color(0xffb347), grey = new THREE.Color(0xc4c8d0);
    const openness = new Float32Array(REGIONS.length + 1), field = new Float32Array(N);
    for (const n of open) openness[n] = 1;
    smoothed(openness, field);
    const isOpen = (i: number) => field[i]! >= 0.5;
    const shut = (i: number) => OWNER[i] !== 0 && !open.has(OWNER[i]!);
    for (let r = 0; r < ROWS - 1; r++) for (let k = 0; k < COLS - 1; k++) {
      const a = r * COLS + k, b = a + 1, d = a + COLS, e = d + 1;
      // The square's four edges as [from, to] corners; a curtain crosses an edge between open and shut land.
      const hits: [number, number, number][] = [];
      for (const [p, q] of [[a, b], [b, e], [d, e], [a, d]] as const) {
        if (isOpen(p) === isOpen(q)) continue;
        const closed = isOpen(p) ? q : p;
        if (OWNER[closed] === 0) continue; // the coast, not a border
        const n = shut(closed) ? OWNER[closed]! : [a, b, d, e].map((j) => OWNER[j]!).find((o) => o && !open.has(o));
        if (!n) continue;
        const t = clamp((0.5 - field[p]!) / (field[q]! - field[p]!), 0, 1);
        hits.push([lerp(p % COLS, q % COLS, t) * STEP, lerp(Math.floor(p / COLS), Math.floor(q / COLS), t) * STEP, n]);
      }
      for (let h = 0; h + 1 < hits.length; h += 2) {
        const [x0, z0, n] = hits[h]!, [x1, z1] = hits[h + 1]!, y0 = Math.max(0, drawnY(x0, z0)), y1 = Math.max(0, drawnY(x1, z1));
        const tone = REGIONS[n - 1]!.tier === "coming-soon" ? grey : amber;
        v.push(x0, y0 - 1, z0, x1, y1 - 1, z1, x1, y1 + 10, z1, x0, y0 - 1, z0, x1, y1 + 10, z1, x0, y0 + 10, z0);
        for (const alpha of [0.32, 0.32, 0, 0.32, 0, 0]) vc.push(tone.r, tone.g, tone.b, alpha);
      }
    }
    mist.geometry.dispose();
    mist.geometry = new THREE.BufferGeometry();
    mist.geometry.setAttribute("position", new THREE.Float32BufferAttribute(v, 3));
    mist.geometry.setAttribute("color", new THREE.Float32BufferAttribute(vc, 4));
  }

  // --- trails: the switchback, a stone per section, the keeper on the next one, bog-light across the gate ---------------
  const trailBits = new Map<number, { path: THREE.Line; stones: THREE.Object3D[]; lights: THREE.MeshBasicMaterial[] }>();
  const stoneGeo = new THREE.BoxGeometry(1.1, 3, 0.7), stoneMat = new THREE.MeshStandardMaterial({ color: 0x6f6a60, roughness: 0.95 }), lightGeo = new THREE.SphereGeometry(0.42, 12, 8);
  /** The trail's dashes and stones on the ground as it is now. */
  function placeTrail(t: Trail, bits: { path: THREE.Line; stones: THREE.Object3D[] }) {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i + 1 < t.pts.length; i++) {
      const a = t.pts[i]!, b = t.pts[i + 1]!, n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 3));
      for (let j = 0; j < n; j++) { const x = lerp(a.x, b.x, j / n), z = lerp(a.z, b.z, j / n); pts.push(new THREE.Vector3(x, Math.max(0, heightAt(w, x, z)) + 0.2, z)); }
    }
    bits.path.geometry.dispose();
    bits.path.geometry = new THREE.BufferGeometry().setFromPoints(pts);
    bits.path.computeLineDistances();
    bits.stones.forEach((o, i) => { const st = t.stones[i >> 1]!, y = Math.max(0, heightAt(w, st.x, st.z)); o.position.set(st.x, y + (i & 1 ? 3.4 : 1.3), st.z); });
  }
  for (const t of TRAILS.values()) {
    const path = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color: PARCHMENT, dashSize: 1.6, gapSize: 1.1, transparent: true, opacity: 0.85 }));
    const stones: THREE.Object3D[] = [], lights: THREE.MeshBasicMaterial[] = [];
    for (let k = 0; k < t.stones.length - 1; k++) {
      const stone = new THREE.Mesh(stoneGeo, stoneMat), light = new THREE.MeshBasicMaterial({ color: 0x8a8f99 });
      stone.castShadow = true;
      stones.push(stone, new THREE.Mesh(lightGeo, light)); lights.push(light);
    }
    placeTrail(t, { path, stones });
    group.add(path, ...stones);
    trailBits.set(t.n, { path, stones, lights });
  }
  let keeper: { b: Walker3d; x: number; z: number } | null = null;
  const gates = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
  group.add(gates);
  /** Stones lit by how far each trail goes, the next keeper standing on its stone, a curtain of bog-light at each gate. */
  function drawTrails(open: ReadonlySet<number>) {
    for (const [n, bits] of trailBits) {
      const on = open.has(n), done = hooks.cleared(n);
      bits.path.visible = on;
      for (const o of bits.stones) o.visible = on;
      bits.lights.forEach((m, k) => m.color.setHex(k < done ? 0x6ad37a : k === done ? 0xffb347 : 0x5a5e66));
    }
    keeper?.b.dispose();
    keeper = null;
    const g = regionN(me.region), t = TRAILS.get(g.n), k = t ? hooks.cleared(g.n) : SECTIONS;
    if (t && k < SECTIONS - 1) {
      const sec = sections(g)[k]!, st = t.stones[k]!;
      const kc = creature(sec.keeper);
      keeper = { b: new Walker3d(kc, group, false, shrouded(kc.id)), x: st.x + 2.2, z: st.z };
    }
    // The gates: marching squares between a sample you may walk and one past the next keeper, in the same region.
    const v: number[] = [], vc: number[] = [], bog = new THREE.Color(0x7dffb0);
    const shut = (i: number) => { const n = OWNER[i]!; return open.has(n) && TRAILS.has(n) && hooks.cleared(n) < SECTIONS && BAND[i]! > hooks.cleared(n) + 1; };
    for (let r = 0; r < ROWS - 1; r++) for (let k2 = 0; k2 < COLS - 1; k2++) {
      const a = r * COLS + k2, b = a + 1, d = a + COLS, e = d + 1, hits: [number, number][] = [];
      for (const [p, q] of [[a, b], [b, e], [d, e], [a, d]] as const)
        if (OWNER[p] === OWNER[q] && shut(p) !== shut(q)) hits.push([lerp(p % COLS, q % COLS, 0.5) * STEP, lerp(Math.floor(p / COLS), Math.floor(q / COLS), 0.5) * STEP]);
      for (let h = 0; h + 1 < hits.length; h += 2) {
        const [x0, z0] = hits[h]!, [x1, z1] = hits[h + 1]!, y0 = Math.max(0, heightAt(w, x0, z0)), y1 = Math.max(0, heightAt(w, x1, z1));
        v.push(x0, y0 - 1, z0, x1, y1 - 1, z1, x1, y1 + 6, z1, x0, y0 - 1, z0, x1, y1 + 6, z1, x0, y0 + 6, z0);
        for (const alpha of [0.4, 0.4, 0, 0.4, 0, 0]) vc.push(bog.r, bog.g, bog.b, alpha);
      }
    }
    gates.geometry.dispose();
    gates.geometry = new THREE.BufferGeometry();
    gates.geometry.setAttribute("position", new THREE.Float32BufferAttribute(v, 3));
    gates.geometry.setAttribute("color", new THREE.Float32BufferAttribute(vc, 4));
  }

  // --- wild creatures roaming the open regions (world.ts `wildsNear`): walk into one and it fights ------------------
  // On a trail, a den holds one of its section's own wild ones at the section's level, so each stretch has its cryptids.
  // Each walks in its own beast (walker3d.ts); a flyer roams on the wing. An unknown you haven't bound is shrouded.
  const roamers = new Map<string, { b: Walker3d; c: Wild }>(), calm = new Map<string, number>();
  let clock = 0, nearest: Wild | null = null;
  const tagEl = document.querySelector<HTMLElement>("#worldHud .tag")!;
  function onTrailDen(c: Wild): Wild {
    const g = regionN(c.region), b = TRAILS.has(g.n) ? bandAt(c.x, c.z) : 0, sec = b ? sections(g)[b - 1] : undefined;
    if (!sec?.wilds.length) return c;
    let h = 0;
    for (const ch of c.den) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return { ...c, id: sec.wilds[h % sec.wilds.length]!, level: sec.level + (h % 3 === 0 ? 1 : 0) };
  }
  function roam(dt: number, open: ReadonlySet<number>) {
    clock += dt;
    for (const [den, until] of calm) if (performance.now() > until) calm.delete(den);
    const wilds = [...wildsNear(w, me.x, me.z, clock, open, 160), ...trailWilds(me.x, me.z, clock, 160).filter((c) => open.has(c.region))].map(onTrailDen).filter((c) => c.id), keep = new Set<string>();
    nearest = null;
    for (const c of wilds) {
      keep.add(c.den);
      let r = roamers.get(c.den);
      if (r && r.c.id !== c.id) { r.b.dispose(); r = undefined; }
      if (!r) { const cr = creature(c.id); r = { b: new Walker3d(cr, group, cr.archetype === "flyer", shrouded(c.id)), c }; roamers.set(c.den, r); }
      r.c = c; r.b.visible = !calm.has(c.den); r.b.update(c.x, fineY(c.x, c.z), c.z, c.heading, dt);
      if (!calm.has(c.den) && (!nearest || Math.hypot(c.x - me.x, c.z - me.z) < Math.hypot(nearest.x - me.x, nearest.z - me.z))) nearest = c;
    }
    for (const [den, r] of roamers) if (!keep.has(den)) { r.b.dispose(); roamers.delete(den); }
  }
  function drawTag() {
    const c = nearest, d = c ? Math.hypot(c.x - me.x, c.z - me.z) : Infinity;
    const p = c && d < 40 && !shot ? new THREE.Vector3(c.x, fineY(c.x, c.z) + body(creature(c.id)).height + (creature(c.id).archetype === "flyer" ? 3.2 : 1.2), c.z).project(camera) : null;
    if (!c || !p || p.z >= 1 || Math.abs(p.x) > 1 || Math.abs(p.y) > 1) { tagEl.hidden = true; return; }
    const t = tierOf(c.id), hide = shrouded(c.id);
    tagEl.className = `tag t-${t}`;
    tagEl.innerHTML = `<b>${hide ? "???" : esc(creature(c.id).name)}</b><small>${hide ? `${icon("circle-help")}unknown` : `${t} · Lv ${c.level}${hooks.owns(c.id) ? "" : ` · ${icon("sparkle")}new`}`}</small>`;
    tagEl.hidden = false;
    tagEl.style.left = `${((p.x + 1) / 2) * innerWidth}px`; tagEl.style.top = `${((1 - p.y) / 2) * innerHeight}px`;
  }

  function refresh(animate = false) {
    const open = openRegions(beaten);
    for (const g of REGIONS) {
      want[g.n] = open.has(g.n) ? 1 : 0;
      if (!animate) rise[g.n] = want[g.n]!;
    }
    shape();
    drawMist(open);
    drawTrails(open);
    for (const [n, { mat, parts }] of beacons) {
      mat.color.setHex(regionN(n).tier === "high-level" ? 0xff4a3a : beaten.has(n) ? 0x6ad37a : open.has(n) ? 0xffb347 : 0x8a8f99);
      for (const o of parts) o.visible = open.has(n) || regionN(n).tier === "high-level";
    }
    paintMap();
    floraDirty = true;
  }
  const regionN = (n: number) => REGIONS[n - 1]!;

  // --- fine ground streamed in round you (src/world/stream.ts) --------------------------------------------------------
  // The world starts from the coarse ground bundled with the page; a region's file comes in when you are within a
  // region of it, and its heights, colours, beacon, trail and the mist along its borders follow once per frame.
  const touched = new Map<number, Box>();
  const stream = createStream(w, async (n) => {
    try { const r = await fetch(`/ground/${n}.bin`); return r.ok ? new Uint8Array(await r.arrayBuffer()) : undefined; } catch { return undefined; }
  }, (n, box) => {
    const was = touched.get(n);
    touched.set(n, was ? [Math.min(was[0], box[0]), Math.max(was[1], box[1]), Math.min(was[2], box[2]), Math.max(was[3], box[3])] : box);
  });
  /** Redraws what the ground changed under: colours, tiles, the markers that stand on it, the mist. */
  function groundMoved() {
    let r0 = ROWS, r1 = -1, c0 = COLS, c1 = -1;
    for (const [n, [a, b, c_, d]] of touched) {
      for (let r = a; r <= b; r++) for (let k = c_; k <= d; k++) colourOf(r * COLS + k);
      r0 = Math.min(r0, a); r1 = Math.max(r1, b); c0 = Math.min(c0, c_); c1 = Math.max(c1, d);
      const bits = trailBits.get(n), t = TRAILS.get(n), bk = beacons.get(n);
      if (bits && t) placeTrail(t, bits);
      if (bk) placeBeacon(regionN(n), bk.parts);
    }
    touched.clear();
    shape(r0, r1, c0, c1);
    drawMist(openRegions(beaten));
    mapStale = true; floraDirty = true;
  }

  // --- you ---------------------------------------------------------------------------------------------------
  const me = spawn(1), trekAt = newTrek(me);
  // Your line-up walks behind you, each a few steps back along where you went.
  let followers: Walker3d[] = [], crumbs: { x: number; z: number; yaw: number }[] = [];
  /** On a trail you haven't finished, past its open sections (a fresh journey, or sent home to the arena): back to the next keeper. */
  function onTrail() {
    const done = hooks.cleared(me.region), b = bandAt(me.x, me.z);
    if (!TRAILS.has(me.region) || done >= SECTIONS || b <= done + 1) return;
    const p = trailhead(me.region, done);
    if (p) { me.x = p.x; me.z = p.z; }
    trekAt.band = bandAt(me.x, me.z); trekAt.armed = false; crumbs = [];
  }
  let you: Walker3d | null = null, speed = 8, yaw = 0, facing = 0, snap = true; // snap: put the camera straight there, no glide
  let shownOnce = false;
  // Pieces whose road opened while you were away (in the arena that opened it): shown rising when you're back.
  let toReveal: Region[] = [];
  // The camera's shot of them: high above, looking down at them and you, then gliding back to follow you.
  let shot: { t: number; end: number; at: THREE.Vector3; look: THREE.Vector3; back: number } | null = null;
  const follow = new THREE.Vector3(), followLook = new THREE.Vector3();
  function startShot(rs: Region[]) {
    const pts = [...rs.map(arenaOf), { x: me.x, z: me.z }];
    const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length, cz = pts.reduce((a, p) => a + p.z, 0) / pts.length;
    const span = Math.max(400, ...pts.map((p) => Math.hypot(p.x - cx, p.z - cz)));
    const look = new THREE.Vector3(cx, heightAt(w, cx, cz), cz);
    // From the south, and from your side of them, so you stay in frame.
    const away = new THREE.Vector2(me.x - cx, me.z - cz + span * 0.3).normalize();
    // A tall phone screen sees less sideways: stand further back until the pieces fit across it.
    const back = (span * 1.1) / Math.sqrt(Math.min(1, camera.aspect));
    shot = { t: 0, end: RISE + EASE_CAM * 2 + 0.4, look, back, at: new THREE.Vector3(cx + away.x * back, look.y + back, cz + away.y * back) };
    toast(`${icon("mountain")} ${rs.map((g) => esc(g.name)).join(", ")} ${rs.length > 1 ? "rise" : "rises"} out of the mist.`);
  }

  // --- the HUD: where you are, a toast, the map ------------------------------------------------------------------
  // The map is the ground seen from above at one pixel per two samples: pieces in their colours, a parchment
  // fog over open land you haven't walked near yet, and unformed grey where the roads are still closed.
  const hud = document.querySelector<HTMLElement>("#worldHud")!, where = hud.querySelector<HTMLElement>(".where")!, toastEl = hud.querySelector<HTMLElement>(".toast")!;
  // The closed piece you face within a few cells: its name and what opens it, floating over its mist.
  const roadEl = hud.querySelector<HTMLElement>(".road")!, LOOK = 40;
  let roadFor = 0;
  function faced() {
    const open = openRegions(beaten), dx = Math.cos(facing), dz = Math.sin(facing);
    for (let d = STEP / 2; d <= LOOK; d += STEP / 2) {
      const x = me.x + dx * d, z = me.z + dz * d, g = regionAt(x, z);
      if (!g) return null;
      if (!open.has(g.n)) return { g, x, z };
    }
    return null;
  }
  function drawRoad() {
    const f = shot || hud.classList.contains("big-map") ? null : faced();
    const p = f && new THREE.Vector3(f.x, Math.max(0, drawnY(f.x, f.z)) + 7, f.z).project(camera);
    if (!f || !p || p.z >= 1 || Math.abs(p.x) > 1 || Math.abs(p.y) > 1) { roadEl.hidden = true; roadFor = 0; return; }
    if (roadFor !== f.g.n) { roadFor = f.g.n; roadEl.innerHTML = `<b>${icon("lock")}${esc(f.g.name)}</b><small>${esc(whatOpens(f.g))}</small>`; }
    roadEl.hidden = false;
    // Kept on screen: near an edge, or on a phone, the point itself may sit under the label's half width.
    const hw = roadEl.offsetWidth / 2 + 8, x = ((p.x + 1) / 2) * innerWidth, y = ((1 - p.y) / 2) * innerHeight;
    roadEl.style.left = `${clamp(x, hw, innerWidth - hw)}px`; roadEl.style.top = `${clamp(y, roadEl.offsetHeight + 8, innerHeight - 8)}px`;
  }
  const map = hud.querySelector<HTMLCanvasElement>("canvas")!, MW = (COLS - 1) / 2, MH = (ROWS - 1) / 2;
  map.width = MW; map.height = MH;
  const ctx = map.getContext("2d"), img = ctx?.createImageData(MW, MH), base = new Uint8ClampedArray(MW * MH * 4);
  let toastUntil = 0, mapAt = 0, mapStale = false;
  function toast(html: string) { toastEl.innerHTML = html; toastEl.hidden = false; toastUntil = performance.now() + 3500; }
  function drawWhere() {
    const g = regionN(me.region), tier = TIER[g.tier], pct = Math.round(explored(seen, g.n) * 100);
    const t = TRAILS.get(g.n), done = hooks.cleared(g.n), b = trekAt.band;
    const sec = t && b ? `<small class="sec">${icon("flag")}${b}/${SECTIONS} ${esc(sections(g)[b - 1]!.name)}${done >= SECTIONS ? "" : ` · ${done} cleared`}</small>` : "";
    where.innerHTML = `<b>${g.n}. ${esc(g.name)}</b>${sec}${tier ? `<span class="tier ${g.tier}">${icon("triangle-alert")}${tier}</span>` : beaten.has(g.n) ? `<span class="tier won">arena won</span>` : ""}<small>${esc(tales(g, hiddenName))}</small><small class="seen">${icon("footprints")}${pct}% explored</small>`;
  }
  /** The map's land and sea from the ground's current colours; the fog and you go on top in drawMap. */
  function paintMap() {
    const shore = new THREE.Color(0x3f7aa8), deep = new THREE.Color(0x1d3a52), rgb = { r: 0, g: 0, b: 0 };
    for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
      const i = (y * 2 + 1) * COLS + x * 2 + 1, o = (y * MW + x) * 4, h = w.y[i]!;
      if (!OWNER[i] || h < 0) c.copy(deep).lerp(shore, clamp(1 + h / 3, 0, 1));
      else {
        c.setRGB(col[i * 3]!, col[i * 3 + 1]!, col[i * 3 + 2]!);
        // Grey pieces keep a faint outline on paper, where there's no mist to tell them apart.
        const o = seamWith[i]!;
        if (o) c.multiplyScalar(lerp(0.8, 1, Math.min(ease(rise[OWNER[i]!]!), ease(rise[o]!))));
      }
      c.getRGB(rgb, THREE.SRGBColorSpace);
      base[o] = rgb.r * 255; base[o + 1] = rgb.g * 255; base[o + 2] = rgb.b * 255; base[o + 3] = 255;
    }
  }
  function drawMap() {
    if (!ctx || !img) return;
    const open = openRegions(beaten), d = img.data, fog = [PARCHMENT >> 16, (PARCHMENT >> 8) & 255, PARCHMENT & 255] as const;
    d.set(base);
    for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
      const n = OWNER[(y * 2 + 1) * COLS + x * 2 + 1]!;
      if (!n || !open.has(n) || isSeen(seen, Math.floor((y * 2 * STEP) / FOG) * FOG_W + Math.floor((x * 2 * STEP) / FOG))) continue;
      const o = (y * MW + x) * 4;
      // Paper, with a faint grain so it reads as unknown rather than as another sandy region.
      const grain = ((x * 7 + y * 13) % 5) * 3;
      for (let k = 0; k < 3; k++) d[o + k] = lerp(d[o + k]!, fog[k]! - grain, 0.9);
    }
    ctx.putImageData(img, 0, 0);
    const k = MW / w.width;
    for (const g of REGIONS) if (g.tier === "high-level" && open.has(g.n) || beaten.has(g.n)) {
      const a = arenaOf(g);
      ctx.fillStyle = beaten.has(g.n) ? "#6ad37a" : "#ff4a3a";
      ctx.beginPath(); ctx.arc(a.x * k, a.z * k, 2, 0, Math.PI * 2); ctx.fill();
    }
    ctx.save(); ctx.translate(me.x * k, me.z * k); ctx.rotate(facing);
    ctx.fillStyle = "#fff"; ctx.strokeStyle = "#1d3a52"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(5, 0); ctx.lineTo(-3, 3.5); ctx.lineTo(-1.5, 0); ctx.lineTo(-3, -3.5); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
  }
  const pointAt = (e: MouseEvent) => { const b = map.getBoundingClientRect(); return regionAt(((e.clientX - b.left) / b.width) * w.width, ((e.clientY - b.top) / b.height) * w.depth); };
  /** Why a region is closed and what opens it, plain text; "" when it's open. */
  function whatOpens(g: Region) {
    if (openRegions(beaten).has(g.n)) return "";
    if (g.tier === "coming-soon") return "coming soon";
    const gate = gateShut(g, beaten);
    if (gate) return gate.why;
    const near = opensRoadTo(g, beaten, me.region);
    return `win ${near ? `${near.name}'s` : "a neighbouring"} arena to open the road`;
  }
  map.addEventListener("mousemove", (e) => {
    const g = pointAt(e), shut = g && whatOpens(g);
    map.title = !g ? "Open sea" : shut ? `${g.n}. ${g.name}: ${shut}` : `${g.n}. ${g.name}${beaten.has(g.n) && hud.classList.contains("big-map") ? ": click to travel to its arena" : ""}`;
  });
  // A tap opens the map big; on the big map a won region travels there, a grey piece says what opens it
  // (the map stays up), anywhere else closes it.
  map.addEventListener("click", (e) => {
    if (!hud.classList.contains("big-map")) { hud.classList.add("big-map"); return; }
    const g = pointAt(e), shut = g && whatOpens(g);
    if (g && shut) { toast(`${icon("lock")} ${esc(g.name)}: ${esc(shut)}.`); return; }
    if (g && beaten.has(g.n)) travel(g.n);
    hud.classList.remove("big-map");
  });
  window.addEventListener("keydown", (e: KeyboardEvent) => { if (group.visible && actionOf(e.code) === "map") hud.classList.toggle("big-map"); });

  // Crossing into a region: its name across the top for a moment, and "Discovered" the first time you're in it.
  const arriveEl = hud.querySelector<HTMLElement>(".arrive")!;
  let arrived = { n: 0, at: -Infinity }, arriveTimer = 0, visited = new Set<number>();
  try { const s: unknown = JSON.parse(localStorage.getItem(SAVE_VISITED) ?? "[]"); if (Array.isArray(s)) visited = new Set(s.filter((n): n is number => typeof n === "number")); } catch { /* none yet */ }
  const saveVisited = () => { try { localStorage.setItem(SAVE_VISITED, JSON.stringify([...visited])); } catch { /* nowhere to keep it */ } };
  function arrive(g: Region) {
    const now = performance.now();
    if (g.n === arrived.n && now - arrived.at < 10_000) return; // stepping back and forth over one border
    arrived = { n: g.n, at: now };
    const fresh = !visited.has(g.n);
    if (fresh) { visited.add(g.n); saveVisited(); }
    arriveEl.innerHTML = `<small>${fresh ? `<span class="new">${icon("sparkle")}Discovered</span>` : esc(g.block)}</small><b>${esc(g.name)}</b>${tales(g, hiddenName) ? `<span>${esc(tales(g, hiddenName))}</span>` : ""}`;
    arriveEl.hidden = false;
    // Restart the fade even if the last card is still up.
    arriveEl.style.animation = "none"; void arriveEl.offsetWidth; arriveEl.style.animation = "";
    clearTimeout(arriveTimer); arriveTimer = window.setTimeout(() => { arriveEl.hidden = true; }, 3300);
    hooks.arrived?.(g, fresh);
  }

  function say(e: TrekEvent) {
    if (e.kind === "section") { drawWhere(); toast(`${icon("flag")} ${e.k + 1} of ${SECTIONS} · ${esc(sections(e.region)[e.k]!.name)}`); hooks.section?.(e.region, e.k); }
    if (e.kind === "keeper") hooks.keeper(e.region, e.k);
    if (e.kind === "blocked" && e.why === "gate" && e.region && performance.now() > toastUntil) {
      const next = sections(e.region)[hooks.cleared(e.region.n)]!;
      toast(`${icon("lock")} Bog-light bars the way. Beat or bind the keeper at ${esc(next.name)} to go on.`);
      return;
    }
    if (e.kind === "enter") { drawTrails(openRegions(beaten)); drawWhere(); arrive(e.region); if (e.region.tier === "high-level") toast(`${icon("triangle-alert")} A wall of strong wild creatures lives in ${esc(e.region.name)}. Turn back until you're ready.`); }
    if (e.kind === "blocked" && performance.now() > toastUntil) toast(e.region ? `${icon("lock")} ${esc(e.region.name)}: ${esc(whatOpens(e.region))}.` : "Open sea. The supercontinent ends here.");
    if (e.kind === "arena") hooks.arena(e.region);
    if (e.kind === "wild") hooks.wild(e.region);
  }
  function wear(c: Creature) {
    you?.dispose();
    you = new Walker3d(c, group);
    // The world is wide: you cover it at twice your fighting pace, and twice that again running.
    speed = body(c).topSpeed * 2.2;
  }
  function look() { if (explore(seen, me.x, me.z)) { seenDirty = true; drawWhere(); } }
  function travel(n: number) { if (!openRegions(beaten).has(n)) return; Object.assign(me, spawn(n)); onTrail(); snap = true; look(); drawWhere(); drawMap(); arrive(regionN(n)); }

  return {
    /** Walk as the line-up's lead, the rest of it following. */
    show(party: Creature[]) {
      setTravel(party);
      wear(party[0]!);
      for (const f of followers) f.dispose();
      followers = party.slice(1).map((p) => new Walker3d(creature(p.id), group));
      onTrail();
      scene.background = new THREE.Color(0xa8c8e8); scene.fog = new THREE.Fog(0xa8c8e8, 200, 1500);
      camera.far = 6000; camera.updateProjectionMatrix();
      group.visible = true; hud.hidden = false; snap = true;
      // The first time in, everything is already where it stands; after that, a piece that opened rises.
      refresh(shownOnce); shownOnce = true; look(); drawWhere(); arrive(regionN(me.region));
    },
    hide() { group.visible = false; hud.hidden = true; },
    get shown() { return group.visible; },
    /** One frame: `keys` are the action ids held (binds.ts). Forward / back / left / right or a stick walks (relative to
     *  the camera, a light push walks slowly), dash runs, turnLeft / turnRight turn the camera, `turn` (radians, from a
     *  right stick or a drag) turns it too, and the map action opens the big map. */
    update(dt: number, keys: ReadonlySet<string>, stick: Stick = NO_STICK, turn = 0) {
      const on = (k: string) => keys.has(k);
      yaw += ((on("turnRight") ? 1 : 0) - (on("turnLeft") ? 1 : 0)) * 1.8 * dt + turn;
      const { fx: fx0, sx: sx0 } = push(keys, stick);
      // Any move skips the shot of a rising piece; you don't walk blind while it plays.
      if (shot && (fx0 || sx0) && shot.t < shot.end - EASE_CAM) shot.t = shot.end - EASE_CAM;
      const fx = shot ? 0 : fx0, sx = shot ? 0 : sx0;
      // yaw 0 looks north (-z).
      const mx = Math.sin(yaw) * fx + Math.cos(yaw) * sx, mz = -Math.cos(yaw) * fx + Math.sin(yaw) * sx;
      if (mx || mz) {
        facing = Math.atan2(mz, mx);
        const v = speed * (on("dash") ? 2 : 1) * dt;
        for (const e of trek(me, trekAt, mx * v, mz * v, beaten, hooks.cleared)) say(e);
        look();
        const last = crumbs[0];
        if (!last || Math.hypot(last.x - me.x, last.z - me.z) > 0.8) { crumbs.unshift({ x: me.x, z: me.z, yaw: facing }); crumbs.length = Math.min(crumbs.length, 40); }
      }
      // A piece whose road just opened rises out of the grey.
      if (toReveal.length) { startShot(toReveal); toReveal = []; }
      let r0 = ROWS, r1 = -1;
      for (let k = 1; k < rise.length; k++) if (rise[k] !== want[k]) {
        rise[k] = clamp(rise[k]! + Math.sign(want[k]! - rise[k]!) * dt / RISE, 0, 1);
        const sp = span.get(k);
        if (sp) { r0 = Math.min(r0, sp[0] - SMOOTH_R * 2); r1 = Math.max(r1, sp[1] + SMOOTH_R * 2); }
      }
      stream.update(me.x, me.z);
      if (touched.size) groundMoved();
      if (r1 >= 0) { shape(Math.max(0, r0), Math.min(ROWS - 1, r1)); mapStale = true; if (!rise.some((v, k) => v !== want[k])) floraDirty = true; }
      drawLand();
      // The fine ground follows you in jumps, and is planted again when it moves or a piece finishes rising.
      const fx1 = Math.round(me.x / SNAP) * SNAP, fz1 = Math.round(me.z / SNAP) * SNAP;
      if (fx1 !== fineAt.x || fz1 !== fineAt.z) { fineAt.x = fx1; fineAt.z = fz1; fineDirty = floraDirty = true; }
      if (fineDirty) buildFine();
      if (floraDirty) regrow();
      const open = openRegions(beaten);
      roam(dt, open);
      const met = !shot && meet(me, [...roamers.values()].map((r) => r.c), new Set(calm.keys()));
      if (met) { calm.set(met.den, performance.now() + CALM_MS); hooks.wild(regionN(met.region), { id: met.id, level: met.level }); }
      if (toastUntil && performance.now() > toastUntil) { toastEl.hidden = true; toastUntil = 0; }
      const y = Math.max(fineY(me.x, me.z), -0.6);
      you?.update(me.x, y, me.z, facing, dt);
      followers.forEach((f, i) => {
        const at = crumbs[Math.min(crumbs.length - 1, (i + 1) * 3)] ?? { x: me.x - (i + 1) * 1.5, z: me.z, yaw: facing };
        f.update(at.x, Math.max(fineY(at.x, at.z), -0.6), at.z, at.yaw, dt);
      });
      if (keeper) keeper.b.update(keeper.x, Math.max(0, fineY(keeper.x, keeper.z)), keeper.z, Math.PI / 2, dt);
      plants.you.set(me.x, y + 1, me.z);
      const cam = new THREE.Vector3(me.x - Math.sin(yaw) * 16, y + 8, me.z + Math.cos(yaw) * 16);
      cam.y = Math.max(cam.y, heightAt(w, cam.x, cam.z) + 2);
      follow.lerp(cam, snap ? 1 : clamp(dt * 5, 0, 1)); snap = false;
      followLook.set(me.x, y + 1.5, me.z);
      if (shot) {
        shot.t += dt;
        const k = ease(clamp(Math.min(shot.t, shot.end - shot.t) / EASE_CAM, 0, 1));
        camera.position.lerpVectors(follow, shot.at, k);
        camera.lookAt(new THREE.Vector3().lerpVectors(followLook, shot.look, k));
        if (scene.fog instanceof THREE.Fog) { scene.fog.near = lerp(120, shot.back * 1.6, k); scene.fog.far = lerp(520, shot.back * 3.2, k); }
        if (shot.t >= shot.end) shot = null;
      } else {
        camera.position.copy(follow);
        camera.lookAt(followLook);
      }
      camera.updateMatrixWorld();
      drawRoad(); drawTag();
      if (performance.now() > mapAt) { mapAt = performance.now() + 250; if (mapStale) { paintMap(); mapStale = false; } drawMap(); if (seenDirty) saveSeen(); }
    },
    beat(n: number) {
      const before = openRegions(beaten);
      beaten.add(n); save();
      const fresh = REGIONS.filter((g) => !before.has(g.n) && openRegions(beaten).has(g.n));
      refresh(true);
      toReveal.push(...fresh);
    },
    /** Back from a fight. Lost: on your last arena's doorstep. */
    afterFight(won: boolean) { if (!won) { sendHome(me); onTrail(); } snap = true; drawTrails(openRegions(beaten)); drawWhere(); drawMap(); },
    /** A section's keeper was beaten or bound: its gate lifts, the next stone lights. */
    cleared() { drawTrails(openRegions(beaten)); drawWhere(); },
    travel,
    /** Where you stand, on the ground. */
    here: () => { const y = fineY(me.x, me.z); return { x: me.x, y: Number.isFinite(y) ? y : drawnY(me.x, me.z), z: me.z }; }, // the fine patch is built on the first frame
    /** Stand at (x, z) at once, for an agent's harness: the stone of a section, beside a roamer. */
    teleport(x: number, z: number) { const g = regionAt(x, z); if (!g || !openRegions(beaten).has(g.n)) return false; me.x = x; me.z = z; me.region = g.n; trekAt.band = bandAt(x, z); trekAt.armed = true; snap = true; look(); drawWhere(); return true; },
    trails: () => [...TRAILS.values()].map((t) => ({ n: t.n, stones: t.stones.map((p) => ({ x: +p.x.toFixed(1), z: +p.z.toFixed(1) })) })),
    reset() { beaten.clear(); save(); seen = newSeen(); saveSeen(); visited.clear(); saveVisited(); arrived.n = 0; toReveal = []; shot = null; calm.clear(); travel(1); refresh(); },
    state: () => {
      const g = regionN(me.region), open = openRegions(beaten);
      return { region: g.n, name: g.name, tier: g.tier, x: +me.x.toFixed(1), z: +me.z.toFixed(1), explored: +explored(seen, g.n).toFixed(3),
        rising: REGIONS.filter((r) => rise[r.n] !== want[r.n]).map((r) => r.n), shot: shot !== null,
        beaten: [...beaten].sort((a, b) => a - b), open: [...open].sort((a, b) => a - b),
        ground: { loaded: stream.loaded(), tiles: landStats() }, section: trekAt.band, wilds: [...roamers.values()].map(({ c }) => ({ id: c.id, level: c.level, x: +c.x.toFixed(1), z: +c.z.toFixed(1) })), plants: plants.spots };
    },
  };
}
export type WorldView = ReturnType<typeof worldView>;
