// The DJ table in the jam room, as something you touch: each media deck's screen shows what's on it (here or on
// another DJ's machine: the name, tempo, key, the waveform with the playhead and the cue, time left), its jog turns
// as the record would and its ring lights while it plays, and a click or tap on its play, cue or hot cue keys
// presses them (booth.ts says where each key is on the model). Anywhere else on a deck, the mixer or the table is
// "open": the page opens the whole setup, both decks and the mixer. The page decides what a press does.
// The gear is found, not new: dust lies over the decks and the mixer, and a hand wipes it where it touches
// (deck-dust.ts), so a well-played deck shows clean prints over its keys and jog. The screens glow warm and hazy.
// The DJ's hands (fingers.ts) go where the decks say they were touched: a press heard from the room, or a change in what
// a deck says (it starts or stops, its cue moves, its tempo, a jump in where it plays), so every page sees the same.
// The mixer's channel faders, crossfader and filter knobs move to what the DJ's mixer says (booth.ts `MixSay`), and a hand
// goes to whichever control moved: channels 1 and 2 (deck A's) and the crossfader's A side the left, the rest the right.
import * as THREE from "three";
import { clock } from "../dj/analyze.ts";
import { DECK_KEYS, deckKeyAt, mixMoved, type DeckView, type MixKey, type MixSay, type Press } from "../dj/booth.ts";
import type { Side } from "../dj/engine.ts";
import { dusted, dustGear, DustMask, dustUniforms, type DustUniforms, type Rim } from "./deck-dust.ts";
import type { Touch } from "./fingers.ts";

/** How the screens look: deck A fire, B blue, as on the decks panel. */
const INK = { bg: "#07080a", text: "#f1efe9", dim: "#8a8f98", wave: ["#ff9a3c", "#4aa8ff"], played: "#3a3d44", cue: "#ffd23c", head: "#ffffff" } as const;
/** The record's turn, revolutions a second at the deck's own rate (33 1/3 rpm). */
const RPS = 33.333 / 60;

/** Where a hand lands on the deck-cd model's top for each key (its own frame), for a press heard from the room. */
const SPOTS: Partial<Record<Press, [number, number]>> = { play: [-0.1295, 0.175], cueDown: [-0.1295, 0.13], hot1: [-0.07, -0.08], hot2: [-0.023, -0.08], hot3: [0.024, -0.08], hot4: [0.071, -0.08] };
/** The deck's crevices, where grime packs in: round the jog's rim, PLAY and CUE. */
const DECK_RIMS: Rim[] = [[0, 0.045, 0.1155], [-0.1295, 0.175, 0.0188], [-0.1295, 0.13, 0.0188]];
/** The jog's middle on the deck's top, and how far out a hand on the platter rests. */
const JOG: [number, number, number, number] = [0, 0.045, 0.055, 0.088];

/** Gear the dust lies on: its own mask and what its materials read. */
interface Worn { group: THREE.Object3D; mask: DustMask; u: DustUniforms }
interface Gear extends Worn { side: Side; jog: THREE.Object3D | null; ring: THREE.Mesh[]; screen: CanvasRenderingContext2D | null; tex: THREE.CanvasTexture | null; drawn: string; was: Was; seen: number }
/** What a deck said last frame, kept here (a view may be the deck's own, changing under it). */
interface Was { name: string | null; playing: boolean; cue: number; bpm: number | null; pos: number; any: boolean }

/** What a DJ's hand goes to on a deck: a key, the tempo fader or the jog. */
export type Reached = Press | "jog" | "tempo";
/** The mixer on the table: its moving caps where the model built them, and what its DJ last said of it. */
interface Mixer { group: THREE.Object3D; parts: Map<string, { o: THREE.Object3D; home: THREE.Vector3; turn: number }>; fader: number; cross: number; say: MixSay | null; t: number }
/** Where a mixer's EQ knobs sit back from the front, the high's first (mixer-club-4's own frame, metres), and how far
 *  left of its fader a channel's knobs are. */
const EQ_Z = [-0.134, -0.112, -0.09, -0.068], EQ_DX = -0.005;
/** How far a filter's frequency knob turns, end to end (radians): 300 degrees, 12 o'clock in the middle. */
const KNOB_TURN = (Math.PI * 5) / 3;
/** How long (seconds) a touched key is held down, and the jog; how long the hand then hovers over it before it goes back
 *  to rest on its jog's rim; and how far (seconds) a deck's place may jump before it was the jog or a seek, not time. */
const DOWN = 0.22, JOG_DOWN = 0.6, HOVER_S = 1.6, JUMP = 0.25;
/** Where a hand rests on the jog, its fingertips on the rim nearest the DJ (the deck's own frame, metres). */
const REST_AT: [number, number, number] = [0, 0.065, 0.045 + 0.088];

/** A worn copy of `group`'s top: its size from the model (gear() writes it), else a deck's. */
function wear(group: THREE.Object3D, seed: number, rims: readonly Rim[] = []): Worn {
  const size: unknown = group.userData.size;
  const [w, d] = Array.isArray(size) && typeof size[0] === "number" && typeof size[2] === "number" ? [size[0], size[2]] : DECK_KEYS.size;
  const mask = new DustMask(w, d, seed, rims);
  return { group, mask, u: dustUniforms(mask) };
}

export class BoothGear {
  private gear: Gear[] = [];
  /** The rest of the booth a click opens the decks from: the mixer, the table under it all. */
  private rest: THREE.Object3D[] = [];
  /** The rest of the booth that gathers dust: the mixer. */
  private worn: Worn[] = [];
  /** The mixer, when the table has one with moving caps. */
  private mixer: Mixer | null = null;
  private ray = new THREE.Raycaster();

  /** The room was built again: forget the old decks. */
  clear() { this.gear = []; this.rest = []; this.worn = []; this.mixer = null; }
  /** Something else on the DJ table (the mixer, the table itself): a click on it opens the decks. `dusty`: it wears dust a hand wipes off (the mixer). */
  addRest(o: THREE.Object3D, dusty = false) {
    this.rest.push(o);
    if (o.getObjectByName("part:cross")) {
      const parts = new Map(o.children.filter((c) => c.name.startsWith("part:")).map((c) => [c.name.slice(5), { o: c, home: c.position.clone(), turn: c.rotation.y }]));
      const num = (k: string, d: number) => { const v: unknown = o.userData[k]; return typeof v === "number" ? v : d; };
      this.mixer = { group: o, parts, fader: num("faderTravel", 0.06), cross: num("crossTravel", 0.045), say: null, t: -1 };
    }
    if (!dusty) return;
    const w = wear(o, 101 + this.worn.length);
    dustGear(o, w.u);
    this.worn.push(w);
  }
  /** A media deck model on the table, deck A (DJ's left) or B. */
  add(group: THREE.Object3D, side: Side) {
    const screenPart = group.getObjectByName("part:screen"), jog = group.getObjectByName("part:jog") ?? group.getObjectByName("part:platter") ?? null;
    const ring: THREE.Mesh[] = [];
    group.getObjectByName("part:ring")?.traverse((o) => { if (o instanceof THREE.Mesh) ring.push(o); });
    let screen: CanvasRenderingContext2D | null = null, tex: THREE.CanvasTexture | null = null, glass: THREE.Material | null = null;
    const worn = wear(group, 11 + side * 17, DECK_RIMS);
    const quad = screenPart?.children.find((o): o is THREE.Mesh => o instanceof THREE.Mesh);
    if (quad && typeof document !== "undefined") {
      const c = document.createElement("canvas");
      c.width = 320; c.height = 184;
      screen = c.getContext("2d");
      tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      // years of sun: the screen's glow gone warm and faded, a haze of the dust over it
      glass = quad.material = dusted(new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, color: "#f0e2c6" }), worn.u, 0.35);
    }
    dustGear(group, worn.u, glass);
    this.gear.push({ ...worn, side, jog, ring, screen, tex, drawn: "", was: { name: null, playing: false, cue: 0, bpm: null, pos: 0, any: false }, seen: -1 });
  }
  get count() { return this.gear.length; }

  /** What a click at `ndc` (-1..1 both ways; the middle when the pointer is locked) touches on the decks, or null. */
  hit(ndc: THREE.Vector2, camera: THREE.Camera): Hit | null { return this.cast(ndc, camera)?.hit ?? null; }
  /** A hand's click or tap: what it touches (as `hit`), and the dust there wiped away, for good. */
  touch(ndc: THREE.Vector2, camera: THREE.Camera): Hit | null {
    const c = this.cast(ndc, camera);
    if (c?.worn) { const jog = c.hit.key === "jog"; c.worn.mask.wipe(c.at.x, c.at.z, jog ? 4 : 3, jog ? 0.012 : 0.008); }
    return c?.hit ?? null;
  }
  /** Someone in the room pressed `press` on deck `side` (heard over the sesh): their fingertips clean that key. */
  pressed(side: Side, press: Press | "jog") {
    const g = this.gear.find((x) => x.side === side);
    if (!g) return;
    if (press === "jog") {
      const a = Math.random() * Math.PI * 2, r = JOG[2] + Math.random() * (JOG[3] - JOG[2]);
      return g.mask.wipe(JOG[0] + Math.sin(a) * r, JOG[1] + Math.cos(a) * r, 4, 0.012);
    }
    const at = SPOTS[press];
    if (at) g.mask.wipe(at[0], at[1]);
  }
  /** What each hand (deck A's, the left; B's, the right) was last touched on, and when (the page's clock, seconds). */
  private touched: [{ key: Reached | MixKey; at: number } | null, { key: Reached | MixKey; at: number } | null] = [null, null];
  /** The DJ's mixer says where its controls sit (heard from the room, or the decks here): the caps go there, and the
   *  hand on its side to the control that moved, its fingertips wiping the dust there. */
  mixed(e: MixSay, t: number) {
    const m = this.mixer;
    if (!m) return;
    const moved = mixMoved(m.say, e);
    m.say = e;
    if (!moved) return;
    this.touched[moved.hand] = { key: moved.key, at: t };
    const w = this.worn.find((x) => x.group === m.group), at = mixSpot(m, moved.key, spotAt, false);
    if (w && at) w.mask.wipe(at.x, at.z);
  }
  /** A DJ's hand went to `key` on deck `side` at `t`: heard from the room, a click here, or a deck's change. */
  reached(side: Side, key: Reached | "cueUp" | "screen" | "open", t: number) {
    if (key === "cueUp" || key === "screen" || key === "open") return;
    // the keys a deck has no model spot for are under the jog's hand: sync rides the tempo, the rest move the record
    this.touched[side] = { key: key === "sync" ? "tempo" : key === "back" || key === "fwd" || key === "seek" ? "jog" : key, at: t };
  }
  private aim: Touch = { turn: new THREE.Quaternion(), right: { at: new THREE.Vector3(), down: false }, left: { at: new THREE.Vector3(), down: false } };
  /** Where the DJ's hands go at `t`: deck A's touches the left hand, B's the right, each pressing a fresh touch, hovering
   *  over it a moment, then back on its jog's rim. Null with no decks drawn. */
  hands(t: number): Touch | null {
    if (this.gear.length < 2) return null;
    for (const g of this.gear) {
      const hand = g.side === 0 ? this.aim.left : this.aim.right, got = this.touched[g.side], ago = got ? t - got.at : Infinity;
      const key = got && ago < HOVER_S ? got.key : null;
      // a mixer control: the index on its cap (it slides under it), held down as long as a jog
      const onMix = key !== null && typeof key === "object" && this.mixer ? mixSpot(this.mixer, key, hand.at) : null;
      if (!onMix) spotOn(g.group, typeof key === "object" ? null : key, hand.at);
      hand.down = key !== null && ago < (key === "jog" || onMix ? JOG_DOWN : DOWN);
    }
    this.gear[0]!.group.getWorldQuaternion(this.aim.turn);
    return this.aim;
  }
  /** How clean each deck (A, B) and the mixer are, 0 as found to 1 wiped bare. */
  dust(): { decks: [number, number]; mixer: number | null } {
    const of = (side: Side) => { const g = this.gear.find((x) => x.side === side); return g ? round4(g.mask.clean) : 0; };
    return { decks: [of(0), of(1)], mixer: this.worn[0] ? round4(this.worn[0].mask.clean) : null };
  }

  private cast(ndc: THREE.Vector2, camera: THREE.Camera): { hit: Hit; worn: Worn | null; at: THREE.Vector3 } | null {
    if (!this.gear.length) return null;
    this.ray.setFromCamera(ndc, camera);
    const got = this.ray.intersectObjects([...this.gear.map((g) => g.group), ...this.rest], true)[0];
    if (!got || got.distance > 2.2) return null;
    const holds = (x: Worn) => { let o: THREE.Object3D | null = got.object; while (o) { if (o === x.group) return true; o = o.parent; } return false; };
    const g = this.gear.find(holds);
    const worn = g ?? this.worn.find(holds) ?? null, at = worn ? worn.group.worldToLocal(got.point.clone()) : got.point;
    if (!g) return { hit: { side: 0, key: "open" }, worn, at };
    return { hit: { side: g.side, key: deckKeyAt(at.x, at.z) ?? "open" }, worn, at };
  }

  /** Each frame: the jogs turn and the rings light by what plays; the screens redraw a few times a second. */
  frame(view: (side: Side) => DeckView | null, t: number) {
    for (const w of this.worn) w.u.dustInv.value.copy(w.group.matrixWorld).invert();
    this.slide(t);
    for (const g of this.gear) {
      g.u.dustInv.value.copy(g.group.matrixWorld).invert();
      const v = view(g.side);
      // what changed on it since last frame is a hand on it: play, the cue, the tempo, or a jump the record made
      const w = g.was;
      if (v && w.any && v.name === w.name) {
        const dt = g.seen < 0 ? 0 : t - g.seen;
        if (v.playing !== w.playing) this.reached(g.side, "play", t);
        else if (Math.abs(v.cue - w.cue) > 0.005) this.reached(g.side, "cueDown", t);
        else if (v.bpm !== null && w.bpm !== null && Math.abs(v.bpm - w.bpm) > 0.05) this.reached(g.side, "tempo", t);
        else if (Math.abs(v.pos - w.pos - (w.playing ? dt : 0)) > JUMP + dt) this.reached(g.side, "jog", t);
      }
      w.any = !!v; g.seen = t;
      if (v) { w.name = v.name; w.playing = v.playing; w.cue = v.cue; w.bpm = v.bpm; w.pos = v.pos; }
      if (g.jog) g.jog.rotation.y = v ? -(v.pos * RPS * Math.PI * 2) % (Math.PI * 2) : 0;
      for (const m of g.ring) { const mat = m.material; if (mat instanceof THREE.MeshStandardMaterial) mat.emissiveIntensity = v?.playing ? 1.4 : 0.15; }
      if (!g.screen || !g.tex) continue;
      const key = v ? `${v.name}|${v.bpm}|${v.key}|${v.playing}|${Math.round(v.pos * 8)}|${v.cue}|${v.who}` : "none";
      if (key === g.drawn) continue;
      g.drawn = key;
      drawScreen(g.screen, v, g.side, t);
      g.tex.needsUpdate = true;
    }
  }
  /** The mixer's caps ease toward what it last said (a say comes a few times a second; a cap glides between them). */
  private slide(t: number) {
    const m = this.mixer, e = m?.say;
    if (!m || !e) return;
    const k = m.t < 0 ? 1 : Math.min(1, (t - m.t) * 14);
    m.t = t;
    const ease = (a: number, b: number) => a + (b - a) * k;
    e.faders.forEach((v, i) => { const p = m.parts.get(`fader-${i + 1}`); if (p) p.o.position.z = ease(p.o.position.z, p.home.z + (0.5 - v) * m.fader); });
    const x = m.parts.get("cross");
    if (x) x.o.position.x = ease(x.o.position.x, x.home.x + (e.cross * m.cross) / 2);
    e.filters.forEach((v, i) => { const p = m.parts.get(`filter-${i + 1}`); if (p) p.o.rotation.y = ease(p.o.rotation.y, p.turn + (0.5 - v) * KNOB_TURN); });
  }
}

/** Where a hand's index goes on the mixer for `key`: a cap's top, or an EQ knob's (the mixer's own frame, or world space with `world`), into `out`. */
function mixSpot(m: Mixer, key: MixKey, out: THREE.Vector3, world = true): THREE.Vector3 | null {
  const name = "fader" in key ? `fader-${key.fader + 1}` : "cross" in key ? "cross" : "filter" in key ? `filter-${key.filter + 1}` : `fader-${key.eq + 1}`;
  const p = m.parts.get(name);
  if (!p) return null;
  if ("eq" in key) out.set(p.home.x + EQ_DX, p.home.y + 0.013, EQ_Z[key.band] ?? EQ_Z[0]!);
  else out.set(p.o.position.x, p.home.y + ("filter" in key ? 0.013 : 0.012), p.o.position.z);
  return world ? m.group.localToWorld(out) : out;
}

const spotAt = new THREE.Vector3();
/** Where a hand's index goes on a deck-cd model for `key` (null: its rest on the jog's rim), world space, into `out`. */
function spotOn(deck: THREE.Object3D, key: Reached | null, out: THREE.Vector3) {
  const part = key === "play" || key === "cueDown" ? deck.getObjectByName(key === "play" ? "part:play" : "part:cue") : key === "tempo" ? deck.getObjectByName("part:tempo") : null;
  if (part) {
    // the cap's top
    out.set(0, key === "tempo" ? 0.011 : 0.008, 0);
    part.localToWorld(out);
    return out;
  }
  const at = key && key !== "jog" && key !== "tempo" ? SPOTS[key] : null;
  // a hot cue: on its pad, up the deck's slope; the jog and the rest: on the platter's rim nearest the DJ
  if (at) spotAt.set(at[0], 0.088 + 0.004, at[1]);
  else spotAt.set(...REST_AT);
  return out.copy(deck.localToWorld(spotAt));
}

/** What a touch on the DJ table lands on: a deck's key, its jog or screen, or "open" (the rest of the table). */
export type Hit = { side: Side; key: Press | "jog" | "screen" | "open" };
const round4 = (n: number) => Math.round(n * 10000) / 10000;

/** A deck's screen: the track and who plays it on top, the waveform across the middle, tempo, key and time below. */
export function drawScreen(g: CanvasRenderingContext2D, v: DeckView | null, side: Side, _t = 0) {
  const w = g.canvas.width, h = g.canvas.height;
  g.fillStyle = INK.bg; g.fillRect(0, 0, w, h);
  g.font = "600 22px 'Barlow Condensed', sans-serif"; g.fillStyle = INK.wave[side]; g.textBaseline = "top";
  g.fillText(side ? "B" : "A", 10, 8);
  if (!v?.name) { g.fillStyle = INK.dim; g.font = "500 18px 'IBM Plex Sans', sans-serif"; g.fillText("No track: press the screen", 34, 10); return; }
  g.fillStyle = INK.text; g.font = "500 18px 'IBM Plex Sans', sans-serif";
  g.fillText(clip(g, v.name, w - 44), 34, 10);
  if (v.who) { g.fillStyle = INK.dim; g.font = "500 14px 'IBM Plex Sans', sans-serif"; g.fillText(v.who, 34, 32); }
  // the waveform: the whole track, what's played greyed, the cue a yellow line, the playhead white
  const top = 56, lane = 70, mid = top + lane / 2, at = v.len ? (v.pos / v.len) * w : 0;
  for (let i = 0; i < v.wave.length; i++) {
    const x = (i / v.wave.length) * w, a = v.wave[i]! * (lane / 2 - 2);
    g.fillStyle = x < at ? INK.played : INK.wave[side];
    g.fillRect(x, mid - a, Math.max(1, w / v.wave.length - 0.5), a * 2);
  }
  if (v.len) { g.fillStyle = INK.cue; g.fillRect((v.cue / v.len) * w - 1, top, 2, lane); }
  g.fillStyle = INK.head; g.fillRect(at - 1, top - 4, 2, lane + 8);
  g.font = "600 26px 'Barlow Condensed', sans-serif"; g.textBaseline = "alphabetic";
  g.fillStyle = INK.text; g.fillText(v.bpm ? `${v.bpm.toFixed(1)}` : "--", 10, h - 14);
  g.fillStyle = INK.dim; g.font = "500 13px 'IBM Plex Sans', sans-serif"; g.fillText("BPM", 10, h - 40);
  if (v.key) { g.fillStyle = INK.cue; g.font = "600 26px 'Barlow Condensed', sans-serif"; g.fillText(v.key, 100, h - 14); g.fillStyle = INK.dim; g.font = "500 13px 'IBM Plex Sans', sans-serif"; g.fillText("KEY", 100, h - 40); }
  g.fillStyle = v.playing ? "#3ddc84" : INK.text; g.font = "600 26px 'IBM Plex Mono', monospace"; g.textAlign = "right";
  g.fillText(`-${clock(v.len - v.pos)}`, w - 10, h - 14);
  g.textAlign = "left";
}

function clip(g: CanvasRenderingContext2D, s: string, max: number): string {
  if (g.measureText(s).width <= max) return s;
  let t = s;
  while (t.length > 1 && g.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t}…`;
}
