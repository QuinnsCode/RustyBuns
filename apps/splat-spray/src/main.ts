import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { SparkRenderer, SplatMesh } from "@sparkjsdev/spark";
import { scan, spray } from "./spray.ts";
import { RevealField } from "./reveal.ts";
import { DEFAULT_GUN, due, pull, spreadOf, type Trigger } from "./gun.ts";
import { buildRoom, roomSlots } from "./levels/room.ts";
import { fillPackedSplats, placeObjects, shuffled, type SpyObject, type SpyScene } from "./levels/scene.ts";
import { rng } from "./levels/kit.ts";
import { pickQuality, QUALITY } from "@rustybuns/util/quality";
import { DEFAULTS, mountControls } from "@rustybuns/game-controls";
import { getJson } from "@rustybuns/util/http";
import { joinRoom, menu, panel, racers, secs, tabPlayerId, type Session } from "./online.ts";
import { MatchReply } from "./api.ts";
import { finishSignIn, reportButton, whoQuery } from "./eqosys.ts";
import { MATCH, type View } from "./match/game.ts";
import { createElement, Hand, ScanLine, Tv, Volume2, VolumeX } from "lucide";
import { brief, clearStamp, closeBrief, stamp } from "./briefing.ts";
import { rank } from "./spy.ts";
import { isMuted, setMuted, sfx } from "./sfx.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>("view");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
// ?quality=low|mid|high or a guess from the GPU: it sets the pixel ratio and how many splats the room is built from.
const tier = pickQuality().quality;
const sharp = Math.min(devicePixelRatio, QUALITY[tier].pixelRatio);
renderer.setPixelRatio(sharp);
const DENSITY = { low: 3000, mid: 6000, high: 9000 }[tier];
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);
const camera = new THREE.PerspectiveCamera(55, 1, 0.05, 500);
const spark = new SparkRenderer({ renderer });
scene.add(spark);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
// left button is the trigger, so looking around is right-drag or the arrow keys
controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE } as any;
controls.listenToKeyEvents(window);

// The cog's look speeds: rotateSpeed carries X (mouse) or touch (finger); Y is the up/down angle change rescaled to match.
let ctl = { ...DEFAULTS };
// A phone starts in its own words (tap, hold Scan) before its first touch; the first press settles it.
let pointerKind = matchMedia("(pointer: coarse)").matches ? "touch" : "mouse";
const applySpeed = () => { controls.rotateSpeed = pointerKind === "touch" ? ctl.touch : ctl.lookX; };
const orbit = new THREE.Spherical();
const polarOf = () => orbit.setFromVector3(camera.position.clone().sub(controls.target)).phi;
let lastPolar = 0;
controls.addEventListener("change", () => {
  const phi = polarOf();
  if (!flight) {
    const speed = pointerKind === "touch" ? ctl.touch : ctl.lookX;
    const k = (ctl.lookY / speed) * (ctl.invertY ? -1 : 1);
    if (k !== 1) {
      const next = Math.min(Math.PI - 0.01, Math.max(0.01, lastPolar + (phi - lastPolar) * k));
      orbit.phi = next;
      camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(orbit));
      camera.lookAt(controls.target);
      lastPolar = next;
      return;
    }
  }
  lastPolar = phi;
});

const GUN = { ...DEFAULT_GUN };
const HOME = { eye: new THREE.Vector3(0, 1.7, 6.4), target: new THREE.Vector3(0, 1.2, -0.6) };
const PICK_SPREAD_DEG = 1.1;
const WRONG_PICK_COST = 5;
const DOTS_PER_SHOT = 260;      // a shot lights this many points, scanner-style
const SHOT_SPREAD_DEG = 7;      // how wide the scan fans out

let shots = 0;            // this round
let missions = 0;         // solo rounds played, for the dossier's mission number
let totalShots = 0;
let wrong = 0;
let startedAt = 0;        // first shot of the round
let roundMs = 0;
let totalMs = 0;
let best: { shots: number; ms: number; name: string } | null = null;
const rand = rng(90210);
let slots = roomSlots(rand);
let target: SpyObject | null = null;
const found = new Set<number>();
let picking = false;
let trigger: Trigger | null = null;
// "menu" until the player picks; "solo" is the practice room; "online" is a match run by a world.
let mode: "menu" | "solo" | "online" = "menu";
let session: Session | null = null;
let view: View | null = null;
let layoutApplied = 0;
/** This round's find was made here (the world confirms it on the board). */
let foundHere = false;
let flight: { fromEye: THREE.Vector3; fromTarget: THREE.Vector3; eye: THREE.Vector3; look: THREE.Vector3; start: number; ms: number } | null = null;

const setText = (id: string, text: string) => { $(id).textContent = text; };
const say = (text: string) => setText("hint", text);
const article = (name: string) => (/^[aeiou]/i.test(name) ? "an" : "a");
function setShots(n: number) { shots = n; setText("rounds", String(n)); }
function setScore() {
  const bestText = best ? ` · best ${best.shots} shots in ${secs(best.ms)} (${best.name})` : "";
  setText("score", `${found.size} / ${room.objects.length} found · ${totalShots} shots · ${secs(totalMs)}${wrong ? ` · ${wrong} wrong` : ""}${bestText}`);
}
function tickTimer() {
  if (session || !target || !startedAt) return;
  setText("timer", secs(performance.now() - startedAt));
}

// ---------- the round ----------

function shuffleRoom(r = rand) {
  slots = shuffled(roomSlots(r), r);
  placeObjects(room, slots);
  fillPackedSplats(room, mesh.packedSplats as any);
  (mesh.packedSplats as any).needsUpdate = true;
  mesh.updateVersion();
}

function nextTarget() {
  const left = room.objects.filter((o) => !found.has(o.id));
  if (!left.length) {
    target = null;
    field.focus(-1);
    setText("prompt", "Every file closed");
    say(`All ${room.objects.length} found: ${totalShots} shots in ${secs(totalMs)}. "Start over" begins again.`);
    return;
  }
  target = left[Math.floor(rand() * left.length)]!;
  // a fresh dark room every round, with everything moved
  shuffleRoom();
  field.reset();
  field.focus(-1);
  setShots(0);
  startedAt = 0;
  nudge(false);
  setText("timer", "0.0s");
  missions++;
  clearStamp();
  setText("prompt", `Target: the ${target.name}`);
  brief(Math.floor(rand() * 2 ** 31), missions, target.name);
  say(touchy() ? "Drag to look, tap or hold Scan to light the room. Seen it? Tap Pick, then tap it. Fewest shots wins." : "Hold the left button to scan, right-drag to look. Seen it? Hold Shift (or press Pick) and click it. Fewest shots wins.");
}

function flyTo(o: SpyObject | null) {
  const dist = o ? Math.max(0.5, o.radius * 4.5) : 0;
  const eye = o ? o.center.clone().add(new THREE.Vector3(dist * 0.45, dist * 0.5, dist)) : HOME.eye.clone();
  const look = o ? o.center.clone() : HOME.target.clone();
  flight = { fromEye: camera.position.clone(), fromTarget: controls.target.clone(), eye, look, start: performance.now(), ms: 900 };
}

function stepFlight() {
  if (!flight) return;
  const t = Math.min(1, (performance.now() - flight.start) / flight.ms);
  const e = t * t * (3 - 2 * t);   // ease in and out
  camera.position.lerpVectors(flight.fromEye, flight.eye, e);
  controls.target.lerpVectors(flight.fromTarget, flight.look, e);
  if (t >= 1) flight = null;
}

// ---------- firing and picking ----------

function rayFrom(x: number, y: number) {
  const rect = canvas.getBoundingClientRect();
  const ndc = new THREE.Vector2(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1);
  const ray = new THREE.Raycaster();
  ray.setFromCamera(ndc, camera);
  const inv = mesh.matrixWorld.clone().invert();
  const origin = ray.ray.origin.clone().applyMatrix4(inv);
  const dir = ray.ray.direction.clone().transformDirection(inv);
  return {
    centers: room.centers, opacities, radii,
    origin: [origin.x, origin.y, origin.z] as [number, number, number],
    dir: [dir.x, dir.y, dir.z] as [number, number, number],
    thickness: 0.06,
  };
}

/** A scan shot: scattered dots on whatever the rays hit first. */
const shootDots = (x: number, y: number, spreadDeg: number) =>
  scan({ ...rayFrom(x, y), halfAngleDeg: spreadDeg, dots: DOTS_PER_SHOT, rand });

/** Picking wants solid coverage of one object, not dots. */
const shootSolid = (x: number, y: number) =>
  spray({ ...rayFrom(x, y), halfAngleDeg: PICK_SPREAD_DEG });

/** Solo practice always; online only while a round is on and this player has not found it. */
const canShoot = () => mode === "solo" || (mode === "online" && view?.phase === "play" && !foundHere);

function fireAt(x: number, y: number, spreadDeg: number) {
  if (!canShoot()) return;
  if (!startedAt) startedAt = performance.now();
  const t0 = performance.now();
  const dots = shootDots(x, y, spreadDeg);
  const ms = performance.now() - t0;
  field.paint(dots);
  setShots(shots + 1);
  totalShots++;
  if (shots === NUDGE_AFTER && !picking) nudge(true);
  say(`${dots.length} dots (${ms.toFixed(1)} ms). ${((field.painted / field.count) * 100).toFixed(1)}% of the room lit.`);
  puff(x, y, "paint");
  sfx.shot();
}

/** What did the player point at? The object with the most hits in the cone. */
function pickAt(x: number, y: number): SpyObject | null {
  const votes = new Map<number, number>();
  for (const i of shootSolid(x, y)) {
    const id = room.itemOf[i]!;
    if (id >= 0) votes.set(id, (votes.get(id) ?? 0) + 1);
  }
  let best = -1, bestVotes = 0;
  for (const [id, n] of votes) if (n > bestVotes) { best = id; bestVotes = n; }
  return best >= 0 ? room.objects[best]! : null;
}

function tryPick(x: number, y: number) {
  if (!target || !canShoot()) return;
  nudge(false);
  const picked = pickAt(x, y);
  // The world judges the pick and keeps the time; this page only shows it as it happens.
  if (picked) session?.send({ t: "pick", id: picked.id, shots });
  puff(x, y, picked && picked.id === target.id ? "hit" : "miss");
  if (!picked) { say("Nothing there. Paint around to see what's nearby."); return; }
  if (picked.id !== target.id) {
    wrong++;
    setShots(shots + WRONG_PICK_COST);
    totalShots += WRONG_PICK_COST;
    setScore();
    stamp("decoy", "Decoy", `That's ${article(picked.name)} ${picked.name}`);
    say(`That's ${article(picked.name)} ${picked.name}, not ${article(target.name)} ${target.name}. Wrong picks cost ${session ? `${MATCH.wrongMs / 1000} seconds` : `${WRONG_PICK_COST} shots`}.`);
    return;
  }
  found.add(target.id);
  roundMs = startedAt ? performance.now() - startedAt : 0;
  totalMs += roundMs;
  if (!best || shots < best.shots || (shots === best.shots && roundMs < best.ms)) best = { shots, ms: roundMs, name: target.name };
  setScore();
  field.paintObject(target.first, target.count);
  field.focus(target.id);
  flyTo(target);
  closeBrief();
  stamp("found", "Intel recovered", `${rank(shots)} · ${shots} shot${shots === 1 ? "" : "s"}${session ? "" : ` · ${secs(roundMs)}`}`);
  setText("prompt", `Found it in the ${target.name}`);
  if (session) {
    foundHere = true;
    say(`${shots} shot${shots === 1 ? "" : "s"}. Waiting for the others…`);
  } else {
    say(`${shots} shot${shots === 1 ? "" : "s"} in ${secs(roundMs)}. Press Space or "Next mission" for another.`);
    $("next").hidden = false;
  }
  target = null;
}

function advance() {
  $("next").hidden = true;
  flyTo(null);
  nextTarget();
}

// ---------- online ----------

function goSolo() {
  $("menu").hidden = true;
  mode = "solo";
  nextTarget();
}

function toMenu(message = "") {
  session?.close();
  session = null; view = null; mode = "menu"; layoutApplied = 0;
  document.body.classList.remove("online");
  for (const id of ["lobby", "racers", "count", "leave"]) $(id).hidden = true;
  field.reset(); field.focus(-1); flyTo(null);
  closeBrief(); clearStamp();
  setText("prompt", "Super Spy Splat Shot"); say(""); setText("timer", "0.0s"); setShots(0);
  setText("menu-msg", message);
  $("menu").hidden = false;
}

/** Quick play asks the matchmaker for the room filling up now; any other code is that room. */
async function goOnline(room: string, name: string) {
  let code = room;
  if (room === "QUICK") {
    setText("menu-msg", "Finding a race…");
    const m = await getJson(`/api/match?${new URLSearchParams(whoQuery(tabPlayerId()))}`, MatchReply).catch(() => null);
    if (!m) return toMenu("Quick play needs the online version. Make a room instead.");
    code = m.room;
  }
  $("menu").hidden = true;
  mode = "online";
  document.body.classList.add("online");
  setText("prompt", `Joining ${code}…`);
  session = joinRoom(code, name, {
    view: onView,
    status: (s) => { if (s.state === "closed") toMenu(s.error ?? ""); },
  });
  try { history.replaceState(null, "", `#room=${code}`); } catch { /* not worth failing for */ }
}

/** Put this round's layout of the room on screen: the same one, from the same seed, for everyone. */
function ensureLayout(v: View) {
  if (!v.layout || layoutApplied === v.layout) return;
  layoutApplied = v.layout;
  const r = rng(v.layout);
  shuffleRoom(r);
  field.reset(); field.focus(-1);
}

function enterPhase(v: View) {
  $("next").hidden = true;
  if (v.phase === "countdown") {
    ensureLayout(v);
    foundHere = false; target = null; flyTo(null);
    setShots(0); startedAt = 0; setText("timer", "0.0s");
    closeBrief(); clearStamp();
    setText("prompt", `Mission ${v.round + 1} of ${v.rounds}: stand by`);
    say(touchy() ? "Same room for everyone, in the dark. Scan to light it, then Pick and tap what you spy." : "Same room for everyone, in the dark. Scan to light it, then Shift-click (or Pick) what you spy.");
  } else if (v.phase === "play") {
    ensureLayout(v);
    target = foundHere ? null : room.objects[v.target] ?? null;
    const t = room.objects[v.target];
    if (t) {
      setText("prompt", `Target: the ${t.name}`);
      // The same seed in every page, so every agent reads the same dossier.
      if (!foundHere) brief(v.layout * 31 + v.round, v.round + 1, t.name);
    }
    say(touchy() ? "First to spy it scores most. Scan to light it, then Pick and tap it." : "First to spy it scores most. Hold the left button to scan, Shift-click to pick.");
    setPicking(false); nudge(false);
  } else if (v.phase === "results") {
    ensureLayout(v);
    const t = room.objects[v.target];
    if (t && !foundHere) { field.paintObject(t.first, t.count); field.focus(t.id); flyTo(t); closeBrief(); setText("prompt", `The intel was in the ${t.name}`); }
    target = null;
  } else {
    // lobby or final: the dark room, nothing asked
    foundHere = false; target = null; flyTo(null);
    if (v.phase === "lobby") { field.reset(); field.focus(-1); }
    closeBrief(); if (v.phase === "lobby") clearStamp();
    setText("prompt", v.phase === "lobby" ? "Waiting in the safehouse" : "Debrief");
    say("");
  }
}

function onView(v: View) {
  const prev = view;
  view = v;
  if (!prev || prev.phase !== v.phase || prev.round !== v.round) enterPhase(v);
  racers(v);
  panel.show(v, session!.room, {
    start: () => session?.send({ t: "start" }),
    lobby: () => session?.send({ t: "lobby" }),
    leave: () => toMenu(),
  });
  $("leave").hidden = false;
  const me = v.players.find((p) => p.id === v.you);
  setText("score", me ? `${me.total} points · ${v.players.length} in room ${session!.room}` : "");
}

/** The countdown number and the round clock, from the world's clock rather than this one's. */
function tickOnline() {
  const v = view;
  if (!session || !v) return;
  const left = v.until - (Date.now() + session.offset);
  const big = $("count");
  big.hidden = v.phase !== "countdown";
  if (v.phase === "countdown") big.textContent = String(Math.max(1, Math.ceil(left / 1000)));
  if (v.phase === "play") setText("timer", secs(Math.max(0, MATCH.roundSecs * 1000 - left)));
}

$("leave").addEventListener("click", () => toMenu());

// ---------- input ----------

/** Scan or pick, shown on the switch, the reticle, the screen edge and the tip line, so it is never in doubt. */
function setPicking(on: boolean) {
  picking = on;
  if (on) { trigger = null; nudge(false); }
  document.body.classList.toggle("picking", on);
  $("mode-scan").setAttribute("aria-pressed", String(!on));
  $("mode-pick").setAttribute("aria-pressed", String(on));
  showTip();
}

const touchy = () => pointerKind === "touch";
/** One line over the switch that says what a press does right now, in this device's words. */
function showTip() {
  const text = picking
    ? (touchy() ? "Tap the thing hiding the intel" : "Click the thing hiding the intel")
    : (touchy() ? "Drag to look · hold Scan to light the room" : "Hold the left button to light the room");
  setText("mode-tip", text);
}

/** After a few shots with no pick, the Pick half breathes so nobody hunts for how to choose. */
const NUDGE_AFTER = 6;
function nudge(on: boolean) { $("mode-pick").classList.toggle("nudge", on); }

const TAP_PX = 10, TAP_MS = 450;
let press: { id: number; x: number; y: number; at: number } | null = null;
const fingers = new Set<number>();

/** The first press says whether this is a phone or a mouse; the tips follow it. */
function notePointer(e: PointerEvent) {
  const kind = e.pointerType === "touch" ? "touch" : "mouse";
  if (kind !== pointerKind) { pointerKind = kind; showTip(); }
  applySpeed();
}
canvas.addEventListener("pointerdown", notePointer, { capture: true });
canvas.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  if (mode === "menu") return;
  // A finger drags to look; a short tap is the shot (or the pick), decided when it lifts.
  if (e.pointerType === "touch") {
    fingers.add(e.pointerId);
    press = fingers.size === 1 ? { id: e.pointerId, x: e.clientX, y: e.clientY, at: performance.now() } : null;
    return;
  }
  canvas.setPointerCapture(e.pointerId);
  if (picking || e.shiftKey) { tryPick(e.clientX, e.clientY); return; }
  trigger = pull(GUN, e.clientX, e.clientY, performance.now());
  fireAt(e.clientX, e.clientY, GUN.spreadDeg);
});
canvas.addEventListener("pointermove", (e) => {
  if (trigger && e.pointerType !== "touch") { trigger.x = e.clientX; trigger.y = e.clientY; }
  if (press?.id === e.pointerId && Math.hypot(e.clientX - press.x, e.clientY - press.y) > TAP_PX) press = null;
});
canvas.addEventListener("pointerup", (e) => {
  fingers.delete(e.pointerId);
  if (e.pointerType !== "touch" || press?.id !== e.pointerId) return;
  const tap = performance.now() - press.at < TAP_MS;
  press = null;
  if (!tap || mode === "menu") return;
  if (picking) tryPick(e.clientX, e.clientY);
  else fireAt(e.clientX, e.clientY, GUN.spreadDeg);
});
for (const ev of ["pointercancel", "pointerleave"]) canvas.addEventListener(ev, (e) => { fingers.delete((e as PointerEvent).pointerId); press = null; });
for (const ev of ["pointerup", "pointercancel", "pointerleave"]) canvas.addEventListener(ev, (e) => { if ((e as PointerEvent).pointerType !== "touch") trigger = null; });
canvas.addEventListener("contextmenu", (e) => e.preventDefault());
addEventListener("keydown", (e: KeyboardEvent) => {
  if (e.key === "Shift" && !e.repeat) setPicking(true);
  if (e.code === "Space" && !$("next").hidden && !session) { e.preventDefault(); advance(); }
});
addEventListener("keyup", (e: KeyboardEvent) => { if (e.key === "Shift") setPicking(false); });

// The Scan half: a click goes back to scanning; holding it on a phone fires at the reticle until let go.
const scanBtn = $("mode-scan");
const centre = () => ({ x: innerWidth / 2, y: innerHeight / 2 });
scanBtn.addEventListener("pointerdown", (e) => {
  notePointer(e);
  setPicking(false);
  if (e.pointerType !== "touch" || mode === "menu") return;
  e.preventDefault();
  try { scanBtn.setPointerCapture(e.pointerId); } catch { /* the pointer already let go */ }
  const c = centre();
  trigger = pull(GUN, c.x, c.y, performance.now());
  fireAt(c.x, c.y, GUN.spreadDeg);
  scanBtn.classList.add("firing");
});
for (const ev of ["pointerup", "pointercancel", "lostpointercapture"]) scanBtn.addEventListener(ev, () => { if (scanBtn.classList.contains("firing")) { trigger = null; scanBtn.classList.remove("firing"); } });
scanBtn.addEventListener("contextmenu", (e) => e.preventDefault());
$("mode-pick").addEventListener("pointerdown", notePointer);
$("mode-pick").addEventListener("click", () => setPicking(!picking));
for (const [id, Icon] of [["scan", ScanLine], ["pick", Hand]] as const) document.querySelector(`[data-icon="${id}"]`)!.append(createElement(Icon));
showTip();

$("next").addEventListener("click", advance);

// Sound on or off, remembered; the low-res picture is the chunky look of a 90s console.
const soundBtn = $("sound");
const showSound = () => { soundBtn.replaceChildren(createElement(isMuted() ? VolumeX : Volume2, { width: 18, height: 18 })); soundBtn.setAttribute("aria-pressed", String(!isMuted())); };
soundBtn.addEventListener("click", () => { setMuted(!isMuted()); showSound(); });
showSound();
const retroBtn = $("retro");
retroBtn.append(createElement(Tv, { width: 18, height: 18 }));
function setRetro(on: boolean) {
  retroBtn.setAttribute("aria-pressed", String(on));
  document.body.classList.toggle("retro", on);
  renderer.setPixelRatio(on ? Math.min(sharp, 0.4) : sharp);
  resize();
  try { localStorage.setItem("splat-spray.retro", on ? "1" : "0"); } catch { /* private window */ }
}
retroBtn.addEventListener("click", () => setRetro(retroBtn.getAttribute("aria-pressed") !== "true"));
$("reveal").addEventListener("click", () => { field.revealAll(); field.focus(-1); });
$("reset").addEventListener("click", () => {
  found.clear();
  wrong = 0;
  totalShots = 0;
  totalMs = 0;
  best = null;
  setScore();
  advance();
});
$<HTMLInputElement>("rate").addEventListener("input", (e) => { GUN.ratePerSecond = Number((e.target as HTMLInputElement).value); });

function puff(x: number, y: number, kind: "paint" | "hit" | "miss") {
  const el = document.createElement("div");
  el.className = `puff ${kind}`;
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  document.body.appendChild(el);
  el.addEventListener("animationend", () => el.remove());
}

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener("resize", resize);
resize();
try { if (localStorage.getItem("splat-spray.retro") === "1") setRetro(true); } catch { /* private window */ }

// ---------- boot ----------

say("Building the room…");
const room: SpyScene = buildRoom({ density: DENSITY });
const opacities = new Float32Array(room.count).fill(0.95);
const radii = new Float32Array(room.count);
for (let i = 0; i < room.count; i++) radii[i] = 2 * room.sizes[i]!;

const field = new RevealField(room.count, room.itemOf);
const mesh = new SplatMesh({
  maxSplats: room.count,
  constructSplats: (splats) => fillPackedSplats(room, splats as any),
  lod: false,
  // Spark's per-frame hook, just before splats regenerate: age the paint.
  onFrame: ({ mesh }) => {
    field.tick();
    if (field.animating()) mesh.updateVersion();
  },
});
await mesh.initialized;
mesh.worldModifier = field.modifier;
mesh.updateGenerator();
scene.add(mesh);
camera.position.copy(HOME.eye);
controls.target.copy(HOME.target);
controls.update();
setShots(0);
setScore();
setText("prompt", "Super Spy Splat Shot");
say("");
const savedName = (() => { try { return localStorage.getItem("splat-spray.name") ?? ""; } catch { return ""; } })();
// Back from eqosys the code is traded first, so the menu opens already knowing who is playing.
reportButton();
void finishSignIn().then((back) => {
  menu({ join: (r, name) => { try { localStorage.setItem("splat-spray.name", name); } catch { /* private window */ } goOnline(r, name); }, solo: goSolo }, savedName);
  if (back?.error) setText("menu-msg", back.error);
});

renderer.setAnimationLoop(() => {
  if (trigger) {
    const t = performance.now();
    for (let i = due(GUN, trigger, t); i > 0; i--) fireAt(trigger.x, trigger.y, spreadOf(GUN, trigger, t));
  }
  stepFlight();
  tickTimer();
  tickOnline();
  controls.update();
  renderer.render(scene, camera);
});

Object.assign(globalThis, {
  __spy: {
    fireAt, tryPick, pickAt, advance, shuffleRoom, GUN, room, field, camera,
    get shots() { return shots; },
    get totalShots() { return totalShots; },
    /** where an object sits on screen, for tests and for aiming help */
    screenOf(o: SpyObject) {
      const p = o.center.clone().project(camera);
      return { x: ((p.x + 1) / 2) * innerWidth, y: ((1 - p.y) / 2) * innerHeight, visible: p.z < 1 };
    },
    get target() { return target; },
    get found() { return [...found]; },
  },
});

/** The cog next to the tools: look speeds, invert and the key list, saved for next time. Opening it lets go of the trigger. */
mountControls({
  key: "splat-spray.controls", parent: $("tools"),
  skin: "house",
  keys: [["Left button (hold)", "Scan and fire"], ["Right-drag / one finger", "Look around"], ["Arrow keys", "Look around"], ["Wheel", "Zoom"], ["Shift (hold) or Pick", "Pick mode: click what you spy"], ["Tap / hold Scan", "Scan on a phone"], ["Pick, then tap", "Pick on a phone"], ["Space", "Next mission"]],
  onChange: (s) => { ctl = s; applySpeed(); },
  onToggle: (open) => { if (open) trigger = null; },
});
