// Wildclash: pick two creatures and an arena, then fight a bot (or watch two), or walk the open world
// between the arenas (src/world). The sim runs at a fixed 60 Hz; this file draws it and turns the keyboard
// into an Input.
// `?a=<id>&b=<id>&skin=<name>&watch=1` skips the picker, `?world=1&a=<id>` walks the world; `window.wildclash`
// has `state()`, `start(a, b, skin, watch)`, `hold(keys)` and `world` for an agent's browser.
import * as THREE from "three";
import { clamp, esc } from "@rustybuns/util";
import { buildArena, SKINS } from "./arena.ts";
import { bot, type Bot } from "./bot.ts";
import { icon } from "./icons.ts";
import { creatureModel, ELEMENT } from "./model.ts";
import { body, creature, ROSTER, type Creature } from "./roster.ts";
import type { Region } from "./world/regions.ts";
import { worldView } from "./world/view.ts";
import { ARENA, HZ, IDLE, newMatch, step, type Fighter, type Input, type Match } from "./sim.ts";

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const canvas = $<HTMLCanvasElement>("#view");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.shadowMap.enabled = true;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 300);
camera.position.set(-14, 7, 0);
const resize = () => { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); };
addEventListener("resize", resize); resize();

// --- the picker -------------------------------------------------------------------------------------
const AXES = ["vigor", "might", "guard", "focus", "will", "speed"] as const;
function radar(c: Creature): string {
  const pt = (i: number, v: number) => { const t = (i / 6) * Math.PI * 2 - Math.PI / 2, r = (v / 150) * 42; return `${(50 + Math.cos(t) * r).toFixed(1)},${(50 + Math.sin(t) * r).toFixed(1)}`; };
  const ring = (v: number) => AXES.map((_, i) => pt(i, v)).join(" ");
  const color = `#${(ELEMENT[c.elements[0]!] ?? 0xcccccc).toString(16).padStart(6, "0")}`;
  return `<svg viewBox="0 0 100 100" class="radar" role="img" aria-label="${esc(c.name)} stats">
    <polygon points="${ring(150)}" class="grid"/><polygon points="${ring(75)}" class="grid"/>
    <polygon points="${AXES.map((a, i) => pt(i, c.stats[a])).join(" ")}" fill="${color}" fill-opacity="0.45" stroke="${color}"/>
    ${AXES.map((a, i) => { const [x, y] = pt(i, 175).split(","); return `<text x="${x}" y="${y}">${a}</text>`; }).join("")}</svg>`;
}
function card(c: Creature, side: "A" | "B", on: boolean) {
  const b = body(c);
  return `<button class="card${on ? " on" : ""}" data-side="${side}" data-id="${esc(c.id)}">
    <b>${esc(c.name)}</b><small>${esc(c.archetype)} · ${c.elements.map(esc).join(" / ")}</small>${radar(c)}
    <span class="body">${c.massKg} kg · ${c.heightM} m · ${b.air === "flight" ? icon("feather", "Flies") : icon("footprints", "Hops")}</span>
    <span class="moves">${c.moves.map((m) => `<i title="${m.slot}, power ${m.power}">${esc(m.name)}</i>`).join("")}</span></button>`;
}

const params = new URLSearchParams(location.search);
let pickA = creature(params.get("a") ?? "").id, pickB = creature(params.get("b") ?? ROSTER[1]?.id ?? "").id;
if (!params.get("b") && pickB === pickA) pickB = ROSTER[1]?.id ?? pickA;
const skinSel = $<HTMLSelectElement>("#skin");
skinSel.innerHTML = Object.entries(SKINS).map(([k, s]) => `<option value="${k}">${esc(s.name)}</option>`).join("");
skinSel.value = SKINS[params.get("skin") ?? ""] ? params.get("skin")! : "stadium";
$<HTMLInputElement>("#watch").checked = params.get("watch") === "1";
function drawPicker() {
  $("#pickA").innerHTML = ROSTER.map((c) => card(c, "A", c.id === pickA)).join("");
  $("#pickB").innerHTML = ROSTER.map((c) => card(c, "B", c.id === pickB)).join("");
}
$("#select").addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>(".card");
  if (!b) return;
  if (b.dataset.side === "A") pickA = b.dataset.id!; else pickB = b.dataset.id!;
  drawPicker();
});
$("#fight").addEventListener("click", () => start(pickA, pickB, skinSel.value, $<HTMLInputElement>("#watch").checked));
$("#walk").addEventListener("click", () => enterWorld());
drawPicker();

// --- a match --------------------------------------------------------------------------------------
let m: Match | null = null, arena: THREE.Group | null = null, models: THREE.Group[] = [], bots: (Bot | null)[] = [null, null];
const shotMeshes: THREE.Mesh[] = [];
const keys = new Set<string>();
let held: Set<string> | null = null; // what an agent asked to hold, instead of the keyboard

// A fight the world started: which region's arena, or its wild creatures.
let trip: { region: Region; wild: boolean } | null = null;

function start(a: string, b: string, skin: string, watch = false) {
  trip = null;
  fight(creature(a), creature(b), skin, watch);
  history.replaceState(null, "", `?${new URLSearchParams({ a, b, skin, ...(watch ? { watch: "1" } : {}) })}`);
}
function fight(a: Creature, b: Creature, skin: string, watch = false) {
  world.hide();
  for (const o of [arena, ...models]) if (o) scene.remove(o);
  arena = buildArena(scene, SKINS[skin] ?? SKINS.stadium!);
  camera.far = 300; camera.updateProjectionMatrix();
  m = newMatch(a, b);
  models = m.f.map((f) => { const g = creatureModel(f.c); scene.add(g); return g; });
  const seed = Math.floor(Math.random() * 1e6) + 1;
  bots = [watch ? bot(0, seed) : null, bot(1, seed + 1)];
  $("#select").hidden = true; $("#result").hidden = true; $("#hud").hidden = false;
}

// --- the open world -------------------------------------------------------------------------------------
// Until the folklore roster (#2706) lands, a region's champion is one of the four we have, and a wild
// creature of the deadly south is one of them grown far past you.
const champion = (g: Region) => { const others = ROSTER.filter((c) => c.id !== pickA); return others[(g.n - 1) % others.length] ?? ROSTER[0]!; };
const wildOne = (g: Region): Creature => {
  const c = champion(g), big = (v: number) => Math.min(255, Math.round(v * 1.8));
  return { ...c, id: `wild-${c.id}`, name: `Wild ${c.name}`, stats: { vigor: big(c.stats.vigor), might: big(c.stats.might), guard: big(c.stats.guard), focus: big(c.stats.focus), will: big(c.stats.will), speed: big(c.stats.speed) },
    moves: c.moves.map((mv) => ({ ...mv, power: Math.min(300, Math.round(mv.power * 1.4)) })) };
};
const world = worldView(scene, camera, {
  arena: (g) => { trip = { region: g, wild: false }; fight(creature(pickA), champion(g), g.skin); },
  wild: (g) => { trip = { region: g, wild: true }; fight(creature(pickA), wildOne(g), g.skin); },
});
function enterWorld() {
  for (const o of [arena, ...models]) if (o) scene.remove(o);
  arena = null; models = []; m = null; trip = null;
  for (const s of shotMeshes) s.visible = false;
  $("#select").hidden = true; $("#result").hidden = true; $("#hud").hidden = true;
  world.show(creature(pickA));
  history.replaceState(null, "", `?${new URLSearchParams({ world: "1", a: pickA })}`);
}

window.addEventListener("keydown", (e: KeyboardEvent) => { keys.add(e.code); if (m && !m.over && ["Space", "ShiftLeft"].includes(e.code)) e.preventDefault(); });
window.addEventListener("keyup", (e: KeyboardEvent) => keys.delete(e.code));
addEventListener("blur", () => keys.clear());

function playerInput(): Input {
  const k = held ?? keys, on = (c: string) => k.has(c);
  // WASD is camera-relative: W pushes away from the camera.
  const fx = (on("KeyW") ? 1 : 0) - (on("KeyS") ? 1 : 0), sx = (on("KeyD") ? 1 : 0) - (on("KeyA") ? 1 : 0);
  const fw = new THREE.Vector3(); camera.getWorldDirection(fw); fw.y = 0; fw.normalize();
  const rt = new THREE.Vector3(-fw.z, 0, fw.x);
  let mx = fw.x * fx + rt.x * sx, mz = fw.z * fx + rt.z * sx;
  const n = Math.hypot(mx, mz); if (n > 1) { mx /= n; mz /= n; }
  return {
    mx, mz, up: on("Space"), down: on("KeyC"), light: on("KeyJ"), heavy: on("KeyK"), special: on("KeyL"), ultimate: on("KeyU"),
    guard: on("KeyQ"), dash: on("ShiftLeft") || on("ShiftRight"), charge: on("KeyE"),
  };
}

// --- drawing ----------------------------------------------------------------------------------------
const bar = (v: number, max: number, cls: string, label: string, ic: string) =>
  `<span class="bar ${cls}" title="${label}">${icon(ic, label)}<span><i style="width:${(clamp(v / max, 0, 1) * 100).toFixed(1)}%"></i></span></span>`;
function hud(m: Match) {
  $("#hud").innerHTML = m.f.map((f, i) => `<div class="side s${i}">
    <b>${esc(f.c.name)}</b>${bar(f.hp, f.b.hp, "hp", "Health", "heart")}
    <span class="launch" title="Launch: the higher, the further the next hit sends you">${icon("move-up-right", "Launch")}${Math.round(f.launch)}%</span>
    ${bar(f.stamina, f.b.stamina, `st${f.exhausted ? " out" : ""}`, "Stamina: flying, sprinting and dashing spend it", "wind")}
    ${bar(f.energy, 100, "en", "Energy: specials, beams and the ultimate spend it; hold E to charge", "zap")}
    ${f.clipped ? `<span class="tag">${icon("feather", "Wings clipped")}grounded</span>` : ""}</div>`).join("")
    + `<div class="clock">${Math.ceil(99 - m.tick / HZ)}</div>`;
}

function draw(m: Match, alpha: number) {
  m.f.forEach((f, i) => {
    const g = models[i]!;
    g.position.set(f.pos.x, f.pos.y, f.pos.z);
    g.rotation.y = -f.yaw;
    g.getObjectByName("guard")!.visible = f.state === "guard";
    for (const w of g.children) if (w.name === "wing") w.rotation.x = f.flying ? Math.sin(m.tick / 4) * 0.5 : 0.9 * Math.sign(w.position.z);
    const flash = f.state === "stun" ? 0.6 : f.state === "charge" ? 0.35 : f.invuln ? 0.2 : 0;
    const torso = g.children[0] as THREE.Mesh, mat = torso.material as THREE.MeshStandardMaterial;
    mat.emissive.setHex(f.state === "charge" ? 0xffee88 : 0xffffff); mat.emissiveIntensity = flash;
  });
  while (shotMeshes.length < m.shots.length) {
    const s = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    scene.add(s); shotMeshes.push(s);
  }
  shotMeshes.forEach((s, i) => {
    const shot = m.shots[i];
    s.visible = !!shot;
    if (!shot) return;
    s.position.set(shot.pos.x, shot.pos.y, shot.pos.z);
    s.scale.setScalar(shot.radius);
    (s.material as THREE.MeshBasicMaterial).color.setHex(ELEMENT[shot.move.element] ?? 0xffffff);
  });
  // Soft lock: behind you, looking past you at them, high enough to see a flyer.
  const [me, them] = m.f;
  const dx = them.pos.x - me.pos.x, dz = them.pos.z - me.pos.z, d = Math.hypot(dx, dz) || 1;
  const back = 6 + me.b.radius * 3, lift = 3.2 + Math.max(0, them.pos.y - me.pos.y) * 0.5;
  const want = new THREE.Vector3(me.pos.x - (dx / d) * back, me.pos.y + lift, me.pos.z - (dz / d) * back);
  camera.position.lerp(want, clamp(alpha * 6, 0, 1));
  camera.lookAt((me.pos.x + them.pos.x) / 2, (me.pos.y + them.pos.y) / 2 + 1, (me.pos.z + them.pos.z) / 2);
}

function finish(m: Match) {
  const ko = m.events.find((e) => e.kind === "ko");
  const w = m.f[m.winner!]!, how = ko?.kind === "ko" ? { hp: "knocked out", "ring-out": "rang out", time: "outlasted on time" }[ko.how] : "";
  const lost = `${esc(m.f[m.winner ? 0 : 1]!.c.name)} ${how === "outlasted on time" ? "was outlasted on time" : how}.`;
  if (trip) {
    const { region, wild } = trip, won = m.winner === 0;
    if (won && !wild) world.beat(region.n);
    const next = won ? (wild ? "The wild ones back off, for now." : `The roads out of ${esc(region.name)} are open.`) : "You wake on the doorstep of your last arena.";
    $("#result").innerHTML = `<h2>${esc(w.c.name)} wins</h2><p>${lost} ${next}</p>
      <div class="row"><button class="go" id="back">${icon("map")} Back to the world</button></div>`;
    $("#result").hidden = false;
    $("#back").onclick = () => { enterWorld(); world.afterFight(won); };
    return;
  }
  $("#result").innerHTML = `<h2>${esc(w.c.name)} wins</h2><p>${lost}</p>
    <div class="row"><button class="go" id="again">${icon("rotate-ccw")} Rematch</button><button id="pick">${icon("users")} Pick again</button></div>`;
  $("#result").hidden = false;
  $("#again").onclick = () => start(m.f[0].c.id, m.f[1].c.id, skinSel.value, !!bots[0]);
  $("#pick").onclick = () => { $("#result").hidden = true; $("#hud").hidden = true; $("#select").hidden = false; };
}

let last = performance.now(), acc = 0;
function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (m && !m.over) {
    acc += dt;
    while (acc >= 1 / HZ && !m.over) {
      const cur = m;
      step(cur, [bots[0] ? bots[0](cur) : playerInput(), bots[1] ? bots[1](cur) : IDLE]);
      acc -= 1 / HZ;
      if (cur.over) finish(cur);
    }
    hud(m);
  }
  if (world.shown) world.update(dt, held ?? keys);
  else if (m) draw(m, dt); else { camera.position.set(Math.cos(now / 4000) * 22, 9, Math.sin(now / 4000) * 22); camera.lookAt(0, 0, 0); }
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
if (!arena) arena = buildArena(scene, SKINS[skinSel.value] ?? SKINS.stadium!);
if (params.get("world") === "1") enterWorld();
else if (params.get("a") && params.get("b")) start(pickA, pickB, skinSel.value, params.get("watch") === "1");
requestAnimationFrame(frame);

const view = (f: Fighter) => ({
  id: f.c.id, hp: Math.round(f.hp), launch: Math.round(f.launch), stamina: +f.stamina.toFixed(2), energy: Math.round(f.energy),
  state: f.state, flying: f.flying, onGround: f.onGround, clipped: f.clipped > 0, pos: { x: +f.pos.x.toFixed(2), y: +f.pos.y.toFixed(2), z: +f.pos.z.toFixed(2) },
});
Object.assign(window, {
  wildclash: {
    state: () => m && { tick: m.tick, over: m.over, winner: m.winner, fighters: m.f.map(view), shots: m.shots.length, ringRadius: ARENA.radius },
    start: (a: string, b: string, skin = "stadium", watch = false) => start(a, b, skin, watch),
    /** Hold these key codes (e.g. ["KeyW", "KeyJ"]) in place of the keyboard; `null` gives it back. */
    hold: (codes: string[] | null) => { held = codes ? new Set(codes) : null; },
    /** The open world: `enter()`, `state()` (where you are, what you've beaten, what's open), `travel(n)` to an open region n's arena, `reset()`. */
    world: { enter: enterWorld, state: world.state, travel: world.travel, reset: world.reset },
    roster: () => ROSTER.map((c) => ({ id: c.id, name: c.name, archetype: c.archetype })),
  },
});
