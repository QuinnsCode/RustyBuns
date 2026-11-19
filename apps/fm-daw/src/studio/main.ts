// Qollab Studio's jam room (/jam.html): walk in as your avatar, sit at an instrument and play the sesh's FM DAW track
// for it with your computer keys or a MIDI keyboard, so everyone in the sesh hears it. Over the shoulder while you
// walk, first person when you sit, V either way. Your body, seat and notes go on the sesh's live line; the room
// (src/studio/rooms/) is data. ?room=<sesh> (or /jam.html opened from a sesh) is the sesh you jam in; ?studio=<id> is the
// room (?studio=yours is the one you built in /rooms.html).
// With no room it's the front door (door.ts): sign in with eqosys, your character, Make a room, your rooms. An invite link
// takes a friend through the same sign-in and back into the room, wearing the character kept on their eqosys account.
import "@fontsource/barlow-condensed/600.css";
import "@fontsource/ibm-plex-sans/400.css";
import "../room/studio.css";
import "./door.css";
import * as THREE from "three";
import { DEFAULTS, loadPad, mountControls, type Settings } from "@rustybuns/game-controls";
import { clamp, lerp } from "@rustybuns/util";
import { cleanAvatar, defaultAvatar, drawAvatar, randomAvatar, type Avatar } from "@rustybuns/util/avatar";
import { eqosys } from "@rustybuns/util/eqosys";
import { APP, EQOSYS, SIGN_IN_FROM, eqosysAvatar } from "../account.ts";
import { fromLink, inviteLink, loadRecent, remember, roomId, saveRecent, studios } from "./door.ts";
import { apply, type Live, type Op, type Project } from "../project.ts";
import { demoProject } from "../presets.ts";
import { AudioOut, START_DB, dbToGain } from "../ui/audio.ts";
import { startMidi } from "../ui/input.ts";
import { loadMsg } from "../ui/load.ts";
import { connect, type Net, type NetStatus } from "../ui/net.ts";
import { localMe, myKey } from "../ui/me.ts";
import { type Answer, BODY_HZ, DRUM_KEYS, body, cameraPose, gone, hear, keyNote, nearSpot, newJam, sit, snapshot, spotOf, stand, step, toggleCam, trackFor, walkTo } from "./jam.ts";
import { figure, handsOn, type Figure } from "./figure.ts";
import type { Aim } from "./fingers.ts";
import { keysReach, thingBox, wallPieces, type Spot } from "./room.ts";
import { ROOMS, LIVE_ROOM } from "./rooms/index.ts";
import { yours } from "./builder.ts";
import { addCommands } from "@rustybuns/util/commands";
import { synth } from "@rustybuns/models/synth";
import { lookBack, may, studioTools, syncRoom, type Player, type Rights } from "./agent.ts";
import { madeSpot } from "./instrument.ts";
import { bassReach, bassSynth } from "./gear-models.ts";
import { monoSteal, withMonoBass } from "./mono-bass.ts";
import { Overlay, bendEvent, keyMap } from "./overlay.ts";
import { facing, muteRoom, mutePeer, noMutes, sounds } from "./mute.ts";
import { isMuted, leaders, type GrantServer } from "../grants.ts";
import { handsUp, marks, words, type Marks } from "./hands.ts";
import { badge, dropBadge } from "./badge.ts";
import { prop } from "./props.ts";
import { dress, loadQuality, metreUV, saveQuality, surface, useKit, type Quality } from "./look.ts";
import { gearKit } from "./gear-kit.ts";
import { Keys, Kit, layout, lowC, partOf, type Part } from "./played.ts";
import { GuitarLine } from "./guitar-line.ts";
import { guitarSettings, guitarTrack, lagWords, type Lag } from "../guitar.ts";
import { mountLane } from "./lane.tsx";
import { TABS, type LaneModel, type Tab } from "./lane-model.ts";

const CONTROLS = "qollab-studio:controls";
const LOOK = "qollab-studio:avatar";
const $ = (id: string) => { const e = document.getElementById(id); if (!e) throw new Error(`#${id} is missing`); return e; };

/** The room this page is in, from its link; null on the front door. */
const here = fromLink(location.search);
const pick = here?.studio ?? "";
const def = (pick === "yours" ? yours() : ROOMS[pick]) ?? LIVE_ROOM;
const jam = newJam(def);
const eq = eqosys({ app: APP, url: EQOSYS, from: SIGN_IN_FROM, prefix: "qollab-studio", skin: { theme: {
  "--ui-bg": "rgba(21, 23, 27, 0.94)", "--ui-ink": "#f4f1ea", "--ui-dim": "#a9adb4", "--ui-line": "#3a3e45", "--ui-soft": "#23262c",
  "--ui-accent": "#ff6b4a", "--ui-on-accent": "#15171b", "--ui-radius": "14px", "--ui-radius-sm": "8px",
} } });
const signedIn = () => !!eq.login();
/** A fresh token for /ws, or null: a guest (signed out, or a page eqosys won't send anyone back to). */
const token = () => { const l = eq.login(); return l && eq.fresh(l, 5_000) ? l.token : null; };
const name = eq.login()?.name || localMe().name || "Someone";
function myLook(): Avatar {
  try { const a = cleanAvatar(JSON.parse(localStorage.getItem(LOOK) ?? "null")); if (a) return a; } catch { /* none saved */ }
  return defaultAvatar(name);
}
let look = myLook();
/** Where your look came from: your eqosys account once it answers, else this browser's. */
let lookFrom: "eqosys" | "local" = "local";
{
  const l = eq.login();
  if (l) void eqosysAvatar(eq.eqosysUrl(), l.token).then((a) => { if (!a) return; look = a; lookFrom = "eqosys"; wear(); door(); });
}

let phase: "menu" | "play" = "menu";
let ctl: Settings = DEFAULTS;
let flash = { text: "", until: 0 };
let octave = 0;
let status: NetStatus = { state: "connecting", peers: 0 };
let project: Project = withMonoBass(demoProject());
const keys = new Set<string>();
const pad = loadPad(CONTROLS, [{ id: "sit", label: "Sit / stand up", button: 0 }, { id: "cam", label: "Camera", button: 3 }]);

// ---- the scene ----
const canvas = $("stage");
if (!(canvas instanceof HTMLCanvasElement)) throw new Error("#stage is not a canvas");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
const scene = new THREE.Scene();
// a lens about a phone's main camera: wide enough to see the room, not so wide its corners stretch (the light: look.ts)
const camera = new THREE.PerspectiveCamera(56, 1, 0.05, 80);
camera.rotation.order = "YXZ";
const std = (c: string, o: Partial<THREE.MeshStandardMaterialParameters> = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, ...o });
function buildRoom() {
  const { w, d, h } = def.size;
  const made = def.materials ?? { floor: "floorboards", ceiling: "drywall", walls: { back: "drywall", right: "drywall", front: "drywall", left: "drywall" } };
  const floor = new THREE.Mesh(metreUV(new THREE.PlaneGeometry(w, d)), surface(made.floor, def.colors.floor));
  floor.rotation.x = -Math.PI / 2;
  const ceil = new THREE.Mesh(metreUV(new THREE.PlaneGeometry(w, d)), surface(made.ceiling, def.colors.ceiling));
  ceil.rotation.x = Math.PI / 2; ceil.position.y = h;
  scene.add(floor, ceil);
  const outside = [{ from: [-w / 2, -d / 2], to: [w / 2, -d / 2] }, { from: [w / 2, -d / 2], to: [w / 2, d / 2] }, { from: [w / 2, d / 2], to: [-w / 2, d / 2] }, { from: [-w / 2, d / 2], to: [-w / 2, -d / 2] }] as const;
  const glass = surface("glass", "#9fc6d8"), trim = surface("wood", def.colors.trim), sides = ["back", "right", "front", "left"] as const;
  for (const wall of [...outside.map((x, i) => ({ from: [...x.from] as [number, number], to: [...x.to] as [number, number], material: made.walls[sides[i]] })), ...def.walls]) {
    const wallMat = surface(wall.material ?? "drywall", wall.material ? undefined : def.colors.walls);
    for (const p of wallPieces(wall, 0.12)) {
      const isGlass = "glass" in wall && wall.glass;
      const m = new THREE.Mesh(metreUV(new THREE.BoxGeometry(p.hw * 2, isGlass ? h - 1.1 : h, p.hd * 2)), isGlass ? glass : wallMat);
      m.position.set(p.cx, isGlass ? 0.9 + (h - 1.1) / 2 : h / 2, p.cz);
      m.rotation.y = p.turn;
      scene.add(m);
      if (isGlass) {
        // a solid wall under the window, a trim along its sill
        const sill = new THREE.Mesh(metreUV(new THREE.BoxGeometry(p.hw * 2, 0.9, p.hd * 2 + 0.02)), wallMat);
        sill.position.set(p.cx, 0.45, p.cz); sill.rotation.y = p.turn;
        const t = new THREE.Mesh(metreUV(new THREE.BoxGeometry(p.hw * 2, 0.04, p.hd * 2 + 0.08)), trim);
        t.position.set(p.cx, 0.9, p.cz); t.rotation.y = p.turn;
        scene.add(sill, t);
      }
    }
  }
  for (const s of def.spots) scene.add(thing(s));
  for (const p of def.props ?? []) scene.add(prop(p, surface));
}
/** Each instrument's keys or drums, by spot id, to show what's played on them. */
const played = new Map<string, { keys?: Keys; kit?: Kit }>();
/** A spot's instrument or furniture, and its seat. */
function thing(s: Spot): THREE.Group {
  const g = new THREE.Group(), b = thingBox(s), t = s.thing, m = std(t.color);
  const at = (o: THREE.Object3D, x: number, y: number, z: number) => { o.position.set(x, y, z); g.add(o); return o; };
  const inFront = new THREE.Group();
  inFront.position.set(b.cx, 0, b.cz); inFront.rotation.y = b.turn;
  g.add(inFront);
  const put = <T extends THREE.Object3D>(o: T, x: number, y: number, z: number): T => { o.position.set(x, y, z); inFront.add(o); return o; };
  // what the gear is made of comes from the photo-texture kit through look.ts (tolex, grille cloth, painted steel,
  // brushed metal, textured plastic, rubber); boxes get UVs in metres so the grain comes out its real size
  const box = (w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, to: THREE.Object3D = inFront) => {
    const o = new THREE.Mesh(metreUV(new THREE.BoxGeometry(w, h, d)), mat);
    o.position.set(x, y, z); to.add(o); return o;
  };
  // many of one small part (keys, knobs, faders) in one draw call
  const many = (geo: THREE.BufferGeometry, mat: THREE.Material, at: [number, number, number][], to: THREE.Object3D = inFront, colors?: string[]) => {
    const o = new THREE.InstancedMesh(geo, mat, at.length), p = new THREE.Matrix4();
    at.forEach(([x, y, z], i) => { o.setMatrixAt(i, p.makeTranslation(x, y, z)); if (colors) o.setColorAt(i, new THREE.Color(colors[i % colors.length])); });
    to.add(o); return o;
  };
  const tube = (r: number, a: THREE.Vector3, z: THREE.Vector3, mat: THREE.Material, to: THREE.Object3D = inFront) => {
    const o = new THREE.Mesh(new THREE.CylinderGeometry(r, r, a.distanceTo(z), 10), mat);
    o.position.copy(a).add(z).multiplyScalar(0.5);
    o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), z.clone().sub(a).normalize());
    to.add(o); return o;
  };
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const blackSteel = surface("steel", "#1b1c1f"), metal = surface("metal", "#b9bcc0"), knob = surface("plastic", "#121314");
  if (s.kind === "drums") {
    // lacquered shells under a clear coat, coated heads, chrome hoops, brass cymbals on stands
    const shell = new THREE.MeshPhysicalMaterial({ color: t.color, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.08 });
    const head = std("#e2ddd0", { roughness: 0.75 }), hoop = surface("chrome", "#d8dadc");
    // laid out from the stool (+z here): the kick out past the drummer's feet, the snare over their left knee, the
    // floor tom by their right, two toms over the kick and the cymbals up either side, every head tipped toward them
    // each drum and cymbal with its own copy of its head or brass, to flash when it's hit
    const kit = new Kit(), own = (part: Part, o: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>, cymbal = false) => { o.material = o.material.clone(); kit.add(part, o, o.material, cymbal); return o; };
    played.set(s.id, { kit });
    // the kick's batter head faces the stool, so from the seat you see its shell's top and the pedal's beater by your
    // right foot: on a hit the shell flashes and the beater swings into the head, its felt lit
    const kick = put(new THREE.Group(), 0, 0.27, -0.2), kickShell = shell.clone(), felt = std("#ece6da", { roughness: 0.9 });
    kick.add(new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.4, 28).rotateX(Math.PI / 2), kickShell));
    const batter = new THREE.Mesh(new THREE.CircleGeometry(0.255, 28), head.clone());
    batter.position.z = 0.201;
    kick.add(batter);
    kit.add("kick", kick, [kickShell, batter.material, felt]);
    const pedal = put(new THREE.Group(), 0.06, 0.07, 0.13);
    box(0.08, 0.012, 0.24, blackSteel, 0.06, 0.02, 0.2).rotation.x = -0.12;
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.24, 8), metal), ball = new THREE.Mesh(new THREE.SphereGeometry(0.03, 14, 10), felt);
    shaft.position.y = 0.12; ball.position.y = 0.25;
    pedal.add(shaft, ball);
    kit.swing("kick", pedal, 0.45, -0.42);
    for (const z of [-0.4, 0]) put(new THREE.Mesh(new THREE.TorusGeometry(0.262, 0.012, 6, 28), hoop), 0, 0.27, z); // its two ends
    for (const [x, y, z, r, tip, part] of [[-0.3, 0.62, 0.3, 0.17, 0.12, "snare"], [0.5, 0.5, 0.25, 0.2, 0, "tom"], [-0.17, 0.82, -0.05, 0.12, 0.35, null], [0.17, 0.82, -0.05, 0.12, 0.35, null]] as const) {
      const drum = put(new THREE.Group(), x, y, z);
      drum.rotation.x = tip;
      const face = new THREE.Mesh(new THREE.CircleGeometry(r * 0.98, 24).rotateX(-Math.PI / 2), head), ring = new THREE.Mesh(new THREE.TorusGeometry(r + 0.004, 0.008, 6, 24).rotateX(Math.PI / 2), hoop);
      face.position.y = 0.081; ring.position.y = 0.08;
      if (part) own(part, face);
      drum.add(new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.16, 24), shell), face, ring);
      if (y < 0.7) tube(0.012, v(0, -0.08, 0), v(0, -y, 0), metal, drum); // the floor tom's and snare's legs
    }
    const brass = std("#c39a46", { metalness: 1, roughness: 0.32 });
    for (const [x, z, part] of [[-0.62, 0.05, "hat"], [0.68, -0.15, "crash"]] as const) {
      own(part, put(new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.23, 0.02, 32), brass), x, 1.08, z), true).rotation.x = 0.2;
      tube(0.011, v(x, 0.02, z), v(x, 1.06, z), metal);
      for (let k = 0; k < 3; k++) { const a = (k / 3) * Math.PI * 2; tube(0.009, v(x, 0.3, z), v(x + Math.cos(a) * 0.25, 0.01, z + Math.sin(a) * 0.25), metal); }
    }
    // a worn rug under the kit with a darker border, so it doesn't creep on the boards
    box(2.3, 0.008, 2, surface("carpet", "#3a2420"), 0, 0.004, 0.25);
    box(2.0, 0.009, 1.7, surface("carpet", "#6a3a2c"), 0, 0.0045, 0.25);
    // two overheads on boom stands, their cables down the stands and across the floor to a stage box at the glass
    const stagebox = box(0.3, 0.12, 0.16, surface("steel", "#26282c"), 0.95, 0.06, -0.9);
    many(new THREE.CylinderGeometry(0.011, 0.011, 0.012, 10).rotateX(Math.PI / 2), surface("metal", "#9a9da2"), [-0.1, -0.03, 0.04, 0.11].map((x) => [x, 0.02, 0.083]), stagebox);
    const rubber = surface("rubber", "#0f1012");
    const cable = (pts: [number, number, number][]) => put(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(([x, y, z]) => v(x, y, z))), pts.length * 10, 0.0035, 5), rubber), 0, 0, 0);
    for (const [side, plug] of [[-1, -0.1], [1, 0.11]] as const) {
      const foot = v(side * 0.98, 0, -0.42), top = v(foot.x, 1.45, foot.z), tip = v(side * 0.38, 1.78, -0.12), tail = top.clone().lerp(tip, -0.35);
      for (let k = 0; k < 3; k++) { const a = (k / 3) * Math.PI * 2 + 0.4; tube(0.009, v(foot.x, 0.32, foot.z), v(foot.x + Math.cos(a) * 0.3, 0.01, foot.z + Math.sin(a) * 0.3), blackSteel); }
      tube(0.011, v(foot.x, 0.02, foot.z), top, blackSteel);
      tube(0.008, tail, tip, blackSteel);
      put(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.06, 14), blackSteel), tail.x, tail.y, tail.z);
      put(new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.13, 12), surface("metal", "#a9acb0")), tip.x, tip.y - 0.07, tip.z);
      cable([[tip.x, tip.y - 0.13, tip.z], [tip.x + side * 0.05, tip.y - 0.2, tip.z], [top.x - side * 0.03, top.y - 0.1, top.z], [foot.x - side * 0.02, 0.6, foot.z], [foot.x - side * 0.05, 0.004, foot.z + 0.06],
        [foot.x * 0.6, 0.004, -0.7 + side * 0.04], [0.95 + plug, 0.004, -0.8], [0.95 + plug, 0.02, -0.82]]);
    }
    // the kick's and the snare's mics on short stands, wired to the same box
    put(new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.016, 0.14, 12).rotateX(Math.PI / 2), rubber), 0.12, 0.22, -0.52);
    tube(0.008, v(0.12, 0.02, -0.52), v(0.12, 0.2, -0.52), blackSteel);
    cable([[0.12, 0.2, -0.46], [0.16, 0.05, -0.52], [0.4, 0.004, -0.62], [0.82, 0.004, -0.78], [0.92, 0.02, -0.82]]);
    cable([[-0.3, 0.68, 0.5], [-0.25, 0.3, 0.5], [-0.15, 0.004, 0.42], [0.4, 0.004, 0.0], [0.6, 0.004, -0.55], [0.99, 0.004, -0.79], [0.99, 0.02, -0.82]]);
  } else if (s.kind === "keys") {
    // a stage synth: a textured plastic case with walnut cheeks, a sloped steel panel of knobs and a small screen
    // behind the keys, on a black steel X stand
    const top = t.h;
    box(t.w - 0.08, 0.1, t.d, surface("plastic", t.color), 0, top - 0.05, 0);
    for (const x of [-t.w / 2 + 0.02, t.w / 2 - 0.02]) box(0.04, 0.13, t.d, surface("ply", "#5b3a24"), x, top - 0.035, 0);
    const panel = box(t.w - 0.08, 0.02, t.d * 0.36, surface("steel", "#26282c"), 0, top + 0.02, -t.d * 0.3);
    panel.rotation.x = 0.18;
    const knobs: [number, number, number][] = [];
    for (let i = 0; i < 14; i++) knobs.push([-t.w / 2 + 0.22 + i * 0.065, 0.02, (i % 2 ? 0.03 : -0.03)]);
    many(new THREE.CylinderGeometry(0.012, 0.013, 0.022, 14), knob, knobs, panel);
    const screen = box(0.16, 0.004, 0.05, surface("screen", "#7ab8d8"), t.w / 2 - 0.22, 0.012, 0, panel);
    screen.userData.glow = 1;
    // white keys with a gap between each, the black ones raised and set back, as a seated player sees them; the black
    // ones satin with a weak, tight sheen, so a lamp nearby doesn't lift them to brown; their near-black is each key's
    // own colour (Keys), so a pressed one can light up
    const white = std("#e2ddd0", { roughness: 0.45 }), black = new THREE.MeshPhysicalMaterial({ color: "#ffffff", roughness: 0.32, specularIntensity: 0.28, envMapIntensity: 0.18 });
    const n = 29, lay = layout(n), kw = (t.w - 0.12) / n, x0 = -(t.w - 0.12) / 2 + kw / 2, z = t.d * 0.18;
    const whites = lay.whites.map((_, i): [number, number, number] => [x0 + i * kw, top + 0.011, z]);
    const blacks = lay.after.map((i): [number, number, number] => [x0 + (i + 0.5) * kw, top + 0.032, z - t.d * 0.1]);
    const wk = many(new THREE.BoxGeometry(kw - 0.003, 0.022, t.d * 0.5), white, whites); // their near edge t.d * 0.43 in from the middle (room.ts keysReach)
    const bk = many(new THREE.BoxGeometry(kw * 0.58, 0.022, t.d * 0.3), black, blacks);
    played.set(s.id, { keys: new Keys(wk, whites, bk, blacks, lay, t.d * 0.5, t.d * 0.3, undefined, new THREE.Color("#040405")) });
    const legH = top - 0.1;
    for (const zz of [-0.12, 0.12]) for (const sx of [-1, 1]) tube(0.016, v(-0.42 * sx, 0.02, zz), v(0.42 * sx, legH, zz), blackSteel);
    for (const x of [-0.42, 0.42]) for (const y of [0.02, legH]) tube(0.018, v(x, y, -0.22), v(x, y, 0.22), blackSteel);
  } else if (s.kind === "booth") {
    tube(0.012, v(0, 0.03, 0), v(0, t.h, 0), blackSteel);
    put(new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.14, 0.03, 24), blackSteel), 0, 0.015, 0);
    put(new THREE.Mesh(new THREE.CapsuleGeometry(0.03, 0.09, 6, 16), surface("metal", "#8e9298")), 0, t.h + 0.07, 0);
    put(new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.006, 6, 20), blackSteel), 0, t.h + 0.04, 0).rotation.x = Math.PI / 2;
  } else if (s.kind === "bass") {
    // an analog mono synth on an X stand, played like the keys (gear-models.ts)
    const { synth, keys } = bassSynth(s);
    inFront.add(synth.group);
    played.set(s.id, { keys });
  } else if (s.kind === "desk") {
    // a mixing console: a steel body, a sloped work surface of channel strips (knobs with coloured caps, a fader
    // in a slot each), a lit meter bridge behind and a padded armrest in front, where the engineer sits (+z)
    const bodyH = t.h - 0.1;
    box(t.w, bodyH, t.d * 0.9, surface("steel", t.color), 0, bodyH / 2, -t.d * 0.05);
    const deck = new THREE.Group();
    deck.position.set(0, t.h - 0.06, 0); deck.rotation.x = 0.14;
    inFront.add(deck);
    box(t.w, 0.03, t.d * 0.8, surface("steel", "#34363b"), 0, 0, -0.02, deck);
    const ch = Math.floor((t.w - 0.24) / 0.1), x0 = -(ch - 1) * 0.05, knobs: [number, number, number][] = [], slots: [number, number, number][] = [], faders: [number, number, number][] = [], leds: [number, number, number][] = [];
    for (let c = 0; c < ch; c++) {
      const x = x0 + c * 0.1;
      for (let r = 0; r < 6; r++) knobs.push([x, 0.026, -t.d * 0.36 + r * 0.045]);
      slots.push([x, 0.016, t.d * 0.2]);
      faders.push([x, 0.03, t.d * 0.2 + ((c * 37) % 9) * 0.008 - 0.03]);
      for (let k = 0; k < 6; k++) leds.push([x, 0.07 + k * 0.016, -t.d * 0.42 + 0.033]);
    }
    many(new THREE.CylinderGeometry(0.012, 0.014, 0.022, 14), knob, knobs, deck);
    many(new THREE.CylinderGeometry(0.007, 0.007, 0.004, 10).translate(0, 0.012, 0), std("#ffffff", { roughness: 0.5 }), knobs, deck, ["#c8c4b8", "#b8402e", "#c8c4b8", "#3a6ab0", "#3a6ab0", "#d8a83a"]);
    many(new THREE.BoxGeometry(0.008, 0.002, 0.11), std("#050505"), slots, deck);
    many(new THREE.BoxGeometry(0.024, 0.02, 0.016), surface("plastic", "#cfcfcc"), faders, deck);
    box(t.w, 0.2, 0.06, surface("steel", "#2a2c30"), 0, 0.1, -t.d * 0.42, deck);
    many(new THREE.BoxGeometry(0.03, 0.01, 0.004), surface("screen", "#5ad06a"), leds, deck).userData.glow = 0.6;
    box(t.w, 0.05, 0.09, surface("tolex", "#1d1b19"), 0, t.h - 0.025, t.d / 2 - 0.045);
  } else {
    put(new THREE.Mesh(new THREE.BoxGeometry(t.w, t.h, t.d), m), 0, t.h / 2, 0);
    if (s.kind === "couch") put(new THREE.Mesh(new THREE.BoxGeometry(t.w, 0.5, 0.2), m), 0, t.h + 0.25, t.d / 2 - 0.1);
  }
  if (s.kind !== "couch" && s.kind !== "booth") {
    // the seat: a stool in black vinyl on a metal post, a foot ring and three feet
    at(new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.16, 0.07, 24), surface("tolex", "#141414")), s.at[0], 0.46, s.at[1]);
    at(new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.43, 10), metal), s.at[0], 0.215, s.at[1]);
    at(new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.009, 6, 24), metal), s.at[0], 0.22, s.at[1]).rotation.x = Math.PI / 2;
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + 0.3, foot = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.02, 0.24), blackSteel);
      foot.rotation.y = a;
      at(foot, s.at[0] + Math.sin(a) * 0.12, 0.012, s.at[1] + Math.cos(a) * 0.12);
    }
  }
  return g;
}
useKit(gearKit(loadQuality()));
buildRoom();
const picture = dress(renderer, scene, camera, def, loadQuality());
/** Q, standing: the other quality setting, kept for next time (the page loads again with it). */
function setQuality(q: Quality) { saveQuality(q); const u = new URL(location.href); u.searchParams.delete("quality"); location.replace(u); }

// ---- people: you, and everyone the live line says is here ----
interface Drawn { fig: Figure; key: string; x: number; z: number; yaw: number; speed: number }
const drawn = new Map<number | "me", Drawn>();
/** Whoever is playing, for everyone else to look at (null: nobody is). */
let watched: THREE.Vector3 | null = null;
function drawPerson(id: number | "me", a: Avatar, label: string | null, x: number, z: number, yaw: number, seat: Spot | null, playing: boolean, dt: number, t: number, snap: boolean) {
  const key = JSON.stringify([a, label]);
  let d = drawn.get(id);
  if (d && d.key !== key) { scene.remove(d.fig.group); d.fig.dispose(); d = undefined; }
  if (!d) { d = { fig: figure(a, label), key, x, z, yaw, speed: 0 }; scene.add(d.fig.group); drawn.set(id, d); }
  // others glide to where their last body said, 10 a second; you are where you are
  const k = snap ? 1 : 1 - Math.exp(-dt * 12);
  const nx = lerp(d.x, x, k), nz = lerp(d.z, z, k);
  d.speed = lerp(d.speed, dt > 0 ? Math.hypot(nx - d.x, nz - d.z) / dt : 0, 0.3);
  d.x = nx; d.z = nz;
  d.yaw += Math.atan2(Math.sin(yaw - d.yaw), Math.cos(yaw - d.yaw)) * k;
  d.fig.group.position.set(d.x, 0, d.z);
  d.fig.group.rotation.y = d.yaw;
  d.fig.pose({ speed: d.speed, seated: !!seat, play: seat && played.get(seat.id)?.keys ? "keys" : handsOn(seat?.kind, playing), note: playing, t, reach: seat ? keysReach(seat) ?? bassReach(seat) : null, sticks: seat?.kind === "drums", aim: seat ? aimAt(seat) : null, look: watched && Math.hypot(watched.x - d.x, watched.z - d.z) > 0.4 ? watched : null });
}
function dropPerson(id: number | "me") {
  const d = drawn.get(id);
  if (d) { scene.remove(d.fig.group); d.fig.dispose(); drawn.delete(id); }
  const b = badges.get(id);
  if (b?.sprite) dropBadge(b.sprite);
  badges.delete(id);
}
/** Each person's grants over their head (hands.ts): leads, hand up, listen only, muted for everyone. */
const badges = new Map<number | "me", { key: string; sprite: THREE.Sprite | null }>();
function markPerson(id: number | "me", m: Marks) {
  const d = drawn.get(id);
  if (!d) return;
  const key = JSON.stringify(m);
  let b = badges.get(id);
  if (b && b.key !== key) { if (b.sprite) dropBadge(b.sprite); b = undefined; }
  if (!b) { b = { key, sprite: badge(m) }; badges.set(id, b); }
  // a figure made again (a new look) dropped its children: hang the badge over the new one, above its name tag
  if (b.sprite && b.sprite.parent !== d.fig.group) {
    b.sprite.position.y = new THREE.Box3().setFromObject(d.fig.group).max.y + 0.14;
    d.fig.group.add(b.sprite);
  }
}

// ---- sound: the FM DAW audio thread, mirroring the sesh's groove ----
let out: AudioOut | null = null;
async function startAudio() {
  if (out) return;
  try {
    out = await AudioOut.start(() => {});
    out.send(loadMsg(project));
    out.send({ t: "master", gain: dbToGain(START_DB) });
    guitars = new GuitarLine(out.ctx, (to, line, sig) => net?.rtc(to, line, sig));
    for (const peer of plugged.keys()) guitars.ask(peer);
  } catch (e) { flash = { text: `No sound: ${(e as Error).message}`, until: performance.now() + 4000 }; }
}
/** Notes you hold now, by what holds them (a key, a MIDI note), so letting go turns off the right one. */
const holding = new Map<string, { track: number; midi: number }>();
function noteOn(by: string, n: { track: number; midi: number }, vel: number) {
  if (holding.has(by)) return;
  // the World passes on no note without a play grant, so a listen-only seat says so rather than going quiet
  if (!may(player).play) return void say({ ok: false, why: rights.asked === "play" ? "Listen only: your hand is up, the leader answers Yes or No" : "Listen only: the leader hasn't let you play. H raises your hand" });
  // the bass synth is mono: a new note takes over from the one you hold
  if (spotOf(jam, jam.me.seat)?.kind === "bass") for (const b of monoSteal(holding, n.track)) noteOff(b);
  holding.set(by, n);
  out?.send({ t: "on", ...n, vel });
  live({ t: "on", ...n, vel });
}
function noteOff(by: string) {
  const n = holding.get(by);
  if (!n) return;
  holding.delete(by);
  out?.send({ t: "off", ...n });
  live({ t: "off", ...n });
}
function releaseAll() { for (const by of [...holding.keys()]) noteOff(by); }

// ---- guitars: yours out to everyone, theirs in, each through its track's amp here (src/guitar.ts) ----
let guitars: GuitarLine | null = null;
/** The track your guitar is plugged into (-1: straight in), or null while it's out. */
let myGuitar: number | null = null;
/** Whose guitar is in, by peer, and the track it's plugged into. */
const plugged = new Map<number, number>();
/** How far behind each guitar coming in is, ms (null: connecting, "failed": no way through), asked once a second. */
let lags = new Map<number, Lag>();
/** I, or the room page's button: plug your guitar (the computer's audio input) in, or pull it out. */
async function guitar() {
  if (myGuitar !== null) {
    guitars?.unplug(); myGuitar = null; live({ t: "guitar", track: null });
    return void say({ ok: false, why: "Your guitar is out" });
  }
  if (!may(player).play) return void say({ ok: false, why: "Listen only: the leader hasn't let you play. H raises your hand" });
  await startAudio();
  if (!guitars) return;
  let stream: MediaStream;
  try {
    // the dry signal, as the jack gives it: a voice call's echo cancelling and levelling would chew a guitar up
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 } });
  } catch (e) { return void say({ ok: false, why: `No guitar: ${(e as Error).message}` }); }
  const seat = spotOf(jam, jam.me.seat);
  const track = guitarTrack(project, seat && seat.kind !== "drums" ? trackFor(seat, project) : -1);
  await guitars.plugIn(stream);
  myGuitar = track;
  live({ t: "guitar", track });
  say({ ok: false, why: track >= 0 ? `Your guitar is in, through ${project.tracks[track].name}'s amp. I pulls it out` : "Your guitar is in, straight (no track has an amp). I pulls it out" });
}
/** Each guitar through its track's amp, at your mutes, where its player stands; you, where you are. */
function hearGuitars() {
  if (!guitars) return;
  guitars.listen(jam.me.x, jam.me.z, jam.me.yaw);
  if (myGuitar !== null) guitars.set("me", guitarSettings(project.tracks[myGuitar]?.amp));
  for (const [peer, track] of plugged) {
    const o = jam.others.get(peer);
    guitars.set(peer, guitarSettings(project.tracks[track]?.amp));
    guitars.level(peer, mutes.room || mutes.peers.has(peer) || leaderMuted(peer) ? 0 : 1);
    if (o) guitars.place(peer, o.at[0], o.at[1]);
  }
}
setInterval(() => { if (guitars && plugged.size) void guitars.lags().then((l) => { lags = l; }); }, 1000);

// ---- the sesh ----
let net: Net | null = null;
const live = (e: Live) => net?.live(e);
function wear() { live({ t: "wear", avatar: look, name }); live(body(jam)); if (myGuitar !== null) live({ t: "guitar", track: myGuitar }); }
function onLive(from: number, e: Live) {
  hear(jam, from, e);
  if (e.t === "wear") people();
  if (e.t === "guitar") {
    if (e.track === null) { plugged.delete(from); lags.delete(from); guitars?.stopHearing(from); }
    else { plugged.set(from, e.track); guitars?.ask(from); }
    return;
  }
  if (!sounds(mutes, from, e)) return;
  if (e.t === "on") out?.send({ t: "on", track: e.track, midi: e.midi, vel: e.vel });
  else if (e.t === "off") out?.send({ t: "off", track: e.track, midi: e.midi });
  else if (e.t === "bend") out?.send({ t: "bend", track: e.track, semis: e.semis });
}
// ---- mutes: yours (the room, or one person) and the leader's for everyone ----
const mutes = noMutes();
/** Which person each peer on the live line is, from the World's grants. */
let peerIds: Record<string, string> = {};
/** The World's last grants message: the grants, the raised hands, who's in. */
let lastGrants: GrantServer | null = null;
const marksOf = (who: string | undefined) => marks(lastGrants, status.floor?.state, who);
/** H, or the button on the room's page: raise your hand to play. */
function raise() {
  if (may(player).play) return void say({ ok: false, why: "You may play already" });
  if (rights.asked !== "play") { net?.grant({ t: "ask", can: "play" }); rights.asked = "play"; }
  say({ ok: false, why: "Your hand is up: the leader answers Yes or No" });
  people();
}
const iLead = () => !!rights.grants && !!rights.me && leaders(rights.grants).includes(rights.me);
const leaderMuted = (peer: number) => !!rights.grants && isMuted(rights.grants, peerIds[peer]);
const letGo = (notes: { track: number; midi: number }[]) => { for (const n of notes) out?.send({ t: "off", ...n }); };
function mutePerson(peer: number, on?: boolean) { letGo(mutePeer(mutes, jam, peer, on)); people(); }
function muteAll(on?: boolean) { letGo(muteRoom(mutes, jam, on)); people(); }
/** The leader mutes this person for everyone (the World checks it's the leader). */
function muteForAll(peer: number, on: boolean) { const who = peerIds[peer]; if (who) net?.grant({ t: "mute", who, on }); }
/** The people list on the room's page: each one with your mute, and the leader's mute for everyone. */
function people() {
  const list = $("people"), lead = iLead();
  $("mute-room").textContent = mutes.room ? "Unmute the room" : "Mute the room";
  list.replaceChildren();
  for (const [peer, o] of jam.others) {
    const li = document.createElement("li"), n = document.createElement("span");
    const who = peerIds[peer], m = marksOf(who);
    n.textContent = [o.name || "Someone", ...words(m)].join(", ");
    const b = document.createElement("button");
    b.type = "button"; b.className = "ghost"; b.textContent = mutes.peers.has(peer) ? "Unmute" : "Mute";
    b.addEventListener("click", () => mutePerson(peer));
    li.append(n, b);
    if (lead) {
      const all = document.createElement("button"), was = leaderMuted(peer);
      all.type = "button"; all.className = "ghost"; all.textContent = was ? "Unmute for everyone" : "Mute for everyone";
      all.addEventListener("click", () => muteForAll(peer, !was));
      li.append(all);
      if (m.hand && who) for (const yes of [true, false]) {
        const a = document.createElement("button");
        a.type = "button"; a.className = "ghost"; a.textContent = yes ? `Yes, ${m.hand}` : "No";
        a.addEventListener("click", () => net?.grant({ t: "answer", who, yes }));
        li.append(a);
      }
    }
    list.append(li);
  }
  $("people-none").hidden = jam.others.size > 0;
  const me = marksOf(rights.me ?? undefined);
  $("me-may").textContent = !lastGrants ? "" : me.lead ? "You lead this sesh: answer a raised hand here." : me.listen ? (me.hand === "play" ? "Listen only. Your hand is up: the leader answers Yes or No." : "Listen only: the leader hasn't let you play yet.") : "You may play.";
  $("raise").hidden = !lastGrants || !me.listen || me.hand === "play";
}
$("mute-room").addEventListener("click", () => muteAll());
$("raise").addEventListener("click", () => raise());
$("guitar").addEventListener("click", () => void guitar().then(() => { $("guitar").textContent = myGuitar === null ? "Plug in your guitar" : "Unplug your guitar"; }));
function onGone(from: number) {
  mutes.peers.delete(from);
  plugged.delete(from); lags.delete(from); guitars?.gone(from);
  for (const k of jam.others.get(from)?.held ?? []) { const [track, midi] = k.split(":").map(Number); out?.send({ t: "off", track, midi }); }
  gone(jam, from);
  dropPerson(from);
  people();
}
// ---- made instruments: a seat at its track, and a synth grown from its seed (src/studio/instrument.ts) ----
const madeGroup = new THREE.Group();
scene.add(madeGroup);
let madeKey = "";
function drawMade() {
  syncRoom(player);
  const key = JSON.stringify(project.instruments ?? []);
  if (key === madeKey) return;
  madeKey = key;
  for (const c of [...madeGroup.children]) {
    madeGroup.remove(c);
    c.traverse((o) => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); for (const mt of [o.material].flat()) mt.dispose(); } });
  }
  for (const m of project.instruments ?? []) {
    const s = madeSpot(m), b = thingBox(s), model = synth(m.seed, m.voice).group;
    // the keys face the seat: the model's front is +z, the seat looks down -z at yaw 0
    model.position.set(b.cx, 0, b.cz); model.rotation.y = s.yaw;
    const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.16, 0.06, 16), std("#2e3439"));
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.45, 8), std("#8a8f94", { metalness: 0.6 }));
    seat.position.set(s.at[0], 0.45, s.at[1]); leg.position.set(s.at[0], 0.225, s.at[1]);
    madeGroup.add(model, seat, leg);
  }
}
let lane: LaneModel | null = null;
function groove(p: Project) { project = p; out?.send(loadMsg(p)); drawMade(); lane?.refresh(); }

// ---- an agent in the browser plays here too: WebMCP tools (and the Cmd/Ctrl+K palette) named studio_* ----
const rights: Rights = { floor: null, grants: null, me: null, asked: null };
const back = lookBack((ago) => net?.rewind(ago));
const player: Player = {
  jam, base: def, name,
  project: () => project,
  rights: () => ({ ...rights, floor: status.floor ?? null }),
  live: (e) => live(e),
  edit: (op: Op) => { net?.send(op); groove(apply(project, op)); },
  ask: (can) => net?.grant({ t: "ask", can }),
  rewind: back.rewind,
  wait: (ms) => new Promise((r) => setTimeout(r, ms)),
};
addCommands(studioTools(player).map((t) => ({ group: "Studio", ...t })));
// Tab, seated: the track's lane over the room (lane.tsx), its edits over the sesh as the player's
lane = mountLane({
  project: () => project, edit: player.edit, may: () => may(player),
  seat: () => { const s = spotOf(jam, jam.me.seat); return s && phase === "play" ? { label: s.label, drums: s.kind === "drums", track: trackFor(s, project) } : null; },
  audition: (track) => { const midi = project.tracks[track]?.root ?? 60; noteOn("lane", { track, midi }, 0.8); setTimeout(() => noteOff("lane"), 220); },
  onToggle: (open) => { if (open) document.exitPointerLock?.(); else if (phase === "play") lock(); },
});

if (here) net = connect({
  onGrants(m) { lastGrants = m; rights.grants = m.grants; peerIds = m.peers; rights.asked = (rights.me && m.asks[rights.me]) || null; people(); },
  onRewound: back.answer,
  onRtc: (m) => void guitars?.signal(m),
  onSnapshot(p) {
    if (!p) { net?.init(project); return; }
    groove(p);
  },
  onOp(op) { groove(apply(project, op)); },
  onLive,
  onGone,
  onStatus(s) {
    // someone new came in: say who you are again, so they see you before you next move
    if (s.state === "online" && s.peers > status.peers) wear();
    status = s;
  },
  onChat(m) { if (m.t === "chat") rights.me = m.you; },
  onTakeBytes() {},
  hello: () => ({ key: myKey(), name }),
  token,
});

// ---- input ----
const locked = () => document.pointerLockElement === canvas;
const lock = () => void Promise.resolve(canvas.requestPointerLock?.()).catch(() => {});
const say = (a: Answer) => { if (!a.ok) flash = { text: a.why, until: performance.now() + 1800 }; return a; };
function sitOrStand() {
  if (jam.me.seat) { releaseAll(); stand(jam); live(body(jam)); return; }
  const s = nearSpot(jam);
  if (!s) return void say({ ok: false, why: "Walk up to an instrument or a seat" });
  if (say(sit(jam, s.id)).ok) live(body(jam));
}
canvas.addEventListener("mousedown", () => {
  if (phase !== "play") return;
  if (lane?.isOpen()) return lane.close();
  if (!locked()) return lock();
  sitOrStand();
});
document.addEventListener("mousemove", (e) => {
  if (!locked()) return;
  const s = 0.0022;
  jam.me.yaw -= e.movementX * s * ctl.lookX;
  jam.me.pitch = clamp(jam.me.pitch - e.movementY * s * ctl.lookY * (ctl.invertY ? -1 : 1), -1.2, 1.1);
});
function keyDown(code: string, shift = false) {
  if (code === "KeyM") return void startAudio();
  if (phase !== "play") return;
  if (code === "KeyV") return toggleCam(jam);
  if (code === "KeyN") return muteAll();
  if (code === "KeyB") { const p = facing(jam); if (p === null) return void say({ ok: false, why: "Look at someone to mute them" }); mutePerson(p); flash = { text: `${jam.others.get(p)?.name || "Someone"} ${mutes.peers.has(p) ? "muted, for you" : "unmuted"}`, until: performance.now() + 1800 }; return; }
  if (code === "Tab") return void (jam.me.seat && lane?.toggle());
  if (code === "Space") return sitOrStand();
  if (code === "KeyH") return raise();
  if (code === "KeyI") return void guitar();
  if (code === "KeyQ" && !jam.me.seat) return setQuality(picture.quality === "high" ? "low" : "high");
  if (jam.me.seat) {
    if (code === "KeyZ") { releaseAll(); octave = Math.max(-3, octave - 1); return; }
    if (code === "KeyX") { releaseAll(); octave = Math.min(3, octave + 1); return; }
    // the see-through keys and the wheels (overlay.ts)
    if (code === "Slash") return overlay.toggle();
    if (code === "ArrowUp" || code === "ArrowDown") return overlay.wheels.push(code === "ArrowUp" ? 1 : -1);
    if (code === "BracketLeft" || code === "BracketRight") return overlay.wheels.modPush(code === "BracketRight" ? 1 : -1);
    const n = keyNote(jam, project, code, octave);
    if (n) noteOn(`kb:${code}`, n, shift ? 1 : 0.75);
  }
}
document.addEventListener("keydown", (e) => {
  if (e.code === "Space" || e.code === "Tab") e.preventDefault();
  keys.add(e.code);
  if (!e.repeat) keyDown(e.code, e.shiftKey);
});
document.addEventListener("keyup", (e) => {
  keys.delete(e.code); noteOff(`kb:${e.code}`);
  if (e.code === "ArrowUp" || e.code === "ArrowDown") overlay.wheels.push(0);
  if (e.code === "BracketLeft" || e.code === "BracketRight") overlay.wheels.modPush(0);
});
addEventListener("blur", () => { keys.clear(); releaseAll(); });
document.addEventListener("pointerlockchange", () => { if (!locked() && phase === "play" && !lane?.isOpen()) { phase = "menu"; releaseAll(); menu(); } });
// a MIDI keyboard plays wherever you sit, note for note (the kit takes its notes as the home row's drums, in order)
void startMidi({
  on(note, vel) {
    const s = spotOf(jam, jam.me.seat);
    if (!s || phase !== "play") return;
    const n = keyNote(jam, project, s.kind === "drums" ? DRUM_KEYS[note % DRUM_KEYS.length] : "KeyA", 0);
    if (n) noteOn(`midi:${note}`, s.kind === "drums" ? n : { track: n.track, midi: note }, vel);
  },
  off(note) { noteOff(`midi:${note}`); },
  panic: releaseAll, bend(x) { overlay.wheels.midi(x); }, cc(n, v) { if (n === 1) overlay.wheels.mod = v; }, devices() {},
});

// ---- the front door ----
function door() {
  const out = !signedIn() && eq.canSignIn();
  $("door-out").hidden = !out;
  $("door-lobby").hidden = out || !!here;
  $("door-room").hidden = out || !here;
  const invited = $("invited");
  invited.hidden = !here;
  invited.textContent = here ? `You're invited to ${here.name || here.room}.` : "";
  $("sign-in").textContent = here ? "Sign in and walk in" : "Sign in with eqosys";
  if (here) $("room-title").textContent = here.name || here.room;
  $("room-studio-name").textContent = `${def.name}.`;
  $("room-about").textContent = def.about ?? "";
  $("me-name").textContent = name;
  $("me-from").textContent = signedIn() ? (lookFrom === "eqosys" ? "Signed in with eqosys, wearing your eqosys character" : "Signed in with eqosys") : "A guest in this browser";
  $("look").hidden = lookFrom === "eqosys";
  $("sign-out").hidden = !signedIn();
  const c = $("me-look");
  const g = c instanceof HTMLCanvasElement ? c.getContext("2d") : null;
  if (g) { g.clearRect(0, 0, 96, 132); drawAvatar(g, look, 48, 124, 112); }
  const list = $("rooms");
  list.replaceChildren();
  const rooms = loadRecent();
  if (!rooms.length) { const li = document.createElement("li"); li.className = "none"; li.textContent = "Rooms you make or join show up here."; list.append(li); }
  for (const r of rooms) {
    const li = document.createElement("li"), a = document.createElement("a"), t = document.createElement("span"), m = document.createElement("small");
    a.href = inviteLink(location.origin, r.room, r.studio, r.name);
    t.textContent = r.name || r.room;
    m.textContent = r.mine ? "Yours" : "Joined";
    a.append(t, m); li.append(a); list.append(li);
  }
}
const studioPick = $("room-studio");
if (studioPick instanceof HTMLSelectElement) for (const s of studios()) studioPick.append(new Option(s.name, s.id));
$("make").addEventListener("submit", (e) => {
  e.preventDefault();
  const input = $("room-name"), label = input instanceof HTMLInputElement ? input.value.trim().slice(0, 40) : "";
  const studio = studioPick instanceof HTMLSelectElement ? studioPick.value : LIVE_ROOM.id;
  const room = roomId(label);
  saveRecent(remember(loadRecent(), { room, name: label, studio, mine: true, at: Date.now() }));
  // the first in with a key is the sesh's maker (its leader), and that's you: you walk in before anyone has the link
  location.assign(inviteLink(location.origin, room, studio, label));
});
$("sign-in").addEventListener("click", () => void eq.signIn(location.search));
$("sign-out").addEventListener("click", () => { eq.signOut(); location.reload(); });
$("invite").addEventListener("click", () => {
  if (!here) return;
  const b = $("invite");
  void navigator.clipboard?.writeText(inviteLink(location.origin, here.room, here.studio, here.name)).then(
    () => { b.textContent = "Copied"; setTimeout(() => { b.textContent = "Copy invite link"; }, 1600); },
    () => { flash = { text: "Copy didn't work: the link is in the address bar", until: performance.now() + 2500 }; });
});
if (here) saveRecent(remember(loadRecent(), { room: here.room, name: here.name, studio: here.studio, mine: false, at: Date.now() }));
// back from eqosys: the invite's room came along as `then`, so open it signed in (a fresh page, so the socket carries the token)
void eq.finishSignIn().then((back) => {
  if (back?.login) { if (back.then.startsWith("?")) location.replace(`${location.pathname}${back.then}`); else location.reload(); return; }
  if (back?.error) { const e = $("door-error"); e.hidden = false; e.textContent = back.error; }
});

function menu() { $("menu").hidden = phase === "play"; door(); people(); }
function play() { if (!here) return; phase = "play"; menu(); lock(); void startAudio(); }
$("play").addEventListener("click", play);
$("look").addEventListener("click", () => {
  look = randomAvatar(Math.random);
  try { localStorage.setItem(LOOK, JSON.stringify(look)); } catch { /* this visit only */ }
  wear();
});
mountControls({
  key: CONTROLS, pad, parent: $("controls-host"), title: "Controls", skin: "house",
  keys: [["WASD / left stick", "Walk"], ["Mouse / right stick", "Look"], ["Space / click", "Sit at a spot, stand up"], ["A to ' (seated)", "Play notes; Shift plays louder"], ["Z / X", "Octave down, up"], ["Tab (seated)", "The track's lane: patch, EQ, mixer, notes"], ["Up / down arrows (seated)", "Pitch bend"], ["[ / ] (seated)", "Mod wheel: vibrato"], ["/ (seated)", "Show or hide the keys' notes"], ["V", "Over the shoulder or first person"], ["N", "Mute the room, for you"], ["B", "Mute who you look at, for you"], ["H", "Raise your hand to play"], ["M", "Speakers up"], ["Q (standing)", "Picture quality, high or low"], ["Esc", "Let go of the mouse"]],
  onChange: (s) => { ctl = s; },
  onToggle: (open) => { if (open) document.exitPointerLock?.(); },
});

function resize() {
  const w = innerWidth, h = innerHeight;
  picture.resize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener("resize", resize);
resize();

function hint(): string {
  const s = spotOf(jam, jam.me.seat);
  if (s) {
    const n = keyNote(jam, project, "KeyA", octave);
    if (!may(player).play) return `At ${s.label}, listen only: ${rights.asked === "play" ? "your hand is up" : "H raises your hand to play"}. Space stands up`;
    if (s.kind === "drums") return `At ${s.label}: A S D F G H J K L are the drums. Space stands up, V camera`;
    if (n) return `At ${s.label}, playing ${project.tracks[n.track].name}: A to ' are notes, Z / X octave (${octave >= 0 ? "+" : ""}${octave}), arrows bend, / the keys. Space stands up, V camera`;
    return `At ${s.label}. Space stands up, V camera`;
  }
  const near = nearSpot(jam);
  return near ? `Space or click: sit at ${near.label}` : "";
}

/** The notes sounding at a spot, as `track:midi`: whoever sits there holds them. */
function soundingAt(id: string): string[] {
  if (jam.me.seat === id) return [...holding.values()].map((n) => `${n.track}:${n.midi}`);
  for (const o of jam.others.values()) if (o.seat === id) return [...o.held];
  return [];
}
/** The notes sounding at a spot as [track, midi], and its keys' own track's notes on its keyboard from `low`. */
function notesAt(s: Spot) {
  const notes = soundingAt(s.id).map((k) => k.split(":").map(Number)).filter(([tr]) => project.tracks[tr]), tr = trackFor(s, project);
  return { notes, keyed: notes.filter(([n]) => n === tr).map(([, m]) => m), low: lowC(project.tracks[tr]?.root ?? 60) };
}
/** What a seated player's fingers and sticks land on (fingers.ts): the spot's keys and the notes on them, or its kit. */
function aimAt(s: Spot): Aim | null {
  const p = played.get(s.id);
  if (!p) return null;
  const n = notesAt(s);
  return { keys: p.keys, kit: p.kit, notes: n.keyed, low: n.low };
}
/** The keys that sound go down, the drums that are hit flash. */
function showPlayed(dt: number, t: number) {
  for (const s of def.spots) {
    const p = played.get(s.id);
    if (!p) continue;
    const { notes, keyed, low } = notesAt(s);
    if (p.keys) p.keys.press(keyed, low);
    if (p.kit) {
      p.kit.hear(new Map(notes.filter(([tr]) => project.tracks[tr].kind === "drum").map(([tr, m]): [string, Part] => [`${tr}:${m}`, partOf(project.tracks[tr].name)])));
      p.kit.tick(dt, t);
    }
  }
}

// ---- the see-through keys and the pitch and mod wheels: a bend goes to your sound and the room's ----
const overlay = new Overlay((track, semis) => {
  if (semis !== 0 && !may(player).play) return;
  out?.send({ t: "bend", track, semis });
  live(bendEvent(track, semis));
});

// ---- every frame ----
let last = performance.now(), sentAt = 0, sentBody = "";
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000), t = now / 1000;
  last = now;
  const gp = pad.poll();
  if (phase === "play") {
    const k = 2.4 * dt;
    jam.me.pitch = clamp(jam.me.pitch - gp.right.y * k * ctl.lookY * (ctl.invertY ? -1 : 1), -1.2, 1.1);
    if (gp.pressed.has("sit")) sitOrStand();
    if (gp.pressed.has("cam")) toggleCam(jam);
    const on = (c: string) => (keys.has(c) && !jam.me.seat ? 1 : 0);
    step(jam, dt, { forward: on("KeyW") - on("KeyS") || -gp.left.y, right: on("KeyD") - on("KeyA") || gp.left.x, turn: -gp.right.x * k * ctl.lookX });
  }
  // your body, about 10 a second while it changes, and once a second regardless so a late arrival sees you
  const b = body(jam), bs = JSON.stringify(b);
  if (now - sentAt > 1000 / BODY_HZ && (bs !== sentBody || now - sentAt > 1000)) { live(b); sentAt = now; sentBody = bs; }
  // you: seen over your shoulder with no tag of your own, and not at all once a wall behind pulls the camera into your
  // head; in first person, your body and hands below you with no head, so you see where you'd press or strike
  const c = cameraPose(jam), first = jam.me.cam === "first";
  const player = holding.size > 0 ? [jam.me.x, jam.me.z] : [...jam.others.values()].find((o) => o.held.size > 0)?.at;
  watched = player ? new THREE.Vector3(player[0], 1, player[1]) : null;
  if (c.boom > 0.7 || first) {
    drawPerson("me", look, null, jam.me.x, jam.me.z, jam.me.yaw, spotOf(jam, jam.me.seat), holding.size > 0, dt, t, true);
    drawn.get("me")?.fig.fade(first ? 0 : c.head);
    // your own badge would hang just over the camera in first person
    if (!first) markPerson("me", marksOf(rights.me ?? undefined));
    else if (badges.has("me")) { const b = badges.get("me"); if (b?.sprite) dropBadge(b.sprite); badges.delete("me"); }
  }
  else dropPerson("me");
  for (const [peer, o] of jam.others) {
    if (!o.avatar && !o.name) continue;
    const seat = spotOf(jam, o.seat);
    drawPerson(peer, o.avatar ?? defaultAvatar(o.name), o.name, o.at[0], o.at[1], seat ? seat.yaw : o.yaw, seat, o.held.size > 0, dt, t, false);
    markPerson(peer, marksOf(peerIds[peer]));
  }
  showPlayed(dt, t);
  overlay.frame(phase === "play" && jam.me.seat ? keyMap(jam, project, octave) : null, holding.keys(), dt, t);
  hearGuitars();
  camera.position.set(...c.at);
  camera.rotation.set(c.pitch, c.yaw, 0);
  $("cross").hidden = jam.me.cam !== "first";
  $("hint").textContent = now < flash.until ? flash.text : hint();
  const hands = handsUp(lastGrants);
  const playing = [...jam.others.values()].filter((o) => o.seat).map((o) => `${o.name || "Someone"} at ${spotOf(jam, o.seat)?.label ?? o.seat}`);
  $("heard").textContent = `${status.state === "online" ? `${status.peers} in the sesh` : status.state}${playing.length ? `. ${playing.join(", ")}` : ""}${out ? "" : ". M brings the speakers up"}${mutes.room ? ". The room is muted (N)" : ""}${rights.grants && isMuted(rights.grants, rights.me ?? undefined) ? ". The leader muted you: nobody hears your notes" : ""}${hands.length && iLead() ? `. ${hands.length} hand${hands.length > 1 ? "s" : ""} up: Esc to answer` : ""}${[...plugged.keys()].map((p) => `. ${lagWords(jam.others.get(p)?.name || "Someone", lags.get(p) ?? null)}`).join("")}${myGuitar !== null ? ". Your guitar is in (I)" : ""}`;
  picture.render(camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
menu();

// ---- the harness (scripts/probe.ts HANDLES): the jam as data, and a player's moves without pointer lock ----
declare global { interface Window { qjam?: typeof harness } }
const harness = {
  state: () => ({ door: { signedIn: signedIn(), name, room: here?.room ?? null, look: lookFrom, rooms: loadRecent() }, phase, net: status.state, peers: status.peers, octave, audio: !!out, picture: picture.state(), holding: [...holding.values()], ...snapshot(jam, project),
    muted: { room: mutes.room, peers: [...mutes.peers], forEveryone: [...jam.others.keys()].filter(leaderMuted), you: !!rights.grants && isMuted(rights.grants, rights.me ?? undefined), lead: iLead() },
    grants: { me: marksOf(rights.me ?? undefined), may: may(player), asked: rights.asked, others: Object.fromEntries([...jam.others.keys()].map((p) => [p, marksOf(peerIds[p])])), hands: handsUp(lastGrants), badges: [...badges].filter(([, b]) => b.sprite).map(([id]) => id) } }),
  start: () => { if (!here) return harness.state(); phase = "play"; menu(); void startAudio(); return harness.state(); },
  walkTo: (x: number, z: number) => { const s = walkTo(jam, x, z); live(body(jam)); return s; },
  look: (yaw: number, pitch = 0) => { jam.me.yaw = yaw; jam.me.pitch = pitch; },
  sit: (id?: string) => { const a = id ? sit(jam, id) : (sitOrStand(), { ok: !!jam.me.seat }); live(body(jam)); return a; },
  stand: () => { releaseAll(); stand(jam); live(body(jam)); },
  /** Where your hands are, in metres from where you sit or stand: ahead, up off the floor, and to your right. */
  hands: () => {
    const g = drawn.get("me")?.fig.group, out: [number, number, number][] = [];
    g?.updateMatrixWorld(true);
    g?.traverse((o) => { if (o.name === "hand") { const p = g.worldToLocal(o.getWorldPosition(new THREE.Vector3())); out.push([-p.z, p.y, p.x].map((v) => Math.round(v * 100) / 100) as [number, number, number]); } });
    return out;
  },
  cam: () => { toggleCam(jam); return jam.me.cam; },
  /** The lane (Tab, seated): open or closed (left out: as it is), on a tab; then its state. */
  lane: (open?: boolean, tab?: Tab) => { if (tab && TABS.includes(tab)) lane?.setTab(tab); if (open !== undefined) (open ? lane?.open() : lane?.close()); return lane?.state() ?? null; },
  /** What shows played: each instrument's keys down (white and black indices) and how hard each drum rings, 0 to 1. */
  played: () => Object.fromEntries([...played].map(([id, p]) => [id, p.keys ? p.keys.down : p.kit?.rings()])),
  /** Play a note at your seat, as a key would (A, S, ... ; the kit's home row), for `ms` milliseconds. */
  play: (code: string, ms = 150) => { const n = keyNote(jam, project, code, octave); if (!n) return null; noteOn(`probe:${code}`, n, 0.8); setTimeout(() => noteOff(`probe:${code}`), ms); return n; },
  /** The picture quality, kept for next time: the page loads again with it. */
  quality: (q: Quality) => setQuality(q),
  /** Press (down true) or let go of a key: KeyA plays the seat's lowest note. */
  key: (code: string, down = true) => (down ? keyDown(code) : noteOff(`kb:${code}`)),
  /** Mute a peer for you (on left out: the other way round), the whole room, or (the leader) a peer for everyone. */
  mute: (peer: number, on?: boolean) => { mutePerson(peer, on); return harness.state().muted; },
  muteRoom: (on?: boolean) => { muteAll(on); return harness.state().muted; },
  muteForAll: (peer: number, on = true) => muteForAll(peer, on),
  /** Raise your hand to play (H). */
  raise: () => { raise(); return harness.state().grants; },
  /** The leader answers this peer's raised hand. */
  answer: (peer: number, yes: boolean) => { const who = peerIds[peer]; if (who) net?.grant({ t: "answer", who, yes }); },
  /** The leader sets what this peer may do (null: back to the floor's), and the floor itself. */
  grant: (peer: number, can: GrantServer["grants"]["who"][string] | null) => { const who = peerIds[peer]; if (who) net?.grant({ t: "grant", who, can }); },
  floor: (state: "free" | "held") => net?.floor(state),
  /** Plug your guitar in (the audio input) or pull it out, as I does; then where every guitar stands. */
  guitar: async () => { await guitar(); return harness.guitars(); },
  /** Your guitar's track (null: out), whose guitars are in and on which track, each call's state and each one's lag. */
  guitars: () => ({ mine: myGuitar, in: Object.fromEntries(plugged), calls: guitars?.state() ?? [], lags: Object.fromEntries(lags) }),
};
window.qjam = harness;
