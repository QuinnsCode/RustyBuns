// The DJ table in the jam room, as something you touch: each media deck's screen shows what's on it (here or on
// another DJ's machine: the name, tempo, key, the waveform with the playhead and the cue, time left), its jog turns
// as the record would and its ring lights while it plays, and a click or tap on its play, cue or hot cue keys
// presses them (booth.ts says where each key is on the model). Anywhere else on a deck, the mixer or the table is
// "open": the page opens the whole setup, both decks and the mixer. The page decides what a press does.
// The gear is found, not new: dust lies over the decks and the mixer, and a hand wipes it where it touches
// (deck-dust.ts), so a well-played deck shows clean prints over its keys and jog. The screens glow warm and hazy.
import * as THREE from "three";
import { clock } from "../dj/analyze.ts";
import { DECK_KEYS, deckKeyAt, type DeckView, type Press } from "../dj/booth.ts";
import type { Side } from "../dj/engine.ts";
import { dusted, dustGear, DustMask, dustUniforms, type DustUniforms, type Rim } from "./deck-dust.ts";

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
interface Gear extends Worn { side: Side; jog: THREE.Object3D | null; ring: THREE.Mesh[]; screen: CanvasRenderingContext2D | null; tex: THREE.CanvasTexture | null; drawn: string }

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
  private ray = new THREE.Raycaster();

  /** The room was built again: forget the old decks. */
  clear() { this.gear = []; this.rest = []; this.worn = []; }
  /** Something else on the DJ table (the mixer, the table itself): a click on it opens the decks. `dusty`: it wears dust a hand wipes off (the mixer). */
  addRest(o: THREE.Object3D, dusty = false) {
    this.rest.push(o);
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
    this.gear.push({ ...worn, side, jog, ring, screen, tex, drawn: "" });
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
    for (const g of this.gear) {
      g.u.dustInv.value.copy(g.group.matrixWorld).invert();
      const v = view(g.side);
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
