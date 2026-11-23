// Qollab Studio's gear room (/studio.html): you stand in it in first person, the same controls as Load In (mouse or
// right stick to look, WASD or left stick to walk). Click a box to pick it up and click again to set it down; click
// a jack to pull a cable out of it, walk the cable to another jack and click there; look at a knob and drag. The
// room's patch is the sesh's Studio (../studio.ts): through a door from a sesh (?room=) it is the one the World keeps,
// shared with everyone in it; on its own it is kept in this browser. What you hear is the walk back
// from the cab (room.ts `listen`): that amp and its pedal run their circuits in Q Amp's audio thread, and nothing
// else does. That sound comes up through FM DAW's desk (../mixer.ts): Tab opens it, a strip for you and one for each
// aux return (Space, or the gear cabled between the desk's aux-send and aux-return jacks). In a sesh it is the sesh's
// desk: a strip per track and per player the live line plays sound for, and every move an edit the sesh keeps
// (`deskOps`). In a sesh you also see who else is in the room: each page says where its body is on the live line,
// and a box or a cable end in someone's hand is drawn at their body. A board dropped here goes to the sesh too, so
// it is the same pedal for everyone. Right of the rack stands the sound wall (../wall/, WALL.md): its modules in the
// case run on an audio thread of their own (wall-worklet.ts), heard from its Q Out; N brings another module.
// `window.qstudio` is the harness (scripts/probe.ts HANDLES).
import "@fontsource/barlow-condensed/600.css";
import "@fontsource/ibm-plex-sans/400.css";
import "./studio.css";
import * as THREE from "three";
import { DEFAULTS, loadPad, mountControls, type Settings } from "@rustybuns/game-controls";
import { clamp, lerp } from "@rustybuns/util";
import { defaultAvatar } from "@rustybuns/util/avatar";
import workletUrl from "../amp/worklet.ts?worker&url";
import deskWorkletUrl from "./desk-worklet.ts?worker&url";
import type { ToDesk } from "./desk-worklet.ts";
import { WallLine, moduleButtons } from "./wall-page.ts";
import { PANELS, type Panel } from "../../circuits/wall-panels.ts";
import { Desk, deskFor, deskOps, deskPlays, playerId, seshDesk, seshShape, shapeAt, shapeName, shapeOps, withChannel, withReturn, withSend, withShape, type Player, type ShapeAt, type Source } from "../mixer.ts";
import { closeShape, openShape, refreshShape } from "../ui/shape-overlay.tsx";
import { apply, decodeServer, type Live, type Project } from "../project.ts";
import { connect, roomName, type Net } from "../ui/net.ts";
import { localMe, myKey, savedLook } from "../ui/me.ts";
import { Band } from "../studio/band.ts";
import { figure, type Figure } from "../studio/figure.ts";
import { BODY_HZ } from "../studio/jam.ts";
import { FarSound } from "../studio/plugin-line.ts";
import { QWERTY, startMidi } from "../ui/input.ts";
import { drawDesk } from "./desk.ts";
import type { AmpSettings, FromAmp } from "../amp/messages.ts";
import { AmpThreads } from "../amp/threads.ts";
import { DEFAULT_ROOM, PEDALS, type PedalDef } from "../circuit/amps.ts";
import { BuildSheet, savedDrive, savedSwaps } from "../kit/sheet.ts";
import { riff } from "../circuit/riff.ts";
import { bench, type Bench, type BenchPedal } from "../circuit/bench.ts";
import { applyStudio, patchOps, sanitizePatch, type Board, type Patch, type StudioServer } from "../studio.ts";
import { check, obj, raw, rec, str, type Of } from "@rustybuns/util/guard";
import { type Aim, type Answer, EYE, bringModule, benchGear, boardFor, boardIn, bodyOf, furnish, benchIn, hear, left, type Heard, type Room, aimed, drop, gearOf, hand, heldId, hint, knobValue, lead, listen, lookAt, moduleAt, newRoom, pedalAt, pickUp, plug, putDown, setKnob, snapshot, startPatch, step, turnHeld, unplug, use, walkTo } from "./room.ts";
import { GearScene } from "./gear-scene.ts";
import { lounge } from "./lounge.ts";
import { loadQuality } from "../studio/look.ts";

const KEY = "q-studio", CONTROLS = "q-studio.controls", DESK = "q-studio.desk";
const $ = (id: string) => { const el = document.getElementById(id); if (!el) throw new Error(`#${id} missing`); return el; };

// Bench pedals: each board read here is kept by its gear id, so a saved patch that names one finds it again.
// Q Amp's bench (its own localStorage key) comes along too, and stands on the floor the first time.
const BENCHES = "q-studio.benches", AMP_BENCH = "q-amp-bench";
const Kept = obj({ name: str(80), board: raw });
const keptBenches = (): Record<string, Of<typeof Kept>> => {
  try { return check(rec(Kept, 32), JSON.parse(localStorage.getItem(BENCHES) ?? "{}")) ?? {}; } catch { return {}; }
};
/** Each board read here, as the sesh carries it to the others (room.ts `boardFor`), by gear id; one too long to carry isn't here. */
const myBoards = new Map<string, Board>();
function mine(pedal: BenchPedal, json: unknown, name: string) { const b = boardFor(pedal, json, name); if (b) myBoards.set(b.gear, b); }
function readBench(json: unknown, name: string): Bench {
  const b = bench(json, { name });
  if (b.ok) {
    mine(b.pedal, json, name);
    const id = benchGear(b.pedal).id;
    try { localStorage.setItem(BENCHES, JSON.stringify({ ...keptBenches(), [id]: { name: name.slice(0, 80), board: json } })); } catch { /* not kept, fine */ }
  }
  return b;
}
for (const k of Object.values(keptBenches())) { const b = bench(k.board, { name: k.name }); if (b.ok) mine(b.pedal, k.board, k.name); }
/** Q Amp's bench pedal when it plays and this room hasn't had it before (binned once, it stays binned). */
function newAmpBench(): BenchPedal | null {
  try {
    const k = check(Kept, JSON.parse(localStorage.getItem(AMP_BENCH) ?? "null"));
    const b = k ? bench(k.board, { name: k.name }) : null;
    if (!k || !b?.ok || benchGear(b.pedal).id in keptBenches()) return null;
    readBench(k.board, k.name);
    return b.pedal;
  } catch { return null; }
}

function loadPatch() {
  try {
    const raw = localStorage.getItem(KEY);
    const p = raw ? sanitizePatch(JSON.parse(raw)) : null;
    if (p?.placed.length) return furnish(p);
  } catch { /* private window or bad JSON: the room as it starts */ }
  return startPatch();
}
let room: Room = newRoom(loadPatch());
{ const p = newAmpBench(); if (p) benchIn(room, p, { x: 0.6, z: 1.0 }); }
let savedPatch: Patch | null = null;
const save = () => {
  // the sesh's room is the World's to keep; this browser's own room stays as it was left
  if (sesh || room.studio.patch === savedPatch) return;
  savedPatch = room.studio.patch;
  try { localStorage.setItem(KEY, JSON.stringify(savedPatch)); } catch { /* not kept, fine */ }
};

// The desk: a channel for you (the guitar, through whatever the room plays) and the aux returns, kept in this browser.
const SOURCES: Source[] = [{ id: "you", name: "You: guitar", source: "player" }];
const keptDesk = () => { try { return check(Desk, JSON.parse(localStorage.getItem(DESK) ?? "null")); } catch { return null; } };
let ownDesk = deskFor(SOURCES, keptDesk());
let deskKey = "";
let drawn = "";

// ---- the sesh (a door from the jam room or the desk carries ?room=): its gear room and its desk are this room's ----
const sesh = roomName();
let net: Net | null = null;
/** The sesh's groove, once it came, and who you are in it (your person id, src/chat.ts). */
let project: Project | null = null;
let me: string | null = null;
let seeded = false;
let asked = false;
/** Which person each number on the live line is (the World's grants), and whose sound the live line plays (their guitar, mic or plugin track). */
let peerIds: Record<string, string> = {};
const band = new Band(() => ({ bpm: project?.bpm ?? 120, loopBeats: 16 }), () => performance.timeOrigin + performance.now());
const far = new FarSound(band, () => {});
const myName = localMe().name || "Someone", myLook = savedLook(myName);
/** In a sesh the desk is the sesh's: its tracks, your own channel (the guitar), a channel per player the live line plays sound for (as FM DAW's Mixer tab shows them), and its returns. */
function inSesh(): { project: Project; who: Player; players: Player[] } | null {
  if (!project || !me) return null;
  const who = { who: me, name: "You: guitar" };
  const others = far.players().flatMap((peer): Player[] => { const id = peerIds[peer]; return id && id !== me ? [{ who: id, name: room.looks.get(peer)?.name || "Player" }] : []; });
  return { project, who, players: [who, ...new Map(others.map((o) => [o.who, o])).values()] };
}
const shownDesk = (): Desk => { const s = inSesh(); return s ? seshDesk(s.project, s.players) : ownDesk; };
/** What this room's own audio thread plays of it: your channel (every solo worked out) and the returns. */
function playedDesk(): { desk: Desk; channel: string } {
  const s = inSesh();
  if (!s) return { desk: ownDesk, channel: "you" };
  // only your own channel has sound here (the others' strips are for mixing them); a solo on any strip still counts
  const channel = playerId(s.who.who);
  return { desk: { channels: deskPlays(s.project, s.players).players.filter((c) => c.id === channel), returns: seshDesk(s.project).returns }, channel };
}
function setDesk(d: Desk) {
  const s = inSesh();
  drawn = "";
  if (s) { for (const edit of deskOps(s.project, d)) { project = apply(project ?? s.project, edit); net?.send(edit); } return; }
  ownDesk = d;
  try { localStorage.setItem(DESK, JSON.stringify(d)); } catch { /* not kept, fine */ }
}
/** The World's gear room: all of it (on joining, or after it said no to a step), or one step someone else took. */
function onStudio(m: StudioServer) {
  // someone's bench pedal: read here, so its box is that pedal on this page too
  if (m.t === "studio-board") { boardIn(m.board); return; }
  if (m.t === "studio-op") { if (m.from !== room.me) room.studio = applyStudio(room.studio, m.from, m.op); return; }
  if (m.you) room.me = m.you;
  if (m.studio.patch.placed.length) { room.studio = m.studio; seeded = true; return; }
  // an empty one: this room as it stands goes in, once (a guest who may not play keeps their own room to themselves)
  if (seeded) return;
  seeded = true;
  room.studio = { patch: room.studio.patch, held: {} };
  for (const gear of new Set(room.studio.patch.placed.map((p) => p.gear))) shareBoard(gear);
  for (const step of patchOps(room.studio.patch)) net?.studio(step);
}
/** A bench pedal's board to the sesh, before the step that brings its box in. False: it is too long to carry, so only this page plays it. */
function shareBoard(gear: string): boolean {
  const b = myBoards.get(gear);
  if (b) net?.board(b);
  return !!b;
}
/** Someone's live event: their body and look, and whether the live line plays sound for them. */
function onLive(from: number, e: Live) {
  hear(room, from, e);
  // who has a guitar, a mic or a plugin track on the live line: each gets a strip on the desk
  if (e.t === "guitar" || e.t === "plugin") far.heard(from, e);
}
/** Where you are and how you look, to everyone else in the sesh (again when someone comes in). */
function wear() {
  sentBody = JSON.stringify(bodyOf(room));
  net?.live(bodyOf(room));
  net?.live({ t: "wear", avatar: myLook, name: myName });
}
let sentAt = 0, sentBody = "", peersIn = 0;
/** Your body on the live line as you move, BODY_HZ times a second at most. */
function sayBody(now: number) {
  if (!net || now - sentAt < 1000 / BODY_HZ) return;
  const b = bodyOf(room), key = JSON.stringify(b);
  if (key === sentBody) return;
  sentAt = now; sentBody = key;
  net.live(b);
}
if (sesh) {
  room.sent = (step) => net?.studio(step);
  net = connect({
    onSnapshot(p) { project = p; drawn = ""; },
    onOp(edit) { project = edit.t === "replace" ? edit.project : project && apply(project, edit); drawn = ""; },
    onStudio,
    onChat(m) { if (m.t === "chat") { me = m.you; drawn = ""; } },
    // in (again): ask the World for its gear room, which it sends unasked only once someone has used it
    onStatus(s) {
      if (s.state !== "online") asked = false; else if (!asked) { asked = true; net?.studio({ t: "drop" }); }
      if (s.state === "online" && s.peers > peersIn) wear();
      peersIn = s.state === "online" ? s.peers : 0;
    },
    onGrants(m) { peerIds = m.peers; },
    onLive,
    onGone(from) { left(room, from); far.gone(from); },
    onTakeBytes() {},
    hello: () => ({ key: myKey(), name: myName }),
  });
}

let phase: "menu" | "play" | "desk" | "sheet" | "modules" = "menu";
let ctl: Settings = DEFAULTS;
let flash = { text: "", until: 0 };
let dragging: { id: string; knob: string } | null = null;
const keys = new Set<string>();
const pad = loadPad(CONTROLS, [
  { id: "grab", label: "Pick up / put down / plug in", button: 0 },
  { id: "drop", label: "Let go of a cable", button: 1 },
  { id: "turnLeft", label: "Turn it left", button: 4 },
  { id: "turnRight", label: "Turn it right", button: 5 },
  { id: "sheet", label: "A pedal's build sheet", button: 3 },
]);

// ---- the scene ----
const canvas = $("stage");
if (!(canvas instanceof HTMLCanvasElement)) throw new Error("#stage is not a canvas");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, 1, 0.03, 40);
camera.rotation.order = "YXZ";
// the warehouse lounge round the gear corner (lounge.ts): its shell, light, racking and the Poly Haven furniture
const bay = lounge(renderer, scene, loadQuality());
// the rack, the pedal wall and the gear on them, in this room's own frame (the gear wall in a studio draws the same)
const gear = new GearScene();
scene.add(gear.group);

// The others in the sesh's gear room: an eqosys figure each, gliding to where its last body said.
const people = new Map<number, { fig: Figure; key: string; x: number; z: number; yaw: number; speed: number }>();
function syncPeople(dt: number, t: number) {
  for (const [peer, p] of people) if (!room.bodies.has(peer)) { scene.remove(p.fig.group); p.fig.dispose(); people.delete(peer); }
  for (const [peer, b] of room.bodies) {
    const l = room.looks.get(peer), name = l?.name ?? "", avatar = l?.avatar ?? defaultAvatar(name), key = JSON.stringify([avatar, name]);
    let p = people.get(peer);
    if (p && p.key !== key) { scene.remove(p.fig.group); p.fig.dispose(); p = undefined; }
    if (!p) { p = { fig: figure(avatar, name), key, x: b.x, z: b.z, yaw: b.yaw, speed: 0 }; scene.add(p.fig.group); people.set(peer, p); }
    const k = 1 - Math.exp(-dt * 12), nx = lerp(p.x, b.x, k), nz = lerp(p.z, b.z, k);
    p.speed = lerp(p.speed, dt > 0 ? Math.hypot(nx - p.x, nz - p.z) / dt : 0, 0.3);
    p.x = nx; p.z = nz;
    p.yaw += Math.atan2(Math.sin(b.yaw - p.yaw), Math.cos(b.yaw - p.yaw)) * k;
    p.fig.group.position.set(p.x, 0, p.z);
    p.fig.group.rotation.y = p.yaw;
    p.fig.pose({ speed: p.speed, seated: false, play: null, note: false, t: t / 1000 });
  }
}

// ---- sound: Q Amp's audio thread, fed only when the chain is whole ----
let ctx: AudioContext | null = null;
let node: AudioWorkletNode | null = null;
/** The rig on the audio thread, split onto workers when a big board puts it over budget (src/amp/threads.ts). */
let threads: AmpThreads | null = null;
let deskNode: AudioWorkletNode | null = null;
let riffNode: AudioBufferSourceNode | null = null;
let panner: PannerNode | null = null;
let meter: FromAmp = { t: "meter", levels: [], out: 0, load: 0, misses: 0 };
let heardKey = "";
let speakersUp = false;
/** The sound wall's audio thread, heard from its Q Out. */
let wallLine: WallLine | null = null;
/** Z: the letter keys play Q Keys (as FM DAW's keyboard does), and you stand still, until Z again. */
let playingKeys = false;
const KEYS_C = 48;

async function speakers(up: boolean) {
  speakersUp = up;
  $("speakers").textContent = up ? "Speakers up. M brings them down." : "Speakers are down. Click, or press M, to bring them up.";
  if (!up) { await ctx?.suspend(); return; }
  if (!ctx) {
    ctx = new AudioContext({ latencyHint: "interactive" });
    await ctx.audioWorklet.addModule(workletUrl);
    await ctx.audioWorklet.addModule(deskWorkletUrl);
    wallLine = await WallLine.start(ctx, ctx.destination);
    // A MIDI keyboard plays Q Keys too, whenever the speakers are up.
    void startMidi({
      on: (n, v) => wallLine?.note(n, v),
      off: (n) => wallLine?.note(n, 0),
      panic: () => { for (let n = 0; n < 128; n++) wallLine?.note(n, 0); },
      bend: () => {}, cc: () => {}, devices: () => {},
    });
    deskNode = new AudioWorkletNode(ctx, "q-desk", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 1, channelCountMode: "explicit" });
    node = new AudioWorkletNode(ctx, "q-amp", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 1, channelCountMode: "explicit" });
    threads = new AmpThreads(node, ctx.sampleRate, () => new Worker(new URL("../amp/part-worker.ts", import.meta.url), { type: "module" }), (m) => { meter = m; });
    panner = new PannerNode(ctx, { panningModel: "HRTF", distanceModel: "inverse", refDistance: 1, rolloffFactor: 0.8 });
    node.connect(deskNode).connect(panner).connect(new GainNode(ctx, { gain: 0.5 })).connect(ctx.destination);
    const data = riff(ctx.sampleRate), buf = ctx.createBuffer(1, data.length, ctx.sampleRate);
    buf.copyToChannel(data, 0);
    riffNode = new AudioBufferSourceNode(ctx, { buffer: buf, loop: true });
    riffNode.start();
    heardKey = ""; deskKey = "";
  }
  await ctx.resume();
}

/** N: the modules there are, each a button that brings one to your hands. */
function openModules(open: boolean) {
  if (!open) { play(); return; }
  phase = "modules"; menu(); document.exitPointerLock?.();
  moduleButtons($("modules-list"), (kind) => { play(); say(bringModule(room, kind)); });
}

/** The desk's audio thread gets the desk and what each aux has cabled in, when either changes. */
function deskSound(h: Heard) {
  const played = playedDesk();
  const cabled = Array.from({ length: played.desk.returns.length }, (_, i) => h.returns.find((r) => r.aux === i + 1)?.settings ?? null);
  const m: ToDesk = { t: "desk", ...played, cabled };
  const key = JSON.stringify(m);
  if (!deskNode || key === deskKey) return;
  deskKey = key;
  deskNode.port.postMessage(m);
}

/** The desk view, drawn again when the desk or what is cabled into its returns changes. */
function deskView(h: Heard) {
  $("desk").hidden = phase !== "desk";
  if (phase !== "desk") { closeShape(); return; }
  const desk = shownDesk();
  const cabled = desk.returns.map((r) => { const x = h.returns.find((y) => y.aux === r.aux); return x?.whole ? x.chain.slice(1, -1).map(nameOfId).join(" > ") : x?.problems[0] ?? ""; });
  const key = JSON.stringify([desk, cabled, inSesh()?.project.eq]);
  if (key === drawn) return;
  drawn = key;
  const s = inSesh();
  drawDesk($("desk-strips"), desk, cabled, setDesk, { spaceMute: !s, shape: openDeskShape, ...(s ? { master: s.project.eq } : {}) });
  refreshShape();
}
/** A strip's full Shape editor, over the desk: in a sesh its moves are the sesh's ops (the master's too), else this browser's desk. */
function openDeskShape(at: ShapeAt) {
  openShape({
    title: shapeName(shownDesk(), at),
    sampleRate: ctx?.sampleRate ?? 48000,
    doc: () => { const s = inSesh(); return s ? seshShape(s.project, s.players, at) : shapeAt(ownDesk, at); },
    onChange: (eq) => {
      const s = inSesh();
      if (!s) { setDesk(withShape(ownDesk, at, eq)); return; }
      drawn = "";
      for (const edit of shapeOps(s.project, s.players, at, eq)) { project = apply(project ?? s.project, edit); net?.send(edit); }
    },
  });
}
const nameOfId = (id: string) => { const p = room.studio.patch.placed.find((x) => x.id === id); return (p && gearOf(p)?.name) ?? id; };
function openDesk(open: boolean) {
  if (open) { phase = "desk"; menu(); document.exitPointerLock?.(); } else play();
}

/** The worklet runs the rig only for a whole chain; otherwise the riff is unplugged and it passes silence through. */
function sound(h: Heard) {
  const key = JSON.stringify(h.settings);
  if (!node || !riffNode || key === heardKey) return;
  heardKey = key;
  try { riffNode.disconnect(); } catch { /* wasn't connected */ }
  if (h.settings) riffNode.connect(node);
  const s: AmpSettings = h.settings ?? { amp: "lead", pedal: null, drive: 0, swaps: {}, knobs: { gain: 0, bass: 5, mid: 5, treble: 5, master: 0, noise: 0, rate: 5, depth: 0 }, mic: DEFAULT_ROOM.mic, bypass: true, oversample: 2 };
  threads?.send(s);
}

// ---- input ----
const locked = () => document.pointerLockElement === canvas;
const lock = () => void Promise.resolve(canvas.requestPointerLock?.()).catch(() => {});
const say = (a: Answer) => { if (!a.ok) flash = { text: a.why, until: performance.now() + 1800 }; return a; };
canvas.addEventListener("mousedown", (e) => {
  if (phase !== "play") return;
  if (!locked()) return lock();
  if (e.button === 2) return void say(drop(room));
  const a = aimed(room);
  if (a?.t === "knob" && !hand(room)) dragging = { id: a.id, knob: a.knob };
  else say(use(room, a));
});
canvas.addEventListener("contextmenu", (e) => e.preventDefault());
addEventListener("mouseup", () => { dragging = null; });
document.addEventListener("mousemove", (e) => {
  if (!locked()) return;
  if (dragging) {
    const p = room.studio.patch.placed.find((x) => x.id === dragging?.id), k = p && gearOf(p)?.knobs.find((x) => x.name === dragging?.knob);
    if (p && k) setKnob(room, p.id, k.name, knobValue(room.studio.patch, p.id, k) - e.movementY * 0.004);
    return;
  }
  const s = 0.0022;
  room.you.yaw -= e.movementX * s * ctl.lookX;
  room.you.pitch = clamp(room.you.pitch - e.movementY * s * ctl.lookY * (ctl.invertY ? -1 : 1), -1.35, 1.25);
});
/** A key of the room's keyboard down or up on Q Keys. */
function keyNote(code: string, down: boolean): boolean {
  const semi = QWERTY[code];
  if (!playingKeys || semi === undefined) return false;
  wallLine?.note(KEYS_C + semi, down ? 0.8 : 0);
  return true;
}
document.addEventListener("keydown", (e) => {
  if (e.code === "KeyZ" && phase === "play" && !e.repeat) {
    if (playingKeys) for (const c of Object.keys(QWERTY)) keyNote(c, false);
    else for (const c of Object.keys(QWERTY)) keys.delete(c); // so you don't walk off on a key held as Z went down
    playingKeys = !playingKeys;
    flash = { text: playingKeys ? "Playing Q Keys: A to ' are the notes from C3. Z to walk again." : "Walking again.", until: performance.now() + 2500 };
    return;
  }
  if (playingKeys && phase === "play" && QWERTY[e.code] !== undefined) { if (!e.repeat) keyNote(e.code, true); return; }
  keys.add(e.code);
  if (e.repeat) return;
  if (e.code === "KeyM") void speakers(!speakersUp);
  if (e.code === "Escape" && phase === "sheet") { sheet.close(); return; }
  if (e.code === "Tab" && phase !== "menu") { e.preventDefault(); openDesk(phase !== "desk"); return; }
  if (e.code === "KeyN" && (phase === "play" || phase === "modules")) { openModules(phase === "play"); return; }
  if (e.code === "Escape" && phase === "modules") { openModules(false); return; }
  if (phase !== "play") return;
  if (e.code === "KeyF") say(use(room));
  if (e.code === "KeyG") say(drop(room));
  if (e.code === "KeyQ") turnHeld(room, -1);
  if (e.code === "KeyE") turnHeld(room, 1);
  if (e.code === "KeyB") openSheetHere();
});
document.addEventListener("keyup", (e) => { keyNote(e.code, false); keys.delete(e.code); });
/** A board's JSON dropped in the room: it stands on the floor in front of you, or the bench says why it won't play. */
function dropBoard(json: unknown, name: string): Answer {
  const b = readBench(json, name);
  if (!b.ok) return say(no(`${name} won't play: ${b.why[0]}`));
  const shared = !sesh || shareBoard(benchGear(b.pedal).id), a = say(benchIn(room, b.pedal));
  return a.ok && !shared ? say(no(`${name} is too big a board for the sesh to carry: only you hear it`)) : a;
}
const no = (why: string): Answer => ({ ok: false, why });
document.addEventListener("dragover", (e) => e.preventDefault());
document.addEventListener("drop", (e) => {
  e.preventDefault();
  const f = e.dataTransfer?.files[0];
  if (!f) return;
  void f.text().then((t) => {
    let json: unknown = null;
    try { json = JSON.parse(t); } catch { /* not JSON: the bench says so */ }
    dropBoard(json, f.name.replace(/(\.circuit)?\.json$/i, ""));
  });
});
addEventListener("blur", () => { keys.clear(); dragging = null; });
document.addEventListener("pointerlockchange", () => { if (!locked() && phase === "play") { phase = "menu"; menu(); } });

function menu() { $("menu").hidden = phase !== "menu"; $("desk").hidden = phase !== "desk"; $("modules").hidden = phase !== "modules"; if (phase !== "sheet") sheet.el.hidden = true; }

// ---- a build sheet (../kit/sheet.ts): B, or the pad's Y, on a pedal on the wall, a module in the case, or either in your hand ----
const sheet = new BuildSheet(() => { if (phase === "sheet") play(); });
$("stage").after(sheet.el);
function openSheet(p: PedalDef) {
  phase = "sheet"; menu(); document.exitPointerLock?.();
  return sheet.open(p, savedSwaps(p.id), savedDrive(p.id));
}
function openModuleSheet(m: Panel) {
  phase = "sheet"; menu(); document.exitPointerLock?.();
  return sheet.openModule(m);
}
function openSheetHere() {
  const p = pedalAt(room), m = p ? null : moduleAt(room);
  if (p) void openSheet(p); else if (m) void openModuleSheet(m); else say(no("Look at a pedal or a sound wall module, or hold one, for its build sheet"));
}
function play() { phase = "play"; menu(); lock(); }

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener("resize", resize);

// ---- every frame ----
let last = performance.now();
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const gp = pad.poll();
  if (phase === "play") {
    const k = 2.4 * dt;
    room.you.pitch = clamp(room.you.pitch - gp.right.y * k * ctl.lookY * (ctl.invertY ? -1 : 1), -1.35, 1.25);
    if (gp.pressed.has("grab")) say(use(room));
    if (gp.pressed.has("drop")) say(drop(room));
    if (gp.pressed.has("turnLeft")) turnHeld(room, -1);
    if (gp.pressed.has("turnRight")) turnHeld(room, 1);
    if (gp.pressed.has("sheet")) openSheetHere();
    const on = (c: string) => (keys.has(c) ? 1 : 0);
    step(room, dt, { forward: on("KeyW") - on("KeyS") || -gp.left.y, right: on("KeyD") - on("KeyA") || gp.left.x, turn: -gp.right.x * k * ctl.lookX });
  }
  save();
  sayBody(now);
  syncPeople(dt, now);
  const a = aimed(room);
  gear.sync(room, a);
  const heard = listen(room.studio.patch);
  sound(heard);
  deskSound(heard);
  deskView(heard);
  wallLine?.set(heard.wall.spec);
  // the sesh's tempo for Q Keys' clock and Q Steps, and the band's beat when its clock is known
  wallLine?.tempo(project?.bpm ?? 120, band.synced ? band.beat() : null);
  glow(heard);
  camera.position.set(room.you.x, EYE, room.you.z);
  camera.rotation.set(room.you.pitch, room.you.yaw, 0);
  if (ctx && panner) {
    const cab = heard.chain.length ? room.studio.patch.placed.find((p) => p.id === heard.chain[heard.chain.length - 1]) : undefined;
    if (cab) { panner.positionX.value = cab.at[0]; panner.positionY.value = cab.at[1] + 0.3; panner.positionZ.value = cab.at[2]; }
    const out = room.studio.patch.placed.find((p) => p.id === heard.wall.spec.modules.find((m) => m.kind === "out")?.id);
    if (out) wallLine?.place(out.at[0], out.at[1] + 0.06, out.at[2]);
    const l = ctx.listener, f = new THREE.Vector3(0, 0, -1).applyEuler(camera.rotation);
    l.positionX.value = room.you.x; l.positionY.value = EYE; l.positionZ.value = room.you.z;
    l.forwardX.value = f.x; l.forwardY.value = f.y; l.forwardZ.value = f.z;
  }
  $("hint").textContent = now < flash.until ? flash.text : hint(room, a);
  $("heard").textContent = (heard.playing ? `Playing: ${heard.chain.map((id) => { const p = room.studio.patch.placed.find((x) => x.id === id); return (p && gearOf(p)?.name) ?? id; }).join(" > ")}${hopText()}${heard.problems.length ? `. ${heard.problems[0]}` : ""}` : `Silent: ${heard.problems[0] ?? ""}`) +
    (heard.wall.playing ? `. Sound wall playing, ${heard.wall.modules.length} modules${heard.wall.problems[0] ? `: ${heard.wall.problems[0]}` : ""}` : "");
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

/** Where a heavy board is cut onto another thread, and the latency the hop adds; nothing on one thread. */
function hopText(): string {
  const t = threads?.state();
  if (!t?.cuts.length) return "";
  return `. Split across ${t.cuts.length + 1} threads before link${t.cuts.length > 1 ? "s" : ""} ${t.cuts.join(" and ")}, +${t.hopMs.toFixed(1)} ms`;
}

/** The running amp's tubes glow with what each stage swings; the cab's cones push with the output. */
function glow(h: Heard) {
  const kindOf = (id: string) => { const p = room.studio.patch.placed.find((x) => x.id === id); return p && gearOf(p)?.kind; };
  // The meter's levels: each pedal on the board first, then the amp's stages.
  const ampId = h.running.find((id) => kindOf(id) === "amp"), offset = h.running.filter((id) => kindOf(id) === "pedal").length;
  const stages = speakersUp ? meter.levels.length - offset - 1 : 0;
  for (const [id, m] of gear.models) {
    m.tubes.forEach((t, i) => {
      const v = clamp(Math.log10(1 + (meter.levels[offset + i] ?? 0)) / 2, 0, 1);
      if (t.material instanceof THREE.MeshStandardMaterial) t.material.emissiveIntensity = id === ampId && i < stages ? 0.3 + v * 2.5 : 0;
    });
    const push = h.chain.includes(id) && speakersUp ? meter.out * 0.02 : 0;
    m.cones.forEach((c) => { c.scale.y = 1 + push * 20; });
  }
}

declare global { interface Window { qstudio: typeof harness } }
/** The harness (scripts/probe.ts HANDLES): the room as data, and a player's moves without pointer lock. */
const harness = {
  state: () => ({ phase, speakers: speakersUp, sheet: sheet.state(), ...snapshot(room), lounge: bay.state(), meter: { out: meter.out, load: meter.load }, threads: threads?.state() ?? null, desk: shownDesk(), sesh: sesh ? { room: sesh, joined: !!project, me: room.me, drawn: [...people.keys()] } : null, returns: listen(room.studio.patch).returns }),
  /** A pedal's build sheet open (B on it), by pedal id: what it shows once its kit has loaded; null for no such pedal. */
  sheet: async (id: string) => { const p = PEDALS.find((x) => x.id === id); return p ? (await openSheet(p), sheet.state()) : null; },
  /** A sound wall module's build sheet open, by kind (vco, vcf, ...), as B on it opens it; null for no such module. */
  moduleSheet: async (kind: string) => { const m = PANELS.find((x) => x.id === kind); return m ? (await openModuleSheet(m), sheet.state()) : null; },
  /** B where you stand: the sheet of the pedal or module you look at or hold, once it has loaded; null when there is none. */
  sheetHere: async () => { const p = pedalAt(room), m = p ? null : moduleAt(room); if (p) await openSheet(p); else if (m) await openModuleSheet(m); else return null; return sheet.state(); },
  /** The open sheet's tab: "schematic", "pcb", "panel" (a module's front panel), "parts", "files" or "band" (a pedal's tolerance band). */
  sheetTab: (tab: "schematic" | "pcb" | "panel" | "parts" | "files" | "band") => sheet.show(tab),
  /** The open sheet's tolerance band, run (a few seconds) and returned: dB per frequency for the sim and the builds. */
  sheetBand: () => sheet.bandOf(),
  /** The open sheet's Download button: the zip's file name and size. */
  sheetDownload: () => sheet.download(),
  /** Close the sheet, back into the room. */
  sheetClose: () => sheet.close(),
  /** A live event from player `from`, as the sesh's live line brings it (a body with room "gear" stands them in the room): false when it isn't one. */
  live: (from: number, e: unknown) => { const m = decodeServer({ t: "live", from, e }); if (m?.t === "live") onLive(m.from, m.e); return m?.t === "live"; },
  /** The desk view open or shut (Tab). */
  desk: (open: boolean) => openDesk(open),
  /** A channel's controls (`you` is the guitar's; in a sesh the ids are `state().desk`'s), an aux send 0 to 1, or a return's fader 0 to 1 (0.75 is 0 dB). */
  channel: (id: string, ch: Parameters<typeof withChannel>[2]) => setDesk(withChannel(shownDesk(), id, ch)),
  send: (id: string, aux: number, v: number) => setDesk(withSend(shownDesk(), id, aux, v)),
  returnFader: (aux: number, v: number) => setDesk(withReturn(shownDesk(), aux, { fader: v })),
  /** Into the room, without asking for the mouse. */
  start: () => { phase = "play"; menu(); },
  /** Walk to (x, z); the seconds it took. The rack is the back wall (z = -3), the door end is z = 3. */
  walkTo: (x: number, z: number) => walkTo(room, x, z),
  /** Look to `yaw` degrees (0 is at the rack) and `pitch` degrees up. */
  look: (yaw: number, pitch = 0) => { room.you.yaw = (yaw * Math.PI) / 180; room.you.pitch = (pitch * Math.PI) / 180; },
  /** Look straight at a box, or one of its jacks or knobs by name. */
  lookAt: (id: string, part?: string) => lookAt(room, id, part),
  /** A click on what you look at (set down, plug, unplug, take a cable, pick up). */
  click: () => use(room),
  pickUp: (id: string) => pickUp(room, id),
  putDown: () => putDown(room),
  turn: (dir: number) => turnHeld(room, dir),
  /** A cable out of a free jack, its far end in your hand; plug(id, jack) puts it in; unplug(id, jack) pulls one out. */
  lead: (id: string, jack: string) => lead(room, [id, jack]),
  plug: (id: string, jack: string) => plug(room, [id, jack]),
  unplug: (id: string, jack: string) => unplug(room, [id, jack]),
  drop: () => drop(room),
  /** A knob to `v`, 0 to 10 as the panel reads. */
  knob: (id: string, knob: string, v: number) => setKnob(room, id, knob, v / 10),
  held: () => heldId(room),
  /** A tscircuit board's circuit JSON, as a drop in the room: on the floor in front of you, or why it won't play. */
  bench: (json: unknown, name = "Bench pedal") => dropBoard(json, name),
  /** Bring the speakers up or down. Browsers start sound only after a click, so a probe reads state instead. */
  speakers: (up: boolean) => speakers(up),
  /** The room as it starts. */
  reset: () => { room = newRoom(startPatch()); },
  /** A new sound wall module in your hand (N's picker), by kind: seq, vco, vcf, vca, env, lfo, mix, out, noise, keys, bbd. */
  addModule: (kind: string) => bringModule(room, kind),
  /** The sound wall: what the room makes of it (`listen().wall`) and, with the speakers up, what each module is doing. */
  wall: async () => {
    const heard = listen(room.studio.patch).wall;
    const s = await wallLine?.state() ?? null;
    return { heard, modules: s?.modules ?? null, load: s?.load ?? null };
  },
};
window.qstudio = harness;

mountControls({
  key: CONTROLS, pad, parent: $("controls-host"), title: "Controls", skin: "house",
  keys: [["WASD / left stick", "Walk"], ["Mouse / right stick", "Look"], ["Click / F", "Pick up, set down, take or plug a cable"], ["Drag on a knob", "Turn it"], ["Q / E", "Turn what you hold"], ["B", "A pedal's or module's build sheet"], ["Right-click / G", "Let go of a cable"], ["M", "Speakers up or down"], ["Tab", "The desk"], ["N", "A new sound wall module"], ["Esc", "Let go of the mouse"]],
  onChange: (s) => { ctl = s; },
  onToggle: (open) => { if (open) document.exitPointerLock?.(); },
});
$("play").addEventListener("click", play);
$("desk-close").addEventListener("click", () => openDesk(false));
$("modules-close").addEventListener("click", () => openModules(false));
$("speakers").addEventListener("click", () => void speakers(!speakersUp));
menu();
resize();
requestAnimationFrame(frame);
