// The page: menu, the over-the-shoulder camera, mouse and keys, and the HUD.
// The game itself is src/sim/game.ts; this only draws it and feeds it input.
// In a battle the game runs in a world (src/net/world.ts) and this draws the page's
// mirror of it (src/net/mirror.ts), sending the same input over the socket.

import * as THREE from "three";
import { loadRepoCached, LoadError, parseSlug } from "../levels/github.ts";
import { LEVELS, placeLevel, type LevelDef } from "../levels/levels.ts";
import { groundAt, parsePlace } from "../levels/place.ts";
import type { Block, RepoSnapshot } from "../sim/codemap.ts";
import { addWin, winKey } from "../sim/heads.ts";
import type { ZoneData } from "../sim/terrain.ts";
import { BATTLE_SECONDS, FFA_SCORE, Game, scopeSway, SHIELD_DELAY, stanceOf, TEAM_SCORE, type GameEvent, type Input, type Mode } from "../sim/game.ts";
import { Mirror } from "../net/mirror.ts";
import { levelOf, NEXT_ROUND } from "../net/room.ts";
import type { FromWorld, RosterEntry } from "../net/wire.ts";
import { briefing, missionFor, OVERRUN } from "../sim/missions.ts";
import { KEYS, keyLabel, WEAPONS, type WeaponId } from "../sim/weapons.ts";
import { isRole, nextRole, ROLE_ORDER, ROLES, type RoleId } from "../sim/roles.ts";
import { STREAKS, VEHICLES, vehicleName } from "../sim/vehicles.ts";
import { weaponIcon } from "./icons.ts";
import { FIELD, place, play, VOICES } from "./audio.ts";
import { BUILDS, type BuildId } from "./figure.ts";
import { Battle } from "./net.ts";
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

/** A battle being played: its socket, the page's mirror of it, and the LAN address and passphrase if this machine hosts it. */
interface Net { battle: Battle; mirror: Mirror; hosting: string | null; roster: RosterEntry[] }
let current: { def: LevelDef; repo: RepoSnapshot; game: Game; world: World; started: number; net?: Net; ended?: boolean } | null = null;
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
const savedBuild = saved("build"), savedRole = saved("role");
const me = {
  build: (savedBuild && savedBuild in BUILDS ? savedBuild : "average") as BuildId,
  head: headById(saved("head") ?? "ball"),
  /** What you'll carry next round: set on the menu, the results screen, or with N mid-fight for your next life. */
  role: (isRole(savedRole) ? savedRole : "committer") as RoleId,
};
const pickRole = (r: RoleId) => {
  me.role = r, save("role", r);
  if (current && current.game.status === "playing") current.game.nextRole = r === current.game.role ? null : r;
  drawRoles();
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

/** The role pickers, on the menu and the results screen: one button per role, its kit as the tooltip. */
function drawRoles() {
  for (const box of [$("roles"), $("results-roles")]) {
    box.innerHTML = "";
    radios(box, ROLE_ORDER, (r) => `${ROLES[r].name}: ${ROLES[r].blurb}`, (b, r) => (b.textContent = ROLES[r].name), (r) => r === me.role, pickRole);
  }
}
drawRoles();

function start(def: LevelDef) {
  const mission = missionFor(def.id), repo = chosen ?? def.repo;
  const game = Game.fromRepo(def.ground(), repo, def.seed, mission, undefined, me.role);
  begin(def, repo, game, briefing(mission));
}

/** Into a level: the scene, the camera behind you, the HUD. On your own or in a battle (net). */
function begin(def: LevelDef, repo: RepoSnapshot, game: Game, brief: string, net?: Net) {
  const world = buildWorld(game.map, { head: me.head, build: me.build }, repo.text);
  current = { def, repo, game, world, started: performance.now(), net };
  if (net) showLooks(net);
  const you = game.you();
  look.yaw = you.yaw, look.pitch = -0.05, prone = false, shake = 0, cam.ready = false;
  $("menu").hidden = true, $("results").hidden = true, $("hud").hidden = false;
  $("level-name").textContent = def.name;
  $("repo").textContent = `${repo.name}@${repo.ref}`;
  $("hosting").hidden = !net?.hosting;
  $("hosting").textContent = net?.hosting ? `join: ${net.hosting}` : "";
  $("again").hidden = !!net;
  $("clickme").textContent = net ? "Click to aim · Q to leave the battle" : "Click to aim · Esc to let go of the mouse";
  $("feed").innerHTML = "";
  feed(`checked out ${repo.name}. ${game.map.compounds.length} folders in conflict.`);
  const burning = game.map.compounds.filter((c) => c.burning);
  if (burning.length) feed(`checks failing: ${burning.map((c) => c.folder).join(", ")} on fire`, true);
  banner(brief);
  lock();
}

function toMenu() {
  const net = current?.net;
  current = null;
  if (net) leaveBattle(net);
  document.exitPointerLock?.();
  $("menu").hidden = false, $("hud").hidden = true, $("results").hidden = true, $("board").hidden = true;
  showHeads();
}
$("again").onclick = () => current && start(current.def);
$("back").onclick = toMenu;

/* ---------------- battles ---------------- */

/** What the host this page runs on says about itself: the desktop app is "git-recon", a plain web page has none, online (src/edge/worker.ts) says so. */
let info: { app?: string; version?: string; online?: boolean } | null = null;
void fetch("/__rb/info").then((r) => (r.ok ? r.json() : null)).then((i) => (info = i, i?.online && goOnline())).catch(() => {});

// No 0/O or 1/I, so a code read out loud comes out right.
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const roomCode = () => Array.from(crypto.getRandomValues(new Uint32Array(6)), (n) => CODE_CHARS[n % CODE_CHARS.length]).join("");

/** Online, a battle is a room code: Host makes one, Join takes one (or ?room= from a friend's link). */
function goOnline() {
  $("battle-label").textContent = "Battle: many players in one repo, online";
  $("battle-host").title = "Open a battle on this level and repo, with a code to send friends";
  $("battle-join").title = "Join a friend's battle by its code";
  const code = $<HTMLInputElement>("battle-addr");
  code.placeholder = "Room code", code.setAttribute("aria-label", "The battle's room code");
  code.value = new URLSearchParams(location.search).get("room")?.toUpperCase() ?? "";
  $("battle-pass").hidden = true;
}
const roomLink = (room: string) => `${location.origin}${location.pathname}?room=${room}`;

const MODES: { id: Mode; name: string; tip: string }[] = [
  { id: "coop", name: "Side by side", tip: "Everyone against the guards, on the level's mission" },
  { id: "ffa", name: "Free-for-all", tip: `Every player for themselves; first to ${FFA_SCORE} downs` },
  { id: "teams", name: "Teams", tip: `Ours against theirs, with the guards against both; first side to ${TEAM_SCORE} downs` },
];
let mode: Mode = store.get<Mode>("mode", "ffa");
radios($("battle-mode"), MODES, (m) => m.tip, (b, m) => (b.textContent = m.name), (m) => m.id === mode, (m) => (mode = m.id, store.set("mode", m.id)));
const levelPick = $<HTMLSelectElement>("battle-level");
for (const l of LEVELS) levelPick.add(new Option(l.name, l.id));
// Anywhere: the lat/long in the box above, its ground read here and sent with the setup.
levelPick.add(new Option("Anywhere (the lat/long above)", "place"));
levelPick.value = store.get("battle-level", LEVELS[0]!.id);
levelPick.onchange = () => store.set("battle-level", levelPick.value);
const nameBox = $<HTMLInputElement>("battle-name");
nameBox.value = store.get("name", "");
const myName = () => (store.set("name", nameBox.value.trim()), nameBox.value.trim() || "soldier");
$<HTMLInputElement>("battle-addr").value = store.get("addr", "");

function battleStatus(text: string, bad = false) {
  $("battle-status").textContent = text;
  $("battle-status").classList.toggle("bad", bad);
}

// The host wants a passphrase of 12 characters or more off this machine: three git words.
const WORDS = ["commit", "rebase", "cherry", "stash", "merge", "branch", "fetch", "blame", "squash", "revert", "tag", "remote", "origin", "reflog", "bisect", "worktree"];
const passphrase = () => Array.from(crypto.getRandomValues(new Uint32Array(3)), (n) => WORDS[n % WORDS.length]).join("-");

/** One player id per tab, kept across a reload so it rejoins as the same player: two tabs are two players. */
function tabId(): string {
  try {
    const have = sessionStorage.getItem("git-recon:uid");
    if (have) return have;
    const id = crypto.randomUUID().replace(/-/g, "");
    sessionStorage.setItem("git-recon:uid", id);
    return id;
  } catch { return crypto.randomUUID().replace(/-/g, ""); }
}

/** Your look and name for the world, on the socket's query. */
const who = () => ({ uid: tabId(), name: myName(), head: me.head.id, build: me.build });

/** The level picked for a battle, and a lat/long one's ground; throws with what to fix. */
async function battleLevel(): Promise<{ def: LevelDef; zone?: ZoneData }> {
  const def = LEVELS.find((l) => l.id === levelPick.value);
  if (def) return { def };
  const at = parsePlace($<HTMLInputElement>("place-at").value);
  if (!at) throw new Error("Put a latitude, longitude in the box above, like 36.0566, -112.1251.");
  battleStatus("Reading the ground (a few seconds the first time)…");
  const zone = await groundFor(at.lat, at.lon);
  return { def: placeLevel(zone), zone };
}

$("battle-host").onclick = async () => {
  battleStatus("");
  let picked: Awaited<ReturnType<typeof battleLevel>>;
  try {
    picked = await battleLevel();
  } catch (err) {
    return battleStatus(err instanceof Error ? err.message : String(err), true);
  }
  const { def, zone } = picked;
  let hosting: string | null = null;
  if (info?.online) {
    const room = roomCode();
    history.replaceState(null, "", `?room=${room}`);
    const b = new Battle("host", "/ws", { ...who(), room });
    b.setup({ level: def.id, mode, repo: chosen ?? def.repo });
    return connect(b, `${room} · ${roomLink(room)}`);
  }
  try {
    // The desktop app opens its world to the LAN; a dev page (scripts/battle.ts behind Vite) just uses it.
    if (info?.app === "git-recon") {
      const pass = passphrase();
      const res = await fetch("/__rb/host", { method: "POST", body: JSON.stringify({ listen: { hostname: "0.0.0.0" }, join: pass }) });
      if (!res.ok) throw new Error(`the host said ${res.status}`);
      const lan = await fetch("/api/lan").then((r) => r.json()) as { addresses: string[]; port: number };
      hosting = `${lan.addresses[0] ?? "this machine"}:${lan.port} · ${pass}`;
    }
  } catch (err) {
    return battleStatus(`Couldn't open a battle to the LAN: ${(err as Error).message}`, true);
  }
  const b = new Battle("host", "/ws", who());
  b.setup({ level: def.id, mode, repo: chosen ?? def.repo, ...(zone ? { zone } : {}) });
  connect(b, hosting);
};

$("battle").onsubmit = (e) => {
  e.preventDefault();
  battleStatus("");
  const addr = $<HTMLInputElement>("battle-addr").value.trim().replace(/^\w+:\/\//, "").replace(/\/.*$/, "");
  if (info?.online) {
    const room = addr.toUpperCase();
    if (!/^[A-Z0-9]{4,8}$/.test(room)) return battleStatus("Type the room code your friend sent, like K7QX2M.", true);
    history.replaceState(null, "", `?room=${room}`);
    return connect(new Battle("guest", "/ws", { ...who(), room }), null);
  }
  store.set("addr", addr);
  // No address: this machine's own battle (a second tab, or back into the one you host).
  if (!addr) return connect(new Battle("host", "/ws", who()), null);
  if (!/^[\w.-]+:\d+$/.test(addr)) return battleStatus("Use the host's address and port, like 192.168.1.20:41234.", true);
  connect(new Battle("guest", `http://${addr}/ws`, { ...who(), join: $<HTMLInputElement>("battle-pass").value.trim(), v: info?.version }), null);
};

function connect(b: Battle, hosting: string | null) {
  battleStatus("Connecting…");
  b.onMessage = (m: FromWorld) => {
    if (m.t === "wait") return battleStatus("In. Waiting for the host to pick the battle…");
    if (m.t === "welcome") {
      // A new round is a new welcome: a fresh mirror and scene, the same socket.
      const def = levelOf(m.setup), mirror = new Mirror(m);
      const brief = m.setup.mode === "coop" ? briefing(missionFor(def.id)) : MODES.find((x) => x.id === m.setup.mode)!.tip;
      battleStatus("");
      return begin(def, m.setup.repo, mirror.game, brief, { battle: b, mirror, hosting, roster: mirror.roster });
    }
    if (current?.net?.battle === b) current.net.mirror.apply(m);
  };
  b.onClose = (err) => {
    if (current?.net?.battle === b) toMenu();
    else leaveBattle({ battle: b, hosting } as Net);
    battleStatus(err ?? "", !!err);
  };
}

function leaveBattle(net: Net) {
  net.battle.close();
  if (net.hosting && !info?.online) void fetch("/__rb/host", { method: "POST", body: JSON.stringify({ join: null, listen: { hostname: "127.0.0.1" } }) }).catch(() => {});
}

/** Each player's head and build on their soldier. */
function showLooks(net: Net) {
  if (!current) return;
  current.world.looks.clear();
  for (const r of net.mirror.roster) current.world.looks.set(r.id, { head: headById(r.look.head), build: (r.look.build in BUILDS ? r.look.build : "average") as BuildId });
  net.roster = net.mirror.roster;
}

/** The scoreboard, while Tab is down. */
function board(game: Game, net: Net) {
  const rows = [...net.mirror.roster].sort((a, b) => b.score - a.score || a.deaths - b.deaths);
  const t = $("board");
  // Past 32 a board at full size runs off the screen.
  t.classList.toggle("long", rows.length > 32);
  t.innerHTML = "<tr><th>soldier</th><th></th><th>downed</th><th>went down</th></tr>";
  for (const r of rows) {
    const tr = document.createElement("tr");
    tr.className = `${r.team}${r.id === game.me ? " me" : ""}`;
    for (const v of [r.name, r.team === "you" ? "" : r.team, r.score, r.deaths]) tr.insertCell().textContent = String(v);
    t.append(tr);
  }
}

/* ---------------- input ---------------- */

const keys = new Set<string>();
const look = { yaw: 0, pitch: 0 };
let fire = false, zoom = false, jump = false, roll = false, prone = false, reload = false, use = false, pick: WeaponId | undefined;
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
  // The number keys pick from what your role carries, in its order.
  const slot = KEYS.indexOf(e.code), kit = current.game.you().kit;
  if (slot >= 0 && slot < kit.length) pick = kit[slot];
  if (e.code === "KeyR" && !e.repeat) reload = true;
  if (e.code === "KeyE" && !e.repeat) use = true;
  if (e.code === "KeyN" && !e.repeat && !current.net && current.game.status === "playing") pickRole(nextRole(current.game.nextRole ?? current.game.role ?? me.role));
  if (e.code === "Escape" && current.game.status !== "playing") toMenu();
  // Out of a battle: Q, once the mouse is let go.
  if (e.code === "KeyQ" && current.net && document.pointerLockElement !== canvas) toMenu();
  if (e.code === "Tab" && current.net) e.preventDefault(), ($("board").hidden = false);
});
window.addEventListener("keyup", (e) => {
  keys.delete(e.code);
  if (e.code === "Tab") $("board").hidden = true;
});
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
  const you = current.game.you(), have = you.kit.filter((w) => you.ammo[w] !== 0);
  const i = have.indexOf(you.weapon);
  pick = have[(i + (e.deltaY > 0 ? 1 : -1) + have.length) % have.length];
});
document.addEventListener("pointerlockchange", () => {
  $("clickme").hidden = document.pointerLockElement === canvas || !current;
  $("clickme").textContent = current?.net ? "Click to aim · Q to leave the battle" : "Click to aim · Esc to let go of the mouse";
});

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
  // In a vehicle the camera sits higher and further back, so you see it and round it.
  const ride = game.vehicles.find((v) => v.id === you.vehicle);
  cam.height += ((ride ? (ride.kind === "heli" ? 3.2 : 2.2) : you.prone ? 0.75 : you.crouch ? 1.3 : 1.7) - cam.height) * ease(9);
  cam.back += ((ride ? (ride.kind === "heli" ? 13 : 8.5) : sniping ? 0.4 : you.prone ? 4 : 5.2) - cam.back) * ease(sniping ? 30 : 8);
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
  if (!s || by === game.me) return;
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
  if (game.mode === "ffa") {
    const top = Math.max(0, ...game.players().map((p) => p.score));
    return [`you ${game.you().score} · top ${top} · to ${FFA_SCORE}`, `Every player for themselves. First to ${FFA_SCORE} downs, or the most when the clock runs out.`];
  }
  if (game.mode === "teams") {
    return [`ours ${game.teamScore("ours")} · theirs ${game.teamScore("theirs")} · to ${TEAM_SCORE}`, `You're ${game.you().team}. First side to ${TEAM_SCORE} downs, or the most when the clock runs out. The guards fight both.`];
  }
  const o = game.objective, merged = `${game.cleared.filter(Boolean).length} / ${game.cleared.length} merged`;
  if (o.kind === "carry") {
    // Carrying it: how far to HEAD. Not yet: how far to the commit.
    const you = game.you(), to = o.carried && o.by === you.id ? game.map.spawn : o, d = Math.round(Math.hypot(to.x - you.x, to.z - you.z));
    return [o.carried && o.by === you.id ? `carrying the commit · ${d} m to HEAD` : o.carried ? `${game.soldiers[o.by]?.name ?? "someone"} has the commit` : `the commit is ${d} m off`, "Bring the commit (the orange diamond) back to HEAD, the dashed ring where you started. Go down and you drop it."];
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
  if (game.mode) {
    // A battle has no reflog to spend: what you've downed, and how often you've gone down.
    $("lives").textContent = `${you.score} · ${you.deaths}`;
    $("lives").title = "Players you've downed · times you went down";
  } else $("lives").textContent = "●".repeat(game.lives) + "○".repeat(Math.max(0, 3 - game.lives));
  const [line, tip] = objective(game);
  $("progress").textContent = line;
  $("progress").title = tip;
  // A battle won on downs counts down.
  $("clock").textContent = clock(game.mode && game.mode !== "coop" ? Math.max(0, BATTLE_SECONDS - game.time) : game.time);
  const ride = game.vehicles.find((v) => v.id === you.vehicle), near = !ride && you.alive ? game.boardable(you) : null;
  $("stance").textContent = game.mode && !you.alive ? "down: back in a moment" : ride ? `${vehicleName(ride.kind)} ${Math.ceil((ride.hp / ride.maxHp) * 100)}%` : you.burn > 0 ? "on fire: roll!" : you.reload > 0 ? "reloading" : you.prone ? "prone" : you.crouch ? "crouched" : "";
  $("stance").classList.toggle("hot", you.burn > 0 || (!!ride && ride.hp < ride.maxHp * 0.3));
  $("prompt").textContent = near ? `E · get in the ${vehicleName(near.kind)}` : ride ? `E · get out${ride.kind === "heli" ? " · Space up · C down · right click rockets" : ""}` : "";
  // Kills, and what the next streak brings.
  const next = STREAKS.find((st) => st.kills > game.kills);
  $("kills").textContent = `${game.kills} kills${next ? ` · ${vehicleName(next.kind)} at ${next.kills}` : ""}`;
  const role = game.role ? ROLES[game.role].name : "", after = game.nextRole ? ROLES[game.nextRole].name : "";
  $("role").textContent = after ? `${role} · next life: ${after}` : role;
  $("role").title = "N picks your role for your next life";
  // What you carry: the magazine and what's left in all. In a vehicle, its guns. Every one is
  // git, so a row is its drawing and the command without "git".
  const row = (w: WeaponId) => `${weaponIcon(w)}<code>${WEAPONS[w].cmd.replace(/^git /, "")}</code>`;
  if (ride) {
    const spec = VEHICLES[ride.kind];
    $("weapons").innerHTML = `<li class="on"><kbd title="click">L</kbd>${row(spec.gun)}<span>∞</span></li>` +
      (spec.rockets ? `<li class="on"><kbd title="right click">R</kbd>${row(spec.rockets)}<span>∞</span></li>` : "");
  } else {
    $("weapons").innerHTML = you.kit.map((w, i) => {
      const a = you.ammo[w], l = you.loaded[w];
      return `<li class="${w === you.weapon ? "on" : ""}${a === 0 ? " out" : ""}"><kbd>${KEYS[i] ? keyLabel(KEYS[i]) : ""}</kbd>${row(w)}<span>${l}<small>/${a < 0 ? "∞" : a}</small></span></li>`;
    }).join("");
  }
  // The crosshair rings round while a magazine goes in.
  const c = $("crosshair");
  c.classList.toggle("reloading", you.reload > 0);
  c.style.setProperty("--reload", `${you.reload > 0 ? 1 - you.reload / WEAPONS[you.weapon].reload : 0}`);
  // What's under the crosshair, and how much of it is left.
  $("target").textContent = aimingAt ? `${aimingAt.path} · ${aimingAt.lines.toLocaleString()} lines` : "";
}

function results(game: Game) {
  document.exitPointerLock?.();
  if (game.mode && game.mode !== "coop") {
    const you = game.you(), mine = game.mode === "teams" ? game.winner === you.team : game.winner === you.name;
    $("results-title").textContent = !game.winner ? "A draw." : mine ? "Merged." : `${game.winner} merged.`;
    $("results-body").textContent = `${game.mode === "teams" ? `Ours ${game.teamScore("ours")}, theirs ${game.teamScore("theirs")}. ` : ""}You downed ${you.score} and went down ${you.deaths}. The next round starts in ${NEXT_ROUND} seconds.`;
    $("results").hidden = false;
    return;
  }
  const won = game.status === "won";
  const o = game.objective, spare = game.mode ? "side by side" : `${game.lives} reflog ${game.lives === 1 ? "entry" : "entries"} to spare`;
  $("results-title").textContent = won ? "Merged." : "Merge failed.";
  $("results-body").textContent = won
    ? o.kind === "carry" ? `The commit made it to HEAD in ${clock(game.time)}, with ${spare}.`
      : o.kind === "defend" && o.held >= o.seconds ? `main held for ${clock(o.held)}, with ${spare}.`
      : `Every conflict in ${current!.repo.name} resolved in ${clock(game.time)}, with ${spare}.`
    : o.kind === "defend" && o.overrun >= OVERRUN ? `main was overwritten after ${clock(o.held)}.`
    : `Out of reflog. ${game.cleared.filter(Boolean).length} of ${game.cleared.length} folders merged in ${clock(game.time)}.`;
  if (game.mode) $("results-body").textContent += ` The next round starts in ${NEXT_ROUND} seconds.`;
  if (won && !game.mode) {
    const got = addWin(wins, winKey(current!.def.id, current!.repo.name));
    wins = got.wins, store.set("wins", wins);
    if (got.head) $("results-body").textContent += ` Unlocked a head: ${got.head.name.toLowerCase()}.`;
  }
  drawRoles();
  $("results").hidden = false;
}

/* ---------------- sound ---------------- */

function sound(game: Game, e: GameEvent) {
  const you = game.you(), me = game.me;
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
  } else if (e.kind === "pickup") e.id === me && play(FIELD.pickup);
  else if (e.kind === "hit" && e.target === me) play(e.shield ? FIELD.shieldHit : FIELD.hurt);
  else if (e.kind === "shield" && e.id === me) play(e.state === "broke" ? FIELD.shieldBroke : e.state === "charging" ? FIELD.shieldCharge : FIELD.shieldFull);
  else if (e.kind === "hit" && e.by === me) play(FIELD.hitmark);
  else if (e.kind === "down") {
    if (e.by === me && e.id !== me) play(FIELD.kill);
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
  const { game, world, net } = current;
  const you = game.you(), me = game.me;
  placeCamera(game, dt);
  const aim = aimPoint(game, world);
  const input: Input = {
    forward: (keys.has("KeyW") ? 1 : 0) - (keys.has("KeyS") ? 1 : 0),
    right: (keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0),
    yaw: look.yaw,
    pitch: look.pitch,
    jump, roll, crouch: keys.has("KeyC") || keys.has("ControlLeft"), prone,
    reload, use, up: keys.has("Space"), down: keys.has("KeyC") || keys.has("ControlLeft"),
    scope: zoom,
    fire: fire && document.pointerLockElement === canvas,
    aim: { x: aim.point.x, y: aim.point.y, z: aim.point.z },
    weapon: pick,
  };
  // Automatic guns fire while held; everything else once per click.
  if (!WEAPONS[you.weapon].auto && fire && you.vehicle < 0) fire = false;
  jump = roll = reload = use = false, pick = undefined;
  shake *= Math.exp(-dt * 9);
  let events: GameEvent[];
  if (net) {
    // A battle: your soldier moves now, the world says what happened; a roster change re-dresses everyone.
    net.mirror.frame(dt, input);
    net.battle.input(input, now, net.mirror.acked);
    events = net.mirror.take();
    if (net.roster !== net.mirror.roster) showLooks(net);
    if (!$("board").hidden) board(game, net);
  } else events = game.step(dt, input);
  for (const e of events) {
    sound(game, e);
    world.event(game, e);
    if (e.kind === "fire" && e.id === me) {
      // Recoil: the aim kicks up (less crouched, least prone) and a heavy gun shakes the view.
      const w = WEAPONS[e.weapon], k = you.prone ? 0.35 : you.crouch ? 0.65 : 1;
      look.pitch = Math.min(1.0, look.pitch + w.kick * k * (0.7 + Math.random() * 0.6));
      look.yaw += (Math.random() - 0.5) * w.kick * k * 0.5;
      shake = Math.max(shake, w.kick * 2.5);
    } else if (e.kind === "boom") {
      shake = Math.max(shake, Math.min(0.6, e.r * 0.1) * Math.max(0, 1 - Math.hypot(e.x - you.x, e.z - you.z) / 40));
    } else if (e.kind === "razed") {
      if (e.by === me) feed(`deleted ${e.path} (${e.lines.toLocaleString()} lines)`);
    } else if (e.kind === "hit" && e.by === me && e.target !== me) mark("hit");
    if (e.kind === "down" && e.by === me && e.id !== me) mark("kill");
    if (e.kind === "boom" || e.kind === "razed" || e.kind === "fire" || (e.kind === "hit" && e.by === me && e.target !== me)) continue;
    const name = (id: number) => game.soldiers[id]?.name ?? "someone";
    if (e.kind === "down" && e.id === me) feed(e.by !== me && !game.soldiers[e.by]?.brain && game.mode ? `${name(e.by)} resolved you` : "you went down", true);
    else if (e.kind === "down") feed(e.by === me || !game.mode ? `resolved ${name(e.id)}` : `${name(e.by)} resolved ${name(e.id)}`);
    else if (e.kind === "respawn") e.id === me && banner(game.mode ? "git reflog: back in" : `git reflog · ${e.lives} left`);
    else if (e.kind === "joined" || e.kind === "left") feed(`${name(e.id)} ${e.kind === "joined" ? "joined" : "left"}`);
    else if (e.kind === "cleared") {
      const c = game.map.compounds[e.compound]!;
      banner(`${c.folder} merged`);
      feed(`merged ${c.folder}: crates in the yard`);
    } else if (e.kind === "pickup") e.id === me && feed(e.item === "health" ? "health crate: +40 hp" : e.item === "ammo" ? "ammo crate" : `found git reset --hard (${keyLabel(KEYS[game.you().kit.indexOf("reset")] ?? "")})`, e.item === "reset");
    else if (e.kind === "blamed") feed(`blamed ${game.soldiers[e.id]!.name}`);
    else if (e.kind === "reverted") feed(`reverted ${game.soldiers[e.id]!.name}`);
    else if (e.kind === "objective") banner(e.text), feed(e.text, true);
    else if (e.kind === "streak") banner(`${e.kills} kills: ${vehicleName(e.vehicle)} inbound`), feed(`${vehicleName(e.vehicle)} dropping in beside you · E to get in`, true);
    else if (e.kind === "wrecked") feed(`${vehicleName(e.vehicle)} wrecked`, true);
    else if (e.kind === "hit" && e.target === me) {
      hitFrom(game, e.by);
      if (!e.shield) $("hud").classList.add("hurt"), setTimeout(() => $("hud").classList.remove("hurt"), 120);
    } else if (e.kind === "shield" && e.id === me && e.state === "broke") feed("shield down", true);
  }
  world.sync(game, dt);
  hud(game, aim.block);
  renderer.render(world.scene, camera);
  // Once per ending: a battle's can arrive between frames, with a snapshot.
  if (game.status !== "playing" && !current.ended) current.ended = true, results(game);
}
requestAnimationFrame(frame);

// In dev, the running game is on the page for poking at from the console: `__recon.current.game`.
if (import.meta.env.DEV) Object.assign(window, { __recon: { get current() { return current; }, look, cam } });
