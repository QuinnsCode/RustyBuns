// The DJ table in the jam room, as something you touch: each media deck's screen shows what's on it (here or on
// another DJ's machine: the name, tempo, key, the waveform with the playhead and the cue, time left), its jog turns
// as the record would and its ring lights while it plays, and a click or tap on its play, cue or hot cue keys
// presses them (booth.ts says where each key is on the model). The page decides what a press does.
import * as THREE from "three";
import { clock } from "../dj/analyze.ts";
import { deckKeyAt, type DeckView, type Press } from "../dj/booth.ts";
import type { Side } from "../dj/engine.ts";

/** How the screens look: deck A blue, B orange, as on the decks panel. */
const INK = { bg: "#07080a", text: "#f1efe9", dim: "#8a8f98", wave: ["#4aa8ff", "#ff9a3c"], played: "#3a3d44", cue: "#ffd23c", head: "#ffffff" } as const;
/** The record's turn, revolutions a second at the deck's own rate (33 1/3 rpm). */
const RPS = 33.333 / 60;

interface Gear { group: THREE.Object3D; side: Side; jog: THREE.Object3D | null; ring: THREE.Mesh[]; screen: CanvasRenderingContext2D | null; tex: THREE.CanvasTexture | null; drawn: string }

export class BoothGear {
  private gear: Gear[] = [];
  private ray = new THREE.Raycaster();

  /** The room was built again: forget the old decks. */
  clear() { this.gear = []; }
  /** A media deck model on the table, deck A (DJ's left) or B. */
  add(group: THREE.Object3D, side: Side) {
    const screenPart = group.getObjectByName("part:screen"), jog = group.getObjectByName("part:jog") ?? null;
    const ring: THREE.Mesh[] = [];
    group.getObjectByName("part:ring")?.traverse((o) => { if (o instanceof THREE.Mesh) ring.push(o); });
    let screen: CanvasRenderingContext2D | null = null, tex: THREE.CanvasTexture | null = null;
    const quad = screenPart?.children.find((o): o is THREE.Mesh => o instanceof THREE.Mesh);
    if (quad && typeof document !== "undefined") {
      const c = document.createElement("canvas");
      c.width = 320; c.height = 184;
      screen = c.getContext("2d");
      tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      quad.material = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
    }
    this.gear.push({ group, side, jog, ring, screen, tex, drawn: "" });
  }
  get count() { return this.gear.length; }

  /** What a click at `ndc` (-1..1 both ways; the middle when the pointer is locked) touches on the decks, or null. */
  hit(ndc: THREE.Vector2, camera: THREE.Camera): { side: Side; key: Press | "jog" | "screen" } | null {
    if (!this.gear.length) return null;
    this.ray.setFromCamera(ndc, camera);
    const got = this.ray.intersectObjects(this.gear.map((g) => g.group), true)[0];
    if (!got || got.distance > 2.2) return null;
    const g = this.gear.find((x) => { let o: THREE.Object3D | null = got.object; while (o) { if (o === x.group) return true; o = o.parent; } return false; });
    if (!g) return null;
    const local = g.group.worldToLocal(got.point.clone());
    const key = deckKeyAt(local.x, local.z);
    return key ? { side: g.side, key } : null;
  }

  /** Each frame: the jogs turn and the rings light by what plays; the screens redraw a few times a second. */
  frame(view: (side: Side) => DeckView | null, t: number) {
    for (const g of this.gear) {
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
