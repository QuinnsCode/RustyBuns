// The page: menu, the over-the-shoulder camera, mouse and keys, and the HUD.
// The game itself is src/sim/game.ts; this only draws it and feeds it input.

import * as THREE from "three";
import { loadRepoCached, LoadError, parseSlug } from "../levels/github.ts";
import { LEVELS, type LevelDef } from "../levels/levels.ts";
import type { RepoSnapshot } from "../sim/codemap.ts";
import { addWin, HEADS, unlocked, winKey } from "../sim/heads.ts";
import { Game, scopeSway, stanceOf, type GameEvent, type Input } from "../sim/game.ts";
import { briefing, missionFor, OVERRUN } from "../sim/missions.ts";
import { ORDER, WEAPONS, type WeaponId } from "../sim/weapons.ts";
import { FIELD, place, play, VOICES } from "./audio.ts";
import { headThumbs } from "./characters.ts";
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
let head = store.get<string | null>("head", null);

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

/* ---------------- heads ---------------- */

const thumbs = headThumbs(HEADS.map((h) => h.id));
function showHeads() {
  const open = new Set(unlocked(wins).map((h) => h.id)), row = $("heads");
  if (head && !open.has(head)) head = null;
  row.innerHTML = "";
  const plain = document.createElement("button");
  plain.className = `plain${head === null ? " on" : ""}`, plain.title = "The black pillar", plain.innerHTML = "<i></i>";
  plain.onclick = () => ((head = null), store.set("head", head), showHeads());
  row.append(plain);
  HEADS.forEach((h, i) => {
    const b = document.createElement("button"), img = document.createElement("img");
    img.src = thumbs.get(h.id) ?? "", img.alt = "";
    b.append(img);
    b.className = head === h.id ? "on" : "";
    b.disabled = !open.has(h.id);
    b.title = open.has(h.id) ? `${h.name}: a nod to ${h.nod}` : `Locked: win ${i + 1 - open.size} more ${i + 1 - open.size === 1 ? "level" : "levels"}`;
    b.onclick = () => ((head = h.id), store.set("head", head), showHeads());
    row.append(b);
  });
}
showHeads();

function start(def: LevelDef) {
  const mission = missionFor(def.id), repo = chosen ?? def.repo;
  const game = Game.fromRepo(def.ground(), repo, def.seed, mission);
  const world = buildWorld(game.map, head);
  current = { def, repo, game, world, started: performance.now() };
  look.yaw = game.map.spawn.yaw, look.pitch = -0.05, prone = false;
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

window.addEventListener("keydown", (e) => {
  if (!current) return;
  keys.add(e.code);
  if (e.code === "Space") jump = true, prone = false, e.preventDefault();
  // Z drops you prone and gets you up again; crouching or jumping gets you up too.
  if (e.code === "KeyZ" && !e.repeat) prone = !prone;
  if (e.code === "KeyC" || e.code === "ControlLeft") prone = false;
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

  const sniping = zoom && you.weapon === "rebase";
  // Down the scope the sight wanders: less crouched, least lying down.
  const sw = sniping ? scopeSway(game.time, stanceOf(you)) : { yaw: 0, pitch: 0 };
  const yaw = look.yaw + sw.yaw, pitch = look.pitch + sw.pitch;
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const back = sniping ? 0.4 : 6, side = sniping ? 0.35 : 1.15;
  const pivot = new THREE.Vector3(you.x - fz * side, you.y + (you.prone ? 0.7 : you.crouch ? 1.3 : 1.75), you.z + fx * side);
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

function hud(game: Game, aimingAt: string | null) {
  const you = game.you();
  $("hp").style.width = `${(you.hp / you.maxHp) * 100}%`;
  $("hp").classList.toggle("low", you.hp < 35);
  $("lives").textContent = "●".repeat(game.lives) + "○".repeat(Math.max(0, 3 - game.lives));
  const [line, tip] = objective(game);
  $("progress").textContent = line;
  $("progress").title = tip;
  $("clock").textContent = clock(game.time);
  $("stance").textContent = you.prone ? "prone" : you.crouch ? "crouched" : "";
  // Weapons you have; git reset --hard only once you've found one.
  $("weapons").innerHTML = ORDER.map((w, i) => {
    const a = you.ammo[w];
    if (w === "reset" && a === 0) return "";
    return `<li class="${w === you.weapon ? "on" : ""}${a === 0 ? " out" : ""}"><kbd>${i + 1}</kbd><code>${WEAPONS[w].cmd}</code><span>${a < 0 ? "∞" : a}</span></li>`;
  }).join("");
  $("target").textContent = aimingAt ?? "";
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
  } else if (e.kind === "pickup") play(FIELD.pickup);
  else if (e.kind === "hit" && e.target === 0) play(FIELD.hurt);
  else if (e.kind === "down") {
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
  placeCamera(game);
  const aim = aimPoint(game, world);
  const input: Input = {
    forward: (keys.has("KeyW") ? 1 : 0) - (keys.has("KeyS") ? 1 : 0),
    right: (keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0),
    yaw: look.yaw,
    pitch: look.pitch,
    jump, roll, crouch: keys.has("KeyC") || keys.has("ControlLeft"), prone,
    scope: zoom,
    // The commit rifle fires while held; everything else once per click.
    fire: fire && document.pointerLockElement === canvas,
    aim: { x: aim.point.x, y: aim.point.y, z: aim.point.z },
    weapon: pick,
  };
  if (you.weapon !== "commit" && fire) fire = false;
  jump = roll = false, pick = undefined;
  const before = game.status;
  for (const e of game.step(dt, input)) {
    sound(game, e);
    if (e.kind === "boom") world.boom(e.x, e.y, e.z, e.r);
    else if (e.kind === "down" && e.id !== 0) feed(`resolved ${game.soldiers[e.id]!.name}`);
    else if (e.kind === "down") feed("you went down", true);
    else if (e.kind === "respawn") banner(`git reflog · ${e.lives} left`);
    else if (e.kind === "cleared") {
      const c = game.map.compounds[e.compound]!;
      banner(`${c.folder} merged`);
      feed(`merged ${c.folder}: crates in the yard`);
    } else if (e.kind === "pickup") feed(e.item === "health" ? "health crate: +40 hp" : e.item === "ammo" ? "ammo crate" : "found git reset --hard (9)", e.item === "reset");
    else if (e.kind === "blamed") feed(`blamed ${game.soldiers[e.id]!.name}`);
    else if (e.kind === "reverted") feed(`reverted ${game.soldiers[e.id]!.name}`);
    else if (e.kind === "objective") banner(e.text), feed(e.text, true);
    else if (e.kind === "hit" && e.target === 0) $("hud").classList.add("hurt"), setTimeout(() => $("hud").classList.remove("hurt"), 120);
  }
  world.sync(game, dt);
  hud(game, aim.path);
  renderer.render(world.scene, camera);
  if (before === "playing" && game.status !== "playing") results(game);
}
requestAnimationFrame(frame);
