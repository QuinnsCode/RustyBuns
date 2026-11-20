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
import { defaultAvatar, drawAvatar, randomAvatar, type Avatar } from "@rustybuns/util/avatar";
import { eqosys } from "@rustybuns/util/eqosys";
import { APP, EQOSYS, SIGN_IN_FROM, eqosysAvatar } from "../account.ts";
import { follow, fromLink, inviteLink, loadRecent, remember, roomId, saveRecent, studios } from "./door.ts";
import { studioCards } from "./picker.ts";
import { apply, loopBeats, roomGain, type Live, type Op, type Project } from "../project.ts";
import { demoProject } from "../presets.ts";
import { AudioOut, CALL_SENDS, START_DB, dbToGain } from "../ui/audio.ts";
import { startMidi } from "../ui/input.ts";
import { DeskFeed, loadMsg, type HeardPlayer } from "../ui/load.ts";
import { AUXES, callStrips } from "../mixer.ts";
import { auxGear } from "../room/room.ts";
import { GearScene } from "../room/gear-scene.ts";
import { GearHands } from "./gear-hands.ts";
import { gearPlace } from "./gear-wall.ts";
import { Band } from "./band.ts";
import { LISTENS, type Listen } from "../clock.ts";
import { encodeTake } from "../take.ts";
import { b64url } from "@rustybuns/util/bytes";
import { OpusOut, webOpus, type MakeEncoder } from "./opus.ts";
import { FarSound } from "./plugin-line.ts";
import { connect, type Net, type NetStatus } from "../ui/net.ts";
import { localMe, myKey, saveLook, savedLook } from "../ui/me.ts";
import { type Answer, BODY_HZ, DRUM_KEYS, body, cameraPose, gone, hear, keyNote, nearSpot, newJam, sit, snapshot, spotOf, stand, step, toggleCam, trackFor, walkTo } from "./jam.ts";
import { figure, handsOn, type Figure } from "./figure.ts";
import type { Aim } from "./fingers.ts";
import { floorAt, keysReach, thingBox, wallPieces, type Spot } from "./room.ts";
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
import { dress, loadQuality, metreUV, saveQuality, surface, useKit, wallSurface, type Quality } from "./look.ts";
import { gearKit } from "./gear-kit.ts";
import { Keys, Kit, layout, lowC, partOf, type Part } from "./played.ts";
import { drumKit } from "@rustybuns/models/drums";
import { GuitarLine } from "./guitar-line.ts";
import { capture, guitarSettings, inputAt, inputTrack, lagWords, type Input, type Lag } from "../guitar.ts";
import { mountLane } from "./lane.tsx";
import { TABS, type LaneModel, type Tab } from "./lane-model.ts";

const CONTROLS = "qollab-studio:controls";
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
let look: Avatar = savedLook(name);
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
    const wallMat = surface(wallSurface(wall.material ?? "drywall"), wall.material ? undefined : def.colors.walls);
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
  // a seat on a riser stands on its deck, and so does what's played there
  for (const s of def.spots) { const t = thing(s); t.position.y = floorAt(def, s.at[0], s.at[1]); scene.add(t); }
  for (const p of def.props ?? []) scene.add(prop(p, surface));
  // the gear wall (gear-wall.ts): the sesh's rack, pedal wall and gear, in the gear room's frame where the studio stands it
  const g = gearPlace(def);
  gearScene.group.position.set(g.at[0], 0, g.at[1]);
  gearScene.group.rotation.y = g.yaw;
  scene.add(gearScene.group);
}
const gearScene = new GearScene();
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
    // the kit from @rustybuns/models/drums: lacquered maple shells, coated heads, chrome hardware, six cymbals of five
    // kinds turned and stamped like real bronze, the mics clipped on, and the gear a kit collects (drums.ts)
    const dk = drumKit({ shell: t.color, quality: loadQuality(), look: { steel: blackSteel, rubber: surface("rubber", "#0f1012"), vinyl: surface("tolex", "#141414"), fabric: surface("fabric", "#1e1f22") } });
    inFront.add(dk.group);
    const kit = new Kit();
    for (const p of dk.pieces) kit.add(p.part, p.obj, p.flash, p.cymbal);
    kit.swing("kick", dk.beater.obj, dk.beater.rest, dk.beater.hit);
    played.set(s.id, { kit });
    const throne = dk.throne;
    throne.rotation.y = b.turn;
    at(throne, s.at[0], 0, s.at[1]);
    // a worn rug under the kit with a darker border, so it doesn't creep on the boards
    box(2.5, 0.008, 2.1, surface("carpet", "#3a2420"), 0, 0.004, 0.2);
    box(2.2, 0.009, 1.8, surface("carpet", "#6a3a2c"), 0, 0.0045, 0.2);
    // two overheads on boom stands and every mic's cable down to the floor and across to a stage box at the glass
    const stagebox = box(0.34, 0.12, 0.16, surface("steel", "#26282c"), 0.95, 0.06, -0.9);
    const jack = (i: number): [number, number] => [-0.12 + (i % 4) * 0.08, i < 4 ? 0.03 : -0.02];
    many(new THREE.CylinderGeometry(0.011, 0.011, 0.012, 10).rotateX(Math.PI / 2), surface("metal", "#9a9da2"), [...Array(8).keys()].map((i) => [jack(i)[0], jack(i)[1], 0.083]), stagebox);
    const rubber = surface("rubber", "#0f1012");
    const cable = (pts: [number, number, number][]) => put(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(([x, y, z]) => v(x, y, z))), pts.length * 10, 0.0035, 5), rubber), 0, 0, 0);
    const plug = (i: number): [number, number, number][] => { const [x, y] = jack(i); return [[0.95 + x, 0.004, -0.78], [0.95 + x, 0.06 + y, -0.8], [0.95 + x, 0.06 + y, -0.82]]; };
    for (const [side, i] of [[-1, 6], [1, 7]] as const) {
      const foot = v(side * 1.15, 0, -0.55), top = v(foot.x, 1.5, foot.z), tip = v(side * 0.4, 1.85, -0.12), tail = top.clone().lerp(tip, -0.35);
      for (let k = 0; k < 3; k++) { const a = (k / 3) * Math.PI * 2 + 0.4; tube(0.009, v(foot.x, 0.32, foot.z), v(foot.x + Math.cos(a) * 0.3, 0.01, foot.z + Math.sin(a) * 0.3), blackSteel); }
      tube(0.011, v(foot.x, 0.02, foot.z), top, blackSteel);
      tube(0.008, tail, tip, blackSteel);
      put(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.06, 14), blackSteel), tail.x, tail.y, tail.z);
      put(new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.13, 12), surface("metal", "#a9acb0")), tip.x, tip.y - 0.07, tip.z);
      cable([[tip.x, tip.y - 0.13, tip.z], [tip.x + side * 0.05, tip.y - 0.2, tip.z], [top.x - side * 0.03, top.y - 0.1, top.z], [foot.x - side * 0.02, 0.6, foot.z], [foot.x - side * 0.05, 0.004, foot.z + 0.06],
        [foot.x * 0.6, 0.004, -0.7 + side * 0.04], ...plug(i)]);
    }
    dk.mics.forEach((m, i) => {
      const a = m.at, drop = v(a.x * 0.9, 0.004, a.z - 0.06);
      cable([[a.x, a.y, a.z], [a.x, a.y - 0.08, a.z - 0.02], [drop.x, Math.max(0.05, a.y * 0.3), drop.z], [drop.x, 0.004, drop.z - 0.05], [(drop.x + 0.95) / 2, 0.004, -0.72 + i * 0.012], ...plug(i)]);
    });
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
  if (s.kind !== "couch" && s.kind !== "booth" && s.kind !== "drums") {
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
  d.fig.group.position.set(d.x, floorAt(jam.def, d.x, d.z), d.z);
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
    out = await AudioOut.start((m) => {
      if (m.t === "tick") { transport = { abs: m.abs, synced: m.synced, late: m.late, playing: m.playing }; return; }
      // a slice of your guitar, stamped with the beat you played it on, to everyone hearing a loop late or at the desk
      if (m.t !== "sound" || m.track !== undefined || myGuitar === null) return;
      const pcm = encodeTake(m.pcm, m.rate);
      if (opusOut && !opusOut.broken) opusOut.slice(m.beat, pcm);
      else live(Band.slice(myGuitar, m.beat, pcm, b64url));
    });
    // Opus over the World when this browser has WebCodecs (a quarter of PCM's bytes), else PCM
    const opus = await webOpus();
    opusEncoder = opus?.encoder ?? null;
    if (opus) far.decodeWith(opus.decoder);
    out.send(loadMsg(project));
    deskFeed.reset(); deskSync();
    out.send(masterMsg(project));
    guitars = new GuitarLine(out.ctx, (to, line, sig) => net?.rtc(to, line, sig));
    guitars.sendsTo(out.node, CALL_SENDS, AUXES);
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
  live({ t: "on", ...n, vel, ...band.stamp() });
}
function noteOff(by: string) {
  const n = holding.get(by);
  if (!n) return;
  holding.delete(by);
  out?.send({ t: "off", ...n });
  live({ t: "off", ...n, ...band.stamp() });
}
function releaseAll() { for (const by of [...holding.keys()]) noteOff(by); }

// ---- guitars: yours out to everyone, theirs in, each through its track's amp here (src/guitar.ts) ----
let guitars: GuitarLine | null = null;
/** The track your guitar is plugged into (-1: straight in), or null while it's out. */
let myGuitar: number | null = null;
/** Your guitar's Opus encoder while it's plugged in (src/studio/opus.ts); null with no WebCodecs. */
let opusEncoder: MakeEncoder | null = null, opusOut: OpusOut | null = null;
/** Whose guitar is in, by peer, and the track it's plugged into. */
const plugged = new Map<number, number>();
/** Whose of those is a voice from the booth's mic, not a guitar; and what yours is while it's in. */
const mics = new Set<number>();
let myInput: Input = "guitar";
/** How far behind each guitar coming in is, ms (null: connecting, "failed": no way through), asked once a second. */
let lags = new Map<number, Lag>();
/** I, or the room page's button: plug your guitar (the computer's audio input) in, or pull it out. */
async function guitar() {
  if (myGuitar !== null) {
    guitars?.unplug(); myGuitar = null; live({ t: "guitar", track: null }); deskSync();
    out?.send({ t: "send", on: false, inLatency: 0 }); mySource?.disconnect(); mySource = null;
    opusOut?.close(); opusOut = null;
    return void say({ ok: false, why: `Your ${myInput} is out` });
  }
  if (!may(player).play) return void say({ ok: false, why: "Listen only: the leader hasn't let you play. H raises your hand" });
  await startAudio();
  if (!guitars) return;
  // standing in the vocal booth it's the mic, anywhere else your guitar: the same line either way
  const seat = spotOf(jam, jam.me.seat), input = inputAt(seat?.kind);
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: capture(input) });
  } catch (e) { return void say({ ok: false, why: `No ${input}: ${(e as Error).message}` }); }
  const track = inputTrack(input, project, seat && seat.kind !== "drums" ? trackFor(seat, project) : -1);
  myInput = input;
  await guitars.plugIn(stream);
  myGuitar = track;
  deskSync();
  if (opusEncoder) opusOut = new OpusOut(opusEncoder, live, () => project.bpm, () => myGuitar);
  // and into the audio thread, which cuts it into stamped slices for whoever hears the band a loop late or at the desk
  if (out) {
    mySource = out.ctx.createMediaStreamSource(stream);
    mySource.connect(out.node);
    const got: MediaTrackSettings & { latency?: number } = stream.getAudioTracks()[0]?.getSettings() ?? {};
    out.send({ t: "send", on: true, inLatency: (got.latency ?? 0) + out.ctx.baseLatency });
  }
  live({ t: "guitar", track, mic: input === "mic" || undefined });
  if (input === "mic") return void say({ ok: false, why: "Your mic is in, straight to everyone. Headphones keep the band out of it. I pulls it out" });
  say({ ok: false, why: track >= 0 ? `Your guitar is in, through ${project.tracks[track].name}'s amp. I pulls it out` : "Your guitar is in, straight (no track has an amp). I pulls it out" });
}
let mySource: MediaStreamAudioSourceNode | null = null;
/** Each guitar through its track's amp, at your mutes, where its player stands; you, where you are. */
function hearGuitars() {
  if (!guitars) return;
  guitars.listen(jam.me.x, jam.me.z, jam.me.yaw);
  // each guitar's chain at its channel on the sesh's desk: its level, and its sends into the audio thread's aux buses
  const calls = [...(myGuitar === null ? [] : [{ key: "me" as const, who: rights.me ?? undefined, track: myGuitar }]), ...[...plugged].map(([peer, track]) => ({ key: peer, who: peerIds[peer], track }))];
  callStrips(project, heardPlayers(), calls).forEach((strip, i) => guitars?.desk(calls[i].key, strip));
  // a guitar cabled through the gear wall to a cab plays through that chain, from the cab, for everyone in the sesh
  const rig = atWall.rig();
  if (myGuitar !== null) { guitars.set("me", rig?.settings ?? guitarSettings(project.tracks[myGuitar]?.amp)); if (rig) guitars.place("me", ...rig.at); }
  for (const [peer, track] of plugged) {
    const o = jam.others.get(peer);
    guitars.set(peer, rig?.settings ?? guitarSettings(project.tracks[track]?.amp));
    // a loop late or at the desk their guitar comes in stamped slices (the audio thread plays it); the call is for "now"
    guitars.level(peer, band.listen !== "now" || mutes.room || mutes.peers.has(peer) || leaderMuted(peer) ? 0 : 1);
    if (rig) guitars.place(peer, ...rig.at); else if (o) guitars.place(peer, o.at[0], o.at[1]);
  }
}
setInterval(() => { if (guitars && plugged.size) void guitars.lags().then((l) => { lags = l; }); }, 1000);

// ---- the sesh ----
let net: Net | null = null;
const live = (e: Live) => net?.live(e);
function wear() { live({ t: "wear", avatar: look, name }); live(body(jam)); if (myGuitar !== null) live({ t: "guitar", track: myGuitar, mic: myInput === "mic" || undefined }); }
function onLive(from: number, e: Live) {
  hear(jam, from, e);
  if (e.t === "wear") people();
  if (e.t === "guitar") {
    far.heard(from, e); deskSync();
    if (e.track === null) { plugged.delete(from); mics.delete(from); lags.delete(from); guitars?.stopHearing(from); }
    else { plugged.set(from, e.track); if (e.mic) mics.add(from); else mics.delete(from); guitars?.ask(from); }
    return;
  }
  if (e.t === "play" || e.t === "stop") return void playGroove(e.t === "play", false);
  // a far plugin's track: kept quiet here, its sound in slices
  if (e.t === "plugin") { far.heard(from, e); deskSync(); return; }
  if (!sounds(mutes, from, e)) return;
  if (far.heard(from, e)) return;
  for (const m of band.heard(from, e)) out?.send(m);
}

// ---- the shared clock (src/clock.ts): the leader's time, the groove and click on it, and how you hear the others ----
const wall = () => performance.timeOrigin + performance.now();
const band = new Band(() => ({ bpm: project.bpm, loopBeats: loopBeats(project) }), wall);
/** Everyone else's guitars and plugin tracks, coming in as slices (src/studio/plugin-line.ts). */
const far = new FarSound(band, (m) => out?.send(m));
/**
 * The sesh's desk beyond the tracks, as FM DAW's Mixer tab sets it (src/mixer.ts): the sound that comes here in slices
 * plays on its player's channel, and the aux 2 return plays what the sesh's gear room has cabled into it.
 */
const deskFeed = new DeskFeed((m) => out?.send(m));
const atWall = new GearHands(def, (op) => net?.studio(op));
/** The sesh's gear room as the World keeps it, kept in step by the wall's hands: what the desk reads (aux 2) and shows. */
const gearRoom = { get patch() { return atWall.room.studio.patch; } };
/**
 * Everyone with a channel on the desk here: whoever the live line plays sound for, and you while your guitar is in
 * (number 0: nothing of yours comes in, but a solo on your channel quiets the rest for you as for everyone).
 */
function heardPlayers(): HeardPlayer[] {
  const others = far.players().flatMap((peer) => { const who = peerIds[peer]; return who ? [{ peer, who, name: "" }] : []; });
  return myGuitar !== null && rights.me ? [...others, { peer: 0, who: rights.me, name: "" }] : others;
}
function deskSync() {
  deskFeed.sync(project, heardPlayers(), auxGear(gearRoom.patch).settings);
}
/** What the audio thread last said: the beat it is on, whether it follows the clock, sound that came too late, the groove. */
let transport = { abs: 0, synced: false, late: 0, playing: false };
/** Enter, or anyone's Play on the live line: the groove and its click, on the shared beat, for everyone. */
function playGroove(on: boolean, tell = true) {
  if (on && !transport.playing) { out?.send({ t: "metro", on: true }); out?.send({ t: "play", countIn: 0 }); }
  else if (!on) out?.send({ t: "stop" });
  transport.playing = on;
  if (tell) live({ t: on ? "play" : "stop" });
}
/** C: hear the others a loop late, as it comes, or (the leader) at the desk. */
function setListen(l?: Listen) {
  const ok = LISTENS.filter((x) => x !== "desk" || iLead());
  band.listen = l && ok.includes(l) ? l : ok[(ok.indexOf(band.listen) + 1) % ok.length];
  hearGuitars();
  flash = { text: band.listen === "loop" ? "Hearing the band a loop late, in time" : band.listen === "desk" ? "At the desk: the whole band 150 ms late, lined up" : "Hearing everyone as it comes", until: performance.now() + 1800 };
  return band.listen;
}
function pingLeader() {
  band.leading(!!status.floor?.host);
  const m = status.state === "online" ? band.ping() : null;
  if (m) net?.clock(m);
  setTimeout(pingLeader, band.clock.every);
}
setTimeout(pingLeader, 200);
// the audio thread's grid, from what the speakers play right now, and the slices of sound coming due
setInterval(() => {
  band.step(transport.playing);
  if (!out) return;
  const ts = out.ctx.getOutputTimestamp();
  if (ts.contextTime !== undefined && ts.performanceTime !== undefined) out.send(band.grid(ts.contextTime, performance.timeOrigin + ts.performanceTime));
  for (const m of band.due()) out.send(m, m.t === "sound" ? [m.pcm.buffer] : []);
}, 50);
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
$("guitar").addEventListener("click", () => void guitar().then(() => { $("guitar").textContent = myGuitar === null ? "Plug in your guitar" : `Unplug your ${myInput}`; }));
function onGone(from: number) {
  mutes.peers.delete(from);
  plugged.delete(from); mics.delete(from); lags.delete(from); guitars?.gone(from);
  far.gone(from); deskSync();
  // what they held lets go now, and again when it would have, for a listener a loop behind
  for (const k of jam.others.get(from)?.held ?? []) { const [track, midi] = k.split(":").map(Number); out?.send({ t: "off", track, midi }); for (const m of band.heard(from, { t: "off", track, midi, b: band.beat() })) out?.send(m); }
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
/** What you hear: the room's level (the remote's master fader, src/remote/) on the jam room's own. */
const masterMsg = (p: Project) => ({ t: "master" as const, gain: dbToGain(START_DB) * roomGain(p) });
function groove(p: Project) { const was = project.master; project = p; out?.send(loadMsg(p)); deskSync(); if (p.master !== was) out?.send(masterMsg(p)); drawMade(); lane?.refresh(); walkOver(p); }
/** The sesh's studio isn't this page's: walk into the one the leader picked (a beat later, so the leader's move goes out first). */
let movingTo: string | null = null;
function walkOver(p: Project) {
  const to = here && follow(location.origin, here, p.studio);
  if (!to || movingTo) return;
  movingTo = to;
  flash = { text: `Moving to ${studios().find((x) => x.id === p.studio)?.name ?? "another studio"}`, until: performance.now() + 2000 };
  setTimeout(() => location.replace(to), 300);
}
/** The leader moves the whole sesh to this studio; anyone else is told no (the World refuses it too). */
function moveStudio(id: string): Answer {
  if (!here) return { ok: false, why: "Not in a room" };
  if (!iLead()) return { ok: false, why: "Only the leader moves the room" };
  if (!studios().some((x) => x.id === id)) return { ok: false, why: `No studio ${id}` };
  player.edit({ t: "studio", id });
  return { ok: true };
}
/** The room's studio cards in the Esc menu: the leader's to pick, read-only for everyone else. */
function roomStudios() {
  if (!here) return;
  const lead = iLead();
  $("studios-note").textContent = lead ? "Pick one and everyone in the room walks into it." : `You're in ${def.name}. The leader picks the studio.`;
  studioCards($("studios"), studios(), here.studio, lead ? (id) => void moveStudio(id) : undefined);
}

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
  clock: () => ({ ...band.clock.state(), behindMs: band.behind() }),
  beat: () => (band.synced ? band.beat() : null),
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
  onGrants(m) { lastGrants = m; rights.grants = m.grants; peerIds = m.peers; deskSync(); rights.asked = (rights.me && m.asks[rights.me]) || null; people(); roomStudios(); },
  onRewound: back.answer,
  onStudio(m) {
    // the sesh's gear, at this studio's gear wall: a bench board read here, so aux 2 plays its circuit when it is cabled in
    atWall.onStudio(m);
    deskSync();
  },
  onRtc: (m) => void guitars?.signal(m),
  onClock(m) { const r = band.onClock(m); if (r) net?.clock(r); },
  onSnapshot(p) {
    // the room's maker seeds the sesh, in the studio its link names
    if (!p) { net?.init({ ...project, ...(here ? { studio: here.studio } : {}) }); return; }
    groove(p);
  },
  onOp(op) { groove(apply(project, op)); },
  onLive,
  onGone,
  onStatus(s) {
    // someone new came in: say who you are again, so they see you before you next move
    if (s.state === "online" && s.peers > status.peers) wear();
    // online again: ask for the sesh's gear, and which hand at the wall is yours
    if (s.state === "online" && status.state !== "online") net?.studio({ t: "drop" });
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
canvas.addEventListener("mousedown", (e) => {
  if (phase !== "play") return;
  if (lane?.isOpen()) return lane.close();
  if (!locked()) return lock();
  // at the gear wall a click is the gear's: right-click lets go of a cable
  if (e.button === 2 && !jam.me.seat) return void say(atWall.letGo());
  if (atWall.wants(jam)) return void say(atWall.click(jam));
  sitOrStand();
});
canvas.addEventListener("contextmenu", (e) => e.preventDefault());
addEventListener("mouseup", () => { atWall.turning = null; });
document.addEventListener("mousemove", (e) => {
  if (!locked()) return;
  if (atWall.turning) return atWall.drag(e.movementY);
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
  if (code === "Enter") return playGroove(!transport.playing);
  if (code === "KeyC") return void setListen();
  if (!jam.me.seat && code === "KeyF") return void say(atWall.click(jam));
  if (!jam.me.seat && code === "KeyG") return void say(atWall.letGo());
  if (!jam.me.seat && (code === "KeyQ" || code === "KeyE") && atWall.turn(code === "KeyQ" ? -1 : 1)) return;
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
  roomStudios();
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
let doorStudio = LIVE_ROOM.id;
const doorStudios = () => studioCards($("room-studio"), studios(), doorStudio, (id) => { doorStudio = id; doorStudios(); });
doorStudios();
$("make").addEventListener("submit", (e) => {
  e.preventDefault();
  const input = $("room-name"), label = input instanceof HTMLInputElement ? input.value.trim().slice(0, 40) : "";
  const studio = doorStudio;
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
  saveLook(look);
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
  const near = nearSpot(jam), gear = atWall.hint(jam);
  return gear || (near ? `Space or click: sit at ${near.label}` : "");
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
  live(bendEvent(track, semis, band.stamp()));
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
  gearScene.sync(atWall.reach(jam), atWall.aim(jam));
  overlay.frame(phase === "play" && jam.me.seat ? keyMap(jam, project, octave) : null, holding.keys(), dt, t);
  hearGuitars();
  camera.position.set(...c.at);
  camera.rotation.set(c.pitch, c.yaw, 0);
  $("cross").hidden = jam.me.cam !== "first" && !atWall.wants(jam);
  $("hint").textContent = now < flash.until ? flash.text : hint();
  const hands = handsUp(lastGrants);
  const playing = [...jam.others.values()].filter((o) => o.seat).map((o) => `${o.name || "Someone"} at ${spotOf(jam, o.seat)?.label ?? o.seat}`);
  $("heard").textContent = `${status.state === "online" ? `${status.peers} in the sesh` : status.state}${playing.length ? `. ${playing.join(", ")}` : ""}${out ? "" : ". M brings the speakers up"}${mutes.room ? ". The room is muted (N)" : ""}${rights.grants && isMuted(rights.grants, rights.me ?? undefined) ? ". The leader muted you: nobody hears your notes" : ""}${hands.length && iLead() ? `. ${hands.length} hand${hands.length > 1 ? "s" : ""} up: Esc to answer` : ""}${[...plugged.keys()].map((p) => `. ${lagWords(jam.others.get(p)?.name || "Someone", lags.get(p) ?? null, mics.has(p) ? "mic" : "guitar", band.listen === "now")}`).join("")}${myGuitar !== null ? `. Your ${myInput} is in (I)` : ""}`;
  picture.render(camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
menu();

// ---- the harness (scripts/probe.ts HANDLES): the jam as data, and a player's moves without pointer lock ----
declare global { interface Window { qjam?: typeof harness } }
const harness = {
  state: () => ({ studio: { here: pick, sesh: project.studio ?? null }, door: { signedIn: signedIn(), name, room: here?.room ?? null, look: lookFrom, rooms: loadRecent() }, phase, net: status.state, peers: status.peers, octave, audio: !!out, picture: picture.state(), holding: [...holding.values()], clock: player.clock?.() ?? null, ...snapshot(jam, project),
    muted: { room: mutes.room, peers: [...mutes.peers], forEveryone: [...jam.others.keys()].filter(leaderMuted), you: !!rights.grants && isMuted(rights.grants, rights.me ?? undefined), lead: iLead() },
    grants: { me: marksOf(rights.me ?? undefined), may: may(player), asked: rights.asked, others: Object.fromEntries([...jam.others.keys()].map((p) => [p, marksOf(peerIds[p])])), hands: handsUp(lastGrants), badges: [...badges].filter(([, b]) => b.sprite).map(([id]) => id) },
    gear: atWall.state(jam) }),
  /** At the gear wall: look straight at a box, or one of its jacks or knobs by name (from where you stand). */
  gearLook: (id: string, part?: string) => atWall.lookAt(jam, id, part),
  /** A click (F) at the gear wall: set down, plug, unplug, take a cable, pick up. */
  gearClick: () => atWall.click(jam),
  /** Let go of the cable in your hand (G). */
  gearDrop: () => atWall.letGo(),
  /** A box on the wall's floor in studio metres (x, z), to walk up to. */
  gearAt: (id: string) => atWall.at(id),
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
  guitars: () => ({ mine: myGuitar, input: myGuitar === null ? null : myInput, in: Object.fromEntries(plugged), mics: [...mics], calls: guitars?.state() ?? [], lags: Object.fromEntries(lags) }),
  /** The shared clock: whose it is, your offset to it and round trip (ms), how you hear the band, and the beat here. */
  clock: () => ({ ...band.clock.state(), beat: Math.round(band.beat() * 1000) / 1000, behindMs: band.behind(), waiting: band.waiting, transport }),
  /** How you hear the others: "loop" (a loop late), "now", or (the leader) "desk"; then the clock. */
  listen: (l: Listen) => { setListen(l); return harness.clock(); },
  /** The studio: this page's and the sesh's, and every one the picker shows; with an id, the leader moves the sesh there. */
  studio: (id?: string) => ({ ...(id ? moveStudio(id) : {}), here: pick, sesh: project.studio ?? null, lead: iLead(), studios: studios().map((x) => x.id), moving: movingTo }),
  /** The groove and its click on the shared beat, for everyone (Enter). */
  groove: (on: boolean) => { playGroove(on); return harness.clock(); },
};
window.qjam = harness;
