// Mythic Masters: pick two creatures and an arena, then fight a bot (or watch two), or walk the open world
// between the arenas (src/world). The sim runs at a fixed 60 Hz; this file draws it and turns the keyboard,
// a touch screen or a gamepad into an Input.
// `?a=<id>&b=<id>&skin=<name or region id>&watch=1` skips the picker, `?world=1&a=<id>` walks the world;
// `window.mythicMasters` has `state()`, `start(a, b, skin, watch)`, `hold(keys)` and `world` for an agent's browser.
import { pipOf } from "./tiles.ts";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { type Bindings, keyName, loadPad, mountControls, volumeOf } from "@rustybuns/game-controls";
import { ACTIONS, actionOf, keymap, KEY, PRESETS } from "./binds.ts";
import { clamp, esc } from "@rustybuns/util";
import { obj, str } from "@rustybuns/util/guard";
import { buildArena, crowdOf, floorOf, gradeOf, SKINS, tickArena, type Skin } from "./arena.ts";
import { forgetBeast, loadBeast, Puppet } from "./beasts.ts";
import { bot, type Bot } from "./bot.ts";
import { buttons, NO_STICK, PAD_ACTIONS, PAD_START, PAD_ZONE, push, readPad, touchStick, TOUCH_BUTTONS, type Stick } from "./controls.ts";
import { icon } from "./icons.ts";
import { ART, radar, tradingCard } from "./card.ts";
import { entry, folio, halves, neighbour, notePlate, regionChart, spread, stepTo, type Dir, type Known } from "./compendium.ts";
import { FIELDS, hex, type Field } from "./fields.ts";
import { mountFieldChart } from "./fieldchart.ts";
import { MAX_LIVE, MAX_LIVE_PHONE, MoveFx, shakeOf } from "./fx.ts";
import { gallery, PAGE } from "./gallery.ts";
import { mountAgent } from "./gallery-agent.ts";
import { addCommands } from "@rustybuns/util/commands";
import { mountPalette } from "@rustybuns/util/palette";
import { creatureModel } from "./model.ts";
import { ALL_SKINS, REGIONS, type Region } from "./regions.ts";
import { body, creature as rosterCreature, learnset, ROSTER, teach, type Creature } from "./roster.ts";
import { worldView, type Foe } from "./world/view.ts";
import { accountChip, achieve, canSignIn, finishSignIn, fresh, login, reportButton, signIn, signOut } from "./account.ts";
import { asCreature, atLevel, bind, downed, heal, hpOf, wound, bindBelow, bindChance, clearSection, cleared, gainXp, INK, loadJourney, moveUp, mythicOf, newJourney, nextUp, call, owns, PICKS, rest, SAVE_KEY, SECTIONS, sections, see, slots, STARTERS, TRAIL_REGIONS, toNext, WITCH_SAYS, type Journey, mend } from "./journey.ts";
import { LORE } from "./lore.ts";
import { bare, blank, dry, handOf, knownOf, PAGE_INK, poolOf, ribbonsOf, summon, type Summoned } from "./grimoire.ts";
import { demandOf, reactionOf, SIGNATURE, type Outcome } from "./demand.ts";
import { tierOf } from "./tiers.ts";
import { book, cardTurn, fly, penSound, pressed, soak, thumb, turnLeaf } from "./page.ts";
import { emblem, frame as ring, seal, tear } from "./ornaments.ts";
import { quill } from "./quill.ts";
import { answer as answerBook, holdOf, lossBeats, momentFor, notesOf, signedOf, spendInk, tally, type Beat, type Ctx, type Moment } from "./book.ts";
import { bookParty, type Seat } from "./book-party.ts";
import { party } from "./account.ts";
import { choosing, dress as dressHud, SKINS as HUD_SKINS, skinNow, stepSkin, useSkin } from "./hud/index.ts";
import { newMemory, remember as rememberHud, viewOf } from "./hud/skin.ts";
import { FX_AMOUNT } from "./effects.ts";
import { darken } from "./world/walker3d.ts";
import { abduction, arrival, Director, faceoff, found, freeze, lookout, SCENES, trail, type Stage, type VsCard } from "./director.ts";
import { mountScenes, playNamed, sceneLink } from "@rustybuns/util/director";
import { identified, intro, type Subject } from "./casefile.ts";
import { drowner } from "./drown.ts";
import { ambience } from "./world/ambience.ts";
import { findTape, lightFire, sight, tapeOf, tapesFound } from "./world/poi.ts";
import { close as closeHunt, HUNTS, stageOf, take, CLUES } from "./world/hunts.ts";
import { FORAGE_MEND } from "./world/nature.ts";
import { Online, roomCode } from "./net/online.ts";
import { joinParty, openParty, partyCode } from "./net/lobby.ts";
import type { Friend } from "./world/view.ts";
import { ARENA, head, held as holding, HZ, IDLE, swingPhase, type Fighter, type Input, type Match, type V3 } from "./sim.ts";
import { tsSim, wasmSim, type Live, type Sim } from "./sim-wasm.ts";
import simWasm from "./sim.wasm?url";

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const canvas = $<HTMLCanvasElement>("#view");
// A logarithmic depth buffer: the open world draws water a few metres under the ground and coasts at 8 km, which a
// linear buffer with a 0.1 m near plane fights over at that range.
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true });
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
const grade = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, tint: { value: new THREE.Color(1, 1, 1) }, saturation: { value: 1 } },
  vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
  fragmentShader: "uniform sampler2D tDiffuse; uniform vec3 tint; uniform float saturation; varying vec2 vUv; void main() { vec4 c = texture2D(tDiffuse, vUv); float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722)); gl_FragColor = vec4(mix(vec3(l), c.rgb, saturation) * tint, c.a); }",
});
const composer = matchMedia("(max-width: 700px), (pointer: coarse)").matches ? null : new EffectComposer(renderer);
if (composer) {
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.45, 0.5, 0.88));
  composer.addPass(grade);
  composer.addPass(new OutputPass());
}
/** The arena skin's light colour grade (gradeOf): a tint and saturation on the linear image, before tone mapping. */
function setGrade(skin: Skin) {
  const g = gradeOf(skin);
  grade.uniforms.tint!.value.copy(g.tint); grade.uniforms.saturation!.value = g.saturation;
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
// Walking together (#3663): `?room=CODE` (the room an eqosys party started) shares the world with the party; without it
// there is no socket and the world is yours alone.
const room = roomCode(location.search);
const online = room ? new Online(room, { onChange: () => drawTogether(), onDen: (den, who, c) => world.friendMet(den, who, c) }) : null;
// `?party=CODE`: an eqosys party's lobby over the world; the host's Start sends everyone to `?world=1&room=ROOM`.
const partyId = room ? null : partyCode(location.search);
let lobbyOpen = false;
/** The world HUD's party chip: the room and who is here (or why nobody is); with no room, "Walk together" for a signed-in player. */
function drawTogether() {
  const el = document.querySelector<HTMLElement>("#worldHud .together"), box = document.querySelector<HTMLElement>("#worldHud .lobby");
  if (!el || !box) return;
  if (partyId && !lobbyOpen) { lobbyOpen = true; box.hidden = false; joinParty(partyId, box); }
  if (!online) {
    const l = login(), can = !partyId && !!l && fresh(l);
    el.hidden = !can;
    if (can && !el.querySelector("button")) {
      el.className = "together";
      el.innerHTML = `<button type="button" title="Make a party: friends who open its link walk this world with you">${icon("users")}<b>Walk together</b></button>`;
      el.querySelector("button")!.addEventListener("click", () => void openParty());
    }
    return;
  }
  el.hidden = false;
  const n = online.ghosts.size, say = { in: n ? `${n} here with you` : "nobody else here yet", joining: "joining...", full: "room full, trying again", off: "open in another tab" }[online.status];
  el.className = `together s-${online.status}`;
  el.innerHTML = `${icon(online.status === "in" ? "users" : "wifi-off")}<b>${online.room}</b><small>${say}</small>`;
}
/** The party's others where they are this frame, in the region you stand in. */
const friendsNow = (o: Online, region: number, now: number): Friend[] => [...o.ghosts.values()].flatMap((g) => {
  const at = g.at(now);
  return at && at.region === region ? [{ id: g.id, name: g.name, lead: at.lead, follow: at.follow, x: at.x, z: at.z, yaw: at.yaw }] : [];
});
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
// The book: your hand is the line-up's ribbons and the opponent is summoned for ink. The Librarian's key (the lock,
// or ?admin=1) turns it back into the whole roster for debugging.
const ADMIN_KEY = "mythic-masters.librarian";
let librarian = params.get("admin") === "1" || (() => { try { return localStorage.getItem(ADMIN_KEY) === "1"; } catch { return false; } })();
let pageInk = PAGE_INK, summoned: Summoned | null = null, inking = false, bareLine = false;
const art = (id: string) => { const p = ART[id], pic = p?.color ?? p?.bw; return pic ? `/${pic.src}` : ""; };
const pageTile = (c: Creature, on: boolean) => `<button class="tile ribbon-tile${on ? " on" : ""}" data-side="A" data-id="${esc(c.id)}" title="${esc(c.archetype)} · ${c.fields.join(" / ")}">
  <span class="pic" style="background-image:url('${art(c.id)}')"></span><b>${esc(c.name)}</b><small>${c.fields.map((f) => `<i style="background:${hex(f)}"></i>`).join("")}</small></button>`;
// The grimoire breathes: smoke curls up off the pages and embers drift in an evil aura. Spawned once; the motion is CSS.
{
  const r = (a: number, b: number) => (a + Math.random() * (b - a)).toFixed(2);
  $("#miasma").innerHTML = Array.from({ length: 9 }, () => `<i class="smoke" style="--x:${r(0, 100)}%;--s:${r(180, 340)}px;--d:${r(9, 16)}s;--w:${r(-9, 0)}s;--dx:${r(-80, 80)}px"></i>`).join("")
    + Array.from({ length: 28 }, () => `<i class="mote" style="--x:${r(0, 100)}%;--s:${r(2, 5)}px;--d:${r(5, 11)}s;--w:${r(-11, 0)}s;--dx:${r(-60, 60)}px"></i>`).join("");
}
function drawPicker() {
  const sel = $("#select");
  sel.classList.toggle("book", !librarian);
  $("#admin").innerHTML = `${icon("lock")}${librarian ? "Librarian's key: on" : "Librarian's key"}`;
  $("#admin").setAttribute("aria-pressed", String(librarian));
  $("#fields").innerHTML = FIELDS.map((f) => `<button class="chip${only === f ? " on" : ""}" data-field="${f}"><i style="background:${hex(f)}"></i>${f}</button>`).join("");
  if (librarian) {
    const shown = ROSTER.filter((c) => !only || c.fields.includes(only));
    for (const [side, id] of [["A", pickA], ["B", pickB]] as const)
      $(`#pick${side}`).innerHTML = card(creature(id), side, true) + `<div class="tiles">${shown.map((c) => tile(c, side, c.id === id)).join("")}</div>`;
    $("#bookTag").textContent = "Size and weight are real. The small one can win.";
    return;
  }
  const hand = handOf(journey), n = ribbonsOf(journey);
  if (!params.get("a") && !hand.includes(pickA)) pickA = hand[0] ?? pickA; // your first ribbon leads, unless a link named someone
  $("#bookTag").textContent = "The Book of Things That Probably Exist. It is not responsible for what it summons.";
  $("#pickA").innerHTML = card(creature(pickA), "A", true)
    + `<h3 class="sub">Your ribbons · ${hand.length} of ${n}</h3><div class="tiles hand">${hand.map((id) => pageTile(creature(id), id === pickA)).join("")}${Array.from({ length: Math.max(0, n - hand.length) }, () => `<span class="tile empty">an empty ribbon</span>`).join("")}</div>`;
  const pots = Array.from({ length: PAGE_INK }, (_, i) => `<i class="pot${i < pageInk ? " full" : ""}"></i>`).join("");
  $("#pickB").innerHTML = card(creature(pickB), "B", true)
    + `<h3 class="sub">The circle${only ? ` of ${only}` : ""}</h3><div class="circle"><div class="pots" title="Ink left">${pots}</div>
      <button id="summon" class="go"${pageInk > 0 ? "" : " disabled"}>Summon${only ? ` from ${only}` : " anything"}</button>
      <p class="margin">${esc(summoned?.line ?? (bareLine ? bare : pageInk > 0 ? blank : dry))}</p></div>${pagesOf()}`;
  $("#pickB").classList.toggle("inking", inking);
  inking = false;
}
// The pages of the circle's field, filling in as the journey goes on: unmet beasts stay ink-smoke (src/compendium.ts).
function pagesOf(): string {
  if (!journey) return "";
  const j = journey, all = ROSTER.filter((c) => !only || c.fields.includes(only)), written = all.filter((c) => knownOf(j, c.id, tierOf(c.id)) !== "unknown").length;
  const sub = `<h3 class="sub">Pages written · ${written} of ${all.length}</h3>`;
  return only ? sub + `<div class="entries pages">${all.map((c) => entry(c, knownOf(j, c.id, tierOf(c.id)), tierOf(c.id), "", j.seen.includes(c.id))).join("")}</div>` : sub;
}
$("#select").addEventListener("click", (e) => {
  const t = e.target as HTMLElement;
  if (t.closest("#admin")) { librarian = !librarian; try { localStorage.setItem(ADMIN_KEY, librarian ? "1" : "0"); } catch { /* this session only */ } drawPicker(); return; }
  if (t.closest("#summon")) {
    if (pageInk <= 0) return;
    const s = summon(only, Math.random, poolOf(journey, ROSTER, tierOf));
    bareLine = !s;
    if (s) { pageInk--; summoned = s; pickB = s.id; inking = true; }
    drawPicker();
    return;
  }
  const chip = t.closest<HTMLElement>(".chip");
  if (chip) { const f = FIELDS.find((x) => x === chip.dataset.field) ?? null; only = only === f ? null : f; drawPicker(); return; }
  const b = t.closest<HTMLElement>(".tile[data-id]");
  if (!b) return;
  if (b.dataset.side === "A") pickA = b.dataset.id!; else pickB = b.dataset.id!;
  drawPicker();
});
$("#fight").addEventListener("click", () => { pageInk = PAGE_INK; summoned = null; start(pickA, pickB, skinSel.value, $<HTMLInputElement>("#watch").checked); });
$("#pickerBack").addEventListener("click", () => showTitle());

// The bestiary (src/card.ts): every beast's card, its pictures, its radar with the numbers, its signature.
const deck = $("#deck");
// Every menu screen is a page of one book (src/page.ts), in reading order: changing screen turns a leaf.
const pages = book(["#title", "#starters", "#select", "#deck", "#journal", "#result"].map((id) => $(id)));
function showDeck(open: boolean) {
  if (open && !deck.querySelector(".tcard")) $("#deckCards").innerHTML = ROSTER.map(tradingCard).join("");
  pages.show(open ? deck : $("#select"));
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
    const p = new Puppet(beast, f.b, f.c.archetype, f.c.fields, FX_AMOUNT[tierOf(f.c.id.replace(/^wild-/, ""))]);
    const other = m?.f[1 - i];
    p.wearTile(f.c.fields, other ? pipOf(f.c.fields, other.c.fields) : 0);
    if (i === 1 && shroudFoe) p.materials.forEach(darken);
    p.onStep = (at, speed) => moveFx.step(at, speed, f.b.radius);
    for (const o of g.children) o.visible = false;
    scene.add(p.group);
    puppets[i] = p;
  });
}

// --- a match --------------------------------------------------------------------------------------
// Fights play on the Rust sim (sim-rs/, #3657) once its wasm is in, and on sim.ts until then or if it won't load: the
// same fight either way, tick for tick (test/sim-rust.test.ts). `live` steps it; `m` is the Match everything reads.
let sim: Sim = tsSim, live: Live | null = null;
fetch(simWasm).then((r) => r.arrayBuffer()).then(wasmSim).then((s) => { sim = s; }, (e) => console.warn("sim.wasm didn't load; fights stay on sim.ts", e));
let m: Match | null = null, arena: THREE.Group | null = null, models: THREE.Group[] = [], puppets: (Puppet | null)[] = [null, null], bots: (Bot | null)[] = [null, null];
const moveFx = new MoveFx(scene, Math.random, matchMedia("(max-width: 700px)").matches ? MAX_LIVE_PHONE : MAX_LIVE);
let hitStop = 0; // seconds the fight holds still after a big hit lands, so the blow reads
let shove = { x: 0, z: 0 }; // a heavy hit's push on the camera along the blow, metres, easing back
let shake = 0; // how hard the camera is shaking after a hit, in metres, easing off
let camMode: "lock" | "side" = "lock"; // behind you looking at them, or side-on to both (for judging the art)
const keys = new Set<string>(); // the keys and mouse buttons down, by code; `actionOf` reads them as actions
let held: Set<string> | null = null; // the actions an agent asked to hold, instead of the keyboard
// --- the director's scenes (src/director.ts): the tape, the standoffs, the freeze frames --------------------------
const director = new Director();
let poke = false; // a key or a tap this frame, to cut a scene short
let pending: { m: Match; bound: boolean } | null = null; // a fight over, its result waiting on a freeze frame
const talked = new Set<string>(); // the trail sections that have had their line on tape this session
let worldUp = false; // the world view is built (its hooks can run while it builds)

// --- the journey: your line-up, the Eldritch Compendium, how far each trail goes (src/journey.ts) ---------------------
let journey: Journey | null = (() => { try { return loadJourney(localStorage.getItem(SAVE_KEY)); } catch { return null; } })();
const saveJourney = () => { try { if (journey) localStorage.setItem(SAVE_KEY, JSON.stringify(journey)); } catch { /* a private window: this session only */ } };
drawPicker(); // after the journey is loaded: the book's ribbons are its line-up

// A fight the world started. `slot` is the line-up member fighting, `out` the ones already down; a keeper guards
// section k of the region's trail, a mythic its arena, a wild one roams; "deadly" is the high-level south's ambush.
// `known` is how well you knew the foe walking in: never met, met before, or bound (its intro's case file, src/casefile.ts).
interface Trip { region: Region; kind: "keeper" | "wild" | "mythic" | "deadly"; k: number; foe: Foe; slot: number; out: Set<number>; ink: number; foeHp: number | null; known: "new" | "met" | "known" }
let trip: Trip | null = null;
const bindable = (t: Trip | null) => !!t && t.kind !== "deadly";

function start(a: string, b: string, skin: string, watch = false) {
  trip = null; shroudFoe = false; bindNote = ""; crowdView = false; crowdOf(arena)?.play(null);
  fight(creature(a), creature(b), skin, watch);
  faceUp();
  history.replaceState(null, "", `?${new URLSearchParams({ a, b, skin, ...(watch ? { watch: "1" } : {}) })}`);
}
function fight(a: Creature, b: Creature, skin: string, watch = false) {
  world.hide(); shelf?.dispose(); shelf = null;
  for (const o of [arena, ...models, ...puppets.map((p) => p?.group)]) if (o) scene.remove(o);
  puppets = [null, null]; moveFx.clear();
  const look = ALL_SKINS[skin] ?? SKINS.stadium!;
  arena = buildArena(scene, look); setGrade(look); moveFx.setGround(floorOf(look));
  camera.far = 300; camera.updateProjectionMatrix();
  try { live = sim(a, b); } catch (e) { console.warn("sim.wasm couldn't start this fight; it plays on sim.ts", e); live = tsSim(a, b); }
  m = live.m;
  if (!watch) void achieve("played");
  hudMem.now = newMemory();
  models = m.f.map((f, i) => { const g = creatureModel(f.c); scene.add(g); wearBeast(f, g, i); return g; });
  const seed = Math.floor(Math.random() * 1e6) + 1;
  bots = [watch ? bot(0, seed) : null, bot(1, seed + 1)];
  pages.show(null); $("#hud").hidden = false;
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
  const known = owns(journey, foe.id) ? "known" : journey.seen.includes(foe.id) ? "met" : "new";
  const spare = spendInk(journey); // a drop the Book handed over at a talk (src/book.ts)
  trip = { region, kind, k, foe, slot: nextUp(journey, downed(journey)), out: downed(journey), ink: INK + spare, foeHp: null, known };
  if (kind !== "deadly") see(journey, foe.id);
  if (kind !== "deadly" || spare) saveJourney();
  fightTrip();
}
/** The trip's next round: the line-up member up now against the foe, its health carried over from the last round. */
function fightTrip() {
  if (!trip || !journey) return;
  const { region, kind, foe } = trip, me = asCreature(journey.party[trip.slot]!);
  shroudFoe = kind !== "deadly" && tierOf(foe.id) === "unknown" && !owns(journey, foe.id);
  const them = kind === "deadly" ? wildOne(region) : atLevel(creature(foe.id), foe.level, kind === "wild");
  // A sighting board's creature goes by what the witnesses call it, known or not.
  fight(me, foe.title ? { ...them, name: foe.title } : shroudFoe ? { ...them, name: kind === "wild" ? "Wild ???" : "???" } : them, skinOf(region));
  if (m && trip.foeHp !== null) m.f[1].hp = trip.foeHp;
  if (m) m.f[0].hp = m.f[0].b.hp * hpOf(journey.party[trip.slot]!); // health carries between fights; a campfire clears it
  bindNote = "";
  // The director's: a keeper or a mythic gets its intro the first round, and so does a wild one you've never met;
  // the last of the line-up gets a word.
  const f = m?.f[1];
  if (f && trip.foeHp === null && (kind === "keeper" || kind === "mythic" || (kind === "wild" && (trip.known === "new" || !!foe.title)))) {
    const place = kind === "keeper" ? sections(region)[trip.k]!.name : region.name;
    const sub = kind === "mythic" ? `The mythic of ${region.name} · Lv ${foe.level}` : kind === "keeper" ? `Keeper of ${place} · Lv ${foe.level}` : foe.title ? `${foe.title} · Sighting · Lv ${foe.level}` : `Wild · Lv ${foe.level}`;
    director.play(intro(subject(foe.id, region, { kind, known: trip.known, bound: boundCount(journey), place, sub }), f.pos, f.b.height, trip.k));
  }
  faceUp(trip.foeHp === null ? "" : `Round ${trip.out.size + 1}`);
  if (shroudFoe) director.gag("nameless");
  else if (trip.out.size && trip.out.size === journey.party.length - 1) director.gag("lastUp");
}
/** Every fight's start: the two cards meet at the middle while the camera spirals down onto the pair. */
function faceUp(round = "") {
  if (!m) return;
  const [p, q] = m.f, card = (i: 0 | 1): VsCard => {
    const c = m!.f[i].c, hidden = i === 1 && shroudFoe, tier = hidden ? "unknown" : tierOf(plain(c.id));
    return { name: c.name, sub: [round, hidden ? "" : tier[0]!.toUpperCase() + tier.slice(1)].filter(Boolean).join(" · "), art: hidden ? null : artOf(c.id), tier };
  };
  director.play(faceoff(card(0), card(1), { x: (p.pos.x + q.pos.x) / 2, y: 0, z: (p.pos.z + q.pos.z) / 2 }, m.tick + (trip?.k ?? 0)));
}
/** How many different creatures the totem holds: the intros get louder with it (src/casefile.ts). */
const boundCount = (j: Journey) => new Set([...j.party, ...j.journal].map((mm) => mm.id)).size;
/** The intro's subject: creature `id` met in `region`. */
function subject(id: string, region: Region, o: Pick<Subject, "kind" | "known" | "bound" | "place" | "sub">): Subject {
  const c = creature(id);
  return { id, name: c.name, region: region.name, tier: tierOf(id), heightM: c.heightM, massKg: c.massKg, ...o,
    signature: c.moves.find((mv) => mv.slot === "ultimate")?.name ?? c.moves[0]?.name ?? "", origin: (region.lore ?? LORE[region.id])?.from ?? "" };
}
/** How the world starts a fight with what you walk into; `mythicMasters.journey.fight` starts the same ones for a harness. */
const meet = {
  arena: (g: Region) => { const boss = g.tier === "playable" ? mythicOf(g) : champion(g); setOut(g, "mythic", { id: boss.id, level: sections(g)[SECTIONS - 1]!.level }, SECTIONS - 1); },
  wild: (g: Region, foe?: Foe) => setOut(g, foe ? "wild" : "deadly", foe ?? { id: champion(g).id, level: 30 }),
  keeper: (g: Region, k: number) => { const s = sections(g)[k]!; setOut(g, "keeper", { id: s.keeper, level: s.level }, k); },
};
const world = worldView(scene, camera, {
  ...meet,
  met: (den, id) => online?.met(den, id),
  cleared: (n) => (journey ? cleared(journey, n) : 0),
  owns: (id) => !!journey && owns(journey, id),
  arrived: (g, fresh) => { if (fresh && worldUp && world.shown) director.play(arrival(g.n, world.here(), world.vista())); },
  places: {
    log: () => journey,
    // A tape plays where it lies, once, and the journal keeps it. A fire is where you rest: lit the first time, saved every time.
    // Resting also mends the line-up (`heal`), since health carries between fights.
    reach: (p) => {
      if (!journey) return;
      if (p.kind === "tape") {
        const t = tapeOf(p);
        if (journey.found.includes(p.id) || !director.play(found(t.title, t.lines, world.here(), p.tape ?? 0))) return;
        findTape(journey, p); saveJourney();
        return `Found a tape: ${t.title}`;
      }
      // A sighting board: the first visit takes its contract and plays the report; after that, where it stands.
      if (p.kind === "board") {
        const h = HUNTS.get(p.id), st = stageOf(journey, p.id);
        if (!h) return;
        if (st === undefined) {
          take(journey, p.id); saveJourney();
          director.play(found(h.title, h.report, world.here(), p.k, "SIGHTING"));
          return `Contract taken: ${h.title}. Follow the signs.`;
        }
        return st > CLUES ? `${h.title}: closed.` : st === CLUES ? `${h.title} waits at its lair.` : `${h.title}: ${st} of ${CLUES} signs read.`;
      }
      const fresh = lightFire(journey, p), mended = heal(journey); saveJourney();
      if (fresh) { const n = world.state().region; say("campfire", { n, regionId: REGIONS[n - 1]?.id }); }
      const rested = mended ? ` ${mended} mended.` : "";
      return (fresh ? "Campfire lit. You rest, and the journey is saved." : "You rest by the fire. Saved.") + rested;
    },
    // A landmark seen the first time: the slow-motion look round, unless a scene is on already.
    sight: (p) => {
      if (!journey || !sight(journey, p)) return;
      saveJourney();
      if (!director.beat) director.play(lookout(p.name, world.here(), { x: p.x, y: world.groundAt(p.x, p.z) + 6, z: p.z }, journey.sights.length));
    },
    sign: () => saveJourney(),
  },
  section: (g, k) => {
    const key = `${g.n}:${k}`;
    if (!talked.has(key) && director.play(trail(g.id, k))) talked.add(key);
    if (k === SECTIONS - 1) say("trail-end", { n: g.n, regionId: g.id, region: g.name, mythic: mythicOf(g).name });
  },
  // Wild food: a quarter of their health back to whoever is hurt.
  forage: (p) => {
    if (!journey) return;
    const helped = mend(journey, FORAGE_MEND); saveJourney();
    return `${p.name}. ${helped ? `${helped} of the line-up ${helped === 1 ? "feels" : "feel"} better.` : "Nobody was hungry."}`;
  },
});
worldUp = true;
/** Close the fight and the cut-scene, and turn to `page` (or close the book on the scene). */
function hideScreens(page: HTMLElement | null = null) { director.cut(); pending = null; $("#hud").hidden = true; pages.show(page); }
function enterWorld() {
  if (!journey) { showStarters(); return; }
  for (const o of [arena, ...models, ...puppets.map((p) => p?.group)]) if (o) scene.remove(o);
  arena = null; models = []; puppets = [null, null]; m = null; trip = null;
  moveFx.clear();
  hideScreens();
  world.show(journey.party.map(asCreature));
  drawTogether();
  history.replaceState(null, "", room ? `?world=1&room=${room}` : partyId ? `?world=1&party=${partyId}` : "?world=1");
}

// --- the title, the Bog Witch's four, the Eldritch Compendium ------------------------------------------------------------
let startingOver = false, signInNote = "";
/** The title's sign-in row: the eqosys name once signed in. */
function drawAccount() {
  accountChip($("#account"), { note: signInNote });
}
/** The book's standing demand, in its own hand on the title scroll and the compendium (src/demand.ts). */
function drawDemand() {
  const note = notesOf(journey).at(-1); // the last thing it wrote about you, under what it wants
  for (const p of document.querySelectorAll("[data-demand]")) p.innerHTML = hand(demandOf(journey), true) + (note ? `<span class="ledger">${esc(note)}</span>` : "");
}
const hand = (ask: string, signed: boolean) => `<span class="ask">${esc(ask)}</span>${signed ? `<span class="sig">${esc(SIGNATURE)}</span>` : ""}`;
/** The book's line on a result note, under its heading (src/demand.ts reactionOf). */
const reaction = (o: Outcome) => { const r = reactionOf(o, journey); return `<p class="demand">${hand(r.ask, r.signed)}</p>`; };

// --- the Book talks back (src/book.ts): at a beat the journey stops until you answer ------------------------------
// A beat queues a moment; it opens once no scene is playing and no fight is on, and the fight and the walk wait (like
// the Controls dialog) until the Book's answer is read. In a party only the host's buttons work; the rest see who it waits on.
let talking: { m: Moment; said: string | null } | null = null;
/** The party the Book answers to (src/book-party.ts), joined from `?party=CODE`; `talkParty` set by the harness overrides its seat. */
let readers: ReturnType<typeof bookParty> | null = null, readersCode: string | null = null, talkParty: Seat | null | undefined;
const talkSeat = () => (talkParty !== undefined ? talkParty : readers?.seat() ?? null);
const talkHold = () => holdOf(talkSeat(), !!readers?.freed());
const talks: Moment[] = [];
const talkEl = Object.assign(document.createElement("div"), { id: "bookTalk", className: "booktalk" });
talkEl.hidden = true;
document.body.append(talkEl);
/** A beat happened: queue what the Book has to say about it, if anything. True when it had something. */
function say(beat: Beat, ctx: Ctx = {}): boolean {
  if (!journey) return false;
  const mo = momentFor(beat, journey, { name: login()?.name, ...ctx });
  if (!mo || talking?.m.talk.id === mo.talk.id || talks.some((t) => t.talk.id === mo.talk.id)) return false;
  talks.push(mo);
  return true;
}
function drawTalk() {
  if (!talking) { talkEl.hidden = true; talkEl.innerHTML = ""; return; }
  const { m: mo, said } = talking, h = talkHold();
  const buttons = said !== null
    ? `<button class="go" data-go>${icon("arrow-right")} Go on</button>`
    : mo.talk.replies.map((r) => `<button data-r="${esc(r.id)}"${h.canAnswer ? "" : " disabled"}>${esc(r.say)}</button>`).join("");
  const lines = said !== null ? `<p class="demand">${hand(said, false)}</p>`
    : `${mo.recall ? `<p class="demand recall">${hand(mo.recall, false)}</p>` : ""}<p class="demand">${hand(mo.ask, signedOf(mo.talk))}</p>`;
  talkEl.innerHTML = `<div class="note paper" role="dialog" aria-label="The Book">${lines}<div class="replies">${buttons}</div>${h.note && said === null ? `<p class="wait">${esc(h.note)}</p>` : ""}</div>`;
  talkEl.hidden = false;
  const paper = talkEl.querySelector<HTMLElement>(".paper");
  if (paper) thumb(paper, journey?.talk?.heard.length ?? 0);
}
/** Answer the open moment with reply `id`: this page's click, or the host's answer arriving at a guest's page. A click
 * on a held page does nothing; the host's own answer goes out to the party. */
function replyBook(id: string, fromHost = false): string | null {
  if (!talking || talking.said !== null || !journey || (!fromHost && !talkHold().canAnswer)) return null;
  const talk = talking.m.talk.id, got = answerBook(journey, talking.m, id);
  if (!got) return null;
  if (!fromHost) readers?.answered(talk, id);
  saveJourney(); talking.said = got.said; drawTalk(); drawDemand();
  if (got.named) say("named", talking.m.ctx);
  return got.said;
}
talkEl.addEventListener("click", (e) => {
  const b = (e.target as Element).closest<HTMLButtonElement>("button");
  if (!b || b.disabled) return;
  if (b.dataset.r) replyBook(b.dataset.r);
  else if (b.dataset.go !== undefined) { talking = null; drawTalk(); }
});
/** Opens the next queued moment when nothing else has the screen. */
function nextTalk() {
  // the ink tearing free stops the fight itself; everything else waits for the fight to end
  if (talking || !talks.length || director.beat || (m && !m.over && talks[0]!.talk.beat !== "bind-fail")) return;
  talking = { m: talks.shift()!, said: null }; keys.clear(); drawTalk();
  readers?.opened();
}
// The title's party row, under the account row: signed in, a button makes a party (or, in one, copies its link) and a
// line says who answers the Book for everyone.
const readersEl = Object.assign(document.createElement("div"), { id: "readers", className: "account" });
$("#account").after(readersEl);
let readersNote = "";
function drawReaders() {
  const s = readers?.seat(), label = readersCode ? "Copy the party link" : "Read the Book with a party";
  const line = readersCode ? `Party ${readersCode}: ${s ? (s.host ? "you answer the Book for everyone" : `${s.hostName} answers the Book for everyone`) : "waiting for someone to join"}` : "";
  readersEl.innerHTML = login() ? `<button data-readers title="${label}" aria-label="${label}">${icon("users")}</button>${line || readersNote ? `<small class="note">${esc(readersNote || line)}</small>` : ""}` : "";
}
readersEl.addEventListener("click", async (e) => {
  if (!(e.target as Element).closest("[data-readers]")) return;
  if (!readersCode) {
    const code = await party().make();
    if (!code) { readersNote = "eqosys would not make a party just now."; drawReaders(); return; }
    joinReaders(code);
  }
  readersNote = "";
  await navigator.clipboard?.writeText(`${location.origin}${location.pathname}?party=${readersCode}`).then(() => { readersNote = "Party link copied."; }, () => {});
  drawReaders();
});
/** Read the Book with a party: `?party=CODE` once signed in (the party row's button makes one and joins it here). */
function joinReaders(code: string) {
  readers?.leave();
  readersCode = code;
  readers = bookParty(party(), code, {
    name: () => login()?.name, open: () => (talking && talking.said === null ? talking.m.talk.id : null),
    answer: (r) => void replyBook(r, true), changed: () => { drawTalk(); drawReaders(); },
  });
}
function showTitle() {
  drawAccount(); drawDemand();
  world.hide(); m = null; startingOver = false;
  const lead = journey?.party[0];
  $("#continue").hidden = !journey;
  if (lead) $("#continue").innerHTML = `${icon("play")} Continue with ${esc(creature(lead.id).name)} (Lv ${lead.level})`;
  $("#newGame").innerHTML = `${icon("moon")} New journey`;
  $("#newGame").classList.toggle("go", !journey);
  hideScreens($("#title"));
  history.replaceState(null, "", location.pathname);
}
// You take three of the witch's five; the first one you take leads.
const chosen: string[] = [];
function showStarters() {
  world.hide();
  $("#starterCards").innerHTML = STARTERS.map((id) => {
    const c = creature(id), at = chosen.indexOf(id);
    return `<button class="card starter${at >= 0 ? " on" : ""}" data-id="${id}" aria-pressed="${at >= 0}"><b>${esc(c.name)}${at >= 0 ? `<i class="pick">${at + 1}</i>` : ""}</b><small>${esc(c.archetype)} · ${c.fields.join(" / ")}</small>${radar(c)}<p>${esc(WITCH_SAYS[id])}</p></button>`;
  }).join("");
  const go = $("#setOut") as HTMLButtonElement;
  go.disabled = chosen.length !== PICKS;
  go.innerHTML = `${icon("footprints")} ${chosen.length === PICKS ? "Set out" : `Choose ${PICKS - chosen.length} more`}`;
  hideScreens($("#starters"));
}
function begin(picks: readonly string[]): boolean {
  const j = newJourney(picks);
  if (!j) return false;
  journey = j; chosen.length = 0; saveJourney(); world.reset(); enterWorld();
  director.play(abduction(world.here())); // tape 1
  say("open");
  return true;
}
$("#continue").addEventListener("click", () => enterWorld());
$("#newGame").addEventListener("click", () => {
  if (journey && !startingOver) { startingOver = true; $("#newGame").innerHTML = `${icon("triangle-alert")} Start over? Your compendium is burned. Click again`; return; }
  showStarters();
});
$("#versus").addEventListener("click", () => { hideScreens($("#select")); history.replaceState(null, "", location.pathname); });
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
/** A leaf of the tome swings over on its spine when you change chapter, the whole page you were reading on its front
 * and the next one's facing half on its back: forward from the right, back from the left (a phone's single page
 * turns from its left edge). */
function turnPage(forward: boolean, was: Node | null) {
  const tome = $("#journal").querySelector(".tome");
  if (tome) turnLeaf($("#journal"), tome.getBoundingClientRect(), was, tome, forward, innerWidth >= 960);
}
/** The whole tome as it is now (header, chapter and all), for the leaf that turns away once it is redrawn. */
const tomeNow = () => { const t = $("#journal").querySelector(".tome"); return t ? pressed(t) : null; };
const dots = (c: Creature) => c.fields.map((f) => `<i style="background:${hex(f)}" title="${f}"></i>`).join("");
function openJournal(open = !journalOpen) {
  if (!journey || (open && !world.shown)) return;
  journalOpen = open; keys.clear();
  pages.show(open ? $("#journal") : null);
  if (open) drawJournal(false);
}
/** Draws the open chapter (or the folio). An `edit` (a row moved, the quill's pick) rewrites only the lines that changed. */
function drawJournal(edit = true) {
  const j = journey;
  if (!j) return;
  drawDemand();
  $("#journalTabs").innerHTML = TABS.map(([id, ic, label]) => `<button class="ribbon r-${id}${tab === id ? " on" : ""}" data-tab="${id}" aria-pressed="${tab === id}">${icon(ic)}${label}</button>`).join("");
  $("#runningHead").textContent = TABS.find(([id]) => id === tab)?.[2] ?? ""; // the bookmark takes the chapter's colour
  for (const [c] of TABS) $("#journal").querySelector(".tome")?.classList.toggle(`c-${c}`, c === tab);
  const body = $("#journalBody");
  body.classList.toggle("folio-on", !!openFolio && tab === "bestiary");
  if (tab === "bestiary" && openFolio) {
    const id = openFolio, known: Known = knownOf(j, id, tierOf(id)), c = creature(id);
    const owned = [...j.party, ...j.journal], at = owned.findIndex((mm) => mm.id === id), slot = j.party.findIndex((mm) => mm.id === id);
    body.innerHTML = folio(c, known, { tier: tierOf(id), member: owned[at] ?? null, item: at + 1, rests: slot >= 0 ? `in the line-up, slot ${slot + 1}${slot ? "" : " (it leads)"}` : "in these pages", fol: ROSTER.indexOf(c) + 1 });
    soak(body, edit);
    return;
  }
  if (tab === "lineup") {
    const row = (mm: Journey["party"][number], i: number) => {
      const c = creature(mm.id);
      const pic = ART[c.id]?.bw ?? ART[c.id]?.color; // a small inked portrait at the head of its row, as the bestiary prints it
      return `<li class="${picked === i ? "on" : ""}" data-pick="${i}">${pic ? `<span class="mini" aria-hidden="true"><img src="/${esc(pic.src)}" alt="" decoding="async"/></span>` : ""}<span class="who">${dots(c)}<b>${esc(c.name)}</b><small>Lv ${mm.level} · ${esc(c.archetype)}${hpOf(mm) < 1 ? ` · ${hpOf(mm) > 0 ? `${Math.round(hpOf(mm) * 100)}% health` : "down"}` : ""}</small></span>
        <span class="xp" title="${mm.xp} / ${toNext(mm.level)} to the next level"><i style="width:${((mm.xp / toNext(mm.level)) * 100).toFixed(0)}%"></i><em>${mm.xp} of ${toNext(mm.level)}</em></span>
        <button data-act="up" data-i="${i}" title="Move up (the top one leads)" aria-label="Move up"${i ? "" : " disabled"}>${icon("arrow-up")}</button>
        <button data-act="rest" data-i="${i}" title="Rest it in the compendium" aria-label="Rest it in the compendium"${j.party.length > 1 ? "" : " disabled"}>${icon("book-open")}</button></li>`;
    };
    body.innerHTML = spread(`<h2>Line-up · ${j.party.length} of ${slots(j)}</h2><p class="dim">Beat a region's mythic for another slot, up to six.</p><p class="ledger-head" aria-hidden="true"><span>Beast</span><span>Ink to the next</span><span>Raise · rest</span></p><ol class="lineup">${j.party.map(row).join("")}</ol>`,
      `<h2>Resting in these pages · ${j.journal.length}</h2>`
      + (j.journal.length ? `<ul class="resting">${j.journal.map((mm, e) => { const c = creature(mm.id); return `<li><span class="who">${dots(c)}<b>${esc(c.name)}</b><small>Lv ${mm.level}</small></span>
        <button data-act="call" data-e="${e}" title="${j.party.length < slots(j) ? "Call it into the line-up" : `Swap it with ${esc(creature(j.party[picked >= 0 ? picked : j.party.length - 1]!.id).name)}`}" aria-label="Call it into the line-up">${icon("arrow-left-right")}</button></li>`; }).join("")}</ul>`
        : `<p class="dim">Nothing resting yet. Bind one when the line-up is full and the compendium keeps it.</p>`)
      // the Book's ledger on you, every note it has kept, newest first, in its own hand
      + (notesOf(j).length ? `<h2 class="of-you">What the Book has written of you</h2><ol class="book-notes">${[...notesOf(j)].reverse().map((n) => `<li>${esc(n)}</li>`).join("")}</ol>` : "")
      + `<i class="vignette rest" aria-hidden="true">${emblem("witch")}</i>`);
  } else if (tab === "bestiary") {
    const owned = new Set([...j.party, ...j.journal].map((mm) => mm.id));
    const groups = [...new Set(ROSTER.map((c) => c.region))].sort((a, b) => a - b);
    const known = (c: Creature): Known => knownOf(j, c.id, tierOf(c.id));
    // a region of one or two beasts leaves bare paper beside them: the scribe filled it with a small engraving, one of
    // the book's own, picked by the region's number (it says nothing of the beasts)
    const VIGNETTES = ["lineup", "regions", "title", "witch", "bestiary"] as const;
    const region = (n: number) => { const here = ROSTER.filter((c) => c.region === n);
      const met = here.filter((c) => known(c) !== "unknown").length; // a gloss in the Book's hand: how much of this country you know
      return `<h3>${n}. ${esc(REGIONS[n - 1]!.name)}<small class="gloss">${met ? `${met} of ${here.length} met` : "none met"}</small></h3><div class="entries">${here.map((c) => entry(c, known(c), tierOf(c.id), dots(c), j.seen.includes(c.id))).join("")}`
        + `${here.length <= 2 ? `<i class="vignette" aria-hidden="true" style="--va:${["start", "center", "end"][n % 3]};--vj:${["start", "center", "end"][(n >> 1) % 3]};--vr:${(n % 9) - 4}deg;--vw:${140 + (n % 4) * 20}px">${emblem(VIGNETTES[n % VIGNETTES.length]!)}</i>` : ""}</div>`; };
    const [l, r] = halves(groups, (n) => 1 + ROSTER.filter((c) => c.region === n).length);
    body.innerHTML = spread(`<h2>Bound ${owned.size} · seen ${j.seen.length} · of ${ROSTER.length}</h2><p class="dim">What you have not met is smoke on the page. Meet it in the wild and its shape shows through; bind it and the ink holds it. The arrows or a d-pad walk the quill; Enter or A opens a page, Esc or B turns back.</p>${l.map(region).join("")}`,
      r.map(region).join(""));
    markCursor();
  } else {
    const page = (g: (typeof TRAIL_REGIONS)[number]) => {
      const done = cleared(j, g.n), secs = sections(g);
      const reels = tapesFound(j, g.n);
      if (!done && !reels.length && !j.pages.some((p) => p.startsWith(`${g.n}:`))) return ""; // named once, under the chart
      const lore = done >= SECTIONS ? LORE[g.id] : undefined;
      // the pages written, the one you are on, and the rest noted once as a scribe would ("and 7 pages still unwritten")
      const blank = secs.filter((sec) => !j.pages.includes(`${g.n}:${sec.k}`) && sec.k !== done).length;
      return `<h3>${g.n}. ${esc(g.name)} · ${done} of ${SECTIONS}</h3><ol class="pages">${secs.map((sec) =>
        j.pages.includes(`${g.n}:${sec.k}`) ? `<li><b>${esc(sec.name)}</b> ${esc(sec.lore)}</li>` : sec.k === done ? `<li class="dim">${esc(sec.name)}</li>` : "").join("")}`
        + `${blank ? `<li class="unwritten">and ${blank} ${blank === 1 ? "page" : "pages"} still unwritten</li>` : ""}</ol>`
        + (reels.length ? `<p class="dim">Found tapes · ${reels.length}</p><ol class="pages">${reels.map((p) => { const t = tapeOf(p); return `<li><b>${esc(t.title)}</b> ${esc(t.lines.join(" "))}</li>`; }).join("")}</ol>` : "")
        + (lore ? `<div class="lore"><p>${esc(lore.legend)}</p><p><b>From</b> ${esc(lore.from)}</p></div>` : "");
    };
    const walked = (g: (typeof TRAIL_REGIONS)[number]) => !!(cleared(j, g.n) || tapesFound(j, g.n).length || j.pages.some((p) => p.startsWith(`${g.n}:`)));
    const [l, r] = halves(TRAIL_REGIONS, (g) => (walked(g) ? SECTIONS : 1));
    // the right leaf opens on the trail drawn as a traveller's chart: walked regions inked in, the rest unknown country
    const chart = () => regionChart(TRAIL_REGIONS.map((g) => ({ n: g.n, done: cleared(j, g.n), walked: walked(g) })), SECTIONS); // each copy its own ids
    // on one page (a phone) the chart opens the chapter; across two leaves it heads the right one (src/tome.css shows one)
    // the country not walked yet, written once as a line under the chart instead of a heading each
    const unknown = TRAIL_REGIONS.filter((g) => !walked(g));
    const still = unknown.length ? `<p class="unwalked"><b>Not yet walked:</b> ${unknown.map((g) => `${g.n}.&nbsp;${esc(g.name)}`).join("; ")}.</p>` : "";
    body.innerHTML = spread(chart().replace('class="chart"', 'class="chart one-page"') + still.replace('class="unwalked"', 'class="unwalked one-page"') + l.map(page).join(""),
      chart().replace('class="chart"', 'class="chart two-leaves"') + still.replace('class="unwalked"', 'class="unwalked two-leaves"') + r.map(page).join(""));
  }
  // the left page opens on the chapter's engraving, the vine rule, the Witch's blessing and what the Book wants
  body.querySelector(".verso")?.insertAdjacentHTML("afterbegin", `<div class="opening"><div class="frontis" aria-hidden="true">${emblem(tab)}</div><hr class="flourish" />`
    + `<p class="witch">Blessed by the Bog Witch of the Pine Barrens: what is written here rests here, and comes when it's called.</p><p class="demand" data-demand></p></div>`);
  drawDemand();
  soak(body, edit);
}

// --- the bestiary's folio, and a quill the d-pad walks over the entries (src/compendium.ts) ------------------------------
/** The beast whose folio is open, and the entry the quill rests on. */
let openFolio: string | null = null, cursor: string | null = null;
/** The entries you can open, in the book's order. */
const knownIds = () => (journey ? ROSTER.filter((c) => knownOf(journey!, c.id, tierOf(c.id)) !== "unknown").map((c) => c.id) : []);
function markCursor() {
  for (const el of $("#journalBody").querySelectorAll<HTMLElement>(".entry.cur")) el.classList.remove("cur");
  const on = cursor && $("#journalBody").querySelector<HTMLElement>(`.entry[data-id="${CSS.escape(cursor)}"]`);
  if (on) { on.classList.add("cur"); on.scrollIntoView({ block: "nearest", behavior: "smooth" }); } else cursor = null;
}
/** Opens a beast's page over the bestiary (a leaf turns forward and its plate lifts off the entry and grows into the
 * folio's top left), or turns back to the bestiary with `null` (the plate shrinks back onto its entry). */
function showFolio(id: string | null) {
  if (!journey || tab !== "bestiary" || (id && knownOf(journey, id, tierOf(id)) === "unknown")) return;
  const body = $("#journalBody"), was = tomeNow(), forward = !!id, beast = id ?? openFolio;
  const plate = (big: boolean) => (beast ? body.querySelector<HTMLImageElement>(big ? ".folio .plate.big img" : `.entry[data-id="${CSS.escape(beast)}"] .plate img`) : null);
  const lift = plate(!forward), from = lift?.getBoundingClientRect();
  if (!id) cursor = openFolio;
  openFolio = id;
  drawJournal(); turnPage(forward, was);
  $("#journal").scrollTo({ top: 0 });
  const land = plate(forward);
  if (!land || !lift) return;
  if (!forward) land.closest(".entry")?.scrollIntoView({ block: "center" });
  land.classList.add("landing");
  fly(lift.currentSrc || lift.src, from, land.getBoundingClientRect(), () => land.classList.remove("landing"));
}
// a swipe across a folio turns to the next beast (or the one before)
let swipeX: number | null = null;
$("#journalBody").addEventListener("pointerdown", (e) => { swipeX = openFolio && e.pointerType === "touch" ? e.clientX : null; });
$("#journalBody").addEventListener("pointerup", (e) => { if (swipeX !== null && Math.abs(e.clientX - swipeX) > 60) journalNav(e.clientX < swipeX ? "right" : "left"); swipeX = null; });
/** One press of the d-pad, the arrows or a button while the compendium is open: the quill moves (or the folio
 * flips a page), `ok` opens the entry under it, `back` turns the folio back or shuts the book, `prev` / `next` change chapter. */
function journalNav(cmd: Dir | "ok" | "back" | "prev" | "next"): boolean {
  if (!journalOpen || !journey) return false;
  if (cmd === "prev" || cmd === "next") {
    const at = TABS.findIndex(([id]) => id === tab), to = TABS[at + (cmd === "next" ? 1 : -1)];
    if (!to) return true;
    const was = tomeNow();
    openFolio = null; tab = to[0]; drawJournal(); turnPage(cmd === "next", was);
    return true;
  }
  if (openFolio) {
    if (cmd === "back") showFolio(null);
    else if (cmd === "left" || cmd === "right" || cmd === "up" || cmd === "down") {
      const to = neighbour(knownIds(), openFolio, cmd === "right" || cmd === "down" ? 1 : -1);
      if (to && to !== openFolio) { const was = tomeNow(); openFolio = to; drawJournal(); turnPage(cmd === "right" || cmd === "down", was); }
    }
    return true;
  }
  if (cmd === "back") { openJournal(false); return true; }
  if (tab === "lineup") {
    // up and down pick a row of the line-up; ok moves the picked one up (the top one leads)
    if (cmd === "up" || cmd === "down") { picked = Math.max(0, Math.min(journey.party.length - 1, (picked < 0 ? (cmd === "down" ? -1 : journey.party.length) : picked) + (cmd === "down" ? 1 : -1))); drawJournal(); return true; }
    if (cmd === "ok" && picked > 0) { moveUp(journey, picked); picked--; saveJourney(); drawJournal(); world.show(journey.party.map(asCreature)); return true; }
    return cmd === "ok";
  }
  if (tab !== "bestiary") { if (cmd === "up" || cmd === "down") $("#journal").scrollBy({ top: cmd === "up" ? -240 : 240, behavior: "smooth" }); return true; }
  if (cmd === "ok") { if (cursor) showFolio(cursor); return true; }
  const spots = [...$("#journalBody").querySelectorAll<HTMLElement>(".entry[data-id]")].map((el) => { const r = el.getBoundingClientRect(); return { id: el.dataset.id!, x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  const to = stepTo(spots, cursor, cmd);
  if (to) { cursor = to; markCursor(); }
  return true;
}
/** A key while the book is open, as a nav command: the move keys and arrows walk, Enter, Space or the attack key open, Esc or Backspace turn back, [ and ] change chapter. */
function journalKey(e: KeyboardEvent): boolean {
  const id = actionOf(e.code);
  const cmd = id === "forward" ? "up" : id === "back" ? "down" : id === "left" || id === "turnLeft" ? "left" : id === "right" || id === "turnRight" ? "right"
    : id === "light" || id === "jump" || e.code === "Enter" || e.code === "NumpadEnter" ? "ok" : e.code === "Escape" || e.code === "Backspace" ? "back"
    : e.code === "BracketLeft" ? "prev" : e.code === "BracketRight" ? "next" : null;
  return cmd ? journalNav(cmd) : false;
}
$("#journalTabs").addEventListener("click", (e) => {
  const t = (e.target as HTMLElement).closest<HTMLElement>("[data-tab]")?.dataset.tab;
  const next = TABS.find(([id]) => id === t)?.[0];
  if (!next || next === tab) return;
  const at = (t: Tab) => TABS.findIndex(([id]) => id === t), forward = at(next) > at(tab), was = tomeNow();
  openFolio = null; tab = next; drawJournal(); turnPage(forward, was);
});
$("#journalBody").addEventListener("click", (e) => {
  const j = journey, el = e.target as HTMLElement, b = el.closest<HTMLButtonElement>("button[data-act]");
  if (!j) return;
  const go = el.closest<HTMLElement>("[data-go]")?.dataset.go;
  if (go) { journalNav(go === "back" ? "back" : go === "next" ? "right" : "left"); return; }
  if (!b) { const en = el.closest<HTMLElement>(".entry[data-id]"); if (en?.dataset.id) { cursor = en.dataset.id; showFolio(en.dataset.id); return; } }
  if (!b) { const li = el.closest<HTMLElement>("[data-pick]"); if (li) { picked = Number(li.dataset.pick) === picked ? -1 : Number(li.dataset.pick); drawJournal(); } return; }
  const i = Number(b.dataset.i), ei = Number(b.dataset.e);
  if (b.dataset.act === "up") moveUp(j, i);
  if (b.dataset.act === "rest") rest(j, i);
  if (b.dataset.act === "call") call(j, ei, picked >= 0 && picked < j.party.length ? picked : j.party.length - 1);
  picked = -1; saveJourney(); drawJournal();
  world.show(j.party.map(asCreature));
});
$("#closeJournal").innerHTML = icon("x");
for (const [id, c] of [["#titleFrontis", "title"], ["#witchFrontis", "witch"], ["#versusFrontis", "title"], ["#youEmblem", "lineup"], ["#foeEmblem", "bestiary"]] as const) $(id).innerHTML = emblem(c); // the title scroll's, the Bog Witch's and the versus book's engravings
$("#titleRing").innerHTML = ring(); // the thorn ring round the title page's frontispiece (#3662 round 74)
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
  say("bind-fail", { n: trip.region.n, regionId: trip.region.id });
}

window.addEventListener("keydown", (e: KeyboardEvent) => {
  if (paused) return; // the Controls dialog is open: a key there may be a new binding, not a move
  if (director.skippable && !e.repeat) poke = true;
  const id = actionOf(e.code); // the key pressed, as the action it is bound to
  if (id === "journal" && (world.shown || journalOpen)) { e.preventDefault(); openJournal(); return; }
  if (journalOpen && !e.repeat && !(e.target instanceof HTMLInputElement) && journalKey(e)) { e.preventDefault(); return; }
  if (id === "bind" && m && !m.over && !e.repeat) tryBind();
  keys.add(e.code);
  if (m && !m.over && id && id !== "journal") e.preventDefault(); // Space, the arrows, ; and ' don't scroll or search the page
});
window.addEventListener("keyup", (e: KeyboardEvent) => keys.delete(e.code));
addEventListener("blur", () => { keys.clear(); fingers.clear(); stickFinger = null; lookFinger = null; mouseLook = false; });
/** The actions the keyboard and mouse hold now. Read through the bindings each frame, so a rebind mid-hold just works. */
const keyActions = () => { const out = new Set<string>(); for (const c of keys) { const a = actionOf(c); if (a) out.add(a); } return out; };

// --- mouse and trackpad: a click attacks and a right click (two-finger click) is strong; in the world a drag turns ------
const MOUSE = ["MouseLeft", "MouseMiddle", "MouseRight"];
let mouseLook = false;
canvas.addEventListener("mousedown", (e) => {
  if (paused || !MOUSE[e.button]) return;
  if (world.shown) { if (e.button === 0) mouseLook = true; return; }
  keys.add(MOUSE[e.button]!);
});
addEventListener("mouseup", (e: MouseEvent) => { keys.delete(MOUSE[e.button] ?? ""); if (e.button === 0) mouseLook = false; });
addEventListener("mousemove", (e: MouseEvent) => { if (mouseLook && world.shown) lookTurn += e.movementX * LOOK * lookScale; });
canvas.addEventListener("contextmenu", (e) => e.preventDefault());

// --- touch: a floating stick on the left half, buttons on the right ------------------------------------
// A thumb can roll from one button to the next without lifting. In the open world the buttons shrink to Run, and a
// drag on the right half turns the camera.
const touchEl = $("#touch"), stickEl = $("#stick"), knob = $("#stick .knob");
$("#buttons").innerHTML = TOUCH_BUTTONS.map((b) =>
  `<button class="${b.size}" data-id="${b.id}" title="${b.label}" aria-label="${b.label}">${icon(b.icon)}</button>`).join("");
const fingers = new Map<number, string>(); // pointer id -> the action its button holds
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
  let dx = e.clientX - stickFinger.x, dy = e.clientY - stickFinger.y;
  // Dragged past the rim, the stick follows the thumb, so turning back is instant instead of a long drag home.
  const n = Math.hypot(dx, dy);
  if (n > STICK_R * 1.4) { const k = STICK_R * 1.4 / n; stickFinger.x = e.clientX - dx * k; stickFinger.y = e.clientY - dy * k; dx *= k; dy *= k; stickEl.style.transform = `translate(${stickFinger.x - STICK_R}px, ${stickFinger.y - STICK_R}px)`; }
  const r = Math.max(1, Math.hypot(dx, dy) / STICK_R);
  knob.style.transform = `translate(${dx / r}px, ${dy / r}px)`;
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
const paintFingers = () => { const on = new Set(fingers.values()); touchEl.querySelectorAll<HTMLElement>("[data-id]").forEach((b) => b.classList.toggle("down", on.has(b.dataset.id!))); };
const buttonAt = (x: number, y: number) => document.elementFromPoint(x, y)?.closest<HTMLElement>("#buttons button[data-id]") ?? null;
$("#buttons").addEventListener("pointerdown", (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>("button");
  if (!b?.dataset.id) return;
  e.preventDefault(); fingers.set(e.pointerId, b.dataset.id); paintFingers();
  if (b.dataset.id === "bind") tryBind();
});
addEventListener("pointermove", (e: PointerEvent) => {
  const was = fingers.get(e.pointerId);
  if (!was) return;
  const b = buttonAt(e.clientX, e.clientY);
  if (b?.dataset.id && b.dataset.id !== was && b.dataset.id !== "bind") { fingers.set(e.pointerId, b.dataset.id); paintFingers(); }
});
const fingerUp = (e: PointerEvent) => { if (fingers.delete(e.pointerId)) paintFingers(); };
addEventListener("pointerup", fingerUp); addEventListener("pointercancel", fingerUp);
touchEl.addEventListener("contextmenu", (e) => e.preventDefault());

// --- gamepad: polled once a frame ----------------------------------------------------------------------
let padKeys: string[] = [], padMove: Stick = NO_STICK, padAim: Stick = NO_STICK;
const pad = loadPad(KEY, PAD_ACTIONS, PAD_ZONE); // buttons rebind in the Controls dialog and save under `${KEY}.pad`
let padDown: number[] = [];
function pollPad() {
  const st = pad.poll();
  padDown = st.connected ? pad.down() : [];
  ({ keys: padKeys, stick: padMove, aim: padAim } = readPad(st.held, st.left, st.right, padDown));
}

/** Buttons that act once when pressed: Start opens or closes the journal, the bind button inks a wild one. With the
 * book open the d-pad and the left stick walk the quill, A opens, B turns back, and the bumpers change chapter. */
let padHeld = new Set<string>();
const PAD_NAV: Record<number, Dir | "ok" | "back" | "prev" | "next"> = { 12: "up", 13: "down", 14: "left", 15: "right", 0: "ok", 1: "back", 4: "prev", 5: "next" };
function padEdges() {
  const now = new Set<string>(), down = paused ? [] : pad.down();
  if (down.includes(PAD_START)) now.add("start");
  if (down.includes(pad.binds.get("bind"))) now.add("bind");
  if (now.has("start") && !padHeld.has("start")) openJournal();
  if (now.has("bind") && !padHeld.has("bind") && !journalOpen) tryBind();
  if (journalOpen && !paused) {
    const { left } = pad.poll(); // the sim is not reading the pad while the book is open
    for (const i of down) { const c = PAD_NAV[i]; if (c) now.add(c); }
    if (Math.abs(left.y) > 0.6) now.add(left.y < 0 ? "up" : "down"); else if (Math.abs(left.x) > 0.6) now.add(left.x < 0 ? "left" : "right");
    for (const c of now) if (c !== "start" && c !== "bind" && !padHeld.has(c)) journalNav(c as Dir | "ok" | "back" | "prev" | "next");
  }
  padHeld = now;
}

/** Every action held, from the keyboard, the mouse, the touch buttons and a gamepad (or what an agent holds). */
const actions = () => held ?? new Set([...keyActions(), ...fingers.values(), ...padKeys]);
function playerInput(): Input {
  const k = actions();
  const analog = held ? NO_STICK : stickFinger ? touchMove : padMove;
  // Moves and the sticks are camera-relative: forward (or stick up) pushes away from the camera.
  const { fx, sx } = push(k, analog);
  const fw = new THREE.Vector3(); camera.getWorldDirection(fw); fw.y = 0; fw.normalize();
  const rt = new THREE.Vector3(-fw.z, 0, fw.x);
  return { mx: fw.x * fx + rt.x * sx, mz: fw.z * fx + rt.z * sx, ...buttons(k, held ? NO_STICK : padAim) };
}

// --- drawing ----------------------------------------------------------------------------------------
const hudMem = { now: newMemory() };
const plain = (id: string) => id.replace(/^wild-/, "");
const artOf = (id: string) => { const p = ART[plain(id)]; const pic = p?.color ?? p?.bw; return pic ? `/${pic.src}` : null; };
function hud(m: Match) {
  const root = $("#hud");
  dressHud(root);
  root.style.setProperty("--hud-in", director.stage.hud.toFixed(3));
  const party = trip && journey ? { size: journey.party.length, down: [...trip.out], up: trip.slot } : null;
  root.innerHTML = skinNow().render(viewOf(m, hudMem.now, {
    party: [party, null], bots: [!!bots[0], !!bots[1]], art: artOf, tier: (id) => tierOf(plain(id)),
    bind: trip && bindable(trip) ? { chance: bindChance(m.f[1].hp / m.f[1].b.hp, trip.kind === "mythic"), ink: trip.ink, key: keymap.get("bind").map(keyName).join(" / ") || "?", note: bindNote } : null,
  }));
  if (choosing) chooser();
}
/** ?hud=: a chip in the bottom left that names the skin and steps through them. */
function chooser() {
  let c = document.querySelector<HTMLElement>("#hudChooser");
  if (!c) {
    c = document.createElement("nav"); c.id = "hudChooser"; c.className = "hud-chooser";
    c.innerHTML = `<button data-by="-1" title="Previous HUD" aria-label="Previous HUD">&lsaquo;</button><span></span><button data-by="1" title="Next HUD" aria-label="Next HUD">&rsaquo;</button>`;
    c.addEventListener("click", (e) => { const b = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-by]") : null; if (b) stepSkin(Number(b.dataset.by)); });
    document.body.append(c);
  }
  c.hidden = $("#hud").hidden;
  const s = skinNow(), label = `${HUD_SKINS.indexOf(s)}/${HUD_SKINS.length - 1} ${s.name}`;
  const span = c.querySelector("span")!;
  if (span.textContent !== label) { span.textContent = label; span.title = s.idea; }
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
    const flash = Math.max(struck, holding(f) > 0 ? 0.3 : f.invuln ? (m.tick % 8 < 4 ? (f.state === "ledge" ? 0.2 : 0.12) : 0) : 0); // brighter in the lip's shadow
    const p = puppets[i];
    // a blow lands as a hot pulse in the hide, not a white wash: white on a grey hide reads as the texture failing
    if (p) { p.update(f, alpha, m.tick, m.f[i ? 0 : 1].pos); p.flash(holding(f) > 0 ? 0xffee88 : struck > 0.01 ? 0xff6a30 : 0xffe8d0, flash); return; }
    const torso = g.children[0] as THREE.Mesh, mat = torso.material as THREE.MeshStandardMaterial;
    mat.emissive.setHex(holding(f) > 0 ? 0xffee88 : 0xffffff); mat.emissiveIntensity = flash;
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
  // The first of its kind the totem binds is the moment you find out what it was (src/casefile.ts).
  const first = bound && journey && !owns(journey, t.foe.id) && t.kind !== "deadly" ? journey : null;
  director.play(first ? identified(t.foe.id, creature(t.foe.id).name, boundCount(first) + 1, { ...loser.pos }, t.k) : freeze(bound ? "bound" : won ? "won" : "lost", { ...loser.pos }, t.k));
  pending = { m, bound };
}
function finish(m: Match, bound = false) {
  const ko = m.events.find((e) => e.kind === "ko");
  const w = m.f[m.winner!]!, how = ko?.kind === "ko" ? { hp: "knocked out", "ring-out": "rang out", time: "outlasted on time" }[ko.how] : "";
  const lost = bound ? "" : `${esc(m.f[m.winner ? 0 : 1]!.c.name)} ${how === "outlasted on time" ? "was outlasted on time" : how}.`;
  if (trip && journey) { tripOver(m, bound, lost); return; }
  $("#result").innerHTML = `<div class="note paper"><h2>${esc(w.c.name)} wins</h2>${reaction({ kind: "versus" })}<p>${lost}</p>
    <div class="row"><button class="go" id="again">${icon("rotate-ccw")} Rematch</button><button id="pick">${icon("users")} Pick again</button></div></div>`;
  pages.show($("#result"));
  $("#again").onclick = () => start(m.f[0].c.id, m.f[1].c.id, skinSel.value, !!bots[0]);
  $("#pick").onclick = () => { $("#hud").hidden = true; pages.show($("#select")); };
}

/** A world fight ended: XP, a bound creature into the line-up or the journal, a section cleared and its page written,
 * a region's roads opened; or, lost, the next of the line-up steps in, until none is left. */
function tripOver(m: Match, bound: boolean, how: string) {
  const t = trip!, j = journey!, won = m.winner === 0, me = j.party[t.slot]!, foe = creature(t.foe.id);
  void achieve("first-fight");
  if (won) void achieve("first-win");
  if (bound) void achieve("first-bind");
  const lines: string[] = [], repeat = owns(j, foe.id);
  let title = "", outcome: Outcome = { kind: "won", foe: t.kind }, go = `${icon("map")} Back to the world`, again: (() => void) | null = null;
  if (won) {
    tally(j, false);
    const ups = gainXp(me, t.foe.level), had = slots(j);
    wound(me, m.f[0].hp / m.f[0].b.hp);
    // the section clears first, so a mythic's new line-up slot is there for the mythic itself when it's bound
    if (t.kind === "keeper" || t.kind === "mythic") clearSection(j, t.region.n, t.k);
    title = bound ? `${esc(foe.name)} is bound` : `${esc(creature(me.id).name)} wins`;
    if (bound) { const sec = sections(t.region)[t.k]; lines.push(`The ink holds. ${esc(foe.name)} (Lv ${t.foe.level}) ${bind(j, foe.id, t.foe.level, sec ? `${sec.name}, ${t.region.name}` : t.region.name) === "party" ? "joins your line-up" : "rests in the Eldritch Compendium"}.`); }
    else lines.push(how);
    if (ups) lines.push(`${esc(creature(me.id).name)} grows to level ${me.level}.`);
    if (t.kind === "keeper" || t.kind === "mythic") {
      const sec = sections(t.region)[t.k]!;
      lines.push(`<span class="page">${icon("book-open")}<b>${esc(sec.name)}</b> ${esc(sec.lore)}</span>`);
      if (t.kind === "mythic") { world.beat(t.region.n); lines.push(`The roads out of ${esc(t.region.name)} are open.${bound ? "" : ` ${esc(foe.name)} fled into the dark: it waits at the arena to be bound.`}${slots(j) > had ? ` Your line-up has room for ${slots(j)} now.` : ""}`); }
      else lines.push(`The bog-light lifts. Section ${t.k + 2} of ${SECTIONS} is open.`);
    }
    if (t.foe.hunt && closeHunt(j, t.foe.hunt)) lines.push(`The sighting is closed: ${esc(t.foe.title ?? foe.name)} won't trouble ${esc(sections(t.region)[HUNTS.get(t.foe.hunt)?.k ?? 0]!.name)} again.`);
    else if (t.kind === "wild" && !bound) lines.push("It slinks off into the brush.");
    if (bound) outcome = { kind: "bound", item: boundCount(j), repeat };
    if (bound && !repeat) say("bind", { n: t.region.n, item: boundCount(j) });
    const at = { n: t.region.n, regionId: t.region.id, region: t.region.name };
    if (t.kind === "mythic") say("mythic", { ...at, mythic: foe.name, item: boundCount(j) });
    if (t.kind === "keeper" && t.k === SECTIONS - 2) say("last-stone", { ...at, mythic: mythicOf(t.region).name });
  } else {
    t.out.add(t.slot);
    wound(me, 0);
    const next = nextUp(j, t.out);
    outcome = { kind: "down", next: next >= 0 && t.kind !== "deadly", deadly: t.kind === "deadly" };
    title = `${esc(creature(me.id).name)} is down`;
    lines.push(how);
    const lost = tally(j, true), at = { n: t.region.n, regionId: t.region.id, down: creature(me.id).name };
    lossBeats(lost, next >= 0 && t.kind !== "deadly").some((b) => say(b, at));
    if (next >= 0 && t.kind !== "deadly") {
      const up = creature(j.party[next]!.id);
      lines.push(`${esc(m.f[1].c.name)} has ${Math.round(m.f[1].hp)} health left.`);
      go = `${icon("arrow-left-right")} Send in ${esc(up.name)}`;
      again = () => { t.slot = next; t.foeHp = m.f[1].hp; fightTrip(); };
    } else {
      heal(j); // waking by the last stone mends the line-up, or nobody could fight again
      lines.push(t.kind === "deadly" ? "You wake on the doorstep of your last arena." : "The whole line-up is down. You wake by the last stone you lit.");
    }
  }
  saveJourney();
  // the note carries the outcome in art: a bind is sealed in wax, a loss tears its corner away (src/ornaments.ts)
  const torn = outcome.kind === "down" ? tear(j.journal.length + t.region.n * 7 + t.k) : null, mark = outcome.kind === "bound" ? `<i class="seal">${seal()}</i>` : torn ? `<i class="tear">${torn.svg}</i>` : "";
  const plate = outcome.kind === "bound" ? notePlate(foe, false) : outcome.kind === "down" ? notePlate(creature(me.id), true) : "";
  $("#result").innerHTML = `<div class="note paper o-${outcome.kind}"${torn ? ` style="--tear: ${torn.clip}"` : ""}>${mark}<p class="leaf-head" aria-hidden="true">Eldritch Compendium<span>fol. ${j.journal.length + j.party.length + (j.seen?.length ?? 0) + 1}</span></p>${plate}<h2>${title}</h2>${reaction(outcome)}${lines.map((l) => `<p>${l}</p>`).join("")}<div class="row"><button class="go" id="back">${go}</button>${again ? `<button id="flee">${icon("map")} Run back</button>` : ""}</div></div>`;
  pages.show($("#result"));
  const home = () => { trip = null; enterWorld(); world.afterFight(won); };
  $("#back").onclick = again ?? home;
  const flee = document.querySelector<HTMLElement>("#flee");
  if (flee) flee.onclick = home;
}

// --- the key hints under the picker and on the world map, written from the bindings as they are now ----------
const cap = (id: string) => `<b>${keymap.get(id).map((c) => esc(keyName(c))).join("</b> / <b>") || "?"}</b>`;
const walk = () => { const f = (id: string) => keyName(keymap.get(id)[0] ?? ""); return `<b>${esc(["forward", "left", "back", "right"].map(f).join(""))}</b>`; };
function drawHints() {
  const fight = document.querySelector("#fightKeys"), roam = document.querySelector("#worldKeys");
  if (fight) fight.innerHTML = `${walk()} move · ${cap("jump")} jump (a tap is a short hop; twice: air jump or fly) · ${cap("dash")} dash · ${cap("light")} attack (land it, press again: a string) · ${cap("heavy")} strong (hold for a bigger slam; with jump held: launcher) · ${cap("special")} special · ${cap("guard")} guard (in the air: drop; flying, with strong: dive) · ${cap("ultimate")} ultimate · ${cap("big")} big (hold to charge it, or to keep a stream on; the stick nudges its aim). Settings has Laptop, Mouse and Arrows layouts. A gamepad: A attack, B special, X jump, Y or the right stick strong (up: launcher), RT guard, RB dash, LB ultimate, LT big. On a phone a stick and buttons show up.`;
  if (roam) roam.innerHTML = `${walk()} walk · ${cap("dash")} run · ${cap("turnLeft")} and ${cap("turnRight")} or a mouse drag turn the camera · ${cap("map")} or a tap on the map opens it big · follow the dashed trail: the keeper on each lit stone opens the next section, wild ones roam between, and the mythic waits at the end. ${cap("journal")} opens the compendium; ${cap("bind")} in a fight binds a worn-down wild one. On a phone: the left thumb walks, a drag on the right turns. A gamepad: left stick walks, right stick turns, RB runs.`;
}

// --- the cog: every key, in the fight and in the world, plus how far a finger drag turns the camera ----------
let paused = false, lookScale = 1; // the Controls dialog is open: the fight and the walk wait
/** The Controls tab's layouts: one click puts every key where a laptop, a mouse or the arrow keys want it. */
function presetRow(pane: HTMLElement) {
  const box = Object.assign(document.createElement("div"), { className: "presets" });
  const note = Object.assign(document.createElement("p"), { className: "gc-note preset-note" });
  const paint = () => {
    const norm = (b: Bindings) => JSON.stringify(ACTIONS.map((a) => b[a.id] ?? null)), now = norm(keymap.toJSON());
    const on = PRESETS.find((p) => norm(p.keys) === now);
    box.querySelectorAll<HTMLElement>("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.preset === on?.id)));
    note.textContent = on ? `${on.label}: ${on.hint}.` : "Your own layout.";
  };
  for (const p of PRESETS) {
    const b = Object.assign(document.createElement("button"), { type: "button", className: "gc-key", textContent: p.label, title: p.hint });
    b.dataset.preset = p.id;
    b.onclick = () => {
      if (p.id === "laptop") keymap.resetAll(); else keymap.apply(p.keys);
      try { localStorage.setItem(`${KEY}.keys`, JSON.stringify(keymap.toJSON())); } catch { /* this session only */ }
      controls.refresh(); drawHints();
    };
    box.append(b);
  }
  pane.prepend(Object.assign(document.createElement("h3"), { className: "gc-sub", textContent: "Layout" }), box, note);
  paint();
  return paint;
}
/** The Controls tab's extras: the layout presets (the gamepad block is the shared one). */
function layoutRows(pane: HTMLElement) {
  const presets = presetRow(pane);
  return { sync: () => { presets(); drawHints(); } };
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

const controls = mountControls({
  key: KEY, parent: $("#controls-host"), tabs: true, title: "Settings", bindings: keymap, show: ["audio"], sounds: [["drown", "Drowned-out noises"], ["wild", "The wilds (wind, birds, rain)"], ["quill", "The quill (the book writing itself)"]],
  hide: ["lookX", "lookY", "invertY"], labels: { touch: "Camera turn by touch" },
  account: accountPane,
  extras: layoutRows, pad,
  onChange: (s) => { lookScale = s.touch; drawHints(); },
  onToggle: (open) => { paused = open; keys.clear(); fingers.clear(); const d = document.querySelector<HTMLElement>("body > .gc-dialog"); if (d) cardTurn(d, open); },
});

// The field chart, under the cog on every screen: a modal over where you are, and the fight waits while it is up.
const chart = mountFieldChart($("#controls-host"), (open) => { paused = open; keys.clear(); fingers.clear(); });

const drown = drowner(() => volumeOf(controls.get(), "sfx", "drown"));
const wilds = ambience(() => (world.shown && !paused ? volumeOf(controls.get(), "sfx", "wild") : 0));
const pen = quill(() => volumeOf(controls.get(), "sfx", "quill"));
penSound((lines, step) => pen.write(lines, step));

// --- the director's stage: its camera over yours, the saucer, the bars, the tape, the freeze frame ------------------
const shotAt = new THREE.Vector3(), shotTo = new THREE.Vector3(), shotQ = new THREE.Quaternion(), shotM = new THREE.Matrix4(), LENS = camera.fov;
function frameShot(shot: Stage["shot"]) {
  // A shot's lens, eased in by how much of the view it has; the page's own when there is none.
  const fov = shot?.fov ? LENS + (shot.fov - LENS) * shot.mix : LENS;
  if (Math.abs(camera.fov - fov) > 1e-3) { camera.fov = fov; camera.updateProjectionMatrix(); }
  if (!shot || shot.mix <= 0) return;
  shotAt.set(shot.from.x, shot.from.y, shot.from.z);
  shotM.lookAt(shotAt, shotTo.set(shot.at.x, shot.at.y, shot.at.z), camera.up);
  shotQ.setFromRotationMatrix(shotM);
  camera.position.lerp(shotAt, shot.mix);
  camera.quaternion.slerp(shotQ, shot.mix);
  if (shot.roll) camera.rotateZ(shot.roll * shot.mix);
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
  const on = st.bars > 0.001 || st.tape > 0.001 || st.freeze > 0.001 || st.dip > 0.001 || st.flash > 0.001 || st.speed > 0.001 || !!st.caption || !!st.title || !!st.versus;
  cine.hidden = !on;
  document.body.classList.toggle("cine-hold", director.holding);
  const filter = [st.tape > 0.01 ? `saturate(${(1 - 0.5 * st.tape).toFixed(2)}) contrast(${(1 + 0.2 * st.tape).toFixed(2)}) sepia(${(0.15 * st.tape).toFixed(2)})` : "",
    st.muffle > 0.01 || st.whip > 0.01 ? `blur(${(3 * st.muffle + 7 * st.whip).toFixed(2)}px)` : "", // you can't make it out either; or the camera whipped round
    st.freeze > 0.01 ? `sepia(${(0.75 * st.freeze).toFixed(2)}) contrast(${(1 + 0.12 * st.freeze).toFixed(2)})` : ""].filter(Boolean).join(" ");
  if (filter !== lastFilter) canvas.style.filter = lastFilter = filter;
  if (!on) return;
  cine.style.setProperty("--bars", st.bars.toFixed(3));
  cine.style.setProperty("--tape", st.tape.toFixed(3));
  cine.style.setProperty("--dip", st.dip.toFixed(3));
  cine.style.setProperty("--flash", st.flash.toFixed(3));
  cine.style.setProperty("--speed", st.speed.toFixed(3));
  cine.classList.toggle("frozen", st.freeze > 0.5);
  cine.classList.toggle("hold", director.holding);
  cine.classList.toggle("taped", st.tape > 0.5);
  cine.querySelector<HTMLElement>(".label")!.textContent = st.label;
  cine.querySelector<HTMLElement>(".timecode")!.textContent = st.timecode;
  const cap = cine.querySelector<HTMLElement>(".caption")!, said = st.caption ? `${st.caption.who}|${st.caption.text}` : "";
  cap.hidden = !st.caption;
  // A drowned-out line: the noise blurred, and under it the reminder that you don't know what that is yet.
  const drowned = !!st.caption && st.muffle > 0.05 && st.caption.who === "???";
  cap.classList.toggle("muffled", drowned);
  if (st.caption && cap.dataset.said !== said) {
    cap.dataset.said = said;
    const [heard, ...why] = drowned ? st.caption.text.split(" · ") : [st.caption.text];
    cap.innerHTML = `${st.caption.who ? `<b>${esc(st.caption.who)}</b>` : ""}<span>${esc(heard!)}</span>${why.length ? `<small>${esc(why.join(" · "))}</small>` : ""}`;
  }
  // The case file (src/casefile.ts): typed rows, stamps slammed on, the scan across the screen.
  const file = cine.querySelector<HTMLElement>(".file")!, scan = cine.querySelector<HTMLElement>(".scan")!, f = st.file;
  file.hidden = !f;
  scan.hidden = !f || f.scan < 0;
  if (f) {
    const typed = `${f.head}|${f.rows.join("|")}|${f.stamps.join("|")}`;
    if (file.dataset.typed !== typed) {
      file.dataset.typed = typed; file.dataset.level = String(f.level);
      file.innerHTML = `<header>${esc(f.head)}</header><ol>${f.rows.map((r) => `<li>${esc(r)}</li>`).join("")}</ol>`
        + f.stamps.map((x, i) => `<b class="stamp" style="--i:${i}">${esc(x)}</b>`).join("");
    }
    file.style.setProperty("--glitch", f.glitch.toFixed(2));
    file.classList.toggle("glitchy", f.glitch > 0);
    if (f.scan >= 0) scan.style.setProperty("--scan", f.scan.toFixed(3));
  }
  const card = cine.querySelector<HTMLElement>(".title-card")!, named = st.title ? `${st.title.text}|${st.title.sub}` : "";
  card.hidden = !st.title;
  card.classList.toggle("redacted", !!st.title?.text.includes("█"));
  if (st.title && card.dataset.named !== named) { card.dataset.named = named; card.innerHTML = `<b>${esc(st.title.text)}</b><small>${esc(st.title.sub)}</small>`; }
  // The faceoff: two cards slide in from the edges to meet at the middle, VS between them.
  const vs = cine.querySelector<HTMLElement>(".versus")!, v = st.versus;
  vs.hidden = !v;
  if (v) {
    const both = `${v.a.name}|${v.a.sub}|${v.a.art}|${v.b.name}|${v.b.sub}|${v.b.art}`;
    if (vs.dataset.both !== both) {
      vs.dataset.both = both;
      const card = (f: VsCard, k: string) => `<div class="card ${k}" style="--tier:var(--t-${esc(f.tier)})"><span class="pic"${f.art ? ` style="background-image:url('${esc(f.art)}')"` : ""}>${f.art ? "" : "?"}</span><b>${esc(f.name)}</b>${f.sub ? `<small>${esc(f.sub)}</small>` : ""}</div>`;
      vs.innerHTML = `${card(v.a, "a")}<b class="vs">VS</b>${card(v.b, "b")}`;
    }
    vs.style.setProperty("--vin", v.in.toFixed(3));
    vs.style.setProperty("--vs", v.vs.toFixed(3));
  }
  cine.querySelector<HTMLElement>(".skip")!.hidden = !director.skippable;
}
addEventListener("pointerdown", () => { if (director.skippable) poke = true; });

/** Plays a director's scene by name where you stand (or over the fight), cutting whatever was on: for a look at one.
 *  A second `t` jumps there and holds it. No name: the scenes' names. */
function playScene(name: string | undefined, k = 0, t: number | null = null): boolean | string[] {
  if (!name) return Object.keys(SCENES);
  const inWorld = world.shown, at = inWorld ? world.here() : m ? { ...m.f[1].pos } : { x: 0, y: 0, z: 0 };
  const view = inWorld ? world.vista() : { x: at.x, y: at.y + 2, z: at.z - 60 };
  return playNamed(director, SCENES, name, { at, view, n: inWorld ? world.state().region : 1, k, name: inWorld ? world.state().name : "The Arena" }, t);
}
mountScenes({ list: () => Object.keys(SCENES), play: (name, t) => playScene(name, 0, t ?? null) === true, state: () => ({ beat: director.beat, paused: director.paused, ...director.stage }) });

let last = performance.now(), acc = 0;
function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  padEdges();
  crowdOf(arena)?.update(dt);
  tickArena(arena, performance.now() / 1000);
  touchEl.hidden = !(touchy && (world.shown || (m && !m.over && !bots[0])));
  touchEl.classList.toggle("world", world.shown);
  touchEl.classList.toggle("bindable", bindable(trip));
  touchEl.classList.toggle("ult-ready", !!m && m.f[0].energy >= 100);
  if (padKeys.length && director.skippable) poke = true;
  director.step(dt, poke); poke = false;
  if (pending && !director.holding) { const p = pending; pending = null; finish(p.m, p.bound); }
  nextTalk();
  if (m && live && !m.over && !paused && !journalOpen && !director.holding && !talking) {
    pollPad();
    if (hitStop > 0) hitStop -= dt; else acc += dt;
    while (acc >= 1 / HZ && !m.over && hitStop <= 0) {
      const cur = m;
      live.step([bots[0] ? bots[0](cur) : playerInput(), bots[1] ? bots[1](cur) : IDLE]);
      moveFx.events(cur, cur.events);
      rememberHud(hudMem.now, cur);
      for (const e of cur.events) if (e.kind === "hit" && !e.guarded) {
        if (trip && e.by === 1 && cur.f[0].hp < cur.f[0].b.hp * 0.3) director.gag("hurt");
        shake = Math.max(shake, shakeOf(e.damage, e.slot));
        crowdOf(arena)?.cheer(Math.min(1, 0.3 + e.damage / 25));
        if (e.damage >= 16) { // a heavy blow shoves the view along the way it went
          const o = cur.f[e.by], t = cur.f[e.on], dx = t.pos.x - o.pos.x, dz = t.pos.z - o.pos.z, l = Math.hypot(dx, dz) || 1, push = Math.min(0.45, e.damage / 120);
          shove = { x: (dx / l) * push, z: (dz / l) * push };
        }
        if (e.damage >= 12) { hitStop = Math.min(0.11, 0.03 + e.damage / 400); acc = 0; } // the sim waits; nothing it decides changes
      }
      acc -= 1 / HZ;
      if (cur.over) ended(cur);
    }
    hud(m);
  }
  if (world.shown && !paused && !journalOpen && !talking) {
    pollPad();
    const still = director.holding, turn = held || still ? 0 : padAim.sx * 1.8 * dt + lookTurn;
    lookTurn = 0;
    const shared = online?.clock(now);
    if (shared != null) world.share(shared); // the party's one clock: the same wilds, sun and weather for everyone
    world.update(dt * director.stage.slow, still ? new Set() : actions(), held || still ? NO_STICK : stickFinger ? touchMove : padMove, turn);
    if (online) { const p = world.pose(); online.update(p.region, p.x, p.z, p.yaw, p.lead, now, p.follow); world.friends(friendsNow(online, p.region, now), dt); }
  }
  else if (m) { const t = director.stage.freeze > 0.5 ? 0 : dt * director.stage.slow; draw(m, t); moveFx.update(t); } else if (shelf) shelf.update(dt); else if (crowdView) crowdCam(now); else { camera.position.set(Math.cos(now / 4000) * 22, 9, Math.sin(now / 4000) * 22); camera.lookAt(0, 0, 0); }
  frameShot(director.stage.shot);
  stageSaucer(director.stage.saucer);
  cinema(director.stage);
  drown.update(director.stage);
  wilds.update(world.ambient(), dt);
  const rim = arena?.getObjectByName("rim");
  if (rim) rim.position.set(-camera.position.x, Math.max(6, camera.position.y * 0.6 + 6), -camera.position.z); // behind what you see, edging it
  // the world's ground was coloured for a straight render; filmic lifts its midtones, so it walks a stop darker
  renderer.toneMappingExposure = world.shown ? 0.62 : 1;
  grade.enabled = !world.shown; // the open world is graded by its own ground; only an arena wears its skin's grade
  if (composer) composer.render(); else renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
if (!arena) { const look = ALL_SKINS[skinSel.value] ?? SKINS.stadium!; arena = buildArena(scene, look); setGrade(look); }
// The gallery (src/gallery.ts): a page of 16 beasts standing in a grid, names in the HUD in the same order.
let shelf: ReturnType<typeof gallery> | null = null, shelfPage = 0;
function showGallery(page: number) {
  shelfPage = page; crowdView = false;
  shelf?.dispose();
  for (const o of [...models, ...puppets.map((p) => p?.group)]) if (o) scene.remove(o);
  m = null; world.hide(); moveFx.clear();
  shelf = gallery(scene, camera, ROSTER, page);
  pages.show(null); $("#hud").hidden = false;
  $("#hud").innerHTML = `<div class="shelf">${shelf.names.map((n) => `<span>${esc(n)}</span>`).join("")}</div>`;
}
// `bun scripts/beasts.ts --watch <id>` rebuilds a beast on a sheet save; the dev server (vite.config.ts) says so and the gallery re-stands it.
const BeastChanged = obj({ id: str(40) });
import.meta.hot?.on("beast-changed", (...a: unknown[]) => { try { forgetBeast(BeastChanged(a[0]).id); } catch { return; } if (shelf) showGallery(shelfPage); });
// `?crowd=<clip>`: the stadium's stands up close, everyone doing one recorded cheer (src/crowd.ts), to approve a take.
let crowdView = false;
const crowdCam = (now: number) => { const t = now / 9000; camera.position.set(Math.cos(t) * 13, 2.6, Math.sin(t) * 13); camera.lookAt(Math.cos(t) * 24, 3.4, Math.sin(t) * 24); };
function showCrowd(clip: string | null) {
  shelf?.dispose(); shelf = null;
  for (const o of [...models, ...puppets.map((p) => p?.group)]) if (o) scene.remove(o);
  m = null; world.hide(); moveFx.clear();
  if (!crowdOf(arena)) { if (arena) scene.remove(arena); arena = buildArena(scene, SKINS.stadium!); setGrade(SKINS.stadium!); }
  const crowd = crowdOf(arena)!;
  crowdView = true;
  crowd.play(clip ?? crowd.state().clips[0]!);
  pages.show(null); $("#hud").hidden = false;
  const now = crowd.state();
  $("#hud").innerHTML = `<div class="shelf">${[...now.clips, "mixed"].map((c) => `<button data-clip="${esc(c)}"${(now.playing ?? "mixed") === c ? " aria-pressed=\"true\"" : ""}>${esc(c)}</button>`).join("")}<span>${now.people} people, ${now.cast} cast, ${now.draws} draws</span></div>`;
  $("#hud").querySelectorAll<HTMLButtonElement>("[data-clip]").forEach((b) => b.addEventListener("click", () => {
    const c = b.dataset.clip!;
    if (c === "mixed") { crowd.play(null); crowd.cheer(1); } else crowd.play(c);
    $("#hud").querySelectorAll("[data-clip]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
  }));
}
if (params.get("cards") === "1") showDeck(true);
else if (params.get("crowd") !== null) showCrowd(params.get("crowd") || null);
else if (params.get("gallery") !== null) {
  mountAgent({ shelf: () => shelf, page: () => shelfPage, pages: Math.ceil(ROSTER.length / PAGE), show: showGallery });
  mountPalette();
  showGallery(clamp(Number(params.get("gallery")) || 0, 0, Math.ceil(ROSTER.length / PAGE) - 1));
}
else if (params.get("world") === "1") { const a = STARTERS.find((s) => s === params.get("a")) ?? STARTERS[0]; if (!journey && params.get("a")) { journey = newJourney([a, ...STARTERS.filter((s) => s !== a)].slice(0, PICKS)); saveJourney(); } enterWorld(); }
else if (params.get("a") && params.get("b")) start(pickA, pickB, skinSel.value, params.get("watch") === "1");
else if (params.get("versus") !== null) pages.show($("#select"));
else showTitle();
// ?scene=<name>&t=<seconds> (@rustybuns/util/director): one of the director's scenes over a fight (the a and b of the
// link, or the first two), held at second t, for a look at one frame without playing to it.
const link = sceneLink(params.toString()); // params: the title has put its own address up by now
if (link) {
  if (!m && !world.shown) start(pickA, pickB, skinSel.value, true);
  playScene(link.name, 0, link.t);
}
// Back from eqosys with ?code=&state=: keep the login and redraw the title with the name.
reportButton();
// Opened from a party link (?party=CODE): read the Book with that party once signed in.
const askedParty = (params.get("party") ?? "").toUpperCase().match(/^[A-Z0-9]{4,12}$/)?.[0] ?? null;
void finishSignIn().then((back) => {
  if (back) { signInNote = back.error ?? ""; drawAccount(); }
  if (askedParty && login()) joinReaders(askedParty);
  else if (askedParty) { signInNote = "Sign in to read the Book with this party."; drawAccount(); }
  drawReaders();
});
requestAnimationFrame(frame);

const view = (f: Fighter) => ({
  id: f.c.id, hp: Math.round(f.hp), launch: Math.round(f.launch), stamina: +f.stamina.toFixed(2), energy: Math.round(f.energy),
  state: f.state, swing: swingPhase(f), flying: f.flying, onGround: f.onGround, invuln: f.invuln, clipped: f.clipped > 0, pos: { x: +f.pos.x.toFixed(2), y: +f.pos.y.toFixed(2), z: +f.pos.z.toFixed(2) },
});
const fightState = () => m && { engine: live?.engine, tick: m.tick, over: m.over, winner: m.winner, fighters: m.f.map(view), shapes: m.areas.map((a) => ({ by: a.owner, shape: a.d.shape, move: a.move.name, head: head(a) })), ringRadius: ARENA.radius };
const tripState = () => trip && { ...trip, out: [...trip.out], region: trip.region.n };
Object.assign(window, {
  mythicMasters: {
    state: fightState,
    /** The field chart: open() / close() it, ask(you, them) sets its asker (one or two fields a side), state() reads it. */
    chart,
    start: (a: string, b: string, skin = "stadium", watch = false) => start(a, b, skin, watch),
    /** Hold these key codes or action ids (["KeyW", "KeyJ"] or ["forward", "light"]) in place of the keyboard; `null` gives it back. */
    hold: (codes: string[] | null) => { held = codes ? new Set(codes.map((c) => actionOf(c) || c)) : null; },
    /** Puts fighter `side` just below the ring's lip, rising, so it catches the ledge a few ticks later (the setup the ledge tests use). */
    ledge: (side: 0 | 1 = 0) => {
      if (!m) return null;
      const f = m.f[side], a = Math.atan2(f.pos.z, f.pos.x) || Math.PI, r = ARENA.radius + f.b.radius * 0.6;
      Object.assign(f, { pos: { x: Math.cos(a) * r, y: -0.6, z: Math.sin(a) * r }, vel: { x: 0, y: 0.5, z: 0 }, onGround: false, state: "free", act: null, drop: 0, fresh: true });
      return view(f);
    },
    /** Where fighter `side`'s puppet has its feet and hips right now, in the world (null before its model loads). */
    body: (side: 0 | 1 = 0) => {
      const p = puppets[side], at = (v: THREE.Vector3) => ({ x: +v.x.toFixed(2), y: +v.y.toFixed(2), z: +v.z.toFixed(2) });
      return p && { feet: p.feetWorld().map(at), hips: at(p.rootWorld()) };
    },
    /** Where the camera stands in a fight: "lock" (behind you) or "side" (side-on to both, to judge a move). */
    camera: (mode: "lock" | "side") => { camMode = mode; },
    /** The fight HUD's skins (src/hud/skins/): `hud()` lists them and names the one showing, `hud(id)` wears one (an id or its index). */
    hud: (id?: string) => { if (id !== undefined && !useSkin(String(id))) return null; return { now: skinNow().id, skins: HUD_SKINS.map((s) => ({ id: s.id, name: s.name, idea: s.idea })) }; },
    /** The open world: `enter()`, `state()` (where you are, what you've beaten, what's open and rising), `travel(n)` to an open region n's arena, `places(n?)` the region's tapes, campfires, landmarks and sighting boards (also in `state().places`), `hunts(n?)` its sighting-board contracts (stage, next sign, lair; also `state().hunts`), `fastTravel(id)` to a lit campfire, `teleport(x, z)` onto open ground (`state().wilds` says where the wild ones roam, `trails()` where each keeper's stone is), `setHour(h)` for the time of day, `setWeather({ rain, snow, mist })` (or null) to hold the weather, `layer(name, on)` to hide a drawn layer, `beat(n)` as if you won its arena, `reset()`. */
    world: { enter: enterWorld, state: world.state, online: () => online && { room: online.room, status: online.status, sentBytes: online.sentBytes, friends: friendsNow(online, world.pose().region, performance.now()) }, travel: world.travel, beat: world.beat, teleport: world.teleport, eye: world.eye, setHour: world.setHour, setWeather: world.setWeather, layer: world.layer, reset: world.reset, trails: world.trails, places: world.places, hunts: world.hunts, fastTravel: world.fastTravel },
    /** The journey: `state()` (line-up, journal, sections cleared, pages), `begin([a, b, c])` a fresh one with three starters, `bind()` tries the ink
     * in a world fight, `journal(open)`, `trip()` what the current world fight is. */
    journey: {
      state: () => journey, trip: tripState,
      begin,
      bind: tryBind,
      /** Sets the foe's health to `frac` of full in the current fight, to try a bind without fighting it down; `side` 0 wears yours, to lose a round. */
      wear: (frac: number, side: 0 | 1 = 1) => { if (m && !m.over) m.f[side].hp = m.f[side].b.hp * clamp(frac, 0.01, 1); },
      journal: (open: boolean) => openJournal(open), tab: (t: Tab) => { tab = t; openFolio = null; drawJournal(); },
      /** The bestiary's folio of a beast (`null` turns back), and a d-pad press while the book is open (`"up"`, `"ok"`, `"back"`, ...); `quill()` says where the quill rests. */
      folio: (id: string | null) => { showFolio(id); return openFolio; }, nav: (cmd: Dir | "ok" | "back" | "prev" | "next") => journalNav(cmd), quill: () => ({ cursor, folio: openFolio, tab }),
      /** Starts a fight in the region you stand in, as if you walked into it: `"wild"` (section k's first wild one), `"keeper"` (section k's),
       * `"mythic"` (the arena's) or `"deadly"` (a south wild one grown huge). Returns `trip()`, or null with no journey or no such section. */
      fight: (kind: Trip["kind"] = "wild", k = 0) => {
        if (!journey) return null;
        const g = REGIONS[world.state().region - 1] ?? REGIONS[0]!, s = sections(g)[k];
        if (kind === "mythic") meet.arena(g);
        else if (kind === "deadly") meet.wild(g);
        else if (!s) return null;
        else if (kind === "keeper") meet.keeper(g, k);
        else meet.wild(g, { id: s.wilds[0]!, level: s.level });
        return tripState();
      },
      /** Clears region n's sections up to k (for a harness to stand later on the trail). */
      clearTo: (n: number, k: number) => { if (!journey) return; for (let i = 0; i <= k; i++) clearSection(journey, n, i); saveJourney(); world.cleared(); },
    },
    /** The Book's talks (src/book.ts): `state()` the open moment (its line, replies, the Book's answer once given) and how many wait,
     * `say(beat, ctx)` as if that beat happened, `answer(id)` a reply (a guest's page gets the host's this way), `close()` reads past the answer,
     * `party({ host, hostName })` (or null) to hold a guest's buttons until the host answers (a real party, `?party=CODE`, sets it itself). */
    book: {
      state: () => ({ open: talking && { id: talking.m.talk.id, recall: talking.m.recall, ask: talking.m.ask, replies: talking.m.talk.replies.map((r) => ({ id: r.id, say: r.say })), said: talking.said, hold: talkHold() }, queued: talks.length, talk: journey?.talk ?? null }),
      say: (beat: Beat, ctx: Ctx = {}) => { say(beat, ctx); nextTalk(); return talking?.m.talk.id ?? null; },
      answer: (id: string) => replyBook(id, !talkHold().canAnswer),
      close: () => { talking = null; drawTalk(); nextTalk(); },
      party: (p: { host: boolean; hostName: string } | null) => { talkParty = p; drawTalk(); },
    },
    /** The stadium crowd (src/crowd.ts): `state()` (people, cast, draw calls, clips, what's playing), `show(clip)` the stands up close doing one take,
     * `play(clip | null)` every seat doing it (null: their own, on a cheer), `cheer(0..1)` as if a hit landed. */
    crowd: { state: () => crowdOf(arena)?.state() ?? null, show: (clip: string | null = null) => showCrowd(clip), play: (clip: string | null) => crowdOf(arena)?.play(clip) ?? false, cheer: (n = 1) => crowdOf(arena)?.cheer(n) },
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
    director: { state: () => ({ beat: director.beat, holding: director.holding, paused: director.paused, ...director.stage }), skip: () => { poke = true; }, cut: () => director.cut(),
      /** Plays a scene by name (SCENES in src/director.ts; none: their names) where you stand; `k` picks a variant. */
      scene: (name?: string, k = 0) => playScene(name, k),
      /** Jumps the scene playing to second t; `pause(true)` holds it there for a screenshot. */
      seek: (t: number) => director.seek(t), pause: (on = true) => { director.paused = on; return on; },
      /** Plays the current fight's foe's intro as if you knew it `known` well with `bound` creatures bound (src/casefile.ts). */
      intro: (known: "new" | "met" | "known" = "known", bound = 0, kind: "keeper" | "mythic" | "wild" = "keeper") => {
        const f = m?.f[1];
        if (!f) return false;
        const id = f.c.id.replace(/^wild-/, ""), g = REGIONS[creature(id).region - 1] ?? REGIONS[0]!;
        return director.play(intro(subject(id, g, { kind, known, bound, place: g.name, sub: `Keeper of ${g.name} · Lv 5` }), f.pos, f.b.height, 0));
      },
      /** Plays the reveal of binding the foe as the `bound`-th creature (src/casefile.ts). */
      identified: (bound = 3) => { const f = m?.f[1]; return !!f && director.play(identified(f.c.id, f.c.name, bound, f.pos, 0)); } },
  },
});

// The page's commands outside the gallery (which adds its own beast_ and gallery_ ones, gallery-agent.ts): WebMCP tools
// for an agent in the browser, window.__commands for a harness, the Cmd/Ctrl+K palette for a person. No corner button:
// the world map and the touch buttons hold the bottom-right.
const arg = (a: unknown, k: string): unknown => (typeof a === "object" && a ? Reflect.get(a, k) : undefined);
const numArg = (a: unknown, k: string) => { const v = arg(a, k); return typeof v === "number" && Number.isFinite(v) ? v : undefined; };
const idArg = (a: unknown, k: string) => {
  const v = arg(a, k), c = ROSTER.find((r) => r.id === v);
  if (!c) throw new Error(`no creature "${String(v)}": mm_roster lists them`);
  return c.id;
};
addCommands([
  { name: "mm_state", title: "Look at the fight", group: "Fight", description: "The fight on screen: tick, over, winner, each fighter's hp, launch, stamina, energy, state and position; and the world trip it is, if any. { fight: null } when none is on.",
    annotations: { readOnlyHint: true }, execute: () => ({ fight: fightState(), trip: tripState() }) },
  { name: "mm_roster", title: "List the creatures", group: "Fight", palette: false, description: "Every creature: id, name, archetype, fields and home region.",
    annotations: { readOnlyHint: true }, execute: () => ROSTER.map((c) => ({ id: c.id, name: c.name, archetype: c.archetype, fields: c.fields, region: c.region })) },
  { name: "mm_regions", title: "List the regions", group: "World", palette: false, description: "All 64 regions; a built one's id is also an arena skin for mm_fight.",
    annotations: { readOnlyHint: true }, execute: () => REGIONS.map(({ skin, ...r }) => ({ ...r, built: !!skin })) },
  { name: "mm_fight", palette: false, title: "Start a versus fight", group: "Fight", description: "A one-off fight between creatures a (yours) and b (ids from mm_roster), in arena skin (default stadium); watch: true lets a bot play your side. Leaves any world trip.",
    inputSchema: { type: "object", properties: { a: { type: "string" }, b: { type: "string" }, skin: { type: "string" }, watch: { type: "boolean" } }, required: ["a", "b"] },
    execute: (x) => {
      const skin = arg(x, "skin") ?? "stadium";
      if (typeof skin !== "string" || !ALL_SKINS[skin]) throw new Error(`no arena skin "${String(skin)}": ${Object.keys(ALL_SKINS).slice(0, 8).join(", ")}, ...`);
      start(idArg(x, "a"), idArg(x, "b"), skin, arg(x, "watch") === true);
      return fightState();
    } },
  { name: "mm_hold", title: "Hold keys", group: "Fight", palette: false, description: "Hold these key codes or action ids (\"KeyW\", \"forward\", \"light\") in place of the keyboard until the next call; an empty list or null gives the keyboard back.",
    inputSchema: { type: "object", properties: { codes: { type: "array", items: { type: "string" } } } },
    execute: (x) => {
      const v = arg(x, "codes"), codes = Array.isArray(v) ? v.filter((c): c is string => typeof c === "string") : [];
      held = codes.length ? new Set(codes.map((c) => actionOf(c) || c)) : null;
      return { held: held ? [...held] : null };
    } },
  { name: "mm_camera", title: "Swap the fight camera", group: "Fight", description: "\"lock\" stands behind you, \"side\" side-on to both (to judge a move). Left out, it swaps.",
    inputSchema: { type: "object", properties: { mode: { type: "string", enum: ["lock", "side"] } } },
    execute: (x) => { const v = arg(x, "mode"); camMode = v === "lock" || v === "side" ? v : camMode === "lock" ? "side" : "lock"; return { camera: camMode }; } },
  { name: "mm_hud", title: "Fight HUD skins", group: "Fight", ask: "skin id or number", description: "Wear a fight HUD skin by id or index; with none, lists them and names the one showing.",
    inputSchema: { type: "object", properties: { id: { type: "string" } } },
    execute: (x) => { const v = arg(x, "id"); if ((typeof v === "string" && v) || typeof v === "number") { if (!useSkin(String(v))) throw new Error(`no HUD skin "${String(v)}"`); } return { now: skinNow().id, skins: HUD_SKINS.map((s) => ({ id: s.id, name: s.name })) }; } },
  { name: "mm_scene", title: "Play a scene", group: "World", ask: "scene name", description: `Play one of the director's scenes where you stand, to look at it: ${Object.keys(SCENES).join(", ")}. k picks a variant; at (seconds) jumps in and holds that frame. With no name, lists them.`,
    inputSchema: { type: "object", properties: { name: { type: "string", enum: Object.keys(SCENES) }, k: { type: "number" }, at: { type: "number" } } },
    execute: (x) => {
      const name = arg(x, "name"), at = numArg(x, "at");
      if (name === undefined) return { scenes: Object.keys(SCENES) };
      if (typeof name !== "string" || !playScene(name, numArg(x, "k") ?? 0, at ?? null)) throw new Error(`no scene "${String(name)}": ${Object.keys(SCENES).join(", ")}`);
      return { beat: director.beat, paused: director.paused };
    } },
  { name: "mm_skip", title: "Skip the scene", group: "Fight", keys: "any key", description: "Cut the director's scene playing (an intro, a tape) short.", execute: () => { poke = true; } },
  { name: "mm_bind", title: "Bind the foe", group: "Journey", description: "In a world fight, spend ink to try binding the foe; it takes once it is worn down. Answers with what happened.",
    execute: () => { if (!trip) throw new Error("only in a world fight"); tryBind(); return { note: bindNote, over: !!m?.over, ink: trip?.ink ?? 0 }; } },
  { name: "mm_title", title: "Go to the title", group: "World", description: "The title screen: continue, a new journey, versus.", execute: () => showTitle() },
  { name: "mm_world", title: "Enter the world", group: "World", description: "Into the open world with your journey's line-up (the starters' pick when there is no journey yet).", execute: () => { enterWorld(); return journey ? world.state() : { choosing: true }; } },
  { name: "mm_where", title: "Where am I", group: "World", description: "In the world: your region, position, what is explored, beaten, open and rising, and the places round you.",
    annotations: { readOnlyHint: true }, execute: () => world.state() },
  { name: "mm_travel", title: "Travel to a region", group: "World", ask: "region number", description: "Travel to an open region n's arena (mm_where says what is open).",
    inputSchema: { type: "object", properties: { region: { type: "number" } }, required: ["region"] },
    execute: (x) => { const n = numArg(x, "region"); if (n === undefined) throw new Error("region: a number"); world.travel(n); return world.state(); } },
  { name: "mm_teleport", title: "Teleport", group: "World", palette: false, description: "Stand at world x, z if that ground is open; answers with whether it was.",
    inputSchema: { type: "object", properties: { x: { type: "number" }, z: { type: "number" } }, required: ["x", "z"] },
    execute: (x) => { const px = numArg(x, "x"), pz = numArg(x, "z"); if (px === undefined || pz === undefined) throw new Error("x and z: numbers"); return { moved: world.teleport(px, pz), at: world.state() }; } },
  { name: "mm_world_reset", title: "Reset the world", group: "World", description: "Forget every region beaten, explored and visited, and go back to region 1.",
    annotations: { destructiveHint: true }, execute: () => { world.reset(); return world.state(); } },
  { name: "mm_journey", title: "Look at the journey", group: "Journey", description: "The line-up, journal, sections cleared and pages; null when there is no journey yet.",
    annotations: { readOnlyHint: true }, execute: () => journey },
  { name: "mm_journey_begin", palette: false, title: "Begin a new journey", group: "Journey", description: `Burn the journey there is and set out with ${PICKS} starters (the first leads): ${STARTERS.join(", ")}.`,
    annotations: { destructiveHint: true }, inputSchema: { type: "object", properties: { starters: { type: "array", items: { type: "string", enum: [...STARTERS] } } }, required: ["starters"] },
    execute: (x) => {
      const v = arg(x, "starters"), picks = Array.isArray(v) ? v.flatMap((p) => STARTERS.filter((s) => s === p)) : [];
      if (picks.length !== PICKS || new Set(picks).size !== PICKS) throw new Error(`starters: ${PICKS} different ones of ${STARTERS.join(", ")}`);
      if (!begin(picks)) throw new Error("couldn't start that journey");
      return journey;
    } },
  { name: "mm_journal", title: "Open or close the journal", group: "Journey", description: "Toggle the journal; open: true or false to set it.",
    inputSchema: { type: "object", properties: { open: { type: "boolean" } } },
    execute: (x) => { const v = arg(x, "open"); openJournal(typeof v === "boolean" ? v : undefined); } },
  { name: "mm_cards", title: "Open the bestiary cards", group: "Journey", description: "The bestiary of cards; open: false closes it.",
    inputSchema: { type: "object", properties: { open: { type: "boolean" } } }, execute: (x) => { showDeck(arg(x, "open") !== false); } },
]);
mountPalette();
