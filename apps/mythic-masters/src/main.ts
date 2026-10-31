// Mythic Masters: pick two creatures and an arena, then fight a bot (or watch two), or walk the open world
// between the arenas (src/world). The sim runs at a fixed 60 Hz; this file draws it and turns the keyboard,
// a touch screen or a gamepad into an Input.
// `?a=<id>&b=<id>&skin=<name or region id>&watch=1` skips the picker, `?world=1&a=<id>` walks the world;
// `window.mythicMasters` has `state()`, `start(a, b, skin, watch)`, `hold(keys)` and `world` for an agent's browser.
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { mountControls } from "@rustybuns/game-controls";
import { clamp, esc } from "@rustybuns/util";
import { buildArena, SKINS } from "./arena.ts";
import { loadBeast, Puppet } from "./beasts.ts";
import { bot, type Bot } from "./bot.ts";
import { NO_STICK, push, readPad, touchStick, TOUCH_BUTTONS, type Stick } from "./controls.ts";
import { icon } from "./icons.ts";
import { COLOR, FIELDS, type Field } from "./fields.ts";
import { MAX_LIVE, MAX_LIVE_PHONE, MoveFx } from "./fx.ts";
import { gallery, PAGE } from "./gallery.ts";
import { creatureModel } from "./model.ts";
import { ALL_SKINS, REGIONS, type Region } from "./regions.ts";
import { body, creature as rosterCreature, learnset, ROSTER, teach, type Creature } from "./roster.ts";
import { grown } from "./world/party.ts";
import { worldView } from "./world/view.ts";
import { wildLevel } from "./world/world.ts";
import { ARENA, HZ, IDLE, newMatch, step, type Fighter, type Input, type Match, type V3 } from "./sim.ts";

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const canvas = $<HTMLCanvasElement>("#view");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
// filmic roll-off so a lit hide keeps its shading instead of clipping flat, and a soft room of light around
// everything (a dim studio, not a mirror) so a dark beast still shows its shape on its shadowed side
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
const scene = new THREE.Scene();
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.35;
const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 300);
camera.position.set(-14, 7, 0);
// On a desktop the brightest things (eyes, flames, shots, hit sparks) bloom into the air around them; a phone
// skips the extra passes and draws straight to the screen.
const composer = matchMedia("(max-width: 700px), (pointer: coarse)").matches ? null : new EffectComposer(renderer);
if (composer) {
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.45, 0.5, 0.88));
  composer.addPass(new OutputPass());
}
const resize = () => { renderer.setSize(innerWidth, innerHeight, false); composer?.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); };
addEventListener("resize", resize); resize();

// --- the picker -------------------------------------------------------------------------------------
const AXES = ["vigor", "might", "guard", "focus", "will", "speed"] as const;
function radar(c: Creature): string {
  const pt = (i: number, v: number) => { const t = (i / 6) * Math.PI * 2 - Math.PI / 2, r = (v / 150) * 42; return `${(50 + Math.cos(t) * r).toFixed(1)},${(50 + Math.sin(t) * r).toFixed(1)}`; };
  const ring = (v: number) => AXES.map((_, i) => pt(i, v)).join(" ");
  const color = `#${COLOR[c.fields[0]!].toString(16).padStart(6, "0")}`;
  return `<svg viewBox="0 0 100 100" class="radar" role="img" aria-label="${esc(c.name)} stats">
    <polygon points="${ring(150)}" class="grid"/><polygon points="${ring(75)}" class="grid"/>
    <polygon points="${AXES.map((a, i) => pt(i, c.stats[a])).join(" ")}" fill="${color}" fill-opacity="0.45" stroke="${color}"/>
    ${AXES.map((a, i) => { const [x, y] = pt(i, 175).split(","); return `<text x="${x}" y="${y}">${a}</text>`; }).join("")}</svg>`;
}
function card(c: Creature, side: "A" | "B", on: boolean) {
  const b = body(c);
  return `<button class="card${on ? " on" : ""}" data-side="${side}" data-id="${esc(c.id)}">
    <b>${esc(c.name)}</b><small>${esc(c.archetype)} · ${c.fields.join(" / ")}</small>${radar(c)}
    <span class="body">${c.massKg} kg · ${c.heightM} m · ${b.air === "flight" ? icon("feather", "Flies") : icon("footprints", "Hops")}</span>
    <span class="moves">${c.moves.map((m) => `<i title="${m.slot}, ${m.field}, power ${m.power}">${esc(m.name)}</i>`).join("")}</span></button>`;
}

// What each creature has been taught (the harness's `teach`); everyone else fights with what it was born knowing.
const taught = new Map<string, Creature>();
const creature = (id: string) => taught.get(id) ?? rosterCreature(id);

const params = new URLSearchParams(location.search);
let pickA = creature(params.get("a") ?? "").id, pickB = creature(params.get("b") ?? ROSTER[1]?.id ?? "").id;
if (!params.get("b") && pickB === pickA) pickB = ROSTER[1]?.id ?? pickA;
const skinSel = $<HTMLSelectElement>("#skin");
// The arenas: the exhibition skins, then every region on the route; the 48 not built yet show as coming soon.
const TIER_NOTE = { playable: "", "high-level": " (deadly wilds)", "coming-soon": " (coming soon)" } as const;
skinSel.innerHTML = `<optgroup label="Exhibition">${Object.entries(SKINS).map(([k, s]) => `<option value="${k}">${esc(s.name)}</option>`).join("")}</optgroup>`
  + [...new Set(REGIONS.map((r) => r.block))].map((block) => `<optgroup label="${esc(block)}">${REGIONS.filter((r) => r.block === block).map((r) =>
    `<option value="${r.id}"${r.skin ? "" : " disabled"} title="${esc(r.folklore.map((b) => b.name).join(", "))}">${r.n} · ${esc(r.name)}${TIER_NOTE[r.tier]}</option>`).join("")}</optgroup>`).join("");
skinSel.value = ALL_SKINS[params.get("skin") ?? ""] ? params.get("skin")! : "stadium";
$<HTMLInputElement>("#watch").checked = params.get("watch") === "1";
// A built region shows its lore page under the arena list: the legend, where it comes from, what is sacred.
function drawLore() {
  const lore = REGIONS.find((r) => r.id === skinSel.value)?.lore, el = $("#lore");
  el.hidden = !lore;
  if (lore) el.innerHTML = `<p>${esc(lore.legend)}</p><p><b>From</b> ${esc(lore.from)}</p><p><b>Sacred</b> ${esc(lore.sacred)}</p>`
    + `<p class="src"><b>Sources</b> ${lore.sources.map(esc).join(" · ")}</p>`;
}
skinSel.addEventListener("change", drawLore);
drawLore();
// Each side: the pick's full card, then all 64 as small tiles (a dot per field), narrowed by the field chips.
let only: Field | null = null;
const hex = (f: Field) => `#${COLOR[f].toString(16).padStart(6, "0")}`;
const tile = (c: Creature, side: "A" | "B", on: boolean) => `<button class="tile${on ? " on" : ""}" data-side="${side}" data-id="${esc(c.id)}"
  title="${esc(c.archetype)} · ${c.fields.join(" / ")}">${c.fields.map((f) => `<i style="background:${hex(f)}"></i>`).join("")}${esc(c.name)}</button>`;
function drawPicker() {
  const shown = ROSTER.filter((c) => !only || c.fields.includes(only));
  for (const [side, id] of [["A", pickA], ["B", pickB]] as const)
    $(`#pick${side}`).innerHTML = card(creature(id), side, true) + `<div class="tiles">${shown.map((c) => tile(c, side, c.id === id)).join("")}</div>`;
  $("#fields").innerHTML = FIELDS.map((f) => `<button class="chip${only === f ? " on" : ""}" data-field="${f}"><i style="background:${hex(f)}"></i>${f}</button>`).join("");
}
$("#select").addEventListener("click", (e) => {
  const chip = (e.target as HTMLElement).closest<HTMLElement>(".chip");
  if (chip) { const f = FIELDS.find((x) => x === chip.dataset.field) ?? null; only = only === f ? null : f; drawPicker(); return; }
  const b = (e.target as HTMLElement).closest<HTMLElement>(".tile");
  if (!b) return;
  if (b.dataset.side === "A") pickA = b.dataset.id!; else pickB = b.dataset.id!;
  drawPicker();
});
$("#fight").addEventListener("click", () => start(pickA, pickB, skinSel.value, $<HTMLInputElement>("#watch").checked));
$("#walk").addEventListener("click", () => enterWorld());
drawPicker();

// The creature's beast (public/models/<id>.glb, src/beasts.ts) replaces the capsule when it loads; the capsule
// stays for a beast whose files haven't been built.
function wearBeast(f: Fighter, g: THREE.Group, i: number) {
  void loadBeast(f.c.id.replace(/^wild-/, "")).then((beast) => {
    if (!beast || models[i] !== g) return;
    const p = new Puppet(beast, f.b, f.c.archetype);
    p.onStep = (at, speed) => moveFx.step(at, speed, f.b.radius);
    for (const o of g.children) o.visible = false;
    scene.add(p.group);
    puppets[i] = p;
  });
}

// --- a match --------------------------------------------------------------------------------------
let m: Match | null = null, arena: THREE.Group | null = null, models: THREE.Group[] = [], puppets: (Puppet | null)[] = [null, null], bots: (Bot | null)[] = [null, null];
const moveFx = new MoveFx(scene, Math.random, matchMedia("(max-width: 700px)").matches ? MAX_LIVE_PHONE : MAX_LIVE);
let hitStop = 0; // seconds the fight holds still after a big hit lands, so the blow reads
let shove = { x: 0, z: 0 }; // a heavy hit's push on the camera along the blow, metres, easing back
let shake = 0; // how hard the camera is shaking after a hit, in metres, easing off
let camMode: "lock" | "side" = "lock"; // behind you looking at them, or side-on to both (for judging the art)
const keys = new Set<string>();
let held: Set<string> | null = null; // what an agent asked to hold, instead of the keyboard

// A fight the world started: a region's arena, the deadly south's wild creatures, or a wild one roaming an open
// region that joins your party if you win; `level` is what beating it is worth to your lead, `id` who it was.
let trip: { region: Region; kind: "arena" | "wild" | "catch"; level: number; id?: string } | null = null;

function start(a: string, b: string, skin: string, watch = false) {
  trip = null;
  fight(creature(a), creature(b), skin, watch);
  history.replaceState(null, "", `?${new URLSearchParams({ a, b, skin, ...(watch ? { watch: "1" } : {}) })}`);
}
function fight(a: Creature, b: Creature, skin: string, watch = false) {
  world.hide(); shelf?.dispose(); shelf = null;
  for (const o of [arena, ...models, ...puppets.map((p) => p?.group)]) if (o) scene.remove(o);
  puppets = [null, null]; moveFx.clear();
  arena = buildArena(scene, ALL_SKINS[skin] ?? SKINS.stadium!);
  camera.far = 300; camera.updateProjectionMatrix();
  m = newMatch(a, b);
  models = m.f.map((f, i) => { const g = creatureModel(f.c); scene.add(g); wearBeast(f, g, i); return g; });
  const seed = Math.floor(Math.random() * 1e6) + 1;
  bots = [watch ? bot(0, seed) : null, bot(1, seed + 1)];
  $("#select").hidden = true; $("#result").hidden = true; $("#hud").hidden = false;
}

// --- the open world -------------------------------------------------------------------------------------
// A region's champion is a creature from its own legends (or, where none fights, the next one along the
// route), and a wild creature of the deadly south is one of them grown far past you.
const champion = (g: Region) => {
  const others = ROSTER.filter((c) => c.id !== pickA), home = others.filter((c) => c.region === g.n);
  return creature((home[(g.n - 1) % Math.max(1, home.length)] ?? others.find((c) => c.region >= g.n) ?? others[0]!).id);
};
const wildOne = (g: Region): Creature => {
  const c = champion(g), big = (v: number) => Math.min(255, Math.round(v * 1.8));
  return { ...c, id: `wild-${c.id}`, name: `Wild ${c.name}`, stats: { vigor: big(c.stats.vigor), might: big(c.stats.might), guard: big(c.stats.guard), focus: big(c.stats.focus), will: big(c.stats.will), speed: big(c.stats.speed) },
    moves: c.moves.map((mv) => ({ ...mv, power: Math.min(300, Math.round(mv.power * 1.4)) })) };
};
// An arena's champion stands a few levels above the wild ones of its region, so you grow your party first.
const championLevel = (g: Region) => wildLevel(g.n, 1) + 1;
const world = worldView(scene, camera, {
  arena: (g) => { trip = { region: g, kind: "arena", level: championLevel(g) }; fight(world.lead(), grown(champion(g), championLevel(g)), g.id); },
  wild: (g) => { trip = { region: g, kind: "wild", level: 30 }; fight(world.lead(), wildOne(g), g.id); },
  encounter: (g, c) => {
    trip = { region: g, kind: "catch", level: c.level, id: c.id };
    const them = grown(creature(c.id), c.level);
    fight(world.lead(), { ...them, name: `Wild ${them.name}` }, g.id);
  },
  lead: (id) => { pickA = id; history.replaceState(null, "", `?${new URLSearchParams({ world: "1", a: pickA })}`); },
});
function enterWorld() {
  for (const o of [arena, ...models]) if (o) scene.remove(o);
  arena = null; models = []; m = null; trip = null;
  moveFx.clear();
  $("#select").hidden = true; $("#result").hidden = true; $("#hud").hidden = true;
  world.show(creature(pickA));
  history.replaceState(null, "", `?${new URLSearchParams({ world: "1", a: pickA })}`);
}

window.addEventListener("keydown", (e: KeyboardEvent) => { keys.add(e.code); if (m && !m.over && ["Space", "ShiftLeft"].includes(e.code)) e.preventDefault(); });
window.addEventListener("keyup", (e: KeyboardEvent) => keys.delete(e.code));
addEventListener("blur", () => { keys.clear(); fingers.clear(); stickFinger = null; lookFinger = null; });

// --- touch: a floating stick on the left half, buttons on the right ------------------------------------
// In the open world the buttons shrink to Run, and a drag on the right half turns the camera.
const touchEl = $("#touch"), stickEl = $("#stick"), knob = $("#stick .knob");
$("#buttons").innerHTML = TOUCH_BUTTONS.map((b) =>
  `<button class="${b.big ? "big" : "small"}" data-code="${b.code}" title="${b.label}" aria-label="${b.label}">${icon(b.icon)}</button>`).join("");
const fingers = new Map<number, string>(); // pointer id -> the key code its button holds
let stickFinger: { id: number; x: number; y: number } | null = null, touchMove: Stick = NO_STICK;
let touchy = matchMedia("(pointer: coarse)").matches;
const STICK_R = 56;
window.addEventListener("pointerdown", (e: PointerEvent) => { if (e.pointerType === "touch") touchy = true; }, { capture: true });
$("#stickzone").addEventListener("pointerdown", (e) => {
  if (stickFinger) return;
  stickFinger = { id: e.pointerId, x: e.clientX, y: e.clientY };
  stickEl.style.transform = `translate(${e.clientX - STICK_R}px, ${e.clientY - STICK_R}px)`; stickEl.classList.add("on");
  (e.target as HTMLElement).setPointerCapture(e.pointerId);
});
$("#stickzone").addEventListener("pointermove", (e) => {
  if (stickFinger?.id !== e.pointerId) return;
  const dx = e.clientX - stickFinger.x, dy = e.clientY - stickFinger.y, n = Math.max(1, Math.hypot(dx, dy) / STICK_R);
  knob.style.transform = `translate(${dx / n}px, ${dy / n}px)`;
  touchMove = touchStick(dx, dy, STICK_R);
});
const stickUp = (e: PointerEvent) => {
  if (stickFinger?.id !== e.pointerId) return;
  stickFinger = null; touchMove = NO_STICK; knob.style.transform = ""; stickEl.classList.remove("on");
};
$("#stickzone").addEventListener("pointerup", stickUp); $("#stickzone").addEventListener("pointercancel", stickUp);
let lookFinger: { id: number; x: number } | null = null, lookTurn = 0; // radians the drag turned since the last frame
const LOOK = 0.008; // radians a pixel of drag turns the camera
$("#lookzone").addEventListener("pointerdown", (e) => {
  if (lookFinger) return;
  lookFinger = { id: e.pointerId, x: e.clientX };
  (e.target as HTMLElement).setPointerCapture(e.pointerId);
});
$("#lookzone").addEventListener("pointermove", (e) => {
  if (lookFinger?.id !== e.pointerId) return;
  lookTurn += (e.clientX - lookFinger.x) * LOOK * lookScale; lookFinger.x = e.clientX;
});
const lookUp = (e: PointerEvent) => { if (lookFinger?.id === e.pointerId) lookFinger = null; };
$("#lookzone").addEventListener("pointerup", lookUp); $("#lookzone").addEventListener("pointercancel", lookUp);
$("#buttons").addEventListener("pointerdown", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>("button");
  if (!b?.dataset.code) return;
  e.preventDefault(); fingers.set(e.pointerId, b.dataset.code); b.classList.add("down");
});
const fingerUp = (e: PointerEvent) => {
  const code = fingers.get(e.pointerId);
  if (!code) return;
  fingers.delete(e.pointerId);
  if (![...fingers.values()].includes(code)) touchEl.querySelector(`[data-code="${code}"]`)?.classList.remove("down");
};
addEventListener("pointerup", fingerUp); addEventListener("pointercancel", fingerUp);
touchEl.addEventListener("contextmenu", (e) => e.preventDefault());

// --- gamepad: polled once a frame ----------------------------------------------------------------------
let padKeys: string[] = [], padMove: Stick = NO_STICK, padTurn = 0;
function pollPad() {
  const pad = [...(navigator.getGamepads?.() ?? [])].find((p) => p?.connected);
  ({ keys: padKeys, stick: padMove, turn: padTurn } = pad ? readPad(pad.buttons, pad.axes) : { keys: [], stick: NO_STICK, turn: 0 });
}

function playerInput(): Input {
  const k = held ?? new Set([...keys, ...fingers.values(), ...padKeys]), on = (c: string) => k.has(c);
  const analog = held ? NO_STICK : stickFinger ? touchMove : padMove;
  // WASD and the sticks are camera-relative: W (or stick up) pushes away from the camera.
  const { fx, sx } = push(k, analog);
  const fw = new THREE.Vector3(); camera.getWorldDirection(fw); fw.y = 0; fw.normalize();
  const rt = new THREE.Vector3(-fw.z, 0, fw.x);
  const mx = fw.x * fx + rt.x * sx, mz = fw.z * fx + rt.z * sx;
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

/** Over your shoulder, never straight behind: swung off the line to them, so the two never stand in a head-on row. */
function lockCamera(me: V3, them: V3, back: number, lift: number) {
  const a = Math.atan2(them.z - me.z, them.x - me.x) + Math.PI + 0.5; // 0.5 rad off the line, to the fighter's right
  return new THREE.Vector3(me.x + Math.cos(a) * back, me.y + lift, me.z + Math.sin(a) * back);
}

function draw(m: Match, alpha: number) {
  m.f.forEach((f, i) => {
    const g = models[i]!;
    g.position.set(f.pos.x, f.pos.y, f.pos.z);
    g.rotation.y = -f.yaw;
    for (const w of g.children) if (w.name === "wing") w.rotation.x = f.flying ? Math.sin(m.tick / 4) * 0.5 : 0.9 * Math.sign(w.position.z);
    // A hit flashes white for a few ticks and fades; holding the flash through the stun hid the creature's colours.
    // Peaks well short of white: a full flash washed the hide out to a plaster cast. Invulnerability is a flicker.
    const struck = moveFx.flashOf(i as 0 | 1, m.tick) * 0.28; // bloom spreads it, so it stays low
    const flash = Math.max(struck, f.state === "charge" ? 0.3 : f.invuln ? (m.tick % 8 < 4 ? 0.12 : 0) : 0);
    const p = puppets[i];
    if (p) { p.update(f, alpha, m.tick, m.f[i ? 0 : 1].pos); p.flash(f.state === "charge" ? 0xffee88 : 0xffe8d0, flash); return; }
    const torso = g.children[0] as THREE.Mesh, mat = torso.material as THREE.MeshStandardMaterial;
    mat.emissive.setHex(f.state === "charge" ? 0xffee88 : 0xffffff); mat.emissiveIntensity = flash;
  });
  moveFx.draw(m);
  // Soft lock: behind you, looking past you at them, high enough to see a flyer.
  const [me, them] = m.f;
  const dx = them.pos.x - me.pos.x, dz = them.pos.z - me.pos.z, d = Math.hypot(dx, dz) || 1;
  // side-on far enough back that both bodies and a flyer overhead fit, however close they stand
  const side = 2.6 + Math.max(me.b.height, them.b.height) * 1.15 + d * 0.5 + Math.abs(me.pos.y - them.pos.y) * 0.45;
  const back = 6 + me.b.radius * 3, lift = 3.2 + Math.max(0, them.pos.y - me.pos.y) * 0.5;
  const want = camMode === "side"
    ? new THREE.Vector3((me.pos.x + them.pos.x) / 2 - (dz / d) * side, (me.pos.y + them.pos.y) / 2 + 1.4, (me.pos.z + them.pos.z) / 2 + (dx / d) * side) // you on the left, as the bars are
    : lockCamera(me.pos, them.pos, back, lift);
  camera.position.lerp(want, clamp(alpha * 6, 0, 1));
  // a hit shakes the camera, hardest on the tick it lands
  shake *= Math.exp(-9 * alpha);
  shove.x *= Math.exp(-7 * alpha); shove.z *= Math.exp(-7 * alpha);
  camera.position.x += shove.x; camera.position.z += shove.z;
  if (shake > 0.002) camera.position.add(new THREE.Vector3((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake));
  camera.lookAt((me.pos.x + them.pos.x) / 2, (me.pos.y + them.pos.y) / 2 + 1, (me.pos.z + them.pos.z) / 2);
}

function finish(m: Match) {
  const ko = m.events.find((e) => e.kind === "ko");
  const w = m.f[m.winner!]!, how = ko?.kind === "ko" ? { hp: "knocked out", "ring-out": "rang out", time: "outlasted on time" }[ko.how] : "";
  const lost = `${esc(m.f[m.winner ? 0 : 1]!.c.name)} ${how === "outlasted on time" ? "was outlasted on time" : how}.`;
  if (trip) {
    const { region, kind, level, id } = trip, won = m.winner === 0;
    if (won && kind === "arena") world.beat(region.n);
    const lead = m.f[0].c.name, s = world.settle(won, level, kind === "catch" ? id : undefined), caught = id ? creature(id).name : "";
    const grew = s.grew ? ` ${esc(lead)} grows to level ${s.level}.` : "";
    const next = won
      ? ({ arena: `The roads out of ${esc(region.name)} are open.`, wild: "The wild ones back off, for now.", catch: s.joined ? `${esc(caught)} joins your party.` : `Another ${esc(caught)} backs off; you have one already.` }[kind] + grew)
      : kind === "catch" ? `The ${esc(caught)} gets away.` : "You wake on the doorstep of your last arena.";
    $("#result").innerHTML = `<h2>${esc(w.c.name)} wins</h2><p>${lost} ${next}</p>
      <div class="row"><button class="go" id="back">${icon("map")} Back to the world</button></div>`;
    $("#result").hidden = false;
    $("#back").onclick = () => { enterWorld(); world.afterFight(won, kind === "catch"); };
    return;
  }
  $("#result").innerHTML = `<h2>${esc(w.c.name)} wins</h2><p>${lost}</p>
    <div class="row"><button class="go" id="again">${icon("rotate-ccw")} Rematch</button><button id="pick">${icon("users")} Pick again</button></div>`;
  $("#result").hidden = false;
  $("#again").onclick = () => start(m.f[0].c.id, m.f[1].c.id, skinSel.value, !!bots[0]);
  $("#pick").onclick = () => { $("#result").hidden = true; $("#hud").hidden = true; $("#select").hidden = false; };
}

// --- the cog: every key, in the fight and in the world, plus how far a finger drag turns the camera ----------
let paused = false, lookScale = 1; // the Controls dialog is open: the fight and the walk wait
mountControls({
  key: "mythic-masters.controls", parent: $("#controls-host"),
  keys: [
    ["WASD", "Move: sideways circles the opponent, W closes, S backs off (the world: walk)"], ["Space", "Jump / fly up"], ["C", "Fly down"], ["Shift", "Dash (the world: run)"],
    ["J", "Light attack"], ["K", "Heavy (hold Space: launcher; flying, hold C: dive)"], ["L", "Special (moving at them: beam)"],
    ["U", "Ultimate"], ["Q", "Guard (the world: turn camera left)"], ["E", "Charge (the world: turn camera right)"], ["M", "The world: open the map"],
    ["Gamepad", "A jump, X light, Y heavy, B special, LB guard, RB dash, LT fly down, RT charge, Back ultimate; left stick moves, right stick turns"],
    ["Touch", "Left thumb moves, buttons on the right; in the world a drag on the right turns the camera"],
  ],
  hide: ["lookX", "lookY", "invertY"], labels: { touch: "Camera turn by touch" },
  onChange: (s) => { lookScale = s.touch; },
  onToggle: (open) => { paused = open; keys.clear(); fingers.clear(); },
});

let last = performance.now(), acc = 0;
function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  touchEl.hidden = !(touchy && (world.shown || (m && !m.over && !bots[0])));
  touchEl.classList.toggle("world", world.shown);
  if (m && !m.over && !paused) {
    pollPad();
    if (hitStop > 0) hitStop -= dt; else acc += dt;
    while (acc >= 1 / HZ && !m.over && hitStop <= 0) {
      const cur = m;
      step(cur, [bots[0] ? bots[0](cur) : playerInput(), bots[1] ? bots[1](cur) : IDLE]);
      moveFx.events(cur, cur.events);
      for (const e of cur.events) if (e.kind === "hit" && !e.guarded) {
        shake = Math.max(shake, Math.min(0.3, e.damage / 80));
        if (e.damage >= 16) { // a heavy blow shoves the view along the way it went
          const o = cur.f[e.by], t = cur.f[1 - e.by], dx = t.pos.x - o.pos.x, dz = t.pos.z - o.pos.z, l = Math.hypot(dx, dz) || 1, push = Math.min(0.45, e.damage / 120);
          shove = { x: (dx / l) * push, z: (dz / l) * push };
        }
        if (e.damage >= 12) { hitStop = Math.min(0.11, 0.03 + e.damage / 400); acc = 0; } // the sim waits; nothing it decides changes
      }
      acc -= 1 / HZ;
      if (cur.over) finish(cur);
    }
    hud(m);
  }
  if (world.shown && !paused) {
    pollPad();
    const turn = held ? 0 : padTurn * 1.8 * dt + lookTurn;
    lookTurn = 0;
    world.update(dt, held ?? new Set([...keys, ...fingers.values(), ...padKeys]), held ? NO_STICK : stickFinger ? touchMove : padMove, turn);
  }
  else if (m) { draw(m, dt); moveFx.update(dt); } else if (shelf) shelf.update(dt); else { camera.position.set(Math.cos(now / 4000) * 22, 9, Math.sin(now / 4000) * 22); camera.lookAt(0, 0, 0); }
  const rim = arena?.getObjectByName("rim");
  if (rim) rim.position.set(-camera.position.x, Math.max(6, camera.position.y * 0.6 + 6), -camera.position.z); // behind what you see, edging it
  // the world's ground was coloured for a straight render; filmic lifts its midtones, so it walks a stop darker
  renderer.toneMappingExposure = world.shown ? 0.62 : 1;
  if (composer) composer.render(); else renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
if (!arena) arena = buildArena(scene, ALL_SKINS[skinSel.value] ?? SKINS.stadium!);
// The gallery (src/gallery.ts): a page of 16 beasts standing in a grid, names in the HUD in the same order.
let shelf: ReturnType<typeof gallery> | null = null;
function showGallery(page: number) {
  shelf?.dispose();
  for (const o of [...models, ...puppets.map((p) => p?.group)]) if (o) scene.remove(o);
  m = null; world.hide(); moveFx.clear();
  shelf = gallery(scene, camera, ROSTER, page);
  $("#select").hidden = true; $("#result").hidden = true; $("#hud").hidden = false;
  $("#hud").innerHTML = `<div class="shelf">${shelf.names.map((n) => `<span>${esc(n)}</span>`).join("")}</div>`;
}
if (params.get("gallery") !== null) showGallery(clamp(Number(params.get("gallery")) || 0, 0, Math.ceil(ROSTER.length / PAGE) - 1));
else if (params.get("world") === "1") enterWorld();
else if (params.get("a") && params.get("b")) start(pickA, pickB, skinSel.value, params.get("watch") === "1");
requestAnimationFrame(frame);

const view = (f: Fighter) => ({
  id: f.c.id, hp: Math.round(f.hp), launch: Math.round(f.launch), stamina: +f.stamina.toFixed(2), energy: Math.round(f.energy),
  state: f.state, flying: f.flying, onGround: f.onGround, clipped: f.clipped > 0, pos: { x: +f.pos.x.toFixed(2), y: +f.pos.y.toFixed(2), z: +f.pos.z.toFixed(2) },
});
Object.assign(window, {
  mythicMasters: {
    state: () => m && { tick: m.tick, over: m.over, winner: m.winner, fighters: m.f.map(view), shots: m.shots.length, ringRadius: ARENA.radius },
    start: (a: string, b: string, skin = "stadium", watch = false) => start(a, b, skin, watch),
    /** Hold these key codes (e.g. ["KeyW", "KeyJ"]) in place of the keyboard; `null` gives it back. */
    hold: (codes: string[] | null) => { held = codes ? new Set(codes) : null; },
    /** Where the camera stands in a fight: "lock" (behind you) or "side" (side-on to both, to judge a move). */
    camera: (mode: "lock" | "side") => { camMode = mode; },
    /** The open world: `enter()`, `state()` (where you are, what you've beaten, what's open and rising), `travel(n)` to an open region n's arena, `teleport(x, z)` onto open ground (`state().wilds` says where the wild ones roam), `beat(n)` as if you won its arena, `reset()`. */
    world: { enter: enterWorld, state: world.state, travel: world.travel, teleport: world.teleport, beat: world.beat, reset: world.reset },
    /** Page `n` (0-3) of the roster standing in a 4 x 4 grid, to judge the art as a set. */
    gallery: (n: number) => showGallery(n),
    roster: () => ROSTER.map((c) => ({ id: c.id, name: c.name, archetype: c.archetype, fields: c.fields, region: c.region })),
    /** What a creature knows now, what it was born knowing, and what it could be taught (move ids). */
    learnset: (id: string) => {
      const c = creature(id), { born, taught: t } = learnset(rosterCreature(id));
      return { knows: c.moves.map((mv) => ({ slot: mv.slot, id: mv.id, name: mv.name, field: mv.field })), born: born.map((mv) => mv.id), taught: t.map((mv) => mv.id) };
    },
    /** Put a creature in a state where it already knows `moveIds` (each in its own slot) for every fight after;
     * `null` forgets everything taught. Returns the move ids it couldn't learn. */
    teach: (id: string, moveIds: string[] | null) => {
      if (!moveIds) { taught.delete(id); return []; }
      let c = creature(id); const refused: string[] = [];
      for (const mv of moveIds) { const next = teach(c, mv); if (next) c = next; else refused.push(mv); }
      taught.set(id, c); drawPicker();
      return refused;
    },
    /** All 64 regions; a built one's id is also a skin for start(). */
    regions: () => REGIONS.map(({ skin, ...r }) => ({ ...r, built: !!skin })),
  },
});
