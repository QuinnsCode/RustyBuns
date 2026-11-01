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
import { keymap, KEY } from "./binds.ts";
import { clamp, esc } from "@rustybuns/util";
import { obj, str } from "@rustybuns/util/guard";
import { buildArena, SKINS } from "./arena.ts";
import { forgetBeast, loadBeast, Puppet } from "./beasts.ts";
import { bot, type Bot } from "./bot.ts";
import { bindPad, NO_STICK, PAD_DEFAULT, PAD_NAMES, PAD_START, parsePad, push, readPad, touchStick, TOUCH_BUTTONS, type Stick } from "./controls.ts";
import { icon } from "./icons.ts";
import { radar, hex, tradingCard } from "./card.ts";
import { cardOf, entry, halves, spread, type Known } from "./compendium.ts";
import { FIELDS, type Field } from "./fields.ts";
import { MAX_LIVE, MAX_LIVE_PHONE, MoveFx } from "./fx.ts";
import { gallery, PAGE } from "./gallery.ts";
import { mountAgent } from "./gallery-agent.ts";
import { creatureModel } from "./model.ts";
import { ALL_SKINS, REGIONS, type Region } from "./regions.ts";
import { body, creature as rosterCreature, learnset, ROSTER, teach, type Creature } from "./roster.ts";
import { worldView, type Foe } from "./world/view.ts";
import { accountHtml, canSignIn, finishSignIn, login, reportButton, signIn, signOut } from "./account.ts";
import { asCreature, atLevel, bind, bindBelow, bindChance, clearSection, cleared, gainXp, INK, loadJourney, moveUp, mythicOf, newJourney, nextUp, call, owns, PICKS, rest, SAVE_KEY, SECTIONS, sections, see, slots, STARTERS, TRAIL_REGIONS, toNext, WITCH_SAYS, type Journey } from "./journey.ts";
import { LORE } from "./lore.ts";
import { tierOf } from "./tiers.ts";
import { darken } from "./world/walker3d.ts";
import { abduction, Director, freeze, standoff, sweep, trail, type Stage } from "./director.ts";
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
// Each side: the pick's full card, then every fighter as a small tile (a dot per field), narrowed by the field chips.
let only: Field | null = null;
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
$("#pickerBack").addEventListener("click", () => showTitle());
drawPicker();

// The bestiary (src/card.ts): every beast's card, its pictures, its radar with the numbers, its signature.
const deck = $("#deck");
function showDeck(open: boolean) {
  if (open && !deck.querySelector(".tcard")) $("#deckCards").innerHTML = ROSTER.map(tradingCard).join("");
  deck.hidden = !open; $("#select").hidden = open;
  history.replaceState(null, "", open ? "?cards=1" : location.pathname);
}
$("#cards").addEventListener("click", () => showDeck(true));
deck.addEventListener("click", (e) => {
  const t = e.target as HTMLElement;
  if (t.closest("#deckClose")) return showDeck(false);
  const b = t.closest<HTMLElement>(".swap button"), card = b?.closest<HTMLElement>(".tcard");
  if (b && card) card.dataset.show = b.dataset.show;
});

// The creature's beast (public/models/<id>.glb, src/beasts.ts) replaces the capsule when it loads; the capsule
// stays for a beast whose files haven't been built.
/** The foe is an unknown you haven't bound: it fights as a shrouded shape, its name hidden (src/tiers.ts). */
let shroudFoe = false;
function wearBeast(f: Fighter, g: THREE.Group, i: number) {
  void loadBeast(f.c.id.replace(/^wild-/, "")).then((beast) => {
    if (!beast || models[i] !== g) return;
    const p = new Puppet(beast, f.b, f.c.archetype);
    if (i === 1 && shroudFoe) p.materials.forEach(darken);
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
// --- the director's scenes (src/director.ts): the tape, the standoffs, the freeze frames --------------------------
const director = new Director();
let poke = false; // a key or a tap this frame, to cut a scene short
let pending: { m: Match; bound: boolean } | null = null; // a fight over, its result waiting on a freeze frame
const talked = new Set<string>(); // the trail sections that have had their line on tape this session
let worldUp = false; // the world view is built (its hooks can run while it builds)

// --- the journey: your line-up, the Eldritch Compendium, how far each trail goes (src/journey.ts) ---------------------
let journey: Journey | null = (() => { try { return loadJourney(localStorage.getItem(SAVE_KEY)); } catch { return null; } })();
const saveJourney = () => { try { if (journey) localStorage.setItem(SAVE_KEY, JSON.stringify(journey)); } catch { /* a private window: this session only */ } };

// A fight the world started. `slot` is the line-up member fighting, `out` the ones already down; a keeper guards
// section k of the region's trail, a mythic its arena, a wild one roams; "deadly" is the high-level south's ambush.
interface Trip { region: Region; kind: "keeper" | "wild" | "mythic" | "deadly"; k: number; foe: Foe; slot: number; out: Set<number>; ink: number; foeHp: number | null }
let trip: Trip | null = null;
const bindable = (t: Trip | null) => !!t && t.kind !== "deadly";

function start(a: string, b: string, skin: string, watch = false) {
  trip = null; shroudFoe = false; bindNote = "";
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
  const lead = journey?.party[0]?.id ?? pickA, others = ROSTER.filter((c) => c.id !== lead), home = others.filter((c) => c.region === g.n);
  return creature((home[(g.n - 1) % Math.max(1, home.length)] ?? others.find((c) => c.region >= g.n) ?? others[0]!).id);
};
const wildOne = (g: Region): Creature => {
  const c = champion(g), big = (v: number) => Math.min(255, Math.round(v * 1.8));
  return { ...c, id: `wild-${c.id}`, name: `Wild ${c.name}`, stats: { vigor: big(c.stats.vigor), might: big(c.stats.might), guard: big(c.stats.guard), focus: big(c.stats.focus), will: big(c.stats.will), speed: big(c.stats.speed) },
    moves: c.moves.map((mv) => ({ ...mv, power: Math.min(300, Math.round(mv.power * 1.4)) })) };
};
const skinOf = (g: Region) => (ALL_SKINS[g.id] ? g.id : "stadium");
function setOut(region: Region, kind: Trip["kind"], foe: Foe, k = 0) {
  if (!journey) return;
  trip = { region, kind, k, foe, slot: nextUp(journey, new Set()), out: new Set(), ink: INK, foeHp: null };
  if (kind !== "deadly") { see(journey, foe.id); saveJourney(); }
  fightTrip();
}
/** The trip's next round: the line-up member up now against the foe, its health carried over from the last round. */
function fightTrip() {
  if (!trip || !journey) return;
  const { region, kind, foe } = trip, me = asCreature(journey.party[trip.slot]!);
  shroudFoe = kind !== "deadly" && tierOf(foe.id) === "unknown" && !owns(journey, foe.id);
  const them = kind === "deadly" ? wildOne(region) : atLevel(creature(foe.id), foe.level, kind === "wild");
  fight(me, shroudFoe ? { ...them, name: kind === "wild" ? "Wild ???" : "???" } : them, skinOf(region));
  if (m && trip.foeHp !== null) m.f[1].hp = trip.foeHp;
  bindNote = "";
  // The director's: a keeper or a mythic gets its standoff the first round; the last of the line-up gets a word.
  const f = m?.f[1];
  if (f && trip.foeHp === null && (kind === "keeper" || kind === "mythic")) {
    const sub = kind === "mythic" ? `The mythic of ${region.name} · Lv ${foe.level}` : `Keeper of ${sections(region)[trip.k]!.name} · Lv ${foe.level}`;
    director.play(standoff(kind === "mythic", f.c.name, sub, f.pos, f.b.height, trip.k));
  }
  if (shroudFoe) director.gag("nameless");
  else if (trip.out.size && trip.out.size === journey.party.length - 1) director.gag("lastUp");
}
const world = worldView(scene, camera, {
  arena: (g) => { const boss = g.tier === "playable" ? mythicOf(g) : champion(g); setOut(g, "mythic", { id: boss.id, level: sections(g)[SECTIONS - 1]!.level }, SECTIONS - 1); },
  wild: (g, foe) => setOut(g, foe ? "wild" : "deadly", foe ?? { id: champion(g).id, level: 30 }),
  keeper: (g, k) => { const s = sections(g)[k]!; setOut(g, "keeper", { id: s.keeper, level: s.level }, k); },
  cleared: (n) => (journey ? cleared(journey, n) : 0),
  owns: (id) => !!journey && owns(journey, id),
  arrived: (g, fresh) => { if (fresh && worldUp && world.shown) director.play(sweep(g.n, world.here())); },
  section: (g, k) => { const key = `${g.n}:${k}`; if (!talked.has(key) && director.play(trail(g.id, k))) talked.add(key); },
});
worldUp = true;
function hideScreens() { director.cut(); pending = null; for (const id of ["#select", "#result", "#hud", "#title", "#starters", "#journal"]) $(id).hidden = true; }
function enterWorld() {
  if (!journey) { showStarters(); return; }
  for (const o of [arena, ...models, ...puppets.map((p) => p?.group)]) if (o) scene.remove(o);
  arena = null; models = []; puppets = [null, null]; m = null; trip = null;
  moveFx.clear();
  hideScreens();
  world.show(journey.party.map(asCreature));
  history.replaceState(null, "", "?world=1");
}

// --- the title, the Bog Witch's four, the Eldritch Compendium ------------------------------------------------------------
let startingOver = false, signInNote = "";
/** The title's sign-in row: the eqosys name once signed in. */
function drawAccount() {
  $("#account").innerHTML = accountHtml(login(), canSignIn(), signInNote);
  document.querySelector("#signIn")?.addEventListener("click", () => void signIn());
  document.querySelector("#signOut")?.addEventListener("click", () => { signOut(); drawAccount(); });
}
function showTitle() {
  drawAccount();
  world.hide(); m = null; hideScreens(); startingOver = false;
  const lead = journey?.party[0];
  $("#continue").hidden = !journey;
  if (lead) $("#continue").innerHTML = `${icon("play")} Continue with ${esc(creature(lead.id).name)} (Lv ${lead.level})`;
  $("#newGame").innerHTML = `${icon("moon")} New journey`;
  $("#newGame").classList.toggle("go", !journey);
  $("#title").hidden = false;
  history.replaceState(null, "", location.pathname);
}
// You take three of the witch's five; the first one you take leads.
const chosen: string[] = [];
function showStarters() {
  world.hide(); hideScreens();
  $("#starterCards").innerHTML = STARTERS.map((id) => {
    const c = creature(id), at = chosen.indexOf(id);
    return `<button class="card starter${at >= 0 ? " on" : ""}" data-id="${id}" aria-pressed="${at >= 0}"><b>${esc(c.name)}${at >= 0 ? `<i class="pick">${at + 1}</i>` : ""}</b><small>${esc(c.archetype)} · ${c.fields.join(" / ")}</small>${radar(c)}<p>${esc(WITCH_SAYS[id])}</p></button>`;
  }).join("");
  const go = $("#setOut") as HTMLButtonElement;
  go.disabled = chosen.length !== PICKS;
  go.innerHTML = `${icon("footprints")} ${chosen.length === PICKS ? "Set out" : `Choose ${PICKS - chosen.length} more`}`;
  $("#starters").hidden = false;
}
function begin(picks: readonly string[]): boolean {
  const j = newJourney(picks);
  if (!j) return false;
  journey = j; chosen.length = 0; saveJourney(); world.reset(); enterWorld();
  director.play(abduction(world.here())); // tape 1
  return true;
}
$("#continue").addEventListener("click", () => enterWorld());
$("#newGame").addEventListener("click", () => {
  if (journey && !startingOver) { startingOver = true; $("#newGame").innerHTML = `${icon("triangle-alert")} Start over? Your compendium is burned. Click again`; return; }
  showStarters();
});
$("#versus").addEventListener("click", () => { hideScreens(); $("#select").hidden = false; history.replaceState(null, "", location.pathname); });
$("#starterCards").addEventListener("click", (e) => {
  const id = (e.target as HTMLElement).closest<HTMLElement>(".starter")?.dataset.id;
  if (!id) return;
  const at = chosen.indexOf(id);
  if (at >= 0) chosen.splice(at, 1); else if (chosen.length < PICKS) chosen.push(id);
  showStarters();
});
$("#setOut").addEventListener("click", () => begin(chosen));

type Tab = "lineup" | "bestiary" | "regions";
let tab: Tab = "lineup", picked = -1, journalOpen = false;
const TABS: [Tab, string, string][] = [["lineup", "users", "Line-up"], ["bestiary", "book-open", "Bestiary"], ["regions", "map", "Regions"]];
/** A leaf of the tome swings over on its spine when you change chapter, the page you were reading on its front:
 * forward from the right, back from the left (a phone's single page turns from its left edge). */
function turnPage(forward: boolean, was: Node) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const leaf = $("#journalBody").getBoundingClientRect(), wide = innerWidth >= 960, fromRight = forward || !wide;
  const w = wide ? leaf.width / 2 : leaf.width, top = Math.max(leaf.top, 0), h = Math.min(leaf.bottom, innerHeight) - top;
  if (h <= 0) return;
  const sheet = document.createElement("div"), face = wide && was instanceof Element ? was.querySelector(forward ? ".recto" : ".verso") : was;
  sheet.className = "turning";
  Object.assign(sheet.style, { left: `${fromRight ? leaf.right - w : leaf.left}px`, top: `${top}px`, width: `${w}px`, height: `${h}px`, transformOrigin: fromRight ? "left center" : "right center" });
  if (face) { const f = document.createElement("div"); f.className = "face"; f.style.marginTop = `${leaf.top - top}px`; f.append(...face.cloneNode(true).childNodes); sheet.append(f); }
  $("#journal").append(sheet);
  const turn = (deg: number) => `perspective(2400px) rotateY(${deg}deg)`;
  const [from, to] = !wide && !forward ? [-180, 0] : [0, forward ? -180 : 180];
  sheet.animate([{ transform: turn(from) }, { filter: "brightness(0.7)", offset: 0.5 }, { transform: turn(to), opacity: 0.3 }],
    { duration: 640, easing: "cubic-bezier(.45,.05,.3,1)" }).finished.finally(() => sheet.remove());
}
const dots = (c: Creature) => c.fields.map((f) => `<i style="background:${hex(f)}" title="${f}"></i>`).join("");
function openJournal(open = !journalOpen) {
  if (!journey || (open && !world.shown)) return;
  journalOpen = open; keys.clear(); $("#journal").querySelector(".cardpop")?.remove();
  $("#journal").hidden = !open;
  if (open) drawJournal();
}
function drawJournal() {
  const j = journey;
  if (!j) return;
  $("#journalTabs").innerHTML = TABS.map(([id, ic, label]) => `<button class="ribbon r-${id}${tab === id ? " on" : ""}" data-tab="${id}" aria-pressed="${tab === id}">${icon(ic)}${label}</button>`).join("");
  const body = $("#journalBody");
  if (tab === "lineup") {
    const row = (mm: Journey["party"][number], i: number) => {
      const c = creature(mm.id);
      return `<li class="${picked === i ? "on" : ""}" data-pick="${i}"><span class="who">${dots(c)}<b>${esc(c.name)}</b><small>Lv ${mm.level} · ${esc(c.archetype)}</small></span>
        <span class="xp" title="${mm.xp} / ${toNext(mm.level)} to the next level"><i style="width:${((mm.xp / toNext(mm.level)) * 100).toFixed(0)}%"></i></span>
        <button data-act="up" data-i="${i}" title="Move up (the top one leads)" aria-label="Move up"${i ? "" : " disabled"}>${icon("arrow-up")}</button>
        <button data-act="rest" data-i="${i}" title="Rest it in the compendium" aria-label="Rest it in the compendium"${j.party.length > 1 ? "" : " disabled"}>${icon("book-open")}</button></li>`;
    };
    body.innerHTML = spread(`<h2>Line-up · ${j.party.length} of ${slots(j)}</h2><p class="dim">Beat a region's mythic for another slot, up to six.</p><ol class="lineup">${j.party.map(row).join("")}</ol>`,
      `<h2>Resting in these pages · ${j.journal.length}</h2>`
      + (j.journal.length ? `<ul class="resting">${j.journal.map((mm, e) => { const c = creature(mm.id); return `<li><span class="who">${dots(c)}<b>${esc(c.name)}</b><small>Lv ${mm.level}</small></span>
        <button data-act="call" data-e="${e}" title="${j.party.length < slots(j) ? "Call it into the line-up" : `Swap it with ${esc(creature(j.party[picked >= 0 ? picked : j.party.length - 1]!.id).name)}`}" aria-label="Call it into the line-up">${icon("arrow-left-right")}</button></li>`; }).join("")}</ul>`
        : `<p class="dim">Nothing resting yet. Bind one when the line-up is full and the compendium keeps it.</p>`));
  } else if (tab === "bestiary") {
    const owned = new Set([...j.party, ...j.journal].map((mm) => mm.id));
    const groups = [...new Set(ROSTER.map((c) => c.region))].sort((a, b) => a - b);
    const known = (c: Creature): Known => owned.has(c.id) ? "bound" : j.seen.includes(c.id) && tierOf(c.id) !== "unknown" ? "seen" : "unknown";
    const region = (n: number) => `<h3>${n}. ${esc(REGIONS[n - 1]!.name)}</h3><div class="entries">${ROSTER.filter((c) => c.region === n)
      .map((c) => entry(c, known(c), tierOf(c.id), dots(c), j.seen.includes(c.id))).join("")}</div>`;
    const [l, r] = halves(groups, (n) => 1 + ROSTER.filter((c) => c.region === n).length);
    body.innerHTML = spread(`<h2>Bound ${owned.size} · seen ${j.seen.length} · of ${ROSTER.length}</h2><p class="dim">What you have not met is smoke on the page. Meet it in the wild and its shape shows through; bind it and the ink holds it.</p>${l.map(region).join("")}`,
      r.map(region).join(""));
  } else {
    const page = (g: (typeof TRAIL_REGIONS)[number]) => {
      const done = cleared(j, g.n), secs = sections(g);
      if (!done && !j.pages.some((p) => p.startsWith(`${g.n}:`))) return `<h3 class="dim">${g.n}. ${esc(g.name)} · not walked yet</h3>`;
      const lore = done >= SECTIONS ? LORE[g.id] : undefined;
      return `<h3>${g.n}. ${esc(g.name)} · ${done} of ${SECTIONS}</h3><ol class="pages">${secs.map((sec) =>
        j.pages.includes(`${g.n}:${sec.k}`) ? `<li><b>${esc(sec.name)}</b> ${esc(sec.lore)}</li>` : `<li class="dim">${sec.k === done ? esc(sec.name) : "Unwritten"}</li>`).join("")}</ol>`
        + (lore ? `<div class="lore"><p>${esc(lore.legend)}</p><p><b>From</b> ${esc(lore.from)}</p></div>` : "");
    };
    const [l, r] = halves(TRAIL_REGIONS, (g) => (cleared(j, g.n) || j.pages.some((p) => p.startsWith(`${g.n}:`)) ? SECTIONS : 1));
    body.innerHTML = spread(l.map(page).join(""), r.map(page).join(""));
  }
}
// A bestiary entry opens its card: the full one for a bound creature, a silhouette for one only seen.
function showCard(id: string | undefined) {
  const j = journey, old = $("#journal").querySelector(".cardpop");
  old?.remove();
  if (!j || !id) return;
  const c = creature(id), owned = [...j.party, ...j.journal].some((mm) => mm.id === id);
  const known: Known = owned ? "bound" : j.seen.includes(id) && tierOf(id) !== "unknown" ? "seen" : "unknown";
  const html = cardOf(c, known);
  if (!html) return;
  const pop = Object.assign(document.createElement("div"), { className: "cardpop", innerHTML: html });
  pop.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>(".swap button"), card = b?.closest<HTMLElement>(".tcard");
    if (b && card) card.dataset.show = b.dataset.show; else pop.remove();
  });
  $("#journal").append(pop);
}
$("#journalTabs").addEventListener("click", (e) => {
  const t = (e.target as HTMLElement).closest<HTMLElement>("[data-tab]")?.dataset.tab;
  const next = TABS.find(([id]) => id === t)?.[0];
  if (!next || next === tab) return;
  const at = (t: Tab) => TABS.findIndex(([id]) => id === t), forward = at(next) > at(tab), was = $("#journalBody").cloneNode(true);
  tab = next; drawJournal(); turnPage(forward, was);
});
$("#journalBody").addEventListener("click", (e) => {
  const j = journey, el = e.target as HTMLElement, b = el.closest<HTMLButtonElement>("button[data-act]");
  if (!j) return;
  if (!b) { const en = el.closest<HTMLElement>(".entry[data-id]"); if (en) return showCard(en.dataset.id); }
  if (!b) { const li = el.closest<HTMLElement>("[data-pick]"); if (li) { picked = Number(li.dataset.pick) === picked ? -1 : Number(li.dataset.pick); drawJournal(); } return; }
  const i = Number(b.dataset.i), ei = Number(b.dataset.e);
  if (b.dataset.act === "up") moveUp(j, i);
  if (b.dataset.act === "rest") rest(j, i);
  if (b.dataset.act === "call") call(j, ei, picked >= 0 && picked < j.party.length ? picked : j.party.length - 1);
  picked = -1; saveJourney(); drawJournal();
  world.show(j.party.map(asCreature));
});
$("#closeJournal").innerHTML = icon("x");
$("#closeJournal").addEventListener("click", () => openJournal(false));
$("#openJournal").innerHTML = icon("book-open");
$("#openJournal").addEventListener("click", () => openJournal());

// --- binding: the witch's ink, B in a fight ---------------------------------------------------------------------------
let bindNote = "";
function tryBind() {
  if (!m || m.over || !trip || !journey || !bindable(trip) || trip.ink <= 0) return;
  const mythic = trip.kind === "mythic", f = m.f[1], chance = bindChance(f.hp / f.b.hp, mythic);
  if (chance <= 0) { bindNote = `Too strong to bind yet: wear it under ${Math.round(bindBelow(mythic) * 100)}%.`; return; }
  trip.ink--;
  if (Math.random() < chance) { m.over = true; m.winner = 0; ended(m, true); return; }
  bindNote = trip.ink ? `It tore free. ${trip.ink} ink left.` : "It tore free, and the ink is spent.";
  director.gag(trip.ink ? "inkMissed" : "inkSpent");
}

window.addEventListener("keydown", (e: KeyboardEvent) => {
  if (paused) return; // the Controls dialog is open: a key there may be a new binding, not a move
  if (director.skippable && !e.repeat) poke = true;
  const code = keymap.canon(e.code); // the key pressed, as the shipped key of the action it is bound to
  if (code === "Tab" && (world.shown || journalOpen)) { e.preventDefault(); openJournal(); return; }
  if (code === "KeyB" && m && !m.over) tryBind();
  if (code) keys.add(code); if (m && !m.over && ["Space", "ShiftLeft"].includes(code)) e.preventDefault(); });
window.addEventListener("keyup", (e: KeyboardEvent) => keys.delete(keymap.canon(e.code)));
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
  if (b.dataset.code === "KeyB") tryBind();
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
const PAD_KEY = `${KEY}.pad`;
let padBinds = PAD_DEFAULT;
try { padBinds = parsePad(JSON.parse(localStorage.getItem(PAD_KEY) ?? "null")); } catch { /* the shipped buttons */ }
function pollPad() {
  const pad = [...(navigator.getGamepads?.() ?? [])].find((p) => p?.connected);
  ({ keys: padKeys, stick: padMove, turn: padTurn } = pad ? readPad(pad.buttons, pad.axes, padBinds) : { keys: [], stick: NO_STICK, turn: 0 });
}

/** Buttons that act once when pressed: Start opens or closes the journal, the bind button inks a wild one. */
let padHeld = new Set<string>();
function padEdges() {
  const pad = [...(navigator.getGamepads?.() ?? [])].find((p) => p?.connected), now = new Set<string>();
  if (pad && !paused) {
    if (pad.buttons[PAD_START]?.pressed) now.add("start");
    if (pad.buttons[padBinds.KeyB!]?.pressed) now.add("bind");
  }
  if (now.has("start") && !padHeld.has("start")) openJournal();
  if (now.has("bind") && !padHeld.has("bind") && !journalOpen) tryBind();
  padHeld = now;
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
    + `<div class="clock">${Math.ceil(99 - m.tick / HZ)}</div>`
    + (trip && bindable(trip) ? `<div class="bind">${icon("link")}<b>B</b> bind ${Math.round(bindChance(m.f[1].hp / m.f[1].b.hp, trip.kind === "mythic") * 100)}% · ink ${trip.ink}${bindNote ? `<small>${esc(bindNote)}</small>` : ""}</div>` : "");
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

/** A fight is over: a keeper's or a mythic's end, a bind or the whole line-up down holds still on a freeze frame
 * first, then the result. */
function ended(m: Match, bound = false) {
  const t = trip, won = m.winner === 0, loser = m.f[won ? 1 : 0];
  const wiped = !!t && !won && journey !== null && nextUp(journey, new Set([...t.out, t.slot])) < 0;
  const big = !!t && (bound || wiped || (won && (t.kind === "keeper" || t.kind === "mythic")));
  if (!big) {
    const ko = m.events.find((e) => e.kind === "ko");
    if (t && won && ko?.kind === "ko" && ko.how === "ring-out") director.gag("ringOut");
    finish(m, bound); return;
  }
  director.play(freeze(bound ? "bound" : won ? "won" : "lost", { ...loser.pos }, t.k));
  pending = { m, bound };
}
function finish(m: Match, bound = false) {
  const ko = m.events.find((e) => e.kind === "ko");
  const w = m.f[m.winner!]!, how = ko?.kind === "ko" ? { hp: "knocked out", "ring-out": "rang out", time: "outlasted on time" }[ko.how] : "";
  const lost = bound ? "" : `${esc(m.f[m.winner ? 0 : 1]!.c.name)} ${how === "outlasted on time" ? "was outlasted on time" : how}.`;
  if (trip && journey) { tripOver(m, bound, lost); return; }
  $("#result").innerHTML = `<div class="note paper"><h2>${esc(w.c.name)} wins</h2><p>${lost}</p>
    <div class="row"><button class="go" id="again">${icon("rotate-ccw")} Rematch</button><button id="pick">${icon("users")} Pick again</button></div></div>`;
  $("#result").hidden = false;
  $("#again").onclick = () => start(m.f[0].c.id, m.f[1].c.id, skinSel.value, !!bots[0]);
  $("#pick").onclick = () => { $("#result").hidden = true; $("#hud").hidden = true; $("#select").hidden = false; };
}

/** A world fight ended: XP, a bound creature into the line-up or the journal, a section cleared and its page written,
 * a region's roads opened; or, lost, the next of the line-up steps in, until none is left. */
function tripOver(m: Match, bound: boolean, how: string) {
  const t = trip!, j = journey!, won = m.winner === 0, me = j.party[t.slot]!, foe = creature(t.foe.id);
  const lines: string[] = [];
  let title = "", go = `${icon("map")} Back to the world`, again: (() => void) | null = null;
  if (won) {
    const ups = gainXp(me, t.foe.level), had = slots(j);
    // the section clears first, so a mythic's new line-up slot is there for the mythic itself when it's bound
    if (t.kind === "keeper" || t.kind === "mythic") clearSection(j, t.region.n, t.k);
    title = bound ? `${esc(foe.name)} is bound` : `${esc(creature(me.id).name)} wins`;
    if (bound) lines.push(`The ink holds. ${esc(foe.name)} (Lv ${t.foe.level}) ${bind(j, foe.id, t.foe.level) === "party" ? "joins your line-up" : "rests in the Eldritch Compendium"}.`);
    else lines.push(how);
    if (ups) lines.push(`${esc(creature(me.id).name)} grows to level ${me.level}.`);
    if (t.kind === "keeper" || t.kind === "mythic") {
      const sec = sections(t.region)[t.k]!;
      lines.push(`<span class="page">${icon("book-open")}<b>${esc(sec.name)}</b> ${esc(sec.lore)}</span>`);
      if (t.kind === "mythic") { world.beat(t.region.n); lines.push(`The roads out of ${esc(t.region.name)} are open.${bound ? "" : ` ${esc(foe.name)} fled into the dark: it waits at the arena to be bound.`}${slots(j) > had ? ` Your line-up has room for ${slots(j)} now.` : ""}`); }
      else lines.push(`The bog-light lifts. Section ${t.k + 2} of ${SECTIONS} is open.`);
    }
    if (t.kind === "wild" && !bound) lines.push("It slinks off into the brush.");
  } else {
    t.out.add(t.slot);
    const next = nextUp(j, t.out);
    title = `${esc(creature(me.id).name)} is down`;
    lines.push(how);
    if (next >= 0 && t.kind !== "deadly") {
      const up = creature(j.party[next]!.id);
      lines.push(`${esc(m.f[1].c.name)} has ${Math.round(m.f[1].hp)} health left.`);
      go = `${icon("arrow-left-right")} Send in ${esc(up.name)}`;
      again = () => { t.slot = next; t.foeHp = m.f[1].hp; fightTrip(); };
    } else lines.push(t.kind === "deadly" ? "You wake on the doorstep of your last arena." : "The whole line-up is down. You wake by the last stone you lit.");
  }
  saveJourney();
  $("#result").innerHTML = `<div class="note paper"><h2>${title}</h2>${lines.map((l) => `<p>${l}</p>`).join("")}<div class="row"><button class="go" id="back">${go}</button>${again ? `<button id="flee">${icon("map")} Run back</button>` : ""}</div></div>`;
  $("#result").hidden = false;
  const home = () => { trip = null; enterWorld(); world.afterFight(won); };
  $("#back").onclick = again ?? home;
  const flee = document.querySelector<HTMLElement>("#flee");
  if (flee) flee.onclick = home;
}

// --- the cog: every key, in the fight and in the world, plus how far a finger drag turns the camera ----------
let paused = false, lookScale = 1; // the Controls dialog is open: the fight and the walk wait
const GAMEPAD_ROWS: [string, string][] = [["Space", "Jump / fly up"], ["KeyJ", "Light attack"], ["KeyK", "Heavy attack"], ["KeyL", "Special"], ["KeyU", "Ultimate"], ["KeyQ", "Guard"], ["KeyE", "Charge"], ["ShiftLeft", "Dash (world: run)"], ["KeyC", "Fly down"], ["KeyB", "Bind a wild one"]];
/** The Controls tab's gamepad block: each action's button; click one, then press the new button on the pad. */
function padRows(pane: HTMLElement) {
  const box = Object.assign(document.createElement("div"), { className: "gc-binds" }), cells: (() => void)[] = [];
  let listening: string | null = null, raf = 0;
  const save = () => { try { localStorage.setItem(PAD_KEY, JSON.stringify(padBinds)); } catch { /* not kept */ } };
  const stop = () => { listening = null; cancelAnimationFrame(raf); cells.forEach((f) => f()); };
  const wait = () => { // the next button pressed on any pad (after all are let go) becomes the action's
    const pad = [...(navigator.getGamepads?.() ?? [])].find((p) => p?.connected);
    const hit = pad?.buttons.findIndex((b, i) => b.pressed && i < 12 && i !== PAD_START) ?? -1;
    if (listening && hit >= 0) { padBinds = bindPad(padBinds, listening, hit); save(); stop(); return; }
    if (listening) raf = requestAnimationFrame(wait);
  };
  for (const [code, label] of GAMEPAD_ROWS) {
    const cap = Object.assign(document.createElement("button"), { type: "button", className: "gc-key", name: `pad-${code}` });
    const def = Object.assign(document.createElement("button"), { type: "button", className: "gc-icon", title: `${label}: back to ${PAD_NAMES[PAD_DEFAULT[code]!]}`, ariaLabel: `${label}: back to default` });
    def.innerHTML = icon("undo-2");
    const paint = () => { cap.textContent = listening === code ? "Press a button..." : PAD_NAMES[padBinds[code]!] ?? "?"; cap.classList.toggle("on", listening === code); def.disabled = padBinds[code] === PAD_DEFAULT[code]; };
    cap.onclick = () => { stop(); listening = code; paint(); raf = requestAnimationFrame(wait); };
    def.onclick = () => { padBinds = bindPad(padBinds, code, PAD_DEFAULT[code]!); save(); cells.forEach((f) => f()); };
    cells.push(paint);
    box.append(Object.assign(document.createElement("span"), { textContent: label }), cap, def);
  }
  const head = Object.assign(document.createElement("h3"), { className: "gc-sub", textContent: "Gamepad buttons" });
  pane.append(head, box);
  return { sync: () => { stop(); } };
}

/** The Account tab: who is signed in through eqosys, and the way in or out. */
function accountPane(pane: HTMLElement) {
  pane.classList.add("gc-acct");
  const draw = () => {
    const who = login(), can = canSignIn();
    pane.innerHTML = who
      ? `<p>Signed in through eqosys as</p><b>${esc(who.name)}</b><button type="button" id="acctOut">${icon("log-out")} Sign out</button>`
      : can ? `<p>Sign in through eqosys to carry your name across the Q games.</p><button type="button" class="primary" id="acctIn">${icon("log-in")} Sign in with eqosys</button>`
        : `<p>Signing in opens once Mythic Masters is online. Until then you play under a local name, and your save stays in this browser.</p>`;
    if (signInNote) pane.insertAdjacentHTML("beforeend", `<p>${esc(signInNote)}</p>`);
    pane.querySelector("#acctIn")?.addEventListener("click", () => void signIn());
    pane.querySelector("#acctOut")?.addEventListener("click", () => { signOut(); draw(); drawAccount(); });
  };
  draw();
  return { sync: draw };
}

mountControls({
  key: KEY, parent: $("#controls-host"), tabs: true, title: "Settings", bindings: keymap, show: ["audio"],
  hide: ["lookX", "lookY", "invertY"], labels: { touch: "Camera turn by touch" },
  account: accountPane,
  extras: padRows,
  onChange: (s) => { lookScale = s.touch; },
  onToggle: (open) => { paused = open; keys.clear(); fingers.clear(); },
});

// --- the director's stage: its camera over yours, the saucer, the bars, the tape, the freeze frame ------------------
const shotAt = new THREE.Vector3(), shotTo = new THREE.Vector3(), shotQ = new THREE.Quaternion(), shotM = new THREE.Matrix4();
function frameShot(shot: Stage["shot"]) {
  if (!shot || shot.mix <= 0) return;
  shotAt.set(shot.from.x, shot.from.y, shot.from.z);
  shotM.lookAt(shotAt, shotTo.set(shot.at.x, shot.at.y, shot.at.z), camera.up);
  shotQ.setFromRotationMatrix(shotM);
  camera.position.lerp(shotAt, shot.mix);
  camera.quaternion.slerp(shotQ, shot.mix);
  camera.updateMatrixWorld();
}
/** The saucer: a flattened hull, a glass dome, a ring of lights, and a beam down to the ground. */
const saucer = (() => {
  const g = new THREE.Group(), metal = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, metalness: 0.85, roughness: 0.3 });
  const hull = new THREE.Mesh(new THREE.SphereGeometry(6, 40, 14), metal); hull.scale.y = 0.22; g.add(hull);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(2.4, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x9fe8c8, emissive: 0x2a6b55, transparent: true, opacity: 0.85 }));
  dome.position.y = 0.7; g.add(dome);
  const lamp = new THREE.MeshBasicMaterial({ color: 0xd8ffb0 });
  for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2, b = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 6), lamp); b.position.set(Math.cos(a) * 5.4, -0.25, Math.sin(a) * 5.4); g.add(b); }
  const beamGeo = new THREE.CylinderGeometry(1.4, 5.5, 1, 32, 1, true); beamGeo.translate(0, -0.5, 0); // hangs down from the hull, scaled to the ground
  const beamMat = new THREE.MeshBasicMaterial({ color: 0xc8ffb0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const beam = new THREE.Mesh(beamGeo, beamMat); g.add(beam);
  g.visible = false; scene.add(g);
  return { g, beam, beamMat };
})();
function stageSaucer(s: Stage["saucer"]) {
  saucer.g.visible = !!s;
  if (!s) return;
  saucer.g.position.set(s.x, s.y, s.z);
  saucer.g.rotation.y += 0.02;
  saucer.beam.scale.y = Math.max(1, s.y - (world.shown ? world.here().y : 0));
  saucer.beamMat.opacity = 0.14 * s.beam; // bloom spreads it
  saucer.beam.visible = s.beam > 0.01;
}
/** The overlay: letterbox bars, a caption, a name slammed in, the camcorder's REC light and timecode, the freeze frame. */
let lastFilter = "";
function cinema(st: Stage) {
  const cine = $("#cine");
  const on = st.bars > 0.001 || st.tape > 0.001 || st.freeze > 0.001 || !!st.caption || !!st.title;
  cine.hidden = !on;
  document.body.classList.toggle("cine-hold", director.holding);
  const filter = [st.tape > 0.01 ? `saturate(${(1 - 0.5 * st.tape).toFixed(2)}) contrast(${(1 + 0.2 * st.tape).toFixed(2)}) sepia(${(0.15 * st.tape).toFixed(2)})` : "",
    st.freeze > 0.01 ? `sepia(${(0.75 * st.freeze).toFixed(2)}) contrast(${(1 + 0.12 * st.freeze).toFixed(2)})` : ""].filter(Boolean).join(" ");
  if (filter !== lastFilter) canvas.style.filter = lastFilter = filter;
  if (!on) return;
  cine.style.setProperty("--bars", st.bars.toFixed(3));
  cine.style.setProperty("--tape", st.tape.toFixed(3));
  cine.classList.toggle("frozen", st.freeze > 0.5);
  cine.querySelector<HTMLElement>(".label")!.textContent = st.label;
  cine.querySelector<HTMLElement>(".timecode")!.textContent = st.timecode;
  const cap = cine.querySelector<HTMLElement>(".caption")!, said = st.caption ? `${st.caption.who}|${st.caption.text}` : "";
  cap.hidden = !st.caption;
  if (st.caption && cap.dataset.said !== said) { cap.dataset.said = said; cap.innerHTML = `${st.caption.who ? `<b>${esc(st.caption.who)}</b>` : ""}<span>${esc(st.caption.text)}</span>`; }
  const card = cine.querySelector<HTMLElement>(".title-card")!, named = st.title ? `${st.title.text}|${st.title.sub}` : "";
  card.hidden = !st.title;
  if (st.title && card.dataset.named !== named) { card.dataset.named = named; card.innerHTML = `<b>${esc(st.title.text)}</b><small>${esc(st.title.sub)}</small>`; }
  cine.querySelector<HTMLElement>(".skip")!.hidden = !director.skippable;
}
addEventListener("pointerdown", () => { if (director.skippable) poke = true; });

let last = performance.now(), acc = 0;
function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  padEdges();
  touchEl.hidden = !(touchy && (world.shown || (m && !m.over && !bots[0])));
  touchEl.classList.toggle("world", world.shown);
  touchEl.classList.toggle("bindable", bindable(trip));
  if (padKeys.length && director.skippable) poke = true;
  director.step(dt, poke); poke = false;
  if (pending && !director.holding) { const p = pending; pending = null; finish(p.m, p.bound); }
  if (m && !m.over && !paused && !journalOpen && !director.holding) {
    pollPad();
    if (hitStop > 0) hitStop -= dt; else acc += dt;
    while (acc >= 1 / HZ && !m.over && hitStop <= 0) {
      const cur = m;
      step(cur, [bots[0] ? bots[0](cur) : playerInput(), bots[1] ? bots[1](cur) : IDLE]);
      moveFx.events(cur, cur.events);
      for (const e of cur.events) if (e.kind === "hit" && !e.guarded) {
        if (trip && e.by === 1 && cur.f[0].hp < cur.f[0].b.hp * 0.3) director.gag("hurt");
        shake = Math.max(shake, Math.min(0.3, e.damage / 80));
        if (e.damage >= 16) { // a heavy blow shoves the view along the way it went
          const o = cur.f[e.by], t = cur.f[1 - e.by], dx = t.pos.x - o.pos.x, dz = t.pos.z - o.pos.z, l = Math.hypot(dx, dz) || 1, push = Math.min(0.45, e.damage / 120);
          shove = { x: (dx / l) * push, z: (dz / l) * push };
        }
        if (e.damage >= 12) { hitStop = Math.min(0.11, 0.03 + e.damage / 400); acc = 0; } // the sim waits; nothing it decides changes
      }
      acc -= 1 / HZ;
      if (cur.over) ended(cur);
    }
    hud(m);
  }
  if (world.shown && !paused && !journalOpen) {
    pollPad();
    const still = director.holding, turn = held || still ? 0 : padTurn * 1.8 * dt + lookTurn;
    lookTurn = 0;
    world.update(dt, still ? new Set() : held ?? new Set([...keys, ...fingers.values(), ...padKeys]), held || still ? NO_STICK : stickFinger ? touchMove : padMove, turn);
  }
  else if (m) { const t = director.stage.freeze > 0.5 ? 0 : dt; draw(m, t); moveFx.update(t); } else if (shelf) shelf.update(dt); else { camera.position.set(Math.cos(now / 4000) * 22, 9, Math.sin(now / 4000) * 22); camera.lookAt(0, 0, 0); }
  frameShot(director.stage.shot);
  stageSaucer(director.stage.saucer);
  cinema(director.stage);
  const rim = arena?.getObjectByName("rim");
  if (rim) rim.position.set(-camera.position.x, Math.max(6, camera.position.y * 0.6 + 6), -camera.position.z); // behind what you see, edging it
  // the world's ground was coloured for a straight render; filmic lifts its midtones, so it walks a stop darker
  renderer.toneMappingExposure = world.shown ? 0.62 : 1;
  if (composer) composer.render(); else renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
if (!arena) arena = buildArena(scene, ALL_SKINS[skinSel.value] ?? SKINS.stadium!);
// The gallery (src/gallery.ts): a page of 16 beasts standing in a grid, names in the HUD in the same order.
let shelf: ReturnType<typeof gallery> | null = null, shelfPage = 0;
function showGallery(page: number) {
  shelfPage = page;
  shelf?.dispose();
  for (const o of [...models, ...puppets.map((p) => p?.group)]) if (o) scene.remove(o);
  m = null; world.hide(); moveFx.clear();
  shelf = gallery(scene, camera, ROSTER, page);
  $("#select").hidden = true; $("#result").hidden = true; $("#hud").hidden = false;
  $("#hud").innerHTML = `<div class="shelf">${shelf.names.map((n) => `<span>${esc(n)}</span>`).join("")}</div>`;
}
// `bun scripts/beasts.ts --watch <id>` rebuilds a beast on a sheet save; the dev server (vite.config.ts) says so and the gallery re-stands it.
const BeastChanged = obj({ id: str(40) });
import.meta.hot?.on("beast-changed", (...a: unknown[]) => { try { forgetBeast(BeastChanged(a[0]).id); } catch { return; } if (shelf) showGallery(shelfPage); });
if (params.get("cards") === "1") showDeck(true);
else if (params.get("gallery") !== null) {
  void mountAgent({ shelf: () => shelf, page: () => shelfPage, pages: Math.ceil(ROSTER.length / PAGE), show: showGallery });
  showGallery(clamp(Number(params.get("gallery")) || 0, 0, Math.ceil(ROSTER.length / PAGE) - 1));
}
else if (params.get("world") === "1") { const a = STARTERS.find((s) => s === params.get("a")) ?? STARTERS[0]; if (!journey && params.get("a")) { journey = newJourney([a, ...STARTERS.filter((s) => s !== a)].slice(0, PICKS)); saveJourney(); } enterWorld(); }
else if (params.get("a") && params.get("b")) start(pickA, pickB, skinSel.value, params.get("watch") === "1");
else if (params.get("versus") !== null) $("#select").hidden = false;
else showTitle();
// Back from eqosys with ?code=&state=: keep the login and redraw the title with the name.
reportButton();
void finishSignIn().then((back) => { if (back) { signInNote = back.error ?? ""; drawAccount(); } });
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
    /** The open world: `enter()`, `state()` (where you are, what you've beaten, what's open and rising), `travel(n)` to an open region n's arena, `teleport(x, z)` onto open ground (`state().wilds` says where the wild ones roam, `trails()` where each keeper's stone is), `beat(n)` as if you won its arena, `reset()`. */
    world: { enter: enterWorld, state: world.state, travel: world.travel, beat: world.beat, teleport: world.teleport, reset: world.reset, trails: world.trails },
    /** The journey: `state()` (line-up, journal, sections cleared, pages), `begin([a, b, c])` a fresh one with three starters, `bind()` tries the ink
     * in a world fight, `journal(open)`, `trip()` what the current world fight is. */
    journey: {
      state: () => journey, trip: () => trip && { ...trip, out: [...trip.out], region: trip.region.n },
      begin,
      bind: tryBind,
      /** Sets the foe's health to `frac` of full in the current fight, to try a bind without fighting it down. */
      wear: (frac: number) => { if (m && !m.over) m.f[1].hp = m.f[1].b.hp * clamp(frac, 0.01, 1); },
      journal: (open: boolean) => openJournal(open), tab: (t: Tab) => { tab = t; drawJournal(); },
      /** Clears region n's sections up to k (for a harness to stand later on the trail). */
      clearTo: (n: number, k: number) => { if (!journey) return; for (let i = 0; i <= k; i++) clearSection(journey, n, i); saveJourney(); world.cleared(); },
    },
    /** Page `n` (0-3) of the roster standing in a 4 x 4 grid, to judge the art as a set. */
    gallery: (n: number) => showGallery(n),
    /** The open gallery page (its beasts, `focus(id, view)`, `silhouette(on)`), for a harness without WebMCP. */
    shelf: () => shelf,
    /** The bestiary of cards; `false` closes it. Each card's \`data-show\` says which picture is up. */
    cards: (open = true) => showDeck(open),
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
    /** The director's scene playing (src/director.ts): `state()` its id, seconds in and what's on screen; `skip()` cuts it short. */
    director: { state: () => ({ beat: director.beat, holding: director.holding, ...director.stage }), skip: () => { poke = true; } },
  },
});
