// The page: menu, the over-the-shoulder camera, mouse and keys, and the HUD.
// The game itself is src/sim/game.ts; this only draws it and feeds it input.

import * as THREE from "three";
import { loadRepoCached, LoadError, parseSlug } from "../levels/github.ts";
import { LEVELS, placeLevel, type LevelDef } from "../levels/levels.ts";
import { groundAt, parsePlace } from "../levels/place.ts";
import type { Block, RepoSnapshot } from "../sim/codemap.ts";
import { addWin, winKey } from "../sim/heads.ts";
import type { ZoneData } from "../sim/terrain.ts";
import { Game, scopeSway, SHIELD_DELAY, stanceOf, type GameEvent, type Input } from "../sim/game.ts";
import { briefing, missionFor, OVERRUN } from "../sim/missions.ts";
import { KEYS, keyLabel, ORDER, WEAPONS, type WeaponId } from "../sim/weapons.ts";
import { FIELD, place, play, VOICES } from "./audio.ts";
import { BUILDS, type BuildId } from "./figure.ts";
import { headById, headCanvas, HEADS, isOpen } from "./heads.ts";
import { buildWorld, type World } from "./scene.ts";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>("view");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
// A filmic curve keeps the orange flashes and lit ground from clipping flat.
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
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

let current: { def: LevelDef; repo: RepoSnapshot; game: Game; world: World; started: number } | null = null;
/** A repo loaded from GitHub to fight instead of each level's own. */
let chosen: RepoSnapshot | null = null;

/** Kept in the browser; a page that can't keep them just starts over each visit. */
const store = {
  get<T>(key: string, fallback: T): T {
    try { return (JSON.parse(localStorage.getItem(`git-recon:${key}`) ?? "null") as T) ?? fallback; } catch { return fallback; }
  },
  set(key: string, value: unknown) {
    try { localStorage.setItem(`git-recon:${key}`, JSON.stringify(value)); } catch {}
  },
};
let wins = store.get<string[]>("wins", []);

const list = $("levels");
for (const def of LEVELS) {
  const b = document.createElement("button");
  b.className = "level";
  b.innerHTML = `<b></b><span></span><code></code><em></em>`;
  b.querySelector("b")!.textContent = def.name;
  b.querySelector("span")!.textContent = def.blurb;
  b.querySelector("em")!.textContent = briefing(missionFor(def.id));
  b.querySelector("code")!.dataset.level = def.id;
  b.onclick = () => start(def);
  list.append(b);
}
function showRepo() {
  for (const code of list.querySelectorAll<HTMLElement>("code[data-level]")) {
    const r = chosen ?? LEVELS.find((l) => l.id === code.dataset.level)!.repo;
    code.textContent = `${r.name}@${r.ref}`;
  }
  $("repo-reset").hidden = !chosen;
}
showRepo();

/* ---------------- any repo ---------------- */

$("repo-form").onsubmit = async (e) => {
  e.preventDefault();
  const input = $<HTMLInputElement>("repo-slug"), status = $("repo-status"), go = $<HTMLButtonElement>("repo-load");
  const slug = parseSlug(input.value);
  status.classList.remove("err");
  if (!slug) return (status.textContent = "Type it as owner/repo, like oven-sh/bun"), status.classList.add("err");
  status.textContent = `Checking out ${slug} from GitHub…`, go.disabled = true;
  try {
    chosen = await loadRepoCached(slug);
    const f = chosen.failing?.length ? ` · ${chosen.failing.length} checks failing` : "";
    status.textContent = `${chosen.name}@${chosen.ref}: ${chosen.files.length} files, ${chosen.links?.length ?? 0} roads${f}. Pick a level.`;
    showRepo();
  } catch (err) {
    status.textContent = err instanceof LoadError ? err.message : `Couldn't reach GitHub (${(err as Error).message})`;
    status.classList.add("err");
  } finally {
    go.disabled = false;
  }
};
$("repo-reset").onclick = () => {
  chosen = null, $("repo-status").textContent = "", $<HTMLInputElement>("repo-slug").value = "";
  showRepo();
};


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

/* ---------------- your soldier ---------------- */

// Remembered in this browser; a blocked storage just means the defaults every time.
const saved = (k: string) => { try { return localStorage.getItem(`git-recon:${k}`); } catch { return null; } };
const save = (k: string, v: string) => { try { localStorage.setItem(`git-recon:${k}`, v); } catch {} };
const savedBuild = saved("build");
const me = {
  build: (savedBuild && savedBuild in BUILDS ? savedBuild : "average") as BuildId,
  head: headById(saved("head") ?? "ball"),
};
if (!isOpen(me.head, wins.length)) me.head = HEADS[0]!;

function radios<T>(box: HTMLElement, items: T[], label: (t: T) => string, fill: (b: HTMLButtonElement, t: T) => void, on: (t: T) => boolean, pick: (t: T) => void) {
  const draw = () => box.querySelectorAll("button").forEach((b, i) => b.setAttribute("aria-checked", String(on(items[i]!))));
  for (const t of items) {
    const b = document.createElement("button");
    b.setAttribute("role", "radio");
    b.title = label(t);
    fill(b, t);
    b.onclick = () => (pick(t), draw());
    box.append(b);
  }
  draw();
}
radios($("builds"), Object.keys(BUILDS) as BuildId[], (id) => BUILDS[id].name, (b, id) => (b.textContent = BUILDS[id].name), (id) => id === me.build, (id) => (me.build = id, save("build", id)));
/** The heads, toy ones greyed out until you've won enough levels; redrawn after a win. */
function showHeads() {
  const box = $("heads");
  box.innerHTML = "";
  radios(box, HEADS, (h) => isOpen(h, wins.length) ? (h.nod ? `${h.name}: a nod to ${h.nod}` : h.name) : `Locked: win ${h.wins! - wins.length} more ${h.wins! - wins.length === 1 ? "level" : "levels"}`,
    (b, h) => (b.append(headCanvas(h)), (b.disabled = !isOpen(h, wins.length))), (h) => h.id === me.head.id, (h) => (me.head = h, save("head", h.id)));
}
showHeads();

function start(def: LevelDef) {
  const mission = missionFor(def.id), repo = chosen ?? def.repo;
  const game = Game.fromRepo(def.ground(), repo, def.seed, mission);
  const world = buildWorld(game.map, { head: me.head, build: me.build });
  current = { def, repo, game, world, started: performance.now() };
  look.yaw = game.map.spawn.yaw, look.pitch = -0.05, prone = false, shake = 0, cam.ready = false;
  $("menu").hidden = true, $("results").hidden = true, $("hud").hidden = false;
  $("level-name").textContent = def.name;
  $("repo").textContent = `${repo.name}@${repo.ref}`;
  $("feed").innerHTML = "";
  feed(`checked out ${repo.name}. ${game.map.compounds.length} folders in conflict.`);
  const burning = game.map.compounds.filter((c) => c.burning);
  if (burning.length) feed(`checks failing: ${burning.map((c) => c.folder).join(", ")} on fire`, true);
  banner(briefing(mission));
  lock();
}

function toMenu() {
  current = null;
  document.exitPointerLock?.();
  $("menu").hidden = false, $("hud").hidden = true, $("results").hidden = true;
  showHeads();
}
$("again").onclick = () => current && start(current.def);
$("back").onclick = toMenu;

/* ---------------- input ---------------- */

const keys = new Set<string>();
const look = { yaw: 0, pitch: 0 };
let fire = false, zoom = false, jump = false, roll = false, prone = false, pick: WeaponId | undefined;
/** How hard the camera's shaking: blasts near you and heavy guns going off. */
let shake = 0;

window.addEventListener("keydown", (e) => {
  if (!current) return;
  keys.add(e.code);
  if (e.code === "Space") jump = true, prone = false, e.preventDefault();
  // Z drops you prone and gets you up again; crouching or jumping gets you up too.
  if (e.code === "KeyZ" && !e.repeat) prone = !prone;
  if (e.code === "KeyC" || e.code === "ControlLeft") prone = false;
  if (e.code === "ShiftLeft" || e.code === "ShiftRight") roll = true;
  const slot = KEYS.indexOf(e.code);
  if (slot >= 0 && slot < ORDER.length) pick = ORDER[slot];
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
function aimPoint(game: Game, world: World): { point: THREE.Vector3; block: Block | null } {
  camera.getWorldDirection(dir);
  ray.set(camera.position, dir);
  ray.far = 300;
  const hits = ray.intersectObjects(world.solids.slice(1), false);
  let best = hits[0] ? hits[0].distance : 300, block: Block | null = hits[0] ? (hits[0].object.userData.block as Block) : null;
  // The ground is a heightfield: march it rather than raycast its 100k triangles.
  for (let t = 1; t < best; t += 0.75) {
    tmp.copy(camera.position).addScaledVector(dir, t);
    if (tmp.y < game.terrain.height(tmp.x, tmp.z)) {
      best = t, block = null;
      break;
    }
  }
  return { point: camera.position.clone().addScaledVector(dir, best), block };
}

/**
 * The camera rides over your right shoulder. Aim turns it at once (a shooter's aim can't lag),
 * but where it sits eases after you: the body's height through a crouch or going prone, how
 * far back it pulls, and a dip when you land. The view widens in a dive-roll and while running,
 * and closes in down the scope.
 */
const cam = { ready: false, x: 0, y: 0, z: 0, height: 1.75, back: 5.2, fov: 64, dip: 0 };
function placeCamera(game: Game, dt: number) {
  const you = game.you();

  const sniping = zoom && you.weapon === "rebase";
  // Down the scope the sight wanders: less crouched, least lying down.
  const sw = sniping ? scopeSway(game.time, stanceOf(you)) : { yaw: 0, pitch: 0 };
  const yaw = look.yaw + sw.yaw, pitch = look.pitch + sw.pitch;
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const ease = (rate: number) => (cam.ready ? 1 - Math.exp(-rate * dt) : 1);
  const follow = ease(18);
  cam.x += (you.x - cam.x) * follow, cam.y += (you.y - cam.y) * ease(12), cam.z += (you.z - cam.z) * follow;
  cam.height += ((you.prone ? 0.75 : you.crouch ? 1.3 : 1.7) - cam.height) * ease(9);
  cam.back += ((sniping ? 0.4 : you.prone ? 4 : 5.2) - cam.back) * ease(sniping ? 30 : 8);
  if (cam.ready && !you.grounded && you.vy < -6) cam.dip = Math.min(0.35, cam.dip + dt * 0.8);
  cam.dip *= Math.exp(-dt * (you.grounded ? 6 : 0.5));
  const run = Math.min(1, Math.hypot(you.vx, you.vz) / 7.5);
  cam.fov += ((sniping ? 18 : 64 + (you.roll > 0 ? 8 : 0) + run * 4) - cam.fov) * ease(sniping ? 30 : 7);
  cam.ready = true;
  const side = sniping ? 0.35 : 1.1;
  const pivot = new THREE.Vector3(cam.x - fz * side, cam.y + cam.height - (you.grounded ? cam.dip : 0), cam.z + fx * side);
  const j = () => (Math.random() - 0.5) * shake;
  camera.position.set(pivot.x - fx * cp * cam.back + j(), pivot.y - sp * cam.back + 0.55 + j(), pivot.z - fz * cp * cam.back + j());
  // Never under the ground.
  const floor = game.terrain.height(camera.position.x, camera.position.z) + 0.4;
  if (camera.position.y < floor) camera.position.y = floor;
  camera.lookAt(pivot.x + fx * cp * 50, pivot.y + sp * 50, pivot.z + fz * cp * 50);
  if (Math.abs(camera.fov - cam.fov) > 0.01) camera.fov = cam.fov, camera.updateProjectionMatrix();
  $("crosshair").classList.toggle("scope", sniping);
}

/** An orange arc round the crosshair, pointing at whoever just hit you. */
function hitFrom(game: Game, by: number) {
  const you = game.you(), s = game.soldiers[by];
  if (!s || by === 0) return;
  // The bearing to them against where you look: 0 straight ahead, clockwise positive.
  const dx = s.x - you.x, dz = s.z - you.z;
  const a = Math.atan2(dx * Math.cos(look.yaw) - dz * Math.sin(look.yaw), -dx * Math.sin(look.yaw) - dz * Math.cos(look.yaw));
  const arc = document.createElement("i");
  arc.style.transform = `rotate(${a}rad)`;
  $("hits").append(arc);
  setTimeout(() => arc.remove(), 900);
}

/* ---------------- HUD ---------------- */

/** The crosshair flashes when you hit something, harder when it goes down. */
let markT = 0;
function mark(kind: "hit" | "kill") {
  const c = $("crosshair");
  if (kind === "hit" && c.classList.contains("kill")) return;
  c.classList.remove("hit", "kill");
  c.classList.add(kind);
  clearTimeout(markT);
  markT = window.setTimeout(() => c.classList.remove("hit", "kill"), kind === "kill" ? 260 : 90);
}

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

/** The mission's line in the top bar, and its tooltip. */
function objective(game: Game): [string, string] {
  const o = game.objective, merged = `${game.cleared.filter(Boolean).length} / ${game.cleared.length} merged`;
  if (o.kind === "carry") {
    // Carrying it: how far to HEAD. Not yet: how far to the commit.
    const you = game.you(), to = o.carried ? game.map.spawn : o, d = Math.round(Math.hypot(to.x - you.x, to.z - you.z));
    return [o.carried ? `carrying the commit · ${d} m to HEAD` : `the commit is ${d} m off`, "Bring the commit (the orange diamond) back to HEAD, the dashed ring where you started. Go down and you drop it."];
  }
  if (o.kind === "defend") {
    return [`main ${clock(Math.max(0, o.seconds - o.held))} · overrun ${Math.round((o.overrun / OVERRUN) * 100)}%`, "Hold main, the dashed ring where you started, until the clock runs down. Guards standing in it overwrite it."];
  }
  return [merged, "Down every guard in a compound to merge its folder. Merge them all to win."];
}

function hud(game: Game, aimingAt: Block | null) {
  const you = game.you();
  $("hp").style.width = `${(you.hp / you.maxHp) * 100}%`;
  $("hp").classList.toggle("low", you.hp < 35);
  $("shield").style.width = `${(you.shield / Math.max(1, you.maxShield)) * 100}%`;
  $("shield-bar").classList.toggle("down", you.shield <= 0);
  $("shield-bar").classList.toggle("charging", you.shield > 0 && you.shield < you.maxShield && you.shieldT >= SHIELD_DELAY);
  $("lives").textContent = "●".repeat(game.lives) + "○".repeat(Math.max(0, 3 - game.lives));
  const [line, tip] = objective(game);
  $("progress").textContent = line;
  $("progress").title = tip;
  $("clock").textContent = clock(game.time);
  $("stance").textContent = you.burn > 0 ? "on fire: roll!" : you.prone ? "prone" : you.crouch ? "crouched" : "";
  $("stance").classList.toggle("hot", you.burn > 0);
  // Weapons you have; git reset --hard only once you've found one.
  $("weapons").innerHTML = ORDER.map((w, i) => {
    const a = you.ammo[w];
    if (w === "reset" && a === 0) return "";
    return `<li class="${w === you.weapon ? "on" : ""}${a === 0 ? " out" : ""}"><kbd>${keyLabel(KEYS[i]!)}</kbd><code>${WEAPONS[w].cmd}</code><span>${a < 0 ? "∞" : a}</span></li>`;
  }).join("");
  // What's under the crosshair, and how much of it is left.
  $("target").textContent = aimingAt ? `${aimingAt.path} · ${aimingAt.lines.toLocaleString()} lines` : "";
}

function results(game: Game) {
  document.exitPointerLock?.();
  const won = game.status === "won";
  const o = game.objective, spare = `${game.lives} reflog ${game.lives === 1 ? "entry" : "entries"} to spare`;
  $("results-title").textContent = won ? "Merged." : "Merge failed.";
  $("results-body").textContent = won
    ? o.kind === "carry" ? `The commit made it to HEAD in ${clock(game.time)}, with ${spare}.`
      : o.kind === "defend" && o.held >= o.seconds ? `main held for ${clock(o.held)}, with ${spare}.`
      : `Every conflict in ${current!.repo.name} resolved in ${clock(game.time)}, with ${spare}.`
    : o.kind === "defend" && o.overrun >= OVERRUN ? `main was overwritten after ${clock(o.held)}.`
    : `Out of reflog. ${game.cleared.filter(Boolean).length} of ${game.cleared.length} folders merged in ${clock(game.time)}.`;
  if (won) {
    const got = addWin(wins, winKey(current!.def.id, current!.repo.name));
    wins = got.wins, store.set("wins", wins);
    if (got.head) $("results-body").textContent += ` Unlocked a head: ${got.head.name.toLowerCase()}.`;
  }
  $("results").hidden = false;
}

/* ---------------- sound ---------------- */

function sound(game: Game, e: GameEvent) {
  const you = game.you();
  const at = (x: number, z: number) => place(x - you.x, z - you.z, look.yaw);
  if (e.kind === "fire") {
    const s = game.soldiers[e.id]!, { vol, pan } = at(s.x, s.z);
    play(VOICES[e.weapon], vol, pan);
  } else if (e.kind === "boom") {
    const { vol, pan } = at(e.x, e.z);
    play(FIELD.boom, vol, pan);
  } else if (e.kind === "razed") {
    const { vol, pan } = at(e.x, e.z);
    play(FIELD.raze, vol, pan);
  } else if (e.kind === "pickup") play(FIELD.pickup);
  else if (e.kind === "hit" && e.target === 0) play(e.shield ? FIELD.shieldHit : FIELD.hurt);
  else if (e.kind === "shield" && e.id === 0) play(e.state === "broke" ? FIELD.shieldBroke : e.state === "charging" ? FIELD.shieldCharge : FIELD.shieldFull);
  else if (e.kind === "hit" && e.by === 0) play(FIELD.hitmark);
  else if (e.kind === "down") {
    if (e.by === 0 && e.id !== 0) play(FIELD.kill);
    const s = game.soldiers[e.id]!, { vol, pan } = at(s.x, s.z);
    play(FIELD.down, vol, pan);
  }
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
  placeCamera(game, dt);
  const aim = aimPoint(game, world);
  const input: Input = {
    forward: (keys.has("KeyW") ? 1 : 0) - (keys.has("KeyS") ? 1 : 0),
    right: (keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0),
    yaw: look.yaw,
    pitch: look.pitch,
    jump, roll, crouch: keys.has("KeyC") || keys.has("ControlLeft"), prone,
    scope: zoom,
    fire: fire && document.pointerLockElement === canvas,
    aim: { x: aim.point.x, y: aim.point.y, z: aim.point.z },
    weapon: pick,
  };
  // Automatic guns fire while held; everything else once per click.
  if (!WEAPONS[you.weapon].auto && fire) fire = false;
  jump = roll = false, pick = undefined;
  const before = game.status;
  shake *= Math.exp(-dt * 9);
  for (const e of game.step(dt, input)) {
    sound(game, e);
    world.event(game, e);
    if (e.kind === "fire" && e.id === 0) {
      // Recoil: the aim kicks up (less crouched, least prone) and a heavy gun shakes the view.
      const w = WEAPONS[e.weapon], k = you.prone ? 0.35 : you.crouch ? 0.65 : 1;
      look.pitch = Math.min(1.0, look.pitch + w.kick * k * (0.7 + Math.random() * 0.6));
      look.yaw += (Math.random() - 0.5) * w.kick * k * 0.5;
      shake = Math.max(shake, w.kick * 2.5);
    } else if (e.kind === "boom") {
      shake = Math.max(shake, Math.min(0.6, e.r * 0.1) * Math.max(0, 1 - Math.hypot(e.x - you.x, e.z - you.z) / 40));
    } else if (e.kind === "razed") {
      if (e.by === 0) feed(`deleted ${e.path} (${e.lines.toLocaleString()} lines)`);
    } else if (e.kind === "hit" && e.by === 0 && e.target !== 0) mark("hit");
    if (e.kind === "down" && e.by === 0 && e.id !== 0) mark("kill");
    if (e.kind === "boom" || e.kind === "razed" || e.kind === "fire" || (e.kind === "hit" && e.by === 0 && e.target !== 0)) continue;
    if (e.kind === "down" && e.id !== 0) feed(`resolved ${game.soldiers[e.id]!.name}`);
    else if (e.kind === "down") feed("you went down", true);
    else if (e.kind === "respawn") banner(`git reflog · ${e.lives} left`);
    else if (e.kind === "cleared") {
      const c = game.map.compounds[e.compound]!;
      banner(`${c.folder} merged`);
      feed(`merged ${c.folder}: crates in the yard`);
    } else if (e.kind === "pickup") feed(e.item === "health" ? "health crate: +40 hp" : e.item === "ammo" ? "ammo crate" : `found git reset --hard (${keyLabel(KEYS[ORDER.indexOf("reset")]!)})`, e.item === "reset");
    else if (e.kind === "blamed") feed(`blamed ${game.soldiers[e.id]!.name}`);
    else if (e.kind === "reverted") feed(`reverted ${game.soldiers[e.id]!.name}`);
    else if (e.kind === "objective") banner(e.text), feed(e.text, true);
    else if (e.kind === "hit" && e.target === 0) {
      hitFrom(game, e.by);
      if (!e.shield) $("hud").classList.add("hurt"), setTimeout(() => $("hud").classList.remove("hurt"), 120);
    } else if (e.kind === "shield" && e.id === 0 && e.state === "broke") feed("shield down", true);
  }
  world.sync(game, dt);
  hud(game, aim.block);
  renderer.render(world.scene, camera);
  if (before === "playing" && game.status !== "playing") results(game);
}
requestAnimationFrame(frame);

// In dev, the running game is on the page for poking at from the console: `__recon.current.game`.
if (import.meta.env.DEV) Object.assign(window, { __recon: { get current() { return current; }, look, cam } });
