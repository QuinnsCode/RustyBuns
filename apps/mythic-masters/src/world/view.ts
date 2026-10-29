// The open world drawn: the supercontinent's ground cut into region pieces, the sea, an arena marker per
// North American region, a red beacon over the deadly south, mist along the borders still closed, you, and
// the map in the corner that fills in as you walk. A piece you can't enter yet lies low and grey, unformed;
// when its road opens it rises into its real relief. Walking is src/world/world.ts; this file turns keys
// into steps and steps into pictures.
import * as THREE from "three";
import { b64url } from "@rustybuns/util/bytes";
import { clamp, esc, lerp } from "@rustybuns/util";
import { NO_STICK, push, type Stick } from "../controls.ts";
import { icon } from "../icons.ts";
import { creatureModel } from "../model.ts";
import { body, type Creature } from "../roster.ts";
import ground from "./ground.json";
import { REGIONS, type Biome, type Region } from "../regions.ts";
import { arenaOf, buildWorld, COLS, explore, explored, FOG, FOG_W, isSeen, newSeen, openRegions, opensRoadTo, OWNER, regionAt, ROWS, sendHome, spawn, STEP, walk, heightAt, type WalkEvent } from "./world.ts";

const SAVE = "mythic-masters.world.beaten", SAVE_SEEN = "mythic-masters.world.seen", SAVE_VISITED = "mythic-masters.world.visited";
const SEA = 0x2f6a98, SAND = 0xc8b890, ROCK = 0x8a8580, SNOW = 0xf2f4f8, CLOSED = 0x5a5e66, PARCHMENT = 0xf1e7cf;
const RISE = 2.8; // seconds a piece takes to rise when its road opens
const EASE_CAM = 0.9; // seconds the camera takes to climb to the shot of a rising piece, and to come back
const TIER = { playable: "", "high-level": "High level: deadly wild creatures", "coming-soon": "Coming soon" } as const;
// The land's colour: a built region's arena ground, else its biome's.
const BIOME: Record<Biome, number> = { "pine-barrens": 0xc9b98a, forest: 0x4f6b3a, rainforest: 0x3f5f32, lake: 0x7a9a5a, desert: 0xd09a5f, swamp: 0x4a5a2f,
  plains: 0x8a9a4a, highlands: 0x7a7a50, jungle: 0x3a6a2a, island: 0xc8c090, mountains: 0x8a8068, river: 0x6a8a48, coast: 0x6a8a58, savanna: 0xb0a058, tundra: 0xa8b0a0, steppe: 0xa8a068 };
const landOf = (g: Region) => g.skin?.ground ?? BIOME[g.biome];
const tales = (g: Region) => g.folklore.filter((b) => !b.sacred).map((b) => b.name).join(", ");
const ease = (t: number) => t * t * (3 - 2 * t);

export interface WorldHooks { arena(g: Region): void; wild(g: Region): void }

export function worldView(scene: THREE.Scene, camera: THREE.PerspectiveCamera, hooks: WorldHooks) {
  const w = buildWorld(ground);
  const group = new THREE.Group();
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
  for (let r = 0; r < ROWS; r++) for (let k = 0; k < COLS; k++) {
    const i = r * COLS + k, y = w.y[i]!, n = OWNER[i]!, g = n ? REGIONS[n - 1] : undefined;
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
  /** 0 = unformed, 1 = risen, per region number; `want` is where it's heading. */
  const rise = new Float32Array(REGIONS.length + 1).fill(1), want = new Float32Array(REGIONS.length + 1).fill(1);
  const geo = new THREE.BufferGeometry();
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
  function shape(r0 = 0, r1 = ROWS - 1) {
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
    // No normals to recompute: the land is flat-shaded, so its normals come from the triangles in the shader.
    for (const a of [geo.attributes.position!, geo.attributes.color!]) {
      if (!(a instanceof THREE.BufferAttribute)) continue;
      a.clearUpdateRanges(); a.addUpdateRange(r0 * COLS * 3, (r1 - r0 + 1) * COLS * 3); a.needsUpdate = true;
    }
  }
  for (let r = 0; r < ROWS; r++) for (let k = 0; k < COLS; k++) { const i = r * COLS + k; pos[i * 3] = k * STEP; pos[i * 3 + 2] = r * STEP; }
  const idx = new Uint32Array((COLS - 1) * (ROWS - 1) * 6);
  for (let r = 0, j = 0; r < ROWS - 1; r++) for (let k = 0; k < COLS - 1; k++) {
    const a = r * COLS + k, b = a + 1, d = a + COLS, e = d + 1;
    idx.set([a, d, b, b, d, e], j); j += 6;
  }
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  const land = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true }));
  land.receiveShadow = true;
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(w.width * 3, w.depth * 3), new THREE.MeshStandardMaterial({ color: SEA, roughness: 0.25, transparent: true, opacity: 0.82 }));
  sea.rotation.x = -Math.PI / 2; sea.position.set(w.width / 2, 0, w.depth / 2);
  const sun = new THREE.DirectionalLight(0xffffff, 2);
  sun.position.set(-200, 300, -100);
  group.add(land, sea, sun, sun.target, new THREE.HemisphereLight(0xbcd6ea, 0x5f7a4c, 1.1));

  // --- markers: an arena ring and beacon per playable region, a red beacon over each high-level one --------
  const beacons = new Map<number, { mat: THREE.MeshBasicMaterial; parts: THREE.Object3D[] }>();
  for (const g of REGIONS) if (g.tier !== "coming-soon") {
    const a = arenaOf(g), y = heightAt(w, a.x, a.z), mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.55, depthWrite: false });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(g.tier === "high-level" ? 3 : 1.2, g.tier === "high-level" ? 3 : 1.2, 60, 16, 1, true), mat);
    beam.position.set(a.x, y + 30, a.z);
    const parts: THREE.Object3D[] = [beam];
    if (g.tier === "playable") {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(4, 0.25, 8, 48), mat);
      ring.rotation.x = Math.PI / 2; ring.position.set(a.x, y + 0.2, a.z);
      parts.push(ring);
    }
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

  function refresh(animate = false) {
    const open = openRegions(beaten);
    for (const g of REGIONS) {
      want[g.n] = open.has(g.n) ? 1 : 0;
      if (!animate) rise[g.n] = want[g.n]!;
    }
    shape();
    drawMist(open);
    for (const [n, { mat, parts }] of beacons) {
      mat.color.setHex(regionN(n).tier === "high-level" ? 0xff4a3a : beaten.has(n) ? 0x6ad37a : open.has(n) ? 0xffb347 : 0x8a8f99);
      for (const o of parts) o.visible = open.has(n) || regionN(n).tier === "high-level";
    }
    paintMap();
  }
  const regionN = (n: number) => REGIONS[n - 1]!;

  // --- you ---------------------------------------------------------------------------------------------------
  const me = spawn(1);
  let you: THREE.Group | null = null, speed = 8, yaw = 0, facing = 0, snap = true; // snap: put the camera straight there, no glide
  let shownOnce = false;
  // Pieces whose road opened while you were away (in the arena that opened it): shown rising when you're back.
  let toReveal: Region[] = [];
  // The camera's shot of them: high above, looking down at them and you, then gliding back to follow you.
  let shot: { t: number; end: number; at: THREE.Vector3; look: THREE.Vector3; back: number } | null = null;
  const follow = new THREE.Vector3(), followLook = new THREE.Vector3();
  function startShot(rs: Region[]) {
    const pts = [...rs.map(arenaOf), { x: me.x, z: me.z }];
    const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length, cz = pts.reduce((a, p) => a + p.z, 0) / pts.length;
    const span = Math.max(120, ...pts.map((p) => Math.hypot(p.x - cx, p.z - cz)));
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
    where.innerHTML = `<b>${g.n}. ${esc(g.name)}</b>${tier ? `<span class="tier ${g.tier}">${icon("triangle-alert")}${tier}</span>` : beaten.has(g.n) ? `<span class="tier won">arena won</span>` : ""}<small>${esc(tales(g))}</small><small class="seen">${icon("footprints")}${pct}% explored</small>`;
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
  window.addEventListener("keydown", (e: KeyboardEvent) => { if (group.visible && e.code === "KeyM") hud.classList.toggle("big-map"); });

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
    arriveEl.innerHTML = `<small>${fresh ? `<span class="new">${icon("sparkle")}Discovered</span>` : esc(g.block)}</small><b>${esc(g.name)}</b>${tales(g) ? `<span>${esc(tales(g))}</span>` : ""}`;
    arriveEl.hidden = false;
    // Restart the fade even if the last card is still up.
    arriveEl.style.animation = "none"; void arriveEl.offsetWidth; arriveEl.style.animation = "";
    clearTimeout(arriveTimer); arriveTimer = window.setTimeout(() => { arriveEl.hidden = true; }, 3300);
  }

  function say(e: WalkEvent) {
    if (e.kind === "enter") { drawWhere(); arrive(e.region); if (e.region.tier === "high-level") toast(`${icon("triangle-alert")} A wall of strong wild creatures lives in ${esc(e.region.name)}. Turn back until you're ready.`); }
    if (e.kind === "blocked" && performance.now() > toastUntil) toast(e.region ? `${icon("lock")} ${esc(e.region.name)}: ${esc(whatOpens(e.region))}.` : "Open sea. The supercontinent ends here.");
    if (e.kind === "arena") hooks.arena(e.region);
    if (e.kind === "wild") hooks.wild(e.region);
  }
  function look() { if (explore(seen, me.x, me.z)) { seenDirty = true; drawWhere(); } }
  function travel(n: number) { if (!openRegions(beaten).has(n)) return; Object.assign(me, spawn(n)); snap = true; look(); drawWhere(); drawMap(); arrive(regionN(n)); }

  return {
    show(c: Creature) {
      if (you) group.remove(you);
      you = creatureModel(c); group.add(you);
      speed = body(c).topSpeed * 1.6;
      scene.background = new THREE.Color(0xa8c8e8); scene.fog = new THREE.Fog(0xa8c8e8, 120, 520);
      camera.far = 1600; camera.updateProjectionMatrix();
      group.visible = true; hud.hidden = false; snap = true;
      // The first time in, everything is already where it stands; after that, a piece that opened rises.
      refresh(shownOnce); shownOnce = true; look(); drawWhere(); arrive(regionN(me.region));
    },
    hide() { group.visible = false; hud.hidden = true; },
    get shown() { return group.visible; },
    /** One frame: WASD or a stick walks (relative to the camera, a light push walks slowly), Shift runs, Q / E or the
     *  arrow keys turn the camera, `turn` (radians, from a right stick or a drag) turns it too, and M opens the big map. */
    update(dt: number, keys: ReadonlySet<string>, stick: Stick = NO_STICK, turn = 0) {
      const on = (k: string) => keys.has(k);
      yaw += ((on("KeyE") || on("ArrowRight") ? 1 : 0) - (on("KeyQ") || on("ArrowLeft") ? 1 : 0)) * 1.8 * dt + turn;
      const { fx: fx0, sx: sx0 } = push(keys, stick, true);
      // Any move skips the shot of a rising piece; you don't walk blind while it plays.
      if (shot && (fx0 || sx0) && shot.t < shot.end - EASE_CAM) shot.t = shot.end - EASE_CAM;
      const fx = shot ? 0 : fx0, sx = shot ? 0 : sx0;
      // yaw 0 looks north (-z).
      const mx = Math.sin(yaw) * fx + Math.cos(yaw) * sx, mz = -Math.cos(yaw) * fx + Math.sin(yaw) * sx;
      if (mx || mz) {
        facing = Math.atan2(mz, mx);
        const v = speed * (on("ShiftLeft") || on("ShiftRight") ? 1.8 : 1) * dt;
        for (const e of walk(me, mx * v, mz * v, beaten)) say(e);
        look();
      }
      // A piece whose road just opened rises out of the grey.
      if (toReveal.length) { startShot(toReveal); toReveal = []; }
      let r0 = ROWS, r1 = -1;
      for (let k = 1; k < rise.length; k++) if (rise[k] !== want[k]) {
        rise[k] = clamp(rise[k]! + Math.sign(want[k]! - rise[k]!) * dt / RISE, 0, 1);
        const sp = span.get(k);
        if (sp) { r0 = Math.min(r0, sp[0] - SMOOTH_R * 2); r1 = Math.max(r1, sp[1] + SMOOTH_R * 2); }
      }
      if (r1 >= 0) { shape(Math.max(0, r0), Math.min(ROWS - 1, r1)); mapStale = true; }
      if (toastUntil && performance.now() > toastUntil) { toastEl.hidden = true; toastUntil = 0; }
      const y = Math.max(heightAt(w, me.x, me.z), -0.6);
      if (you) { you.position.set(me.x, y, me.z); you.rotation.y = -facing; }
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
      drawRoad();
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
    afterFight(won: boolean) { if (!won) sendHome(me); snap = true; drawWhere(); drawMap(); },
    travel,
    reset() { beaten.clear(); save(); seen = newSeen(); saveSeen(); visited.clear(); saveVisited(); arrived.n = 0; toReveal = []; shot = null; travel(1); refresh(); },
    state: () => {
      const g = regionN(me.region), open = openRegions(beaten);
      return { region: g.n, name: g.name, tier: g.tier, x: +me.x.toFixed(1), z: +me.z.toFixed(1), explored: +explored(seen, g.n).toFixed(3),
        rising: REGIONS.filter((r) => rise[r.n] !== want[r.n]).map((r) => r.n), shot: shot !== null,
        beaten: [...beaten].sort((a, b) => a - b), open: [...open].sort((a, b) => a - b) };
    },
  };
}
export type WorldView = ReturnType<typeof worldView>;
