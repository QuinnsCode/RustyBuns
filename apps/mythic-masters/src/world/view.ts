// The open world drawn: the supercontinent's ground, the sea, an arena marker per North American region,
// a red beacon over the deadly south, walls where the roads are still closed, you, and the map in the corner.
// Walking is src/world/world.ts; this file turns keys into steps and steps into pictures.
import * as THREE from "three";
import { clamp, esc } from "@rustybuns/util";
import { icon } from "../icons.ts";
import { creatureModel } from "../model.ts";
import { body, type Creature } from "../roster.ts";
import ground from "./ground.json";
import { REGIONS, type Biome, type Region } from "../regions.ts";
import { GRID } from "./places.ts";
import { arenaOf, buildWorld, CELL, cell, heightAt, neighbours, openRegions, regionAt, regionAtCell, sendHome, spawn, STEP, walk, type WalkEvent } from "./world.ts";

const SAVE = "mythic-masters.world.beaten";
const SEA = 0x2f6a98, SAND = 0xc8b890, ROCK = 0x8a8580, SNOW = 0xf2f4f8, CLOSED = 0x5a5e66;
const TIER = { playable: "", "high-level": "High level: deadly wild creatures", "coming-soon": "Coming soon" } as const;
// The land's colour: a built region's arena ground, else its biome's.
const BIOME: Record<Biome, number> = { "pine-barrens": 0xc9b98a, forest: 0x4f6b3a, rainforest: 0x3f5f32, lake: 0x7a9a5a, desert: 0xd09a5f, swamp: 0x4a5a2f,
  plains: 0x8a9a4a, highlands: 0x7a7a50, jungle: 0x3a6a2a, island: 0xc8c090, mountains: 0x8a8068, river: 0x6a8a48, coast: 0x6a8a58, savanna: 0xb0a058, tundra: 0xa8b0a0, steppe: 0xa8a068 };
const landOf = (g: Region) => g.skin?.ground ?? BIOME[g.biome];
const tales = (g: Region) => g.folklore.filter((b) => !b.sacred).map((b) => b.name).join(", ");

export interface WorldHooks { arena(g: Region): void; wild(g: Region): void }

export function worldView(scene: THREE.Scene, camera: THREE.PerspectiveCamera, hooks: WorldHooks) {
  const w = buildWorld(ground);
  const group = new THREE.Group();
  group.visible = false;
  scene.add(group);
  let beaten = new Set<number>();
  try { const s: unknown = JSON.parse(localStorage.getItem(SAVE) ?? "[]"); if (Array.isArray(s)) beaten = new Set(s.filter((n): n is number => typeof n === "number")); } catch { /* a private window: start fresh */ }
  const save = () => { try { localStorage.setItem(SAVE, JSON.stringify([...beaten])); } catch { /* nowhere to keep it */ } };

  // --- the ground, coloured by its region's skin, by height and by whether it is open yet ----------------
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(w.cols * w.rows * 3), col = new Float32Array(w.cols * w.rows * 3);
  const c = new THREE.Color(), tint = new THREE.Color();
  for (let r = 0; r < w.rows; r++) for (let k = 0; k < w.cols; k++) {
    const i = r * w.cols + k, y = w.y[i]!, x = k * STEP, z = r * STEP;
    pos.set([x, y, z], i * 3);
    const g = regionAt(Math.min(x, w.width - 1), Math.min(z, w.depth - 1));
    c.setHex(y < 0 || !g ? SAND : landOf(g));
    if (y < 0) c.lerp(tint.setHex(0x3a4a50), clamp(-y / 3, 0, 0.7));
    if (y > 14) c.lerp(tint.setHex(ROCK), clamp((y - 14) / 8, 0, 1));
    if (y > 24) c.lerp(tint.setHex(SNOW), clamp((y - 24) / 4, 0, 1));
    if (!g || g.tier === "coming-soon") c.lerp(tint.setHex(CLOSED), 0.55);
    col.set([c.r, c.g, c.b], i * 3);
  }
  const idx: number[] = [];
  for (let r = 0; r < w.rows - 1; r++) for (let k = 0; k < w.cols - 1; k++) {
    const a = r * w.cols + k, b = a + 1, d = a + w.cols, e = d + 1;
    idx.push(a, d, b, b, d, e);
  }
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const land = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true }));
  land.receiveShadow = true;
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(w.width * 1.5, w.depth * 1.5), new THREE.MeshStandardMaterial({ color: SEA, roughness: 0.25, transparent: true, opacity: 0.82 }));
  sea.rotation.x = -Math.PI / 2; sea.position.set(w.width / 2, 0, w.depth / 2);
  const sun = new THREE.DirectionalLight(0xffffff, 2);
  sun.position.set(-200, 300, -100);
  group.add(land, sea, sun, sun.target, new THREE.HemisphereLight(0xbcd6ea, 0x5f7a4c, 1.1));

  // --- markers: an arena ring and beacon per playable region, a red beacon over each high-level one --------
  const beacons = new Map<number, THREE.MeshBasicMaterial>();
  for (const g of REGIONS) if (g.tier !== "coming-soon") {
    const a = arenaOf(g), y = heightAt(w, a.x, a.z), mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.55, depthWrite: false });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(g.tier === "high-level" ? 3 : 1.2, g.tier === "high-level" ? 3 : 1.2, 60, 16, 1, true), mat);
    beam.position.set(a.x, y + 30, a.z);
    group.add(beam);
    if (g.tier === "playable") {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(4, 0.25, 8, 48), mat);
      ring.rotation.x = Math.PI / 2; ring.position.set(a.x, y + 0.2, a.z);
      group.add(ring);
    }
    beacons.set(g.n, mat);
  }
  // --- walls where an open region meets one you can't walk into yet ------------------------------------------
  const walls = new THREE.Group();
  group.add(walls);
  const wallMat = { soon: new THREE.MeshBasicMaterial({ color: 0x9aa0aa, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }),
    locked: new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false }) };
  function refresh() {
    const open = openRegions(beaten);
    walls.clear();
    for (const g of REGIONS) if (open.has(g.n)) for (const o of neighbours(g)) if (!open.has(o.n)) {
      const mx = (cell(g)[0] + cell(o)[0] + 1) / 2 * CELL, mz = (cell(g)[1] + cell(o)[1] + 1) / 2 * CELL;
      const wall = new THREE.Mesh(new THREE.PlaneGeometry(CELL, 40), wallMat[o.tier === "coming-soon" ? "soon" : "locked"]);
      wall.position.set(mx, heightAt(w, mx, mz) + 8, mz);
      if (cell(g)[0] !== cell(o)[0]) wall.rotation.y = Math.PI / 2;
      walls.add(wall);
    }
    for (const [n, mat] of beacons) mat.color.setHex(regionN(n).tier === "high-level" ? 0xff4a3a : beaten.has(n) ? 0x6ad37a : open.has(n) ? 0xffb347 : 0x8a8f99);
    drawMap();
  }
  const regionN = (n: number) => REGIONS.find((g) => g.n === n)!;

  // --- you ---------------------------------------------------------------------------------------------------
  const me = spawn(1);
  let you: THREE.Group | null = null, speed = 8, yaw = 0, facing = 0, snap = true; // snap: put the camera straight there, no glide

  // --- the HUD: where you are, a toast, the map ------------------------------------------------------------------
  const hud = document.querySelector<HTMLElement>("#worldHud")!, where = hud.querySelector<HTMLElement>(".where")!, toastEl = hud.querySelector<HTMLElement>(".toast")!;
  const map = hud.querySelector<HTMLCanvasElement>("canvas")!, px = 14;
  map.width = GRID.w * px; map.height = GRID.h * px;
  let toastUntil = 0, mapAt = 0;
  function toast(html: string) { toastEl.innerHTML = html; toastEl.hidden = false; toastUntil = performance.now() + 3500; }
  function drawWhere() {
    const g = regionN(me.region), tier = TIER[g.tier];
    where.innerHTML = `<b>${g.n}. ${esc(g.name)}</b>${tier ? `<span class="tier ${g.tier}">${icon("triangle-alert")}${tier}</span>` : beaten.has(g.n) ? `<span class="tier won">arena won</span>` : ""}<small>${esc(tales(g))}</small>`;
  }
  function drawMap() {
    const ctx = map.getContext("2d");
    if (!ctx) return;
    const open = openRegions(beaten);
    ctx.fillStyle = "#1d3a52"; ctx.fillRect(0, 0, map.width, map.height);
    for (const g of REGIONS) {
      const [x, y] = cell(g);
      c.setHex(landOf(g));
      if (g.tier === "coming-soon") c.lerp(tint.setHex(CLOSED), 0.6);
      else if (!open.has(g.n)) c.multiplyScalar(0.55);
      ctx.fillStyle = `#${c.getHexString()}`;
      ctx.fillRect(x * px + 1, y * px + 1, px - 2, px - 2);
      if (beaten.has(g.n)) { ctx.fillStyle = "#6ad37a"; ctx.fillRect(x * px + 4, y * px + 4, px - 8, px - 8); }
      if (g.tier === "high-level") { ctx.strokeStyle = "#ff4a3a"; ctx.strokeRect(x * px + 1.5, y * px + 1.5, px - 3, px - 3); }
    }
    ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc((me.x / CELL) * px, (me.z / CELL) * px, 2.5, 0, Math.PI * 2); ctx.fill();
  }
  const cellOf = (e: MouseEvent) => { const b = map.getBoundingClientRect(); return regionAtCell(Math.floor(((e.clientX - b.left) / b.width) * GRID.w), Math.floor(((e.clientY - b.top) / b.height) * GRID.h)); };
  map.addEventListener("mousemove", (e) => { const g = cellOf(e); map.title = g ? `${g.n}. ${g.name}${g.tier === "coming-soon" ? " (coming soon)" : beaten.has(g.n) ? ": click to travel to its arena" : ""}` : "Open sea"; });
  map.addEventListener("click", (e) => { const g = cellOf(e); if (g && beaten.has(g.n)) travel(g.n); });

  function say(e: WalkEvent) {
    if (e.kind === "enter") { drawWhere(); if (e.region.tier === "high-level") toast(`${icon("triangle-alert")} A wall of strong wild creatures lives in ${esc(e.region.name)}. Turn back until you're ready.`); }
    if (e.kind === "blocked" && performance.now() > toastUntil) {
      const near = e.region && neighbours(e.region).find((o) => o.tier === "playable" && !beaten.has(o.n) && openRegions(beaten).has(o.n));
      toast(e.why === "sea" ? "Open sea. The supercontinent ends here." : e.why === "soon" ? `${icon("lock")} ${esc(e.region!.name)} is coming soon.` : `${icon("lock")} The road to ${esc(e.region!.name)} opens when you win ${near ? `${esc(near.name)}'s` : "a neighbouring"} arena.`);
    }
    if (e.kind === "arena") hooks.arena(e.region);
    if (e.kind === "wild") hooks.wild(e.region);
  }
  function travel(n: number) { if (!openRegions(beaten).has(n)) return; Object.assign(me, spawn(n)); snap = true; drawWhere(); drawMap(); }

  return {
    show(c: Creature) {
      if (you) group.remove(you);
      you = creatureModel(c); group.add(you);
      speed = body(c).topSpeed * 1.6;
      scene.background = new THREE.Color(0xa8c8e8); scene.fog = new THREE.Fog(0xa8c8e8, 120, 520);
      camera.far = 900; camera.updateProjectionMatrix();
      group.visible = true; hud.hidden = false; snap = true;
      refresh(); drawWhere();
    },
    hide() { group.visible = false; hud.hidden = true; },
    get shown() { return group.visible; },
    /** One frame: WASD walks (relative to the camera), Shift runs, Q / E or the arrow keys turn the camera. */
    update(dt: number, keys: ReadonlySet<string>) {
      const on = (k: string) => keys.has(k);
      yaw += ((on("KeyE") || on("ArrowRight") ? 1 : 0) - (on("KeyQ") || on("ArrowLeft") ? 1 : 0)) * 1.8 * dt;
      const fwd = (on("KeyW") || on("ArrowUp") ? 1 : 0) - (on("KeyS") || on("ArrowDown") ? 1 : 0), side = (on("KeyD") ? 1 : 0) - (on("KeyA") ? 1 : 0);
      // yaw 0 looks north (-z).
      let mx = Math.sin(yaw) * fwd + Math.cos(yaw) * side, mz = -Math.cos(yaw) * fwd + Math.sin(yaw) * side;
      const n = Math.hypot(mx, mz);
      if (n > 0) {
        mx /= n; mz /= n; facing = Math.atan2(mz, mx);
        const v = speed * (on("ShiftLeft") || on("ShiftRight") ? 1.8 : 1) * dt;
        for (const e of walk(me, mx * v, mz * v, beaten)) say(e);
      }
      if (toastUntil && performance.now() > toastUntil) { toastEl.hidden = true; toastUntil = 0; }
      const y = Math.max(heightAt(w, me.x, me.z), -0.6);
      if (you) { you.position.set(me.x, y, me.z); you.rotation.y = -facing; }
      const want = new THREE.Vector3(me.x - Math.sin(yaw) * 16, y + 8, me.z + Math.cos(yaw) * 16);
      want.y = Math.max(want.y, heightAt(w, want.x, want.z) + 2);
      camera.position.lerp(want, snap ? 1 : clamp(dt * 5, 0, 1)); snap = false;
      camera.lookAt(me.x, y + 1.5, me.z);
      if (performance.now() > mapAt) { mapAt = performance.now() + 250; drawMap(); }
    },
    beat(n: number) { beaten.add(n); save(); refresh(); },
    /** Back from a fight. Lost: on your last arena's doorstep. */
    afterFight(won: boolean) { if (!won) sendHome(me); snap = true; drawWhere(); drawMap(); },
    travel,
    reset() { beaten.clear(); save(); travel(1); refresh(); },
    state: () => {
      const g = regionN(me.region), open = openRegions(beaten);
      return { region: g.n, name: g.name, tier: g.tier, x: +me.x.toFixed(1), z: +me.z.toFixed(1), beaten: [...beaten].sort((a, b) => a - b), open: [...open].sort((a, b) => a - b) };
    },
  };
}
export type WorldView = ReturnType<typeof worldView>;
