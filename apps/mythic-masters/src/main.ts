// Mythic Masters: pick two creatures and an arena, then fight a bot (or watch two), or walk the open world
// between the arenas (src/world). The sim runs at a fixed 60 Hz; this file draws it and turns the keyboard,
// a touch screen or a gamepad into an Input.
// `?a=<id>&b=<id>&skin=<name or region id>&watch=1` skips the picker, `?world=1&a=<id>` walks the world;
// `window.mythicMasters` has `state()`, `start(a, b, skin, watch)`, `hold(keys)` and `world` for an agent's browser.
import { pipOf } from "./tiles.ts";
import LANDING from "../content/landing.json";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { type Bindings, keyName, loadPad, mountControls, volumeOf } from "@rustybuns/game-controls";
import { ACTIONS, actionOf, keymap, KEY, moveKeys, PRESETS } from "./binds.ts";
import { clamp, esc } from "@rustybuns/util";
import { check, obj, str } from "@rustybuns/util/guard";
import { buildArena, crowdOf, floorOf, gradeOf, SKINS, tickArena, type Skin } from "./arena.ts";
import { forgetBeast, loadBeast, Puppet } from "./beasts.ts";
import { bot, type Bot } from "./bot.ts";
import { temper } from "./opener.ts";
import { coopTeams, mountVersus } from "./versus.ts";
import { coopCode, duelCode, mintDuel, sum } from "./net/duel.ts";
import { recordCoop, type CoopAt } from "./coop.ts";
import { buttons, NO_STICK, PAD_ACTIONS, PAD_START, PAD_ZONE, push, readPad, touchStick, TOUCH_BUTTONS, type Stick } from "./controls.ts";
import { icon } from "./icons.ts";
import { ART, radar, tradingCard } from "./card.ts";
import { moveLine, shapeSvg } from "./moveline.ts";
import { entry, folio, halves, neighbour, notePlate, ordinal, regionChart, spread, stepTo, type Dir, type Known } from "./compendium.ts";
import { FIELDS, hex, type Field } from "./fields.ts";
import { mountFieldChart } from "./fieldchart.ts";
import { MAX_LIVE, MAX_LIVE_PHONE, MoveFx, shakeOf } from "./fx.ts";
import { gallery, PAGE } from "./gallery.ts";
import { mountAgent } from "./gallery-agent.ts";
import { addCommands } from "@rustybuns/util/commands";
import { mountPalette } from "@rustybuns/util/palette";
import { creatureModel } from "./model.ts";
import { ALL_SKINS, fightSkin, REGIONS, type Region } from "./regions.ts";
import { body, creature as rosterCreature, learnset, ROSTER, teach, type Creature } from "./roster.ts";
import { worldView, type Foe } from "./world/view.ts";
import { plantBudget, setPlantBudget } from "./world/flora.ts";
import { pickQuality, QUALITY } from "@rustybuns/util/quality";
import { tutorial } from "@rustybuns/util/tutorial";
import { accountChip, achieve, achievements, canSignIn, finishSignIn, fresh, login, reportButton } from "./account.ts";
import { asCreature, atLevel, bind, downed, heal, hpOf, wound, bindBelow, bindChance, clearSection, cleared, gainXp, INK, loadJourney, moveUp, mythicOf, newJourney, nextUp, call, owns, PICKS, rest, SAVE_KEY, SECTIONS, sections, see, slots, STARTERS, TRAIL_REGIONS, toNext, witchSays, type Journey, mend } from "./journey.ts";
import { LORE } from "./lore.ts";
import { Bout, circleLineOf, handOf, knownOf, PAGE_INK, poolOf, ribbonsOf, summon, type Summoned } from "./grimoire.ts";
import { deckDemandOf, demandOf, pageLineOf, reactionOf, settingsLineOf, SIGNATURE, thumbAt, worldLineOf, type Back, type Outcome } from "./demand.ts";
import { tierOf } from "./tiers.ts";
import { book, cardTurn, fly, penSound, pressed, soak, thumb, turnLeaf } from "./page.ts";
import { emblem, frame as ring, inkUrl, seal, tear } from "./ornaments.ts";
import { quill } from "./quill.ts";
import { answer as answerBook, holdOf, lossBeats, momentFor, notesOf, signedOf, spendInk, tally, type Beat, type Ctx, type Moment } from "./book.ts";
import { bookParty, type Seat } from "./book-party.ts";
import { peek } from "@rustybuns/util/token";
import { party } from "./account.ts";
import { choosing, dress as dressHud, ring as hudRing, SKINS as HUD_SKINS, skinNow, stepSkin, useSkin } from "./hud/index.ts";
import { crewHtml, newMemory, pairOf, remember as rememberHud, viewOf } from "./hud/skin.ts";
import { FX_AMOUNT } from "./effects.ts";
import { darken, warmWith } from "./world/walker3d.ts";
import { abduction, arrival, Director, faceoff, found, freeze, lookout, SCENES, trail, type Stage, type VsCard, type Where } from "./director.ts";
import { mountScenes, playNamed, sceneLink } from "@rustybuns/util/director";
import { Memories } from "@rustybuns/util/memories";
import { budgetQuality } from "@rustybuns/util/quality";
import { identified, intro, type Subject } from "./casefile.ts";
import { drowner } from "./drown.ts";
import { ambience } from "./world/ambience.ts";
import { findTape, ISLE_N, isleTapesFound, lightFire, sight, tapeOf, tapesFound, WITCH_CAMP, type Poi } from "./world/poi.ts";
import { lairLook, PACKS, type Pack } from "./packs.ts";
import { regionsCleared, visit, WITCH } from "./witch.ts";
import { approach as approachFaction, back as backAgain, deed, FACTION, factionsOf, fought as foughtFaction, hail as hailPost, postFought, postsIn, record as questRecord, reply as replyFaction, sectionCleared, waitingAll, type Ctx as FactionCtx, type Foe as FactionFoe, type Manned, type Scene } from "./factions/engine.ts";
import { postSpot, stageSpot, walkedUp } from "./world/posts.ts";
import { COAT_CSS, rivalsView, type Figure } from "./world/rivals-view.ts";
import { FACTIONS, type FactionId } from "./factions/model.ts";
import { bandOf, pressure, reading, trendOf } from "./factions/read.ts";
import { ledgerOf, type Ledger } from "./factions/ledger.ts";
import { jumpTo, stepOf } from "./factions/jump.ts";
import { close as closeHunt, HUNTS, huntOf, isleHunts, stageOf, take, CLUES } from "./world/hunts.ts";
import { FORAGE_MEND } from "./world/nature.ts";
import { Online, roomCode, uid } from "./net/online.ts";
import { COOP_MS, HURT_FULL } from "./net/party.ts";
import { COLOURS, css as hueCss, firstColour, wornColour } from "./world/hues.ts";
import { invitedBy, joinParty, openParty, partyCode, signInToJoin } from "./net/lobby.ts";
import type { Friend } from "./world/view.ts";
import { ARENA, foeOf, head, held as holding, HZ, IDLE, swingPhase, warning, type Fighter, type Input, type Match, type V3 } from "./sim.ts";
import { tsSim, wasmSim, type Live, type Sim } from "./sim-wasm.ts";
import simWasm from "./sim.wasm?url";

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const canvas = $<HTMLCanvasElement>("#view");
// The quality tier (@rustybuns/util/quality: ?quality=low|mid|high, remembered, else guessed from the GPU): the canvas's pixel
// ratio, antialiasing and shadows, whether the bloom passes run, and how far the open world's plants reach (src/world/flora.ts).
const tier = pickQuality().quality, QUAL = QUALITY[tier];
// `?draw=0`: the page plays (the world, its fights, the party's socket) but draws nothing, for a machine whose GL is software
// (a CI runner draws the open world at a frame a second): the two-page journey runs there this way (test/together.test.ts).
const DRAW = new URLSearchParams(location.search).get("draw") !== "0";
setPlantBudget(tier);
// A logarithmic depth buffer: the open world draws water a few metres under the ground and coasts at 8 km, which a
// linear buffer with a 0.1 m near plane fights over at that range.
const renderer = new THREE.WebGLRenderer({ canvas, antialias: QUAL.antialias, logarithmicDepthBuffer: true });
renderer.setPixelRatio(Math.min(QUAL.pixelRatio, devicePixelRatio));
renderer.shadowMap.enabled = QUAL.shadows;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
// One frame's counts across every pass the composer renders, reset by frame() (mythicMasters.perf, scripts/walk-budget.ts).
renderer.info.autoReset = false;
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
const composer = tier === "low" || matchMedia("(max-width: 700px), (pointer: coarse)").matches ? null : new EffectComposer(renderer);
// A wild one's beast compiles its shaders before it swaps in for its capsule (walker3d.ts), for the target the scene is
// really drawn into (the composer's, when there is one: tone mapping and colour space are part of a program).
warmWith((o) => {
  if (!DRAW) return Promise.resolve();
  const was = renderer.getRenderTarget();
  renderer.setRenderTarget(composer ? composer.readBuffer : null);
  const ready = renderer.compileAsync(o, camera, scene);
  renderer.setRenderTarget(was);
  return ready;
});
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
// The frame budget (#3664): the tier read above (one read: ?quality=, the saved one, else the machine's guess, a phone at
// mid at most) drops a tier when frames miss the 60 Hz beat for a few seconds, and climbs
// back, no higher than it started, once they're calm: the pixel ratio and shadows follow, and low turns the bloom off. Its
// own rAF callback, so it reads the same timestamps as the game's loop without living in it.
const tiers = budgetQuality(renderer, [], { quality: tier, onChange: (q) => {
  setPlantBudget(q); // the plant ring shrinks or grows at the next re-plant
  composer?.setPixelRatio(renderer.getPixelRatio()); resize();
  for (const p of composer?.passes ?? []) if (p instanceof UnrealBloomPass) p.enabled = q !== "low";
} });
const watchTier = (now: number) => { tiers.tick(now); requestAnimationFrame(watchTier); };
requestAnimationFrame(watchTier);

// --- the picker -------------------------------------------------------------------------------------
const aOrAn = (word: string) => (/^[aeiou]/i.test(word) ? "an" : "a");
function card(c: Creature, side: "A" | "B", on: boolean) {
  const b = body(c);
  // written as an entry in the versus book (#3671 round 85), not a stat card: what it is, what it weighs and how it
  // moves, its engraved radar, and its moves named in a sentence
  return `<button class="card${on ? " on" : ""}" data-side="${side}" data-id="${esc(c.id)}">
    <b>${esc(c.name)}</b><small>${aOrAn(c.archetype)} ${esc(c.archetype)} of ${c.fields.join(" and ")}</small>${radar(c)}
    <span class="body">${c.massKg} kg, ${c.heightM} m tall; it ${b.air === "flight" ? "flies" : "walks and hops"} ${b.air === "flight" ? icon("feather", "Flies") : icon("footprints", "Hops")}</span>
    <span class="moves"><em>Its moves:</em> ${c.moves.map((m, k) => `<i title="${esc(`${m.slot}, ${m.field}: ${moveLine(m)}`)}">${m.delivery.shape === "touch" ? "" : shapeSvg(m.delivery)}${esc(m.name)}</i>${k < c.moves.length - 2 ? "," : k === c.moves.length - 2 ? " and" : "."}`).join(" ")}</span></button>`;
}

// What each creature has been taught (the harness's `teach`); everyone else fights with what it was born knowing.
const taught = new Map<string, Creature>();
const creature = (id: string) => taught.get(id) ?? rosterCreature(id);

const params = new URLSearchParams(location.search);
// Walking together (#3663): `?room=CODE` (the room an eqosys party started) shares the world with the party; without it
// there is no socket and the world is yours alone.
const room = roomCode(location.search);
/** The friends' fights this page heard of lately, newest last: who walked into which den, and how it went once told. */
const fights: { who: string; den: string; c: string; lv?: number; won?: boolean; bound?: boolean }[] = [];
/** A contract's lair holds one creature, whoever fights it (#4063): what each friend there has taken off its health so
 *  far (thousandths, net/party.ts HURT_FULL), by lair and friend, as the room tells it. */
const lairHurt = new Map<string, Map<string, number>>();
const online = room ? new Online(room, {
  onChange: () => drawTogether(),
  opened: () => world.opened(),
  posed: () => world.pose(), // a den or contract taken mid-frame is checked where you stand now, not a frame ago
  onDen: (den, who, c) => { fights.push({ who, den, c }); fights.splice(0, fights.length - 8); world.friendMet(den, who, c); },
  onHunt: (h, s, who) => joinHunt(h, s, who),
  // a faction's team is made from the friend's own save, so there is no den to share: who, and whose team
  onCoop: (c) => askCoop(c),
  onRival: (f, who) => { fights.push({ who, den: `rival:${f}`, c: "" }); fights.splice(0, fights.length - 8); world.note(`${icon("users")} ${esc(who || "A friend")} is fighting a team of ${esc(FACTION[f].name.replace(/^The /, "the "))}.`); },
  onHurt: (den, id, d) => { let by = lairHurt.get(den); if (!by) lairHurt.set(den, (by = new Map())); by.set(id, Math.max(d, by.get(id) ?? 0)); },
  onFought: (f) => {
    const at = fights.findLast((x) => x.who === f.who && x.c === f.c && x.won === undefined);
    if (at) Object.assign(at, { lv: f.lv, won: f.won, bound: f.bound });
    world.note(`${icon("users")} ${esc(f.who || "A friend")} ${f.bound ? "bound" : f.won ? "beat" : "lost to"} ${esc(creature(f.c).name)} (Lv ${f.lv}).`);
  },
  onCompany: () => { shareHunts(); online?.seen(world.seen()); },
  onSeen: (s) => world.seenHeard(s),
  onLife: (k, id, h, at) => world.lifeHeard(k === "pick" ? { k, id } : { k, id, h }, at),
  // Start sends everyone to the room from their own save: walk over to the friend already here, if their region is open to you.
  onLand: (r, x, z, name) => {
    if (world.pose().region !== r) world.travel(r);
    if (world.pose().region === r) world.teleport(x + 2, z + 2);
    else world.note(`${icon("users")} ${esc(name || "Your friend")} is in ${esc(REGIONS[r - 1]?.name ?? "another region")}. Open its road to walk with them.`);
  },
}) : null;
/** The contracts under way in this region, told to whoever is here now, so they can follow the same signs. */
function shareHunts() {
  if (!online || !journey) return;
  const n = world.pose().region;
  for (const [h, s] of Object.entries(journey.hunts ?? {})) if (s <= CLUES && HUNTS.get(h)?.n === n) online.hunt(h, s);
}
/** A friend took a contract or read a sign: you are on it with them, as far as they have got (never past the lair, and
 *  never back: your own fight still closes it). */
function joinHunt(h: string, s: number, who: string) {
  const hunt = HUNTS.get(h);
  if (!journey || !hunt || s > CLUES) return;
  const mine = stageOf(journey, h);
  if (mine !== undefined && mine >= s) return;
  journey.hunts = { ...journey.hunts, [h]: s }; saveJourney();
  world.note(`${icon("footprints")} ${esc(who || "A friend")} ${s === 0 ? "took the contract" : `read sign ${s} of ${CLUES}`}: ${esc(hunt.title)}. You're on it too.`);
}
// `?party=CODE`: an eqosys party's lobby over the world; the host's Start sends everyone to `?world=1&room=ROOM`.
const partyId = room ? null : partyCode(location.search);
/** Who sent the party link, read before the world puts its own address up. */
const partyFrom = invitedBy(location.search);
let lobbyOpen = false, askedIn = false;
/** The world HUD's party chip: the room and who is here (or why nobody is); with no room, "Walk together" for a signed-in player. */
function drawTogether() {
  const el = document.querySelector<HTMLElement>("#worldHud .together"), box = document.querySelector<HTMLElement>("#worldHud .lobby");
  if (!el || !box) return;
  if (partyId && !lobbyOpen && login()) { lobbyOpen = true; box.hidden = false; joinParty(partyId, box); }
  // Signed out at the link: "Sign in to join Ada's party" first, then this again with the login (heardLogin).
  else if (partyId && !lobbyOpen && !askedIn) { askedIn = true; signInToJoin(box, partyId, partyFrom, heardLogin); }
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
  const here = world.pose().region, all = online.where(), n = all.filter((w) => w.region === here).length;
  const away = all.filter((w) => w.region !== here).map((w) => `${esc(w.name || "a friend")} in ${esc(REGIONS[w.region - 1]?.name ?? "the wilds")}`).join(", ");
  const say = { in: n ? `${n} here with you${away ? `; ${away}` : ""}` : away || "nobody else here yet", joining: "joining...", offline: "offline, walking alone, trying again", full: "room full (six), trying again", signin: "sign in again to walk together", off: "open in another tab" }[online.status];
  el.className = `together s-${online.status}`;
  el.innerHTML = `${icon(online.status === "in" ? "users" : "wifi-off")}<b>${online.room}</b><small>${say}</small>`;
}
/** The party's others where they are this frame, in the region you stand in. */
const friendsNow = (o: Online, region: number, now: number): Friend[] => [...o.ghosts.values()].flatMap((g) => {
  const at = g.at(now);
  return at && at.region === region ? [{ id: g.id, name: g.name, lead: at.lead, follow: at.follow, x: at.x, z: at.z, yaw: at.yaw, colour: at.colour ?? firstColour(g.id) }] : [];
});
/** The colour your ground hums in (world/hues.ts): the one you picked in Settings (saved per browser; until then one seeded
 *  from this browser), unless a friend in the room was wearing it first. */
const HUE_KEY = `${KEY}.colour`;
let hueChosen = (() => { try { const n = Number(localStorage.getItem(HUE_KEY)); if (localStorage.getItem(HUE_KEY) !== null && Number.isInteger(n) && n >= 0 && n < COLOURS) return n; } catch { /* first visit below */ } return firstColour(uid()); })();
const hueWorn = () => (online ? wornColour(hueChosen, online.you, online.colours()) : hueChosen);
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
// The arena is written into the terms as a word (#3671 round 112): the plain name, the list's numbering left out.
const arenaName = (id: string) => SKINS[id]?.name ?? REGIONS.find((r) => r.id === id)?.name ?? id;
const drawArena = () => { $("#arenaWord").textContent = arenaName(skinSel.value); };
skinSel.addEventListener("change", () => { drawArena(); drawLore(); });
drawArena();
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
// The last practice bout or duel, so the circle can bring it up next time (circleLineOf, #4276 round 11).
const BOUT_KEY = "mythic-masters.lastBout";
let lastBout: Bout | null = (() => { try { return check(Bout, JSON.parse(localStorage.getItem(BOUT_KEY) ?? "null")); } catch { return null; } })();
function remember(b: Bout) { lastBout = b; try { localStorage.setItem(BOUT_KEY, JSON.stringify(b)); } catch { /* this session only */ } }
const art = (id: string) => { const p = ART[id], pic = p?.color ?? p?.bw; return pic ? `/${pic.src}` : ""; };
const pageTile = (c: Creature, on: boolean) => `<button class="tile ribbon-tile${on ? " on" : ""}" data-side="A" data-id="${esc(c.id)}" title="${esc(c.archetype)} · ${c.fields.join(" / ")}">
  <span class="pic" style="background-image:url('${art(c.id)}')"></span><b>${esc(c.name)}</b><small>${c.fields.join(" and ")}</small></button>`; // its fields written under its name (#3671 round 110), not coloured status dots
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
    $("#bookTag").textContent = LANDING.versus.librarianTag;
    return;
  }
  const mine = handOf(journey), n = ribbonsOf(journey);
  if (!params.get("a") && !mine.includes(pickA)) pickA = mine[0] ?? pickA; // your first ribbon leads, unless a link named someone
  $("#bookTag").textContent = LANDING.versus.bookTag;
  $("#pickA").innerHTML = card(creature(pickA), "A", true)
    + `<h3 class="sub">Your ribbons · ${mine.length} of ${n}</h3><div class="tiles hand">${mine.map((id) => pageTile(creature(id), id === pickA)).join("")}${Array.from({ length: Math.max(0, n - mine.length) }, () => `<span class="tile empty">an empty ribbon</span>`).join("")}</div>`;
  const said = circleLineOf(summoned, bareLine, pageInk, lastBout);
  const pots = Array.from({ length: PAGE_INK }, (_, i) => `<i class="pot${i < pageInk ? " full" : ""}"></i>`).join("");
  $("#pickB").innerHTML = card(creature(pickB), "B", true)
    + `<h3 class="sub">The circle${only ? ` of ${only}` : ""}</h3><div class="circle"><div class="pots" title="Ink left">${pots}</div>
      <button id="summon" class="go"${pageInk > 0 ? "" : " disabled"}>Summon${only ? ` from ${only}` : " anything"}</button>
      <p class="margin">${hand(said.ask, said.signed)}</p></div>${pagesOf()}`;
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
$("#fight").addEventListener("click", () => {
  pageInk = PAGE_INK; summoned = null;
  const watch = $<HTMLInputElement>("#watch").checked;
  start(pickA, pickB, skinSel.value, watch);
  if (!watch) coach.start();
});
$("#pickerBack").addEventListener("click", () => showTitle());

// The bestiary (src/card.ts): every beast's card, its pictures, its radar with the numbers, its signature.
const deck = $("#deck");
// Every menu screen is a page of one book (src/page.ts), in reading order: changing screen turns a leaf.
const pages = book(["#title", "#starters", "#select", "#deck", "#journal", "#result", "#friends"].map((id) => $(id)));
function showDeck(open: boolean) {
  if (open && !deck.querySelector(".tcard")) $("#deckCards").innerHTML = ROSTER.map(tradingCard).join("");
  if (open) { const d = deckDemandOf(journey); $("#deckDemand").innerHTML = hand(d.ask, d.signed); }
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
/** A fight with friends is on (`versus`), and which fighter is you: seat 1 sees the fight from the other side. In a
 * co-op round (#4400) `wildBot` is the wild one's hands, the same seeded bot on every page. */
let versusOn = false, mine = 0, wildBot: Bot | null = null;
/** The arena look the fight is in (an ALL_SKINS key), for state(). */
let arenaLook = "stadium";
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
// The scenes you've seen to their end, kept on this device across journeys so the journal can play them again
// (@rustybuns/util/memories). Only what is wrapped in memories.mark below is kept: the tapes, the arrivals, the
// landmarks, a first binding. A passing gag or a fight's faceoff never is.
const memories = new Memories("mythic-masters.memories");
let poke = false; // a key or a tap this frame, to cut a scene short
let pending: { m: Match; bound: boolean } | null = null; // a fight over, its result waiting on a freeze frame
const talked = new Set<string>(); // the trail sections that have had their line on tape this session
let worldUp = false; // the world view is built (its hooks can run while it builds)

// --- the journey: your line-up, the Eldritch Compendium, how far each trail goes (src/journey.ts) ---------------------
let journey: Journey | null = (() => { try { return loadJourney(localStorage.getItem(SAVE_KEY)); } catch { return null; } })();
/** False for a jump link's scratch journey (src/factions/jump.ts): played, never kept over your own. */
let keepJourney = true;
const saveJourney = () => { try { if (journey && keepJourney) localStorage.setItem(SAVE_KEY, JSON.stringify(journey)); } catch { /* a private window: this session only */ } };
if (journey?.factions) { backAgain(journey, Date.now()); saveJourney(); } // the factions notice a long time away (src/factions/engine.ts)
drawPicker(); // after the journey is loaded: the book's ribbons are its line-up

// A fight the world started. `slot` is the line-up member fighting, `out` the ones already down; a keeper guards
// section k of the region's trail, a mythic its arena, a wild one roams; "deadly" is the high-level south's ambush.
// `known` is how well you knew the foe walking in: never met, met before, or bound (its intro's case file, src/casefile.ts).
// A "rival" is a faction's team (src/factions/engine.ts): its creatures come at you one after another, and none of them can be bound.
interface Trip { region: Region; kind: "keeper" | "wild" | "mythic" | "deadly" | "rival"; k: number; foe: Foe; slot: number; out: Set<number>; ink: number; foeHp: number | null; known: "new" | "met" | "known"; friendsHp: number; rival?: Rival }
/** A faction's fight: a quest step's (`stage`) or a post's, its team, and which of them is up. */
interface Rival { faction: FactionId; stage?: string; post?: Manned; team: FactionFoe[]; i: number }
let trip: Trip | null = null;
const bindable = (t: Trip | null) => !!t && t.kind !== "deadly" && t.kind !== "rival";
/** A faction's creature as the fight names it: what its holder calls it, then what it is ("Asset 14, Wampus Cat"). */
const rivalFoe = (f: FactionFoe): Foe => ({ id: f.id, level: f.level, title: f.title ? `${f.title}, ${creature(f.id).name}` : undefined });

/** A practice fight: `a` (you, unless `watch`) against `b`. With `mates` (`?with=`) or `foes` (`?and=`) it's a team
 * fight, every fighter but you a bot, the way a co-op round against a wild one plays (#4401). */
function start(a: string, b: string, skin: string, watch = false, mates: string[] = [], foes: string[] = []) {
  trip = null; shroudFoe = false; bindNote = ""; crowdView = false; crowdOf(arena)?.play(null);
  const teams: [Creature[], Creature[]] | undefined = mates.length || foes.length ? [[creature(a), ...mates.map(creature)], [creature(b), ...foes.map(creature)]] : undefined;
  fight(creature(a), creature(b), skin, watch, false, teams);
  faceUp();
  history.replaceState(null, "", `?${new URLSearchParams({ a, b, ...(mates.length ? { with: mates.join(",") } : {}), ...(foes.length ? { and: foes.join(",") } : {}), skin, ...(watch ? { watch: "1" } : {}) })}`);
}
/** `?with=` and `?and=`: the teammates and extra foes a practice link names, at most three each (four a side). */
const matesOf = (v: string | null) => (v ?? "").split(",").filter(Boolean).slice(0, 3).map((id) => creature(id).id);
function fight(a: Creature, b: Creature, skin: string, watch = false, vs = false, teams?: [Creature[], Creature[]]) {
  versusOn = vs; if (!vs) mine = 0;
  if (!teams || !vs) wildBot = null;
  world.hide(); shelf?.dispose(); shelf = null;
  for (const o of [arena, ...models, ...puppets.map((p) => p?.group)]) if (o) scene.remove(o);
  puppets = [null, null]; moveFx.clear();
  const look = ALL_SKINS[skin] ?? SKINS.stadium!;
  arenaLook = ALL_SKINS[skin] ? skin : "stadium";
  arena = buildArena(scene, look); setGrade(look); moveFx.setGround(floorOf(look));
  camera.far = 300; camera.updateProjectionMatrix();
  // A team fight plays on sim.ts (#4400; sim.wasm plays teams too since #4412, a later step).
  if (teams) live = tsSim(teams[0], teams[1]);
  else try { live = sim(a, b); } catch (e) { console.warn("sim.wasm couldn't start this fight; it plays on sim.ts", e); live = tsSim(a, b); }
  m = live.m;
  if (!watch) void achieve("played");
  hudMem.now = newMemory();
  models = m.f.map((f, i) => { const g = creatureModel(f.c); scene.add(g); wearBeast(f, g, i); return g; });
  const seed = Math.floor(Math.random() * 1e6) + 1;
  // One on one, each bot is tempered with an opening (src/opener.ts, two fighters only); in a team fight they fight plain.
  const hands = (k: number) => (teams ? bot(k, seed + k) : temper(bot(k, seed + k), k ? 1 : 0, seed + k));
  bots = versusOn ? [null, null] : m.f.map((_, k) => (k || watch ? hands(k) : null));
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
function setOut(region: Region, kind: Trip["kind"], foe: Foe, k = 0) {
  if (!journey) return;
  const known = owns(journey, foe.id) ? "known" : journey.seen.includes(foe.id) ? "met" : "new";
  const spare = spendInk(journey); // a drop the Book handed over at a talk (src/book.ts)
  // A lair walked into afresh: what friends did to it on an earlier trip is gone; the room tells what they have done now.
  if (foe.hunt) lairHurt.delete(`hunt:${foe.hunt}`);
  trip = { region, kind, k, foe, slot: nextUp(journey, downed(journey)), out: downed(journey), ink: INK + spare, foeHp: null, known, friendsHp: 0 };
  // A wild one goes to the party from the world (hooks.met); a keeper's stone and the arena's mythic from here.
  if (kind === "keeper" || kind === "mythic") online?.met(kind === "mythic" ? `mythic:${region.n}` : `keeper:${region.n}:${k}`, foe.id, foe.level);
  if (kind !== "deadly") see(journey, foe.id);
  if (kind !== "deadly" || spare) saveJourney();
  // Walking together, a friend in this region can join (#4413): you wait for them in a co-op room, or fight alone.
  const code = (kind === "wild" || kind === "keeper") && !foe.hunt && keepJourney && online ? mintDuel() : null, den = code ? online!.coop(code) : null;
  if (code && den) {
    coopAt = { region, kind: kind === "keeper" ? "keeper" : "wild", k, foe, host: true };
    world.hide();
    versus.enter(code, "coop", { foe: den, host: true, alone: () => { coopAt = null; fightTrip(); } });
    return;
  }
  fightTrip();
}
/** A den's co-op fight with friends, from walking in (or joining) until its result is written (src/coop.ts). */
let coopAt: CoopAt | null = null;
/** "Join the fight": a friend in this region walked into a den or a keeper and is waiting in a co-op room. */
const coopAsk = Object.assign(document.createElement("aside"), { className: "coop-ask", hidden: true, role: "status" });
document.body.append(coopAsk);
let coopAskTimer: ReturnType<typeof setTimeout> | undefined;
function askCoop(c: { who: string; den: string; c: string; lv: number; code: string }) {
  if (!journey || !keepJourney || !world.shown || trip || versusOn || coopAt) return; // busy with a fight of your own
  const keeper = /^keeper:(\d+):(\d+)$/.exec(c.den), named = tierOf(c.c) !== "unknown" || owns(journey, c.c), name = named ? creature(c.c).name : "something nameless";
  coopAsk.innerHTML = `<p>${icon("users")} <b>${esc(c.who || "A friend")}</b> walked into ${keeper ? `the keeper, ${esc(name)}` : `a wild ${esc(name)}`} (Lv ${c.lv}).</p><button class="go">${icon("swords")} Join the fight</button>`;
  coopAsk.hidden = false;
  clearTimeout(coopAskTimer);
  coopAskTimer = setTimeout(() => { coopAsk.hidden = true; }, 2 * COOP_MS);
  coopAsk.querySelector("button")!.onclick = () => {
    coopAsk.hidden = true;
    const n = keeper ? +keeper[1]! : world.pose().region, region = REGIONS[n - 1];
    if (!journey || !region || trip || versusOn) return;
    coopAt = { region, kind: keeper ? "keeper" : "wild", k: keeper ? +keeper[2]! : 0, foe: { id: c.c, level: c.lv }, host: false };
    world.hide();
    versus.enter(c.code, "coop", { foe: { den: c.den, c: c.c, lv: c.lv }, host: false, alone: () => { coopAt = null; enterWorld(); } });
  };
}
/** At a contract's lair with friends: their blows come off this page's copy of the creature (the room's word for how much,
 *  never more than it believes), and ours go to them. Every frame of a lair trip; a message only when a share grew. */
function shareLair() {
  if (!trip?.foe.hunt || !online || !m || versusOn) return;
  const full = m.f[1].b.hp, by = lairHurt.get(`hunt:${trip.foe.hunt}`);
  const theirs = Math.min(full, ([...(by?.values() ?? [])].reduce((a, b) => a + b, 0) * full) / HURT_FULL), more = theirs - trip.friendsHp;
  // Between rounds (the result's up) it waits: the next round starts from the foe's health then, and takes it off.
  if (more > 0 && !m.over) {
    m.f[1].hp = Math.max(0, m.f[1].hp - more); trip.friendsHp = theirs;
    if (!bindNote) bindNote = `${[...(by?.keys() ?? [])].map((id) => online.ghosts.get(id)?.name || "A friend").join(" and ")} fighting it too`;
  }
  online.hurt(((full - Math.max(0, m.f[1].hp) - trip.friendsHp) / full) * HURT_FULL);
}
/** The trip's next round: the line-up member up now against the foe, its health carried over from the last round. */
function fightTrip() {
  if (!trip || !journey) return;
  const { region, kind, foe } = trip, me = asCreature(journey.party[trip.slot]!);
  shroudFoe = kind !== "deadly" && tierOf(foe.id) === "unknown" && !owns(journey, foe.id);
  const them = kind === "deadly" ? wildOne(region) : atLevel(creature(foe.id), foe.level, kind === "wild");
  // A sighting board's creature goes by what the witnesses call it, known or not.
  fight(me, foe.title ? { ...them, name: foe.title } : shroudFoe ? { ...them, name: kind === "wild" ? "Wild ???" : "???" } : them, foe.at ?? fightSkin(region, kind === "rival" ? "wild" : kind));
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
  // You and the one you face: one on one, the two fighters; in a team fight, the first foe you lock on (hud/skin.ts pairOf).
  const pair = pairOf(m, mine), [p, q] = [m.f[pair[0]]!, m.f[pair[1]]!], card = (k: 0 | 1): VsCard => {
    const c = (k ? q : p).c, hidden = k === 1 && shroudFoe, tier = hidden ? "unknown" : tierOf(plain(c.id));
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
  /** Pack p's lair on its island: who pack.json says waits there, met as a wild one (the island has no trail to clear),
   *  in the pocket's look. */
  lair: (p: Pack) => {
    // Its board's contract, every sign read: the one in the lair is the one on the board, and beating or binding it closes it.
    const h = isleHunts(p).find((c) => !!journey && stageOf(journey, c.id) === CLUES);
    setOut(isleRegion(p), "wild", { id: p.lair.foe, level: p.lair.level, at: lairLook(p), ...(h && { hunt: h.id, title: h.title }) });
  },
};
/** A pack's island as a fight's region: its name on the intro and the bind, region number ISLE_N, no trail. */
const isleRegion = (p: Pack): Region => ({ n: ISLE_N, id: p.id, name: p.name, block: p.name, tier: p.tier, biome: "tundra", folklore: [] });
// The boat to a pack's island (world/ferry.ts): its lines play as a tape where you stand, and the view swaps once they end
// (or are skipped, or cut). `started` because a scene can wait behind one already playing.
let boat: { s: ReturnType<typeof found>; then: () => void; started: boolean } | null = null;
const world = worldView(scene, camera, {
  ferry: (p, lines, then) => {
    const s = found(p.name, p.director[lines], world.here(), lines === "arrival" ? 1 : 0, lines === "crossing" ? "THE CROSSING" : lines === "arrival" ? "LANDED" : "LEAVING");
    if (!director.play(s)) { then?.(); return; }
    if (then) boat = { s, then, started: false };
  },
  // Walking into a fight in your own journey is where the tutorial starts (a jump link's scratch journey never does).
  arena: (g) => { meet.arena(g); learn(); },
  wild: (g, foe) => { meet.wild(g, foe); learn(); },
  keeper: (g, k) => { meet.keeper(g, k); learn(); },
  lair: (p) => { meet.lair(p); learn(); },
  met: (den, id, level) => online?.met(den, id, level),
  life: (e) => online?.life(e.k, e.id, e.k === "flush" ? e.h : 0),
  cleared: (n) => (journey ? cleared(journey, n) : 0),
  owns: (id) => !!journey && owns(journey, id),
  rumours: () => (journey?.factions?.met ?? []).flatMap((f) => FACTION[f].rumours),
  firstNight: () => { if (!journey || journey.nights) return false; journey.nights = 1; saveJourney(); return true; },
  arrived: (g, fresh) => { if (fresh && worldUp && world.shown) director.play(memories.mark(arrival(g.n, world.here(), world.vista()), { id: `arrival:${g.n}`, scene: "arrival", title: `Arriving in ${g.name}`, args: { n: g.n } })); },
  places: {
    log: () => journey,
    // A tape plays where it lies, once, and the journal keeps it. A fire is where you rest: lit the first time, saved every time.
    // Resting also mends the line-up (`heal`), since health carries between fights.
    reach: (p) => {
      if (!journey) return;
      if (p.kind === "tape") {
        const t = tapeOf(p);
        if (journey.found.includes(p.id) || !director.play(memories.mark(found(t.title, t.lines, world.here(), p.tape ?? 0), { id: `tape:${p.id}`, scene: "found", title: t.title, sub: "Found tape", args: { name: t.title, lines: t.lines, k: p.tape ?? 0 } }))) return;
        findTape(journey, p); saveJourney();
        return `Found a tape: ${t.title}`;
      }
      // A sighting board: the first visit takes its contract and plays the report; after that, where it stands.
      if (p.kind === "board") {
        const h = huntOf(p.id), st = stageOf(journey, p.id);
        if (!h) return;
        if (st === undefined) {
          take(journey, p.id); saveJourney(); online?.hunt(p.id, 0);
          director.play(memories.mark(found(h.title, h.report, world.here(), p.k, "SIGHTING"), { id: `sighting:${p.id}`, scene: "found", title: h.title, sub: "Sighting", args: { name: h.title, lines: h.report, k: p.k, label: "SIGHTING" } }));
          return `Contract taken: ${h.title}. Follow the signs.`;
        }
        return st > CLUES ? `${h.title}: closed.` : st === CLUES ? `${h.title} waits at its lair.` : `${h.title}: ${st} of ${CLUES} signs read.`;
      }
      // A cabin or a fire at night: alone, you sleep till dawn; a party's night is the room's clock, so it is sat out (#3779).
      const night = () => online ? (world.state().day.dark ? " The night is shared with your party: sit it out here." : "") : world.sleep() ? " You sleep till dawn." : "";
      if (p.kind === "cabin") {
        const first = sight(journey, p); saveJourney();
        return (first ? "An old cabin. The door bars from inside, and nothing comes in after dark." : "The old cabin.") + night();
      }
      const fresh = lightFire(journey, p), mended = heal(journey); saveJourney();
      if (p.id === WITCH_CAMP) sitWithWitch();
      else if (fresh) {
        // An island's fire is the island's (its pack id is the Book's region), not the port region the boat left from.
        const { region: n, isle } = world.state(), pk = isle && PACKS.find((q) => q.id === isle.id);
        say("campfire", pk ? { n, regionId: pk.id, region: pk.name } : { n, regionId: REGIONS[n - 1]?.id });
      }
      const rested = mended ? ` ${mended} mended.` : "";
      return (fresh ? "Campfire lit. You rest, and the journey is saved." : "You rest by the fire. Saved.") + rested + night();
    },
    // A landmark seen the first time: the slow-motion look round, unless a scene is on already.
    sight: (p) => {
      if (!journey || !sight(journey, p)) return;
      saveJourney();
      if (!director.beat) { const view = { x: p.x, y: world.groundAt(p.x, p.z) + 6, z: p.z }, k = journey.sights.length;
        director.play(memories.mark(lookout(p.name, world.here(), view, k), { id: `lookout:${p.id}`, scene: "lookout", title: p.name, sub: "Landmark", args: { name: p.name, k, vx: view.x, vy: view.y, vz: view.z } })); }
    },
    // Travelling home to her camp sits you down with her too.
    travelled: (p) => { if (p.id === WITCH_CAMP && sitWithWitch()) return WITCH.camp; },
    sign: (h) => { saveJourney(); const s = journey && stageOf(journey, h.id); if (s != null) online?.hunt(h.id, s); },
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
  accountChip($("#account"), { note: signInNote, onSignIn: heardLogin });
}
/** A login came back from eqosys's window beside the game: everything that reads it, again, and no reload. */
function heardLogin() {
  signInNote = "";
  drawAccount(); drawReaders();
  if (world.shown) drawTogether();
  if (askedParty && !readersCode) joinReaders(askedParty);
}
/** The book's standing demand, in its own hand on the title scroll and the compendium (src/demand.ts). */
function drawDemand() {
  const note = notesOf(journey).at(-1); // the last thing it wrote about you, under what it wants
  for (const p of document.querySelectorAll("[data-demand]")) p.innerHTML = hand(demandOf(journey), true) + (note ? `<span class="ledger">${esc(note)}</span>` : "");
}
function hand(ask: string, signed: boolean) { return `<span class="ask">${esc(ask)}</span>${signed ? `<span class="sig">${esc(SIGNATURE)}</span>` : ""}`; }
/** The book's line on a result note, under its heading (src/demand.ts reactionOf). */
const reaction = (o: Outcome) => { const r = reactionOf(o, journey); return `<p class="demand">${hand(r.ask, r.signed)}</p>`; };
/** The book's line in the world's toast once a fight is behind you (src/demand.ts worldLineOf), on a scrap of its
 * paper with its thumbprint pressed somewhere new each time. */
let scraps = 0;
const bookToast = (b: Back) => {
  const r = worldLineOf(b, journey), t = thumbAt(scraps++);
  return `<p class="demand">${hand(r.ask, r.signed)}</p><i class="thumb" aria-hidden="true" style="left: ${t.x}%; top: ${t.y}%; width: ${Math.round(t.size * 0.8)}px; transform: translate(-50%, -50%) rotate(${t.turn}deg)"></i>`;
};

// --- the Book talks back (src/book.ts): at a beat the journey stops until you answer ------------------------------
// A beat queues a moment; it opens once no scene is playing and no fight is on, and the fight and the walk wait (like
// the Controls dialog) until the Book's answer is read. In a party only the host's buttons work; the rest see who it waits on.
/** `page` counts the lead-in pages already turned (book.ts `lead`): the Book asks once they all are. */
let talking: { m: Moment; said: string | null; page: number } | null = null;
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
  const lead = said === null ? mo.lead[talking.page] : undefined;
  const buttons = lead !== undefined ? `<button data-next>${icon("arrow-right")} Go on</button>`
    : said !== null
    ? `<button class="go" data-go>${icon("arrow-right")} Go on</button>`
    : mo.talk.replies.map((r) => `<button data-r="${esc(r.id)}"${h.canAnswer ? "" : " disabled"}>${esc(r.say)}</button>`).join("");
  const lines = lead !== undefined ? `<p class="demand">${hand(lead, false)}</p>`
    : said !== null ? `<p class="demand">${hand(said, false)}</p>`
    : `${mo.recall ? `<p class="demand recall">${hand(mo.recall, false)}</p>` : ""}<p class="demand">${hand(mo.ask, signedOf(mo.talk))}</p>`;
  const wait = h.note && said === null && lead === undefined ? `<p class="wait">${esc(h.note)}</p>` : "";
  // The first time it talks, the Book itself opens, the whole spread, like the title: a plate facing its words.
  const first = mo.talk.beat === "open", again = talkEl.dataset.open === mo.talk.id;
  talkEl.dataset.open = first ? mo.talk.id : "";
  talkEl.classList.toggle("first-open", first);
  talkEl.innerHTML = first
    ? `<div class="title" role="dialog" aria-label="The Book"><div class="tome paper opening-spread${again ? " again" : ""}"><i class="boards" aria-hidden="true"></i><i class="cover" aria-hidden="true"></i><div class="leaf">`
      + `<div class="page recto"><p class="imprint-head">The Eldritch Compendium</p>${lines}<hr class="flourish" /><div class="menu replies">${buttons}</div>${wait}</div>`
      + `<div class="page verso"><figure class="plate" aria-hidden="true"><div class="frontis">${emblem("title")}</div><span class="ring">${ring()}</span></figure><p class="plate-caption">It fell on your chest. It is warm.</p></div></div></div></div>`
    : `<div class="note paper" role="dialog" aria-label="The Book">${lines}<div class="replies">${buttons}</div>${wait}</div>`;
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
  else if (b.dataset.next !== undefined && talking) { talking.page++; drawTalk(); }
  else if (b.dataset.go !== undefined) { talking = null; drawTalk(); }
});
// --- the Bog Witch's camp (src/witch.ts): walk up to it or travel there and she has a word for you ---------------
let sitting: string | null = null;
const witchEl = Object.assign(document.createElement("div"), { id: "witchVisit", className: "booktalk" });
witchEl.hidden = true;
document.body.append(witchEl);
function drawWitch() {
  witchEl.hidden = sitting === null;
  witchEl.innerHTML = sitting === null ? ""
    : `<div class="note paper" role="dialog" aria-label="${esc(WITCH.heading)}"><h2>${esc(WITCH.heading)}</h2><p class="witch">${esc(sitting)}</p><div class="replies"><button class="go" data-go>${icon("arrow-right")} ${esc(WITCH.goOn)}</button></div></div>`;
}
/** Sit at her fire: what she says for the regions you've cleared, saved as seen. False with no journey. */
function sitWithWitch(): boolean {
  if (!journey) return false;
  sitting = visit(journey).say; saveJourney(); keys.clear(); drawWitch();
  return true;
}
witchEl.addEventListener("click", (e) => { if ((e.target as Element).closest("[data-go]")) { sitting = null; drawWitch(); } });

/** A jump link (`?faction=office.3`): a scratch journey at that step, the regions before it won, and you a few steps
 * from whoever waits there. Nothing of it is saved over your own journey. */
function jumpToStage(id: string) {
  const at = stepOf(id), j = jumpTo(id);
  if (!at || !j) return;
  keepJourney = false; world.scratch();
  journey = j;
  enterWorld();
  for (let n = 1; n < at.stage.n; n++) world.beat(n);
  world.travel(at.stage.n);
  const spot = stageSpot(at.faction, at.stage.n, at.stage.k);
  if (spot && !world.teleport(spot.x - 9, spot.z)) world.teleport(spot.x, spot.z); // a few steps off, or on them if that is water
  history.replaceState(null, "", `?world=1&faction=${id}`);
}

// --- the three factions behind you (src/factions/engine.ts): walk up to one, hear them out, answer, fight their team ------
/** The step you have walked up to, between its hail and the end of its fight. */
let facing: Scene | null = null;
/** The sheet over the world while someone of a faction has the floor: who, what they have said so far, your replies (a
 * quest step's question), the team waiting when a fight is on offer, and whose fight that is. */
let sheet: { who: string; said: string[]; replies: Scene["replies"]; team: FactionFoe[] | null; rival: Pick<Rival, "faction" | "stage" | "post">; n: number; k: number } | null = null;
const factionEl = Object.assign(document.createElement("div"), { id: "factionTalk", className: "booktalk" });
factionEl.hidden = true;
document.body.append(factionEl);
/** What a faction's moment knows of the world: the time, where you stand on the trail, the hour, how many of you there
 * are (the friends walking this region with you, or the party reading the Book with you, whichever is more). */
function factionCtx(): FactionCtx {
  const n = world.pose().region, walking = 1 + (online ? friendsNow(online, n, performance.now()).length : 0);
  return { now: Date.now(), n, k: Math.min(SECTIONS - 1, journey ? cleared(journey, n) : 0), night: world.ambient().night > 0.5, party: Math.max(walking, readers?.size() ?? 1) };
}
/** In a party the host answers a faction's question for everyone (book-party.ts), as they answer the Book. */
const sheetHold = () => holdOf(talkSeat(), !!readers?.faction.freed(), facing?.who.name);
const postAt = (id: string): Manned | undefined => (journey ? postsIn(journey, Number(id.split(":")[1]), factionCtx()).find((p) => p.id === id) : undefined);
function drawSheet() {
  factionEl.hidden = !sheet;
  if (!sheet) { factionEl.innerHTML = ""; return; }
  const h = sheet.replies.length ? sheetHold() : { canAnswer: true, note: null };
  const buttons = sheet.replies.length ? sheet.replies.map((r) => `<button data-r="${esc(r.id)}"${h.canAnswer ? "" : " disabled"}>${esc(r.say)}</button>`).join("")
    : sheet.team?.length ? `<button class="go" data-fight>${icon("shield")} Fight their ${sheet.team.length}</button><button data-go>${icon("map")} Walk on</button>`
    : `<button class="go" data-go>${icon("arrow-right")} Go on</button>`;
  factionEl.innerHTML = `<div class="note paper" role="dialog" aria-label="${esc(sheet.who)}"><h2>${esc(sheet.who)}</h2>${sheet.said.map((s) => `<p class="witch">${esc(s)}</p>`).join("")}<div class="replies">${buttons}</div>${h.note ? `<p class="wait">${esc(h.note)}</p>` : ""}</div>`;
}
const spoken = (...said: (string | null)[]) => said.filter((s): s is string => !!s);
/** Walk up to faction f's waiting step: they meet you (the first time), say their piece and ask. False when nothing of theirs waits. */
function faceStage(f: FactionId): boolean {
  if (!journey || sheet) return false;
  const sc = approachFaction(journey, f, factionCtx());
  if (!sc) return false;
  facing = sc; saveJourney(); keys.clear();
  sheet = { who: `${sc.who.name}, ${FACTION[f].short}`, said: spoken(sc.aside, sc.hail, sc.ask), replies: sc.replies, team: sc.team, rival: { faction: f, stage: sc.stage.id }, n: sc.stage.n, k: sc.stage.k };
  drawSheet();
  if (sc.replies.length) readers?.faction.opened();
  return true;
}
/** Walk up to a post: the line about the place, the rank's hail, and its team unless it is resting. */
function facePost(p: Manned): boolean {
  if (!journey || sheet) return false;
  const h = hailPost(journey, p, factionCtx());
  saveJourney(); keys.clear();
  sheet = { who: `${p.rank.title}, ${FACTION[p.faction].short}`, said: spoken(h.aside, h.line, h.hail), replies: [], team: h.team, rival: { faction: p.faction, post: p }, n: p.post.n, k: p.post.k };
  drawSheet();
  return true;
}
/** Answer the step's question with reply `id`: what they say back, and their team if that starts the fight. This page's
 * click (held in a party until the host answers), or the host's answer arriving; the host's own goes out to the party. */
function answerSheet(id: string, fromHost = false): string | null {
  if (!journey || !sheet || !facing || !sheet.replies.length || (!fromHost && !sheetHold().canAnswer)) return null;
  const got = replyFaction(journey, facing, id, factionCtx());
  if (!got) return null;
  if (!fromHost) readers?.faction.answered(facing.stage.id, id);
  saveJourney();
  sheet.said = spoken(got.said, got.ink ? `They hand you ${got.ink === 1 ? "a drop" : `${got.ink} drops`} of ink for your next fight.` : null);
  sheet.replies = []; sheet.team = got.team;
  drawSheet();
  return got.said;
}
/** Take the fight on offer: their team, one after another, where their section's fights happen. */
function fightSheet(): boolean {
  const s = sheet, region = s && REGIONS[s.n - 1];
  if (!s?.team?.length || !region || !journey) return false;
  sheet = null; drawSheet();
  setOut(region, "rival", rivalFoe(s.team[0]!), s.k);
  online?.rival(s.rival.faction);
  if (trip) trip.rival = { ...s.rival, team: s.team, i: 0 };
  return !!trip;
}
/** A faction's fight is over, won or lost: the engine keeps it, and what they say goes on the result note. */
function rivalSays(r: Rival, won: boolean): string {
  if (!journey) return "";
  const ctx = factionCtx(), said = r.stage ? foughtFaction(journey, r.faction, r.stage, won, ctx) : r.post ? postFought(journey, r.post, won, ctx) : "";
  return `<b>${esc(FACTION[r.faction].short)}.</b> ${esc(said || "They say nothing.")}`;
}
factionEl.addEventListener("click", (e) => {
  const b = (e.target as Element).closest<HTMLButtonElement>("button");
  if (!b || b.disabled) return;
  if (b.dataset.r) answerSheet(b.dataset.r);
  else if (b.dataset.fight !== undefined) fightSheet();
  else { sheet = null; drawSheet(); }
});

// The faction people on the ground (src/world/posts.ts, rivals-view.ts): a quest step's person by the stone of its section,
// the posts round the stones behind you. Who stands where changes slowly, so it is worked out twice a second; the one
// you walk up to speaks, once a visit.
const rivals = rivalsView(scene, (x, z) => world.groundAt(x, z), camera, $("#worldHud"));
const rivalsReached = new Set<string>();
let figures: (Figure & { stage?: FactionId; post?: Manned })[] = [], figuresAt = -1e9;
function stepRivals(now: number) {
  if (!journey) { rivals.hide(); return; }
  const p = world.pose(), j = journey;
  if (now - figuresAt > 500) {
    figuresAt = now;
    const ctx = factionCtx();
    const waits = waitingAll(j, ctx);
    const who = (f: FactionId, id: string) => FACTION[f].people.find((x) => x.id === id)?.name ?? FACTION[f].short;
    figures = [
      ...waits.filter((w) => w.stage.n === p.region).flatMap((w) => { const at = stageSpot(w.faction, w.stage.n, w.stage.k); return at ? [{ id: `stage:${w.faction}`, faction: w.faction, quest: true, stage: w.faction, name: who(w.faction, w.stage.who), sub: `${FACTION[w.faction].short} · ${w.stage.title}`, ...at }] : []; }),
      ...postsIn(j, p.region, ctx).flatMap((post) => { const at = postSpot(post.id); return at ? [{ id: post.id, faction: post.faction, resting: post.resting, post, name: post.rank.title, sub: FACTION[post.faction].short, ...at }] : []; }),
    ];
    // the map marks every step waiting behind you, wherever it is, and the posts of the region you are in
    world.pins([
      ...waits.flatMap((w) => { const at = stageSpot(w.faction, w.stage.n, w.stage.k); return at ? [{ ...at, colour: COAT_CSS[w.faction], quest: true }] : []; }),
      ...figures.filter((f) => f.post).map((f) => ({ x: f.x, z: f.z, colour: COAT_CSS[f.faction], dim: f.resting })),
    ]);
  }
  rivals.update(figures, now / 1000, p);
  if (sheet || talking || director.beat) return;
  const up = walkedUp(p, figures, rivalsReached)[0];
  if (up?.stage) faceStage(up.stage); else if (up?.post) facePost(up.post);
}

/** Opens the next queued moment when nothing else has the screen. */
function nextTalk() {
  // the ink tearing free stops the fight itself; everything else waits for the fight to end
  if (talking || !talks.length || director.beat || (m && !m.over && talks[0]!.talk.beat !== "bind-fail")) return;
  talking = { m: talks.shift()!, said: null, page: 0 }; keys.clear(); drawTalk();
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
    // eqosys's party knows each member by the id its token carries, so the seat is found by that, not by a name two friends may share
    name: () => login()?.name, id: () => { const l = login(); return l ? peek(l.token)?.sub : undefined; },
    open: () => (talking && talking.said === null ? talking.m.talk.id : null),
    answer: (r) => void replyBook(r, true), changed: () => { drawTalk(); drawSheet(); drawReaders(); },
    faction: { open: () => (sheet?.replies.length && facing ? facing.stage.id : null), answer: (r) => void answerSheet(r, true) },
  });
}
/** The landing's printed words (content/landing.json, `bun run cms`): each `data-copy="section.key"` in index.html; a list is one line each. */
function printLanding() {
  const copy = new Map<string, unknown>(Object.entries(LANDING).flatMap(([s, o]) => Object.entries(o).map(([k, v]) => [`${s}.${k}`, v] as const)));
  for (const el of document.querySelectorAll<HTMLElement>("[data-copy]")) {
    const words = copy.get(el.dataset.copy ?? "");
    if (typeof words === "string") el.innerHTML = words.split("\n").map(esc).join("<br />"); // Enter in the cms is a line break
    else if (Array.isArray(words)) el.innerHTML = words.map((w) => esc(String(w))).join("<br />");
  }
}
printLanding();
function showTitle() {
  drawAccount(); drawDemand();
  world.hide(); m = null; startingOver = false;
  const lead = journey?.party[0];
  $("#continue").hidden = !journey;
  if (lead) $("#continue").innerHTML = `${icon("play")} ${esc(LANDING.title.continue.replace("{name}", creature(lead.id).name).replace("{level}", String(lead.level)))}`;
  $("#newGame").innerHTML = `${icon("moon")} ${esc(LANDING.title.newJourney)}`;
  $("#newGame").classList.toggle("go", !journey);
  $("#duelBtn").innerHTML = `${icon("users")} ${esc(LANDING.title.duel)}`;
  hideScreens($("#title"));
  history.replaceState(null, "", location.pathname);
}
// You take three of the witch's five; the first one you take leads.
const chosen: string[] = [];
function showStarters() {
  world.hide();
  drawDemand(); // the Book's first demand, in its own hand, over the three you pick (with no journey yet: all of them, start with three)
  $("#starterCards").innerHTML = STARTERS.map((id) => {
    const c = creature(id), at = chosen.indexOf(id);
    const said = witchSays(id, journey), took = !!journey && owns(journey, id); // on a second journey, what became of the ones you took is on the card
    return `<button class="card starter${at >= 0 ? " on" : ""}" data-id="${id}" aria-pressed="${at >= 0}" title="${esc(said)}"><b>${esc(c.name)}${at >= 0 ? `<i class="pick">${at + 1}</i>` : ""}</b><small>${esc(c.archetype)} · ${c.fields.join(" / ")}</small>${radar(c)}${took ? `<p>${esc(said)}</p>` : ""}</button>`;
  }).join("");
  const go = $("#setOut") as HTMLButtonElement;
  go.disabled = chosen.length !== PICKS;
  go.innerHTML = `${icon("footprints")} ${esc(chosen.length === PICKS ? LANDING.starters.setOut : LANDING.starters.chooseMore.replace("{n}", String(PICKS - chosen.length)))}`;
  hideScreens($("#starters"));
}
function begin(picks: readonly string[]): boolean {
  const j = newJourney(picks);
  if (!j) return false;
  journey = j; chosen.length = 0; saveJourney(); world.reset(); enterWorld();
  director.play(memories.mark(abduction(world.here()), { id: "abduction", scene: "abduction", title: "Tape 1: the saucer", sub: "Nobody will believe this" })); // tape 1
  // the first page is said somewhere too, so a callback to it can count the regions since
  const n = world.state().region;
  say("open", { n, regionId: REGIONS[n - 1]?.id });
  return true;
}
$("#continue").addEventListener("click", () => enterWorld());
$("#newGame").addEventListener("click", () => {
  if (journey && !startingOver) { startingOver = true; $("#newGame").innerHTML = `${icon("triangle-alert")} ${esc(LANDING.title.startOver)}`; return; }
  showStarters();
});
$("#duelBtn").addEventListener("click", () => versus.open());
$("#versus").addEventListener("click", () => { hideScreens($("#select")); history.replaceState(null, "", location.pathname); });
$("#starterCards").addEventListener("click", (e) => {
  const id = (e.target as HTMLElement).closest<HTMLElement>(".starter")?.dataset.id;
  if (!id) return;
  const at = chosen.indexOf(id);
  if (at >= 0) chosen.splice(at, 1); else if (chosen.length < PICKS) chosen.push(id);
  showStarters();
});
$("#setOut").addEventListener("click", () => begin(chosen));

type Tab = "lineup" | "bestiary" | "regions" | "factions";
let tab: Tab = "lineup", picked = -1, journalOpen = false;
/** The chapter the book's front matter (engraving, vine rule, the inscription) was printed over: only its first
 * opening has it (#3747); a turned page, a folio or a shut book ends it (null), and every page after starts on the
 * Book's demand in one line, so the chapter starts at the top of the leaf. */
let front: Tab | null | undefined;
const TABS: [Tab, string, string][] = [["lineup", "users", "Line-up"], ["bestiary", "book-open", "Bestiary"], ["regions", "map", "Regions"], ["factions", "footprints", "Factions"]];
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
  else if (front !== undefined) front = null;
}
/** Draws the open chapter (or the folio). An `edit` (a row moved, the quill's pick) rewrites only the lines that changed. */
function drawJournal(edit = true) {
  const j = journey;
  if (!j) return;
  drawDemand();
  $("#journalTabs").innerHTML = TABS.map(([id, ic, label]) => `<button class="ribbon r-${id}${tab === id ? " on" : ""}" data-tab="${id}" aria-pressed="${tab === id}" title="${label}" aria-label="${label}">${icon(ic)}<span class="rl">${label}</span></button>`).join("");
  $("#runningHead").textContent = TABS.find(([id]) => id === tab)?.[2] ?? ""; // the bookmark takes the chapter's colour
  for (const [c] of TABS) $("#journal").querySelector(".tome")?.classList.toggle(`c-${c}`, c === tab);
  const body = $("#journalBody");
  body.classList.toggle("folio-on", !!openFolio && tab === "bestiary");
  if (tab === "bestiary" && openFolio) {
    front = null;
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
      // written as an entry in the book, not a row of a form (#3662 round 79): its name, a sentence on what it is and how
      // it is, the ink still owed underlined in that sentence; raising and resting it are small marks in the margin
      const hp = hpOf(mm), health = hp >= 1 ? "" : hp > 0 ? `, wounded (${Math.round(hp * 100)}% of its health)` : ", down, and waiting to be woken";
      return `<li class="${picked === i ? "on" : ""}" data-pick="${i}">${pic ? `<span class="mini" aria-hidden="true"><img src="/${esc(pic.src)}" alt="" decoding="async"/></span>` : ""}<p class="entry"><b>${esc(c.name)}</b>${i ? "" : `<span class="gloss">it leads</span>`}
        <span class="prose">${aOrAn(c.archetype)} ${esc(c.archetype)} of ${c.fields.map(esc).join(" and ")}, at its ${ordinal(mm.level)} level${health}; <span class="xp" title="${mm.xp} / ${toNext(mm.level)} to the next level"><i style="width:${((mm.xp / toNext(mm.level)) * 100).toFixed(0)}%"></i><em>${mm.xp} of ${toNext(mm.level)}</em></span> drops of ink toward the ${ordinal(mm.level + 1)}.</span></p>
        <span class="marks"><button data-act="up" data-i="${i}" title="Move up (the top one leads)" aria-label="Move up"${i ? "" : " disabled"}>${icon("arrow-up")}</button>
        <button data-act="rest" data-i="${i}" title="Rest it in the compendium" aria-label="Rest it in the compendium"${j.party.length > 1 ? "" : " disabled"}>${icon("book-open")}</button></span></li>`;
    };
    body.innerHTML = spread(`<h2>Line-up · ${j.party.length} of ${slots(j)}</h2><p class="dim">Beat a region's mythic for another slot, up to six.</p><ol class="lineup">${j.party.map(row).join("")}</ol>`,
      // the line-up drawn from life across the facing leaf (#3671 round 90): each in its thorn ring, one that is down struck through
      `<h2>Drawn from life</h2><div class="drawn">${j.party.map((mm) => `<div>${notePlate(creature(mm.id), hpOf(mm) <= 0)}<p>${esc(creature(mm.id).name)}</p></div>`).join("")}</div>`
      + `<h2>Resting in these pages · ${j.journal.length}</h2>`
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
    body.innerHTML = spread(`<h2>Bound ${owned.size} · seen ${j.seen.length} · of ${ROSTER.length}</h2><p class="dim">What you have not met is a blot on the page. Meet it in the wild and its shape shows through the stain; bind it and the ink holds it. The arrows or a d-pad walk the quill; Enter or A opens a page, Esc or B turns back.</p>${l.map(region).join("")}`,
      r.map(region).join(""));
    markCursor();
  } else if (tab === "factions") {
    // the three behind you (src/factions/ledger.ts): where you stand with each, their steps you have done, the next
    const book = ledgerOf(j);
    const side = (l: Ledger) => `<h3>${esc(l.name)}<small class="gloss">they call you ${esc(l.calls)}</small></h3><p class="dim">${esc(l.standing)}</p>`
      + (l.done.length ? `<ol class="pages">${l.done.map((d) => `<li><b>${esc(d.title)}</b> ${esc(d.log)}</li>`).join("")}</ol>` : "")
      + (l.next ? `<p class="unwritten">Next: ${esc(l.next.title)}, at ${esc(l.next.where)}.</p>` : `<p class="unwritten">Their quest is closed.</p>`);
    const [l, r] = halves(book, (x) => 2 + x.done.length);
    body.innerHTML = spread(`<h2>Behind you · ${book.length} of ${FACTIONS.length} met</h2>`
      + (book.length ? "" : `<p class="dim">Nobody has stepped out of the trees yet. Clear a few sections and look behind you.</p>`) + l.map(side).join(""),
      r.map(side).join("") + (book.length && book.length < FACTIONS.length ? `<p class="unwalked">${FACTIONS.length - book.length === 1 ? "One more has" : "Two more have"} not shown themselves yet.</p>` : "") + `<i class="vignette rest" aria-hidden="true">${emblem("factions")}</i>`);
  } else {
    const reel = (p: Poi) => { const t = tapeOf(p); return `<li><b>${esc(t.title)}</b> ${esc(t.lines.join(" "))}</li>`; };
    // a pack's island (src/packs.ts): its tapes found there, under its name, once you've found one
    const isles = PACKS.map((pk) => ({ pk, reels: isleTapesFound(j, pk) })).filter((i) => i.reels.length)
      .map(({ pk, reels }) => `<h3>${esc(pk.name)}</h3><p class="dim">Found tapes · ${reels.length}</p><ol class="pages">${reels.map(reel).join("")}</ol>`).join("");
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
        + (reels.length ? `<p class="dim">Found tapes · ${reels.length}</p><ol class="pages">${reels.map(reel).join("")}</ol>` : "")
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
    // what you've seen to its end, kept to watch again (memories): a tape, an arrival, a landmark, a first binding
    const kept = memories.list();
    const recalled = kept.length ? `<h3>Remembered · ${kept.length}</h3><ol class="pages memories">${kept.map((mm) => `<li><button data-recall="${esc(mm.id)}" title="Watch it again" aria-label="Watch ${esc(mm.title)} again">${icon("play")}</button><b>${esc(mm.title)}</b>${mm.sub ? ` <span class="dim">${esc(mm.sub)}</span>` : ""}</li>`).join("")}</ol>` : "";
    body.innerHTML = spread(chart().replace('class="chart"', 'class="chart one-page"') + still.replace('class="unwalked"', 'class="unwalked one-page"') + recalled + l.map(page).join(""),
      chart().replace('class="chart"', 'class="chart two-leaves"') + still.replace('class="unwalked"', 'class="unwalked two-leaves"') + r.map(page).join("") + isles);
  }
  // the book's first opening prints the chapter's engraving, the vine rule and the inscription over what the Book
  // wants; every page after opens on that demand alone, one line, and the chapter takes the rest of the leaf (a leaf
  // with nothing on it yet, the trail before a step is walked, keeps the engraving rather than lie bare)
  if (front === undefined) front = tab;
  else if (front !== tab) front = null;
  const verso = body.querySelector(".verso"), bare = !!verso && ![...verso.children].some((e) => (e as HTMLElement).offsetHeight > 0);
  verso?.insertAdjacentHTML("afterbegin", front || bare ? `<div class="opening"><div class="frontis" aria-hidden="true">${emblem(tab)}</div><hr class="flourish" />`
    + `<p class="witch">Left in the Pine Barrens by the ones who fled: what is written here rests here, and comes when it&rsquo;s called.</p><p class="demand" data-page></p></div>`
    : `<div class="opening slim"><p class="demand" data-page></p></div>`);
  // each chapter's head is the Book's line on your record there (src/demand.ts pageLineOf), not the title's demand
  const said = pageLineOf(tab, j);
  for (const p of body.querySelectorAll("[data-page]")) p.innerHTML = hand(said.ask, said.signed);
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
  for (const el of [$("#journal"), $("#journalBody")]) el.scrollTo({ top: 0 }); // the page, or on a wide screen the leaves that scroll inside the book
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
  const again = el.closest<HTMLElement>("[data-recall]")?.dataset.recall;
  if (again) { recall(again); return; }
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
// the facing leaves of the Settings and result spreads carry an engraving each, in a thorn ring (#3671 round 81)
for (const [name, c] of [["--verso-hands", "title"], ["--verso-rest", "witch"]] as const) document.documentElement.style.setProperty(name, `${inkUrl(emblem(c))} 50% 132px / 150px 80px no-repeat, ${inkUrl(ring())} 50% 64px / 216px 216px no-repeat`);
// the result spread is drawn to the screen's size (#3963), so it places the same two engravings itself, in its own units
document.documentElement.style.setProperty("--ink-witch", inkUrl(emblem("witch")));
document.documentElement.style.setProperty("--ink-ring", inkUrl(ring()));
$("#closeJournal").addEventListener("click", () => openJournal(false));
$("#openJournal").innerHTML = icon("book-open");
for (const b of document.querySelectorAll<HTMLElement>("button.info")) b.innerHTML = icon("circle-help"); // each opens its screen's words (a popover)
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
  const b = buttons(k, held ? NO_STICK : padAim);
  // What the player has done in a fight so far, for the tutorial: each flag stays true once it is.
  did.move ||= fx !== 0 || sx !== 0; did.jump ||= b.up; did.attack ||= b.light || b.heavy; did.guard ||= b.guard; did.special ||= b.special;
  return { mx: fw.x * fx + rt.x * sx, mz: fw.z * fx + rt.z * sx, ...b };
}

// --- drawing ----------------------------------------------------------------------------------------
const hudMem = { now: newMemory() };
const plain = (id: string) => id.replace(/^wild-/, "");
const artOf = (id: string) => { const p = ART[plain(id)]; const pic = p?.color ?? p?.bw; return pic ? `/${pic.src}` : null; };
const bindKey = () => keymap.get("bind").map(keyName).join(" / ") || "?";
/** The bind prompt: what to do while the foe is too strong, a call to act once the ink can hold. A knockout can't be bound. */
function bindView(m: Match) {
  if (!trip || !bindable(trip)) return null;
  const mythic = trip.kind === "mythic", chance = bindChance(m.f[1].hp / m.f[1].b.hp, mythic);
  const note = bindNote || (!trip.ink ? "" : chance > 0 ? "Bind it now, before it drops" : `Wear it under ${Math.round(bindBelow(mythic) * 100)}%, then bind`);
  return { chance, ink: trip.ink, key: bindKey(), note };
}
function hud(m: Match) {
  const root = $("#hud");
  dressHud(root);
  root.style.setProperty("--hud-in", director.stage.hud.toFixed(3));
  const party = trip && journey ? { size: journey.party.length, down: [...trip.out], up: trip.slot } : null;
  // A bot plays a fighter when this page runs one for it, or it is a co-op round's wild one (the last fighter).
  const view = viewOf(m, hudMem.now, {
    party: [party, null], bots: m.f.map((_, k) => !!bots[k] || (!!wildBot && k === m.f.length - 1)), art: artOf, tier: (id) => tierOf(plain(id)),
    bind: bindView(m), you: mine,
  });
  root.innerHTML = skinNow().render(view) + crewHtml(view);
  root.classList.toggle("bind-ready", !!trip && bindable(trip) && trip.ink > 0 && bindChance(m.f[1].hp / m.f[1].b.hp, trip.kind === "mythic") > 0);
  if (choosing) chooser();
}
/** ?hud=: a chip in the bottom left that names the skin and steps through them. */
function chooser() {
  let c = document.querySelector<HTMLElement>("#hudChooser");
  if (!c) {
    c = document.createElement("nav"); c.id = "hudChooser"; c.className = "hud-chooser";
    c.innerHTML = `<button data-by="-1" title="Previous HUD" aria-label="Previous HUD">&lsaquo;</button><span></span><button data-by="1" title="Next HUD" aria-label="Next HUD">&rsaquo;</button>`;
    c.addEventListener("click", (e) => { const b = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-by]") : null; if (b && stepSkin(Number(b.dataset.by)) && m) hud(m); }); // redraw now: a paused or finished fight doesn't tick
    document.body.append(c);
  }
  c.hidden = $("#hud").hidden;
  const s = skinNow(), r = hudRing(), label = `${HUD_SKINS.indexOf(s)} ${s.name} · ${r.indexOf(s) + 1}/${r.length}`;
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
    const struck = moveFx.flashOf(i, m.tick) * 0.28; // bloom spreads it, so it stays low
    const flash = Math.max(struck, holding(f) > 0 ? 0.3 : f.invuln ? (m.tick % 8 < 4 ? (f.state === "ledge" ? 0.2 : 0.12) : 0) : 0); // brighter in the lip's shadow
    const p = puppets[i];
    // a blow lands as a hot pulse in the hide, not a white wash: white on a grey hide reads as the texture failing
    if (p) { p.update(f, alpha, m.tick, m.f[foeOf(m, i)]!.pos); p.flash(holding(f) > 0 ? 0xffee88 : struck > 0.01 ? 0xff6a30 : 0xffe8d0, flash); return; }
    const torso = g.children[0] as THREE.Mesh, mat = torso.material as THREE.MeshStandardMaterial;
    mat.emissive.setHex(holding(f) > 0 ? 0xffee88 : 0xffffff); mat.emissiveIntensity = flash;
  });
  moveFx.draw(m);
  // Soft lock: behind you, looking past you at them, high enough to see a flyer.
  const me = m.f[mine]!, them = m.f[foeOf(m, mine)]!;
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
  director.play(first ? memories.mark(identified(t.foe.id, creature(t.foe.id).name, boundCount(first) + 1, { ...loser.pos }, t.k), { id: `identified:${t.foe.id}`, scene: "identified", title: creature(t.foe.id).name, sub: "Bound for the first time", args: { creature: t.foe.id, name: creature(t.foe.id).name, n: boundCount(first) + 1, k: t.k } }) : freeze(bound ? "bound" : won ? "won" : "lost", { ...loser.pos }, t.k));
  pending = { m, bound };
}
function finish(m: Match, bound = false) {
  const ko = m.events.find((e) => e.kind === "ko");
  const w = m.f.find((f) => f.team === m.winner && !f.down) ?? m.f[m.winner!]!, how = ko?.kind === "ko" ? { hp: "was knocked out", "ring-out": "was pushed out of the ring", time: "had less health when time ran out" }[ko.how] : "";
  const lost = bound ? "" : `${esc(m.f[ko?.kind === "ko" ? ko.who : m.winner ? 0 : 1]!.c.name)} ${how}.`;
  if (trip && journey) { tripOver(m, bound, lost); return; }
  const you = versusOn ? mine : 0;
  const won = m.winner === m.f[you]!.team;
  remember({ kind: versusOn ? "duel" : bots[0] ? "watched" : "practice", you: m.f[you]!.c.name, foe: m.f[foeOf(m, you)]!.c.name, won, how: ko?.kind === "ko" ? ko.how : "none" });
  if (versusOn && wildBot && coopAt) { coopOver(m, won, w.c.name); return; }
  if (versusOn && wildBot) { duelOver(won ? "You win together" : `${w.c.name} wins`, `${esc(w.c.name)} ${won ? "stands" : "wins"}. ${lost}`); return; }
  if (versusOn) { duelOver(won ? "You win" : `${versus.friend() ?? "Your friend"} wins`, `${esc(w.c.name)} wins. ${lost}`); return; }
  delete $("#result").dataset.verso;
  $("#result").innerHTML = `<div class="note paper"><h2>${esc(w.c.name)} wins</h2>${reaction({ kind: "versus" })}<p>${lost}</p>
    <div class="row"><button class="go" id="again">${icon("rotate-ccw")} Rematch</button><button id="pick">${icon("users")} Pick again</button></div></div>`;
  pages.show($("#result"));
  const them = m.f.filter((f) => f.team === 1).map((f) => f.c.id), mates = m.f.filter((f, k) => k > 0 && f.team === 0).map((f) => f.c.id);
  $("#again").onclick = () => start(m.f[0].c.id, them[0]!, skinSel.value, !!bots[0], mates, them.slice(1));
  $("#pick").onclick = () => { $("#hud").hidden = true; drawPicker(); pages.show($("#select")); };
}

// --- fighting a friend (src/versus.ts): Qollab friends, challenges, and a duel's room --------------------------------
const versus = mountVersus($("#friends"), {
  show: (el) => hideScreens(el),
  title: () => showTitle(),
  lineUp: () => journey?.party ?? null,
  fight: (go, you, names, kind) => {
    trip = null; shroudFoe = false; bindNote = ""; crowdView = false;
    mine = you; acc = 0; hitStop = 0;
    if (kind === "coop") {
      const teams = coopTeams(go), wild = teams[0].length;
      if (!go.foe) coopAt = null; // the room didn't believe the den: a seeded wild one, nobody's journey to write
      fight(teams[0][0]!, teams[1][0]!, coopAt ? fightSkin(coopAt.region, coopAt.kind) : "stadium", false, true, teams);
      wildBot = bot(wild, go.seed);
      faceUp(`${names.join(", ")} vs ${teams[1][0]!.name}`);
      return;
    }
    const [a, b] = go.picks as [typeof go.picks[0], typeof go.picks[0]];
    fight(atLevel(creature(a.c), a.lv), atLevel(creature(b.c), b.lv), "stadium", false, true);
    faceUp(`${names[0]} vs ${names[1]}`);
  },
  broken: (why) => {
    if (!versusOn || !m || m.over) return;
    m.over = true;
    if (!coopAt) { duelOver("No contest", esc(why)); return; }
    // A den's fight called off: nothing to write, and the walk goes on.
    coopAt = null; delete $("#result").dataset.verso;
    $("#result").innerHTML = `<div class="note paper"><h2>No contest</h2><p>${esc(why)}</p><div class="row"><button class="go" id="back">${icon("map")} Back to the world</button></div></div>`;
    pages.show($("#result"));
    $("#back").onclick = () => { versus.drop(); trip = null; enterWorld(); };
  },
});
/** A den's co-op fight is over (#4413): this page writes what it gave back into its own journey, and the walk goes on. */
function coopOver(m: Match, won: boolean, winner: string) {
  const at = coopAt!, j = journey, i = versus.picked(), me = j && i !== null ? j.party[i] : undefined;
  coopAt = null;
  if (at.host) online?.fought(at.foe.id, at.foe.level, won, false, m.tick / HZ); // the room checks it against the den we walked into
  const lines = j && me ? recordCoop(j, me, at, won, m.f[mine]!.hp / m.f[mine]!.b.hp) : [];
  saveJourney();
  delete $("#result").dataset.verso;
  $("#result").innerHTML = `<div class="note paper o-${won ? "won" : "down"}"><h2>${won ? "You win together" : `${esc(winner)} wins`}</h2>${lines.map((l) => `<p>${esc(l)}</p>`).join("")}
    <div class="row"><button class="go" id="back">${icon("map")} Back to the world</button></div></div>`;
  pages.show($("#result"));
  $("#back").onclick = () => { versus.drop(); trip = null; enterWorld(); world.afterFight(won); };
}
/** A duel is over (or off): who won, and a rematch, another pick, or home. */
function duelOver(head: string, line: string) {
  delete $("#result").dataset.verso;
  $("#result").innerHTML = `<div class="note paper"><h2>${esc(head)}</h2><p>${line}</p>
    <div class="row"><button class="go" id="again">${icon("rotate-ccw")} Rematch</button><button id="pick">${icon("users")} Pick again</button><button id="home">${icon("x")} Leave</button></div></div>`;
  pages.show($("#result"));
  $("#again").onclick = () => versus.rematch();
  $("#pick").onclick = () => { $("#hud").hidden = true; versus.room(); };
  $("#home").onclick = () => { $("#hud").hidden = true; versus.leave(); };
}

/** A world fight ended: XP, a bound creature into the line-up or the journal, a section cleared and its page written,
 * a region's roads opened; or, lost, the next of the line-up steps in, until none is left. */
function tripOver(m: Match, bound: boolean, how: string) {
  const t = trip!, j = journey!, won = m.winner === 0, me = j.party[t.slot]!, foe = creature(t.foe.id);
  online?.fought(foe.id, t.foe.level, won, bound, m.tick / HZ); // the room checks it against the den we walked into
  void achieve("first-fight");
  if (won) void achieve("first-win");
  if (bound) void achieve("first-bind");
  const lines: string[] = [], repeat = owns(j, foe.id);
  // beaten but not bound (and not a sighting closed for good), nothing goes into the Compendium: the page says it got away
  const loose = won && !bound && !t.foe.hunt && (t.kind === "wild" || t.kind === "mythic");
  let title = "", outcome: Outcome = { kind: "won", foe: t.kind === "rival" ? "wild" : t.kind }, go = `${icon("map")} Back to the world`, again: (() => void) | null = null, back: Back | null = null;
  /** What you notice behind you once a section is cleared: a faction's next step now waits at that stone (src/factions/engine.ts). */
  let behindYou: string[] = [];
  if (won) {
    tally(j, false);
    const ups = gainXp(me, t.foe.level), had = slots(j);
    wound(me, m.f[0].hp / m.f[0].b.hp);
    // the section clears first, so a mythic's new line-up slot is there for the mythic itself when it's bound
    if (t.kind === "keeper" || t.kind === "mythic") { clearSection(j, t.region.n, t.k); behindYou = sectionCleared(j, t.region.n, t.k, Date.now()); }
    title = bound ? `${esc(foe.name)} is bound` : loose ? `${esc(foe.name)} got away` : `${esc(creature(me.id).name)} wins`;
    if (bound) { const sec = sections(t.region)[t.k]; lines.push(`The ink holds. ${esc(foe.name)} (Lv ${t.foe.level}) ${bind(j, foe.id, t.foe.level, sec ? `${sec.name}, ${t.region.name}` : t.region.name) === "party" ? "joins your line-up" : "rests in the Eldritch Compendium"}.`); }
    else lines.push(how);
    if (ups) lines.push(`${esc(creature(me.id).name)} grows to level ${me.level}.`);
    if (t.kind === "keeper" || t.kind === "mythic") {
      const sec = sections(t.region)[t.k]!;
      lines.push(`<span class="page">${icon("book-open")}<b>${esc(sec.name)}</b> ${esc(sec.lore)}</span>`);
      if (t.kind === "mythic") { world.beat(t.region.n); lines.push(`The roads out of ${esc(t.region.name)} are open.${bound ? "" : ` ${esc(foe.name)} ran into the dark. It waits for you at the arena: go back and bind it.`}${slots(j) > had ? ` Your line-up has room for ${slots(j)} now.` : ""}`); }
      else lines.push(`The bog-light lifts. Section ${t.k + 2} of ${SECTIONS} is open.`);
    }
    // the factions hear of it (src/factions/model.ts HOOKS): a mythic bound or let go, a contract closed, the Book's count
    if (t.kind === "mythic") deed(j, bound ? "mythic-bound" : "mythic-loose");
    if (bound && !repeat && boundCount(j) === 8) deed(j, "binds-8");
    if (bound && !repeat && boundCount(j) === 16) deed(j, "binds-16");
    if (t.foe.hunt && closeHunt(j, t.foe.hunt)) { deed(j, "hunt-closed"); lines.push(`The sighting is closed: ${esc(t.foe.title ?? foe.name)} won't trouble ${esc(HUNTS.has(t.foe.hunt) ? sections(t.region)[HUNTS.get(t.foe.hunt)!.k]!.name : t.region.name)} again.`); }
    else if (t.kind === "wild" && !bound) lines.push(`It runs off into the trees. You cannot bind a beast that is knocked out. Next time, get its health under ${Math.round(bindBelow(false) * 100)}%. Then press ${esc(bindKey())} before it falls.`);
    if (bound) outcome = { kind: "bound", item: boundCount(j), repeat };
    if (bound) back = { kind: "bound", repeat };
    else if (t.kind === "keeper" || t.kind === "mythic") back = { kind: "cleared", section: sections(t.region)[t.k]!.name, k: t.k, of: SECTIONS, mythic: t.kind === "mythic" ? foe.name : mythicOf(t.region).name, beat: t.kind === "mythic" };
    // a faction's team: the next of them steps in, or, with none left, the fight is theirs to answer for
    if (t.rival) {
      const r = t.rival, next = r.team[r.i + 1];
      title = `${esc(m.f[1].c.name)} is beaten`;
      if (next) {
        lines.push(`They send in ${esc(rivalFoe(next).title ?? creature(next.id).name)} (Lv ${next.level}). ${r.team.length - r.i - 1} to go.`);
        go = `${icon("arrow-left-right")} Fight on`;
        again = () => { r.i++; t.foe = rivalFoe(next); t.foeHp = null; fightTrip(); };
      } else lines.push(rivalSays(r, true));
    }
    if (bound && !repeat) say("bind", { n: t.region.n, item: boundCount(j) });
    const at = { n: t.region.n, regionId: t.region.id, region: t.region.name };
    if (t.kind === "mythic") say("mythic", { ...at, mythic: foe.name, item: boundCount(j) });
    if (t.kind === "keeper" && t.k === SECTIONS - 2) say("last-stone", { ...at, mythic: mythicOf(t.region).name });
  } else {
    t.out.add(t.slot);
    wound(me, 0);
    const next = nextUp(j, t.out);
    const left = next >= 0 && t.kind !== "deadly";
    outcome = { kind: "down", next: left, deadly: t.kind === "deadly" };
    title = left || t.kind === "deadly" ? `${esc(creature(me.id).name)} is knocked out` : "Your whole team is knocked out";
    lines.push(how);
    const lost = tally(j, true), at = { n: t.region.n, regionId: t.region.id, down: creature(me.id).name };
    lossBeats(lost, left).some((b) => say(b, at));
    if (left) {
      const up = creature(j.party[next]!.id);
      lines.push(`${esc(m.f[1].c.name)} still has ${Math.round(m.f[1].hp)} health. Send in your next creature to keep fighting, or run back to the world.`);
      go = `${icon("arrow-left-right")} Send in ${esc(up.name)}`;
      again = () => { t.slot = next; t.foeHp = m.f[1].hp; fightTrip(); };
    } else {
      heal(j); // waking by the last stone mends the line-up, or nobody could fight again
      if (t.rival) lines.push(rivalSays(t.rival, false));
      lines.push(t.kind === "deadly"
        ? "You lost this fight. Your team is healed, and you are back outside the arena you came from."
        : "None of your creatures can fight now. Your team is healed, and you are back at the last stone you lit.");
    }
  }
  saveJourney();
  // the note carries the outcome in art: a bind is sealed in wax, a loss tears its corner away (src/ornaments.ts)
  const torn = outcome.kind === "down" ? tear(j.journal.length + t.region.n * 7 + t.k) : null, mark = outcome.kind === "bound" ? `<i class="seal">${seal()}</i>` : torn ? `<i class="tear">${torn.svg}</i>` : "";
  const plate = outcome.kind === "bound" ? notePlate(foe, false) : outcome.kind === "down" ? notePlate(creature(me.id), true) : "";
  // no folio on a page that kept nothing, and the facing leaf says why
  if (loose) $("#result").dataset.verso = "This page stays empty.\nI only keep what you bind.\n\n\u2014\u00a0the Book";
  else delete $("#result").dataset.verso;
  $("#result").innerHTML = `<div class="note paper o-${outcome.kind}"${torn ? ` style="--tear: ${torn.clip}"` : ""}>${mark}<p class="leaf-head" aria-hidden="true">${loose ? "Field notes<span></span>" : `Eldritch Compendium<span>fol. ${j.journal.length + j.party.length + (j.seen?.length ?? 0) + 1}</span>`}</p>${plate}<h2>${title}</h2>${reaction(outcome)}${lines.map((l) => `<p>${l}</p>`).join("")}<div class="row"><button class="go" id="back">${go}</button>${again ? `<button id="flee">${icon("map")} Run back</button>` : ""}</div></div>`;
  pages.show($("#result"));
  const home = () => { trip = null; enterWorld(); world.afterFight(won); if (back) world.note(bookToast(back)); for (const line of behindYou) world.note(`${icon("footprints")}${esc(line)}`); };
  $("#back").onclick = again ?? home;
  const flee = document.querySelector<HTMLElement>("#flee");
  if (flee) flee.onclick = home;
}

// --- the key hints under the picker and on the world map, and the movement card, written from the bindings as they are now ---
// Only the few keys you need to get going show on screen; every key sits in Settings under Moving, Fighting and Open world.
const cap = (id: string) => `<b>${keymap.get(id).map((c) => esc(keyName(c))).join("</b> / <b>") || "?"}</b>`;
const walk = () => { const f = (id: string) => keyName(keymap.get(id)[0] ?? ""); return `<b>${esc(["forward", "left", "back", "right"].map(f).join(""))}</b>`; };
/** The first-time tutorial (@rustybuns/util/tutorial): a first fight's five things to do, each ticked once the player
 *  has done it (`did`, set from their own input in playerInput). It starts with the first fight you pick or walk into. */
const did = { move: false, jump: false, attack: false, guard: false, special: false };
const caps = (...ids: string[]) => ids.map((id) => keyName(keymap.get(id)[0] ?? "")).filter(Boolean);
const coach = tutorial({
  prefix: "mm",
  account: { achieve, achievements },
  steps: [
    { title: "Move", keys: caps("forward", "left", "back", "right"), say: "Or the stick. Moves go from the camera: forward is away from you.", done: () => did.move },
    { title: "Jump", keys: caps("jump"), say: "Tap for a hop, hold to go higher.", done: () => did.jump },
    { title: "Attack", keys: caps("light"), say: "Or click. A right click is a strong swing that costs stamina.", done: () => did.attack },
    { title: "Guard", keys: caps("guard"), say: "Hold it as they swing: a guarded hit does a fraction.", done: () => did.guard },
    { title: "A special", keys: caps("special"), say: "Every beast has its own. It costs energy: land hits, or stand still, to fill it back up.", done: () => did.special },
  ],
});
/** A fight you walked into from your own journey: the tutorial, if this is the first. */
const learn = () => { if (m && keepJourney) coach.start(); };
/** The movement card over the fight and the world: shown unless it is switched off in Settings (saved per browser). */
const MOVE_CARD = `${KEY}.moveCard`;
let moveCardOn = (() => { try { return localStorage.getItem(MOVE_CARD) !== "off"; } catch { return true; } })();
const moveCard = Object.assign(document.createElement("aside"), { id: "moveKeys", className: "move-keys", hidden: true, ariaLabel: "Movement keys" });
document.body.append(moveCard);
const cineEl = $("#cine");
let moveCardFor: "fight" | "hunt" | "world" | null = null;
function drawMoveCard(where: "fight" | "hunt" | "world") {
  moveCardFor = where;
  moveCard.classList.toggle("world", where === "world");
  moveCard.innerHTML = moveKeys(where).map((k) => `<span><kbd>${esc(k.keys)}</kbd>${esc(k.does)}</span>`).join("");
}
function drawHints() {
  const fight = document.querySelector("#fightKeys"), roam = document.querySelector("#worldKeys");
  if (fight) fight.innerHTML = `${walk()} move · ${cap("jump")} jump · ${cap("dash")} dash · ${cap("light")} attack · ${cap("heavy")} strong · ${cap("special")} special · ${cap("guard")} guard. More keys in Settings.`;
  if (roam) roam.innerHTML = `Follow the dashed trail. Beat the keeper on each lit stone to open the next part; the mythic waits at the end. ${cap("map")} map · ${cap("journal")} book. More keys in Settings.`;
  if (moveCardFor) drawMoveCard(moveCardFor);
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
  const box = Object.assign(document.createElement("input"), { type: "checkbox", checked: moveCardOn, name: "moveCard" });
  box.onchange = () => { moveCardOn = box.checked; try { localStorage.setItem(MOVE_CARD, moveCardOn ? "on" : "off"); } catch { /* this session only */ } };
  // the panel's own switch row (a label with its words in .gc-lab, then the box), so it sits like Toggle instead of hold
  const row = document.createElement("label");
  row.append(Object.assign(document.createElement("span"), { className: "gc-lab", textContent: "Movement keys on screen" }), box);
  pane.append(row);
  return { sync: () => { presets(); box.checked = moveCardOn; drawHints(); } };
}

/** Your ground's colour, under the Account tab: the 64 as swatches, the ones friends in your room wear taken. */
function huePicker(pane: HTMLElement) {
  const taken = new Set(online?.colours().flatMap((o) => (o.colour === undefined ? [] : [o.colour])) ?? []), worn = hueWorn();
  const box = Object.assign(document.createElement("div"), { className: "hues", role: "group", ariaLabel: "Your ground's colour" });
  box.innerHTML = Array.from({ length: COLOURS }, (_, i) => {
    const gone = taken.has(i) && i !== worn;
    return `<button type="button" data-hue="${i}" style="--hue:${hueCss(i)}" aria-pressed="${i === worn}"${gone ? " disabled" : ""} title="${gone ? `Colour ${i + 1}, a friend's` : `Colour ${i + 1}`}" aria-label="${gone ? `Colour ${i + 1}, a friend's` : `Colour ${i + 1}`}"></button>`;
  }).join("");
  box.onclick = (e) => {
    const b = e.target instanceof Element ? e.target.closest<HTMLButtonElement>("button[data-hue]") : null;
    if (!b || b.disabled) return;
    hueChosen = Number(b.dataset.hue);
    try { localStorage.setItem(HUE_KEY, String(hueChosen)); } catch { /* this session only */ }
    box.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
  };
  pane.append(Object.assign(document.createElement("p"), { textContent: "Your ground: the colour the waves round your feet hum in, which friends know you by. A colour a friend in your room wears is taken." }), box);
}

/** The Account tab: the shared eqosys chip (who is signed in, the way in or out) under a line of the Book's, and your ground's colour. */
function accountPane(pane: HTMLElement) {
  pane.classList.add("gc-acct");
  const draw = () => {
    const who = login(), can = canSignIn();
    const say = who ? "Signed in through eqosys: your name goes with you across the Q games."
      : can ? "Sign in through eqosys to carry your name across the Q games."
        : "Signing in opens once Mythic Masters is online. Until then you play under a local name, and your save stays in this browser.";
    pane.replaceChildren(Object.assign(document.createElement("p"), { textContent: say }));
    if (who || can) pane.append(accountChip(document.createElement("div"), { note: signInNote, onSignOut: () => { draw(); drawAccount(); }, onSignIn: () => { draw(); heardLogin(); } }));
    huePicker(pane);
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
  onToggle: (open) => {
    const over = (!!m && !m.over) || world.shown; // opened over a fight or the walk, Settings is the pause
    paused = open; keys.clear(); fingers.clear();
    const d = document.querySelector<HTMLElement>("body > .gc-dialog");
    if (open && d) settingsNote(d, over);
    if (d) cardTurn(d, open);
  },
});

/** The Book's margin note on the Settings card, under its heading, and a thumbprint somewhere new each opening. */
let settingsOpens = 1; // from 1, so the first opening is one that carries a print (page.ts thumb skips some)
function settingsNote(dialog: HTMLElement, over: boolean) {
  const card = dialog.querySelector<HTMLElement>(".gc-card");
  if (!card) return;
  let p = card.querySelector<HTMLElement>(":scope > .demand");
  if (!p) { p = Object.assign(document.createElement("p"), { className: "demand" }); card.querySelector(".gc-head")?.after(p); }
  p.innerHTML = hand(settingsLineOf({ paused: over, quillMuted: volumeOf(controls.get(), "sfx", "quill") === 0 }), false);
  thumb(card, settingsOpens++);
}

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
/** Through your own eyes (the abduction): the lids, the blur, the saucer's room, and the greys leaning in. */
function stagePov(el: HTMLElement, p: Stage["pov"]) {
  el.hidden = !p;
  if (!p) return;
  el.dataset.where = p.where;
  el.style.setProperty("--lids", p.lids.toFixed(3));
  el.style.setProperty("--blur", `${p.blur.toFixed(2)}px`);
  el.style.setProperty("--greys", p.figures.toFixed(3));
  el.style.setProperty("--up", p.up.toFixed(3));
}
/** The overlay: letterbox bars, a caption, a name slammed in, the camcorder's REC light and timecode, the freeze frame. */
let lastFilter = "";
function cinema(st: Stage) {
  const cine = $("#cine");
  const on = st.bars > 0.001 || st.tape > 0.001 || st.freeze > 0.001 || st.dip > 0.001 || st.flash > 0.001 || st.speed > 0.001 || !!st.caption || !!st.title || !!st.versus || !!st.pov;
  cine.hidden = !on;
  document.body.classList.toggle("cine-hold", director.holding);
  const filter = [st.tape > 0.01 ? `saturate(${(1 - 0.5 * st.tape).toFixed(2)}) contrast(${(1 + 0.2 * st.tape).toFixed(2)}) sepia(${(0.15 * st.tape).toFixed(2)})` : "",
    st.muffle > 0.01 || st.whip > 0.01 ? `blur(${(3 * st.muffle + 7 * st.whip).toFixed(2)}px)` : "", // you can't make it out either; or the camera whipped round
    st.pov && st.pov.where === "pines" && st.pov.blur > 0.05 ? `blur(${st.pov.blur.toFixed(2)}px)` : "", // coming to on your back
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
  stagePov(cine.querySelector<HTMLElement>(".pov")!, st.pov);
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
  return playNamed(director, SCENES, name, whereNow(k), t);
}
/** Where a scene played by name happens: where you stand in the world, or over the fight. */
function whereNow(k = 0): Where {
  const inWorld = world.shown, at = inWorld ? world.here() : m ? { ...m.f[1].pos } : { x: 0, y: 0, z: 0 };
  const view = inWorld ? world.vista() : { x: at.x, y: at.y + 2, z: at.z - 60 };
  return { at, view, n: inWorld ? world.state().region : 1, k, name: inWorld ? world.state().name : "The Arena" };
}
/** Watches a memory again (memories above): its scene from SCENES, where you stand now, with what it was (a tape's
 *  lines, a landmark's place). Only one you've seen to its end is there to play. A second `t` holds that frame. */
function recall(id: string, t: number | null = null): boolean {
  const mem = memories.get(id);
  if (!mem) return false;
  const a = mem.args ?? {}, w = whereNow(typeof a.k === "number" ? a.k : 0);
  const n = (key: string) => typeof a[key] === "number" ? a[key] : undefined, txt = (key: string) => typeof a[key] === "string" ? a[key] : undefined;
  const vx = n("vx"), vy = n("vy"), vz = n("vz"), lines = a.lines;
  const where: Where = { ...w, n: n("n") ?? w.n, name: txt("name") ?? w.name, label: txt("label"), creature: txt("creature"),
    ...(Array.isArray(lines) ? { lines } : {}), ...(vx !== undefined && vy !== undefined && vz !== undefined ? { view: { x: vx, y: vy, z: vz } } : {}) };
  if (journalOpen) openJournal(false);
  return playNamed(director, SCENES, mem.scene, where, t);
}
mountScenes({ list: () => Object.keys(SCENES), play: (name, t) => playScene(name, 0, t ?? null) === true, state: () => ({ beat: director.beat, paused: director.paused, ...director.stage }) });

let last = performance.now(), acc = 0;
function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  padEdges();
  crowdOf(arena)?.update(dt);
  tickArena(arena, performance.now() / 1000);
  const moving = world.shown || (!!m && !m.over && !bots[0]);
  document.body.classList.toggle("in-fight", !!m && !m.over && !world.shown);
  touchEl.hidden = !(touchy && moving);
  const where = world.shown ? "world" : bindable(trip) ? "hunt" : "fight";
  if (moveCardFor !== where) drawMoveCard(where);
  moveCard.hidden = !moveCardOn || touchy || !moving || paused || journalOpen || !!talking || !cineEl.hidden;
  touchEl.classList.toggle("world", world.shown);
  touchEl.classList.toggle("bindable", bindable(trip));
  touchEl.classList.toggle("ult-ready", !!m && m.f[mine].energy >= 100);
  if (padKeys.length && director.skippable) poke = true;
  memories.step(director.step(dt, poke)); poke = false;
  if (boat) { if (director.scene === boat.s) boat.started = true; else if (boat.started || !director.beat) { const b = boat; boat = null; b.then(); } }
  if (pending && !director.holding) { const p = pending; pending = null; finish(p.m, p.bound); }
  nextTalk();
  const step = versusOn ? versus.link()?.step ?? null : null;
  shareLair();
  // A fight against a friend never pauses: a menu open over it only stops your hands.
  if (m && live && !m.over && (step || ((!paused && !journalOpen) && !versusOn)) && !director.holding && !talking) {
    pollPad();
    if (hitStop > 0) hitStop -= dt; else acc += dt;
    while (acc >= 1 / HZ && !m.over && hitStop <= 0) {
      const cur = m;
      const seats = step ? step.next(() => (paused || journalOpen ? IDLE : playerInput())) : null;
      const both: Input[] | null = step ? seats && (wildBot ? [...seats, wildBot(cur)] : seats) : cur.f.map((_, k) => { const b = bots[k]; return b ? b(cur) : k === 0 ? playerInput() : IDLE; });
      if (!both) { acc = Math.min(acc, 0.25); break; } // the friend's input isn't in yet: wait a frame, never guess
      live.step(both);
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
    if (step) versus.link()?.flush(m);
    hud(m);
  }
  if (!world.shown) rivals.hide();
  if (world.shown && !paused && !journalOpen && !talking && sitting === null && !sheet) {
    stepRivals(now);
    pollPad();
    const still = director.holding, turn = held || still ? 0 : padAim.sx * 1.8 * dt + lookTurn;
    lookTurn = 0;
    const shared = online?.clock(now);
    if (shared != null) world.share(shared); // the party's one clock: the same wilds, sun and weather for everyone
    world.update(dt * director.stage.slow, still ? new Set() : actions(), held || still ? NO_STICK : stickFinger ? touchMove : padMove, turn);
    const hue = hueWorn();
    world.hue(hue);
    if (online) { const p = world.pose(); online.update(p.region, p.x, p.z, p.yaw, p.lead, now, p.follow, hue); if (online.you) world.seat(online.you); world.friends(friendsNow(online, p.region, now), dt); }
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
  renderer.info.reset();
  if (DRAW) { if (composer) composer.render(); else renderer.render(scene, camera); }
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
// Back from eqosys with ?code=&state=: read the handoff before any screen below puts its own address up (the title wipes
// the query), or the code is lost and the title still offers Sign in. It reads the address now; the login lands later.
const signedIn = finishSignIn();
if (params.get("cards") === "1") showDeck(true);
else if (params.get("crowd") !== null) showCrowd(params.get("crowd") || null);
else if (params.get("gallery") !== null) {
  mountAgent({ shelf: () => shelf, page: () => shelfPage, pages: Math.ceil(ROSTER.length / PAGE), show: showGallery });
  mountPalette();
  showGallery(clamp(Number(params.get("gallery")) || 0, 0, Math.ceil(ROSTER.length / PAGE) - 1));
}
else if (params.get("faction") && stepOf(params.get("faction")!)) jumpToStage(params.get("faction")!);
else if (params.get("world") === "1") { const a = STARTERS.find((s) => s === params.get("a")) ?? STARTERS[0]; if (!journey && params.get("a")) { journey = newJourney([a, ...STARTERS.filter((s) => s !== a)].slice(0, PICKS)); saveJourney(); } enterWorld(); }
else if (params.get("a") && params.get("b")) start(pickA, pickB, skinSel.value, params.get("watch") === "1", matesOf(params.get("with")), matesOf(params.get("and")));
else if (params.get("versus") !== null) pages.show($("#select"));
else if (duelCode(location.search)) versus.enter(duelCode(location.search)!);
else if (coopCode(location.search)) versus.enter(coopCode(location.search)!, "coop");
else if (params.get("vs") === "1") versus.open();
else showTitle();
// ?scene=<name>&t=<seconds> (@rustybuns/util/director): one of the director's scenes over a fight (the a and b of the
// link, or the first two), held at second t, for a look at one frame without playing to it.
const link = sceneLink(params.toString()); // params: the title has put its own address up by now
if (link) {
  if (!m && !world.shown) start(pickA, pickB, skinSel.value, true);
  playScene(link.name, 0, link.t);
}
reportButton();
// Opened from a party link (?party=CODE): read the Book with that party once signed in.
const askedParty = (params.get("party") ?? "").toUpperCase().match(/^[A-Z0-9]{4,12}$/)?.[0] ?? null;
// Signed in: redraw the title's chip with the name.
void signedIn.then((back) => {
  if (back) { signInNote = back.error ?? ""; drawAccount(); }
  if (back?.login && back.then === "versus") versus.open(); // signed in from Fight a Friend: back to the friends list
  // Signed in from a party link the long way round (the window was blocked): back to that party's lobby; its invite key waited.
  const backTo = back?.login && back.then.startsWith("party:") ? partyCode(`?party=${back.then.slice(6)}`) : null;
  if (backTo && backTo !== partyId) { location.search = `?world=1&party=${backTo}`; return; }
  if (askedParty && login()) joinReaders(askedParty);
  else if (askedParty) { signInNote = "Sign in to read the Book with this party."; drawAccount(); }
  drawReaders();
});
requestAnimationFrame(frame);

const view = (f: Fighter) => ({
  id: f.c.id, hp: Math.round(f.hp), launch: Math.round(f.launch), stamina: +f.stamina.toFixed(2), energy: Math.round(f.energy),
  state: f.state, swing: swingPhase(f), flying: f.flying, onGround: f.onGround, invuln: f.invuln, clipped: f.clipped > 0, pos: { x: +f.pos.x.toFixed(2), y: +f.pos.y.toFixed(2), z: +f.pos.z.toFixed(2) },
});
const fightState = () => m && { tutorial: coach.state(), engine: live?.engine, arena: arenaLook, tick: m.tick, over: m.over, winner: m.winner, fighters: m.f.map(view), shapes: m.areas.map((a) => ({ by: a.owner, shape: a.d.shape, move: a.move.name, head: head(a) })), warnings: ([0, 1] as const).map((i) => warning(m!, i)?.d.shape ?? null), ringRadius: ARENA.radius };
const tripState = () => trip && { ...trip, out: [...trip.out], region: trip.region.n };
Object.assign(window, {
  mythicMasters: {
    state: fightState,
    /** Fighting a friend: the duel's link, who sits where, the round, the tick it plays next and how long it's waited,
     *  and the fight's hash (net/duel.ts `sum`), the same on both pages while they play the same fight. */
    duel: () => { const l = versus.link(); return l && { code: l.code, status: l.status, seats: l.seats, round: l.step?.r ?? null, next: l.step?.tick ?? null, waited: l.step?.waited ?? 0, delay: l.step?.delay ?? null, mine, on: versusOn, tick: m?.tick ?? null, over: m?.over ?? null, sum: m ? sum(m) : null, screen: document.querySelector("#result:not([hidden]) h2")?.textContent ?? null }; },
    /** Pick line-up member `i` in the duel's room (what a tap on its card does). */
    /** Leave the duel (the room's Leave button), and open or close the Settings menu (the pause menu, over a fight). */
    duelLeave: () => versus.leave(),
    settings: (open = true) => { if (open) controls.open(); else controls.close(); return controls.isOpen(); },
    duelPick: (i: number) => { const b = document.querySelector<HTMLElement>(`#friends [data-pick="${i}"]`); b?.click(); return !!b; },
    /** The last frame's draw calls and triangles (every pass), the geometries and textures the GPU holds, and the shader programs compiled so far: for scripts/walk-budget.ts. */
    perf: () => { const { render, memory, programs } = renderer.info; return { calls: render.calls, triangles: render.triangles, geometries: memory.geometries, textures: memory.textures, programs: programs?.length ?? 0, particles: moveFx.count, cap: moveFx.cap }; },
    /** The field chart: open() / close() it, ask(you, them) sets its asker (one or two fields a side), state() reads it. */
    chart,
    start: (a: string, b: string, skin = "stadium", watch = false) => start(a, b, skin, watch),
    /** The movement card: whether it shows, and the keys on it (`moveKeys(false)` switches it off as Settings does). */
    moveKeys: (on?: boolean) => { if (on !== undefined) moveCardOn = on; return { shown: !moveCard.hidden, on: moveCardOn, where: moveCardFor, keys: moveKeys(moveCardFor ?? "fight") }; },
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
    /** The quality tier drawn at `now` (low, mid or high), each step the frame budget took to get there (`?quality=` sets where it starts), and the plant budget that tier set. */
    quality: () => ({ now: tiers.quality, steps: tiers.steps, plants: plantBudget() }),
    hud: (id?: string) => { if (id !== undefined && !useSkin(String(id))) return null; if (id !== undefined && m) hud(m); return { now: skinNow().id, skins: HUD_SKINS.map((s) => ({ id: s.id, name: s.name, idea: s.idea })) }; },
    /** The open world: `enter()`, `state()` (where you are, what you've beaten, what's open and rising), `travel(n)` to an open region n's arena, `places(n?)` the region's tapes, campfires, landmarks and sighting boards (also in `state().places`), `hunts(n?)` its sighting-board contracts (stage, next sign, lair; also `state().hunts`), `fastTravel(id)` to a lit campfire, `enterTown(id)` into a sighting board's town (its door does it too; `state().town` says where you stand inside, the board and the people), `standInside(x, z)` there in the town's own metres and `leaveTown()`, `ferry()` takes the boat to the Yule Isle or back (`state().isle` on the island: where you stand, its slip and landing fire; `state().ports` the piers) and `standIsle(x, z)` on it, `teleport(x, z)` onto open ground (`state().wilds` says where the wild ones roam, `trails()` where each keeper's stone is), `setHour(h)` for the time of day, `setWeather({ rain, snow, mist })` (or null) to hold the weather, `layer(name, on)` to hide a drawn layer, `beat(n)` as if you won its arena, `reset()`. */
    /** Walking together, for an agent or the two-page journey: the party's view, and a contract told to the room. */
    together: {
      state: () => online && { room: online.room, status: online.status, where: online.where(), fights: fights.map((f) => ({ ...f })), lair: trip?.foe.hunt && m ? { den: `hunt:${trip.foe.hunt}`, hp: m.f[1].hp / m.f[1].b.hp, friends: Object.fromEntries(lairHurt.get(`hunt:${trip.foe.hunt}`) ?? []) } : null },
      hunt: (h: string, s: number) => online?.hunt(h, s),
      /** As if you had picked patch `id` (a grid cell, `gx,gz`), for the two-page journey. */
      pick: (id: string) => { world.lifeHeard({ k: "pick", id }); online?.life("pick", id); },
      seen: () => world.seen(),
    },
    world: { enter: enterWorld, state: world.state, friends: world.friends, online: () => online && { room: online.room, status: online.status, clock: online.clock(performance.now()), sentBytes: online.sentBytes, friends: friendsNow(online, world.pose().region, performance.now()) }, travel: world.travel, beat: world.beat, teleport: world.teleport, eye: world.eye, setHour: world.setHour, peace: world.peace, setWeather: world.setWeather, layer: world.layer, reset: world.reset, trails: world.trails, places: world.places, hunts: world.hunts, fastTravel: world.fastTravel, enterTown: world.enterTown, standInside: world.standInside, leaveTown: world.leaveTown, ferry: world.ferry, standIsle: world.standIsle },
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
     * `say(beat, ctx)` as if that beat happened, `turn()` the next lead-in page, `answer(id)` a reply (a guest's page gets the host's this way), `close()` reads past the answer,
     * `party({ host, hostName })` (or null) to hold a guest's buttons until the host answers (a real party, `?party=CODE`, sets it itself). */
    book: {
      state: () => ({ open: talking && { id: talking.m.talk.id, recall: talking.m.recall, lead: talking.m.lead, page: talking.page, ask: talking.m.ask, replies: talking.m.talk.replies.map((r) => ({ id: r.id, say: r.say })), said: talking.said, hold: talkHold() }, queued: talks.length, talk: journey?.talk ?? null }),
      say: (beat: Beat, ctx: Ctx = {}) => { say(beat, ctx); nextTalk(); return talking?.m.talk.id ?? null; },
      turn: () => { if (talking && talking.said === null && talking.page < talking.m.lead.length) { talking.page++; drawTalk(); } return talking?.page ?? 0; },
      answer: (id: string) => replyBook(id, !talkHold().canAnswer),
      close: () => { talking = null; drawTalk(); nextTalk(); },
      party: (p: { host: boolean; hostName: string } | null) => { talkParty = p; drawTalk(); },
    },
    /** The three factions behind you (src/factions/engine.ts): `state()` who you met and in what order, the steps done, the flags, each one's
     * reading (now, past, trend, the pressure that makes) and the steps waiting; `posts(n)` the posts manned in region n; `approach(f)` walks
     * up to faction f's waiting step (its hail, question and replies), `reply(id)` answers it (what they say, and their team if it starts the
     * fight), `fought(won)` ends that fight; `hail(postId)` walks up to a post and `postFought(postId, won)` ends its fight. */
    factions: {
      state: () => journey && {
        ...factionsOf(journey), record: questRecord(journey),
        waiting: waitingAll(journey, factionCtx()).map((w) => ({ faction: w.faction, stage: w.stage.id, title: w.stage.title, n: w.stage.n, k: w.stage.k, who: w.stage.who })),
        reading: Object.fromEntries(FACTIONS.map((f) => { const r = reading(journey!.factions?.by[f]); return [f, { ...r, band: bandOf(r.now), pastBand: bandOf(r.past), trendBand: trendOf(r.trend), pressure: pressure(r) }]; })),
      },
      posts: (n = world.pose().region) => (journey ? postsIn(journey, n, factionCtx()).map((p) => ({ id: p.id, faction: p.faction, k: p.post.k, rank: p.rank.title, resting: p.resting })) : []),
      sheet: () => sheet && { who: sheet.who, said: sheet.said, replies: sheet.replies, team: sheet.team },
      figures: () => figures.map((f) => ({ id: f.id, faction: f.faction, quest: !!f.quest, resting: !!f.resting, x: +f.x.toFixed(1), z: +f.z.toFixed(1) })),
      approach: (f: FactionId) => faceStage(f) && sheet,
      reply: (id: string) => answerSheet(id),
      fight: () => fightSheet(),
      close: () => { sheet = null; drawSheet(); },
      fought: (won: boolean) => { const said = journey && facing ? foughtFaction(journey, facing.faction, facing.stage.id, won, factionCtx()) : ""; saveJourney(); return said; },
      hail: (id: string) => { const p = postAt(id); return !!p && facePost(p) && sheet; },
      postFought: (id: string, won: boolean) => { const p = postAt(id); const said = journey && p ? postFought(journey, p, won, factionCtx()) : ""; saveJourney(); return said; },
    },
    /** The Bog Witch's camp (src/witch.ts): `state()` her camp, what she is saying and the count she last saw, `sit()` as if you
     * walked up to her fire, `close()` reads past her line. `world.fastTravel(witch.state().camp)` once it's lit goes there. */
    witch: {
      state: () => ({ camp: WITCH_CAMP, saying: sitting, seen: journey?.witch ?? null, cleared: journey ? regionsCleared(journey) : 0 }),
      sit: () => sitWithWitch() && sitting,
      close: () => { sitting = null; drawWitch(); },
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
      /** The scenes you've seen to their end, to watch again; `recall(id)` plays one (`t`: held at that second). */
      memories: () => memories.list(), recall: (id: string, t?: number) => recall(id, t ?? null),
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
