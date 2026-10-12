// The page: menu, the over-the-shoulder camera, mouse and keys, and the HUD.
// The game itself is src/sim/game.ts; this only draws it and feeds it input.

import * as THREE from "three";
import { LEVELS, placeLevel, type LevelDef } from "../levels/levels.ts";
import { groundAt, parsePlace } from "../levels/place.ts";
import type { ZoneData } from "../sim/terrain.ts";
import { Game, MAX_HP, type Input } from "../sim/game.ts";
import { ORDER, WEAPONS, type WeaponId } from "../sim/weapons.ts";
import { buildWorld, type World } from "./scene.ts";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>("view");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 600);

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
window.addEventListener("resize", resize);
resize();

/** Captures the mouse; a page the browser won't lock (a background tab) just keeps playing without it. */
const lock = () => void Promise.resolve(canvas.requestPointerLock?.()).catch(() => {});

/* ---------------- menu ---------------- */

let current: { def: LevelDef; game: Game; world: World; started: number } | null = null;

const list = $("levels");
for (const def of LEVELS) {
  const b = document.createElement("button");
  b.className = "level";
  b.innerHTML = `<b></b><span></span><code></code>`;
  b.querySelector("b")!.textContent = def.name;
  b.querySelector("span")!.textContent = def.blurb;
  b.querySelector("code")!.textContent = `${def.repo.name}@${def.repo.ref}`;
  b.onclick = () => start(def);
  list.append(b);
}

// Any lat/long: the ground is read from AWS Terrain Tiles in the page, then kept
// in this browser so the same place loads instantly (and offline) next time.
const placeKey = (lat: number, lon: number) => `git-recon:ground:${lat.toFixed(4)},${lon.toFixed(4)}`;
async function groundFor(lat: number, lon: number): Promise<ZoneData> {
  try {
    const hit = localStorage.getItem(placeKey(lat, lon));
    if (hit) return JSON.parse(hit) as ZoneData;
  } catch {}
  const zone = await groundAt(lat, lon);
  try {
    localStorage.setItem(placeKey(lat, lon), JSON.stringify(zone));
  } catch {}
  return zone;
}

$("place").onsubmit = async (e) => {
  e.preventDefault();
  const status = $("place-status"), go = $<HTMLButtonElement>("place-go");
  const at = parsePlace($<HTMLInputElement>("place-at").value);
  status.classList.remove("bad");
  if (!at) {
    status.textContent = "Two numbers, like 36.0566, -112.1251.";
    status.classList.add("bad");
    return;
  }
  go.disabled = true, status.textContent = "Reading the ground (a few seconds the first time)…";
  try {
    const def = placeLevel(await groundFor(at.lat, at.lon));
    status.textContent = "";
    start(def);
  } catch (err) {
    status.textContent = err instanceof Error ? err.message : String(err);
    status.classList.add("bad");
  } finally {
    go.disabled = false;
  }
};

function start(def: LevelDef) {
  const game = Game.fromRepo(def.ground(), def.repo, def.seed);
  const world = buildWorld(game.map);
  current = { def, game, world, started: performance.now() };
  look.yaw = game.map.spawn.yaw, look.pitch = -0.05;
  $("menu").hidden = true, $("results").hidden = true, $("hud").hidden = false;
  $("level-name").textContent = def.name;
  $("repo").textContent = `${def.repo.name}@${def.repo.ref}`;
  $("feed").innerHTML = "";
  feed(`checked out ${def.repo.name}. ${game.map.compounds.length} folders in conflict.`);
  lock();
}

function toMenu() {
  current = null;
  document.exitPointerLock?.();
  $("menu").hidden = false, $("hud").hidden = true, $("results").hidden = true;
}
$("again").onclick = () => current && start(current.def);
$("back").onclick = toMenu;

/* ---------------- input ---------------- */

const keys = new Set<string>();
const look = { yaw: 0, pitch: 0 };
let fire = false, zoom = false, jump = false, roll = false, pick: WeaponId | undefined;

window.addEventListener("keydown", (e) => {
  if (!current) return;
  keys.add(e.code);
  if (e.code === "Space") jump = true, e.preventDefault();
  if (e.code === "ShiftLeft" || e.code === "ShiftRight") roll = true;
  const n = Number(e.key);
  if (n >= 1 && n <= ORDER.length) pick = ORDER[n - 1];
  if (e.code === "Escape" && current.game.status !== "playing") toMenu();
});
window.addEventListener("keyup", (e) => keys.delete(e.code));
window.addEventListener("blur", () => (keys.clear(), (fire = false)));
canvas.addEventListener("click", () => current && document.pointerLockElement !== canvas && lock());
canvas.addEventListener("mousedown", (e) => {
  if (document.pointerLockElement !== canvas) return;
  if (e.button === 0) fire = true;
  if (e.button === 2) zoom = true;
});
window.addEventListener("mouseup", (e) => {
  if (e.button === 0) fire = false;
  if (e.button === 2) zoom = false;
});
canvas.addEventListener("contextmenu", (e) => e.preventDefault());
window.addEventListener("mousemove", (e) => {
  if (document.pointerLockElement !== canvas) return;
  const k = zoom && current?.game.you().weapon === "rebase" ? 0.0007 : 0.0022;
  look.yaw -= e.movementX * k;
  look.pitch = Math.max(-1.2, Math.min(1.0, look.pitch - e.movementY * k));
});
window.addEventListener("wheel", (e) => {
  if (!current) return;
  const you = current.game.you(), have = ORDER.filter((w) => you.ammo[w] !== 0);
  const i = have.indexOf(you.weapon);
  pick = have[(i + (e.deltaY > 0 ? 1 : -1) + have.length) % have.length];
});
document.addEventListener("pointerlockchange", () => ($("clickme").hidden = document.pointerLockElement === canvas || !current));

/* ---------------- camera and aim ---------------- */

const ray = new THREE.Raycaster();
const tmp = new THREE.Vector3(), dir = new THREE.Vector3();

/** What the crosshair is on: the first block or ground along the camera's line. */
function aimPoint(game: Game, world: World): { point: THREE.Vector3; path: string | null } {
  camera.getWorldDirection(dir);
  ray.set(camera.position, dir);
  ray.far = 300;
  const hits = ray.intersectObjects(world.solids.slice(1), false);
  let best = hits[0] ? hits[0].distance : 300, path: string | null = hits[0] ? (hits[0].object.userData.path as string) : null;
  // The ground is a heightfield: march it rather than raycast its 100k triangles.
  for (let t = 1; t < best; t += 0.75) {
    tmp.copy(camera.position).addScaledVector(dir, t);
    if (tmp.y < game.terrain.height(tmp.x, tmp.z)) {
      best = t, path = null;
      break;
    }
  }
  return { point: camera.position.clone().addScaledVector(dir, best), path };
}

function placeCamera(game: Game) {
  const you = game.you();
  const fx = -Math.sin(look.yaw), fz = -Math.cos(look.yaw), cp = Math.cos(look.pitch), sp = Math.sin(look.pitch);
  const sniping = zoom && you.weapon === "rebase";
  const back = sniping ? 0.4 : 6, side = sniping ? 0.35 : 1.15;
  const pivot = new THREE.Vector3(you.x - fz * side, you.y + (you.crouch ? 1.3 : 1.75), you.z + fx * side);
  camera.position.set(pivot.x - fx * cp * back, pivot.y - sp * back + 0.9, pivot.z - fz * cp * back);
  // Never under the ground.
  const floor = game.terrain.height(camera.position.x, camera.position.z) + 0.4;
  if (camera.position.y < floor) camera.position.y = floor;
  camera.lookAt(pivot.x + fx * cp * 50, pivot.y + sp * 50, pivot.z + fz * cp * 50);
  const fov = sniping ? 18 : 62;
  if (camera.fov !== fov) camera.fov = fov, camera.updateProjectionMatrix();
  $("crosshair").classList.toggle("scope", sniping);
}

/* ---------------- HUD ---------------- */

function feed(text: string, hot = false) {
  const li = document.createElement("li");
  li.textContent = text;
  if (hot) li.className = "hot";
  const ul = $("feed");
  ul.prepend(li);
  while (ul.children.length > 5) ul.lastChild!.remove();
  setTimeout(() => li.classList.add("old"), 5000);
}

function banner(text: string) {
  const b = $("banner");
  b.textContent = text;
  b.classList.remove("show");
  void b.offsetWidth;
  b.classList.add("show");
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

function hud(game: Game, aimingAt: string | null) {
  const you = game.you();
  $("hp").style.width = `${(you.hp / MAX_HP) * 100}%`;
  $("hp").classList.toggle("low", you.hp < 35);
  $("lives").textContent = "●".repeat(game.lives) + "○".repeat(Math.max(0, 3 - game.lives));
  const merged = game.cleared.filter(Boolean).length;
  $("progress").textContent = `${merged} / ${game.cleared.length} merged`;
  $("clock").textContent = clock(game.time);
  $("weapons").innerHTML = ORDER.map((w, i) => {
    const a = you.ammo[w];
    return `<li class="${w === you.weapon ? "on" : ""}${a === 0 ? " out" : ""}"><kbd>${i + 1}</kbd><code>${WEAPONS[w].cmd}</code><span>${a < 0 ? "∞" : a}</span></li>`;
  }).join("");
  $("target").textContent = aimingAt ?? "";
}

function results(game: Game) {
  document.exitPointerLock?.();
  const won = game.status === "won";
  $("results-title").textContent = won ? "Merged." : "Merge failed.";
  $("results-body").textContent = won
    ? `Every conflict in ${current!.def.repo.name} resolved in ${clock(game.time)}, with ${game.lives} reflog ${game.lives === 1 ? "entry" : "entries"} to spare.`
    : `Out of reflog. ${game.cleared.filter(Boolean).length} of ${game.cleared.length} folders merged in ${clock(game.time)}.`;
  $("results").hidden = false;
}

/* ---------------- loop ---------------- */

let last = performance.now();
function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!current) return;
  const { game, world } = current;
  const you = game.you();
  placeCamera(game);
  const aim = aimPoint(game, world);
  const input: Input = {
    forward: (keys.has("KeyW") ? 1 : 0) - (keys.has("KeyS") ? 1 : 0),
    right: (keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0),
    yaw: look.yaw,
    pitch: look.pitch,
    jump, roll, crouch: keys.has("KeyC") || keys.has("ControlLeft"),
    // The commit rifle fires while held; everything else once per click.
    fire: fire && document.pointerLockElement === canvas,
    aim: { x: aim.point.x, y: aim.point.y, z: aim.point.z },
    weapon: pick,
  };
  if (you.weapon !== "commit" && fire) fire = false;
  jump = roll = false, pick = undefined;
  const before = game.status;
  for (const e of game.step(dt, input)) {
    if (e.kind === "boom") world.boom(e.x, e.y, e.z, e.r);
    else if (e.kind === "down" && e.id !== 0) feed(`resolved ${game.soldiers[e.id]!.name}`);
    else if (e.kind === "down") feed("you went down", true);
    else if (e.kind === "respawn") banner(`git reflog · ${e.lives} left`);
    else if (e.kind === "cleared") {
      const c = game.map.compounds[e.compound]!;
      banner(`${c.folder} merged`);
      feed(`merged ${c.folder}: +40 hp, more ammo`);
    } else if (e.kind === "hit" && e.target === 0) $("hud").classList.add("hurt"), setTimeout(() => $("hud").classList.remove("hurt"), 120);
  }
  world.sync(game.soldiers, game.shots, game.cleared, dt);
  hud(game, aim.path);
  renderer.render(world.scene, camera);
  if (before === "playing" && game.status !== "playing") results(game);
}
requestAnimationFrame(frame);
