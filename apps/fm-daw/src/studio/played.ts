// What playing looks like on the room's instruments: the key that sounds goes down and lights up, and the drum or cymbal
// that's hit flashes and gives (a head flexes, a cymbal rocks), both in one cool cyan that no part of the room shares (the
// shells are coral, the heads and white keys off-white, the cymbals brass), so what you hit stands out from the seat. main.ts builds
// the stage synth's keys from `layout` and hands each spot's sounding notes here every frame.
import * as THREE from "three";
import type { DrumPart } from "@rustybuns/models/drums";

/** The semitones above a keyboard's lowest C of each white key along it, and of each black key (in the order drawn), for
 *  `n` white keys; `after` is the white key each black one sits just to the right of. */
export function layout(n: number): { whites: number[]; blacks: number[]; after: number[] } {
  const steps = [0, 2, 4, 5, 7, 9, 11], whites: number[] = [], blacks: number[] = [], after: number[] = [];
  for (let i = 0; i < n; i++) {
    whites.push(Math.floor(i / 7) * 12 + steps[i % 7]);
    if ([0, 1, 3, 4, 5].includes(i % 7) && i < n - 1) { blacks.push(whites[i] + 1); after.push(i); }
  }
  return { whites, blacks, after };
}

/** The keyboard's lowest C for a track rooted at `root`: an octave under the root's own C, so the root sits in its second
 *  octave and an octave down (Z) still lands on it. */
export const lowC = (root: number) => Math.floor(root / 12) * 12 - 12;

/** The key a note presses on a keyboard from `low` (a note past either end folds in by octaves, as the nearest key of its
 *  name): a white key's index, or a black one's. */
export function keyAt(midi: number, low: number, lay: ReturnType<typeof layout>): { black: boolean; i: number } {
  const top = lay.whites[lay.whites.length - 1];
  let off = midi - low;
  while (off < 0) off += 12;
  while (off > top) off -= 12;
  const w = lay.whites.indexOf(off);
  return w >= 0 ? { black: false, i: w } : { black: true, i: Math.max(0, lay.blacks.indexOf(off)) };
}

/** The drums and cymbals the room's kit draws (@rustybuns/models/drums): kick, snare, three toms (hi and mid on the
 *  kick, the floor tom), the hats, two crashes, a ride, a splash and a china. */
export type Part = DrumPart;
/** Which part of the kit a drum track plays, by its name: a plain "tom" is the floor tom, a clap or anything unnamed
 *  falls on the snare, any other cymbal on the first crash. */
export function partOf(name: string): Part {
  const n = name.toLowerCase();
  if (/kick|bass ?drum|bd\b/.test(n)) return "kick";
  if (/hat|hh\b/.test(n)) return "hat";
  if (/ride/.test(n)) return "ride";
  if (/splash/.test(n)) return "splash";
  if (/china/.test(n)) return "china";
  if (/crash ?(2|b)\b|crash 18/.test(n)) return "crash2";
  if (/crash|cymbal/.test(n)) return "crash";
  if (/tom/.test(n)) return /hi|high|rack|\b1\b/.test(n) ? "hi" : /mid|\b2\b/.test(n) ? "mid" : "tom";
  return "snare";
}

/** How long (seconds) a hit's flash takes to fall to a third. */
export const RING = 0.25;
/** The colour of what's played: a pressed key, a struck drum or cymbal. */
export const LIT = new THREE.Color("#0a9fe0");
/** A pressed key's tip down this far (radians) about its back edge. */
const DIP = 0.12;

/** The stage synth's keys, pressed as notes sound. Each mesh's material is white and its keys' colours (`whiteRest`,
 *  `blackRest`) are their instance colours, so a pressed black key can light as brightly as a white one. */
export class Keys {
  private last = "";
  private readonly m = new THREE.Matrix4();
  private readonly r = new THREE.Matrix4();
  private readonly back = new THREE.Matrix4();
  constructor(
    private readonly white: THREE.InstancedMesh, private readonly whiteAt: [number, number, number][],
    private readonly black: THREE.InstancedMesh, private readonly blackAt: [number, number, number][],
    readonly lay: ReturnType<typeof layout>, private readonly whiteLen: number, private readonly blackLen: number,
    private readonly whiteRest = new THREE.Color(1, 1, 1), private readonly blackRest = new THREE.Color(1, 1, 1),
  ) {
    this.set(white, whiteAt, new Set(), whiteLen, whiteRest);
    this.set(black, blackAt, new Set(), blackLen, blackRest);
  }
  /** Which keys are down now: white indices and black ones. */
  down: { whites: number[]; blacks: number[] } = { whites: [], blacks: [] };
  /** Press the keys of the notes sounding now (on a keyboard from `low`), and let the rest up. */
  press(midis: Iterable<number>, low: number) {
    const whites = new Set<number>(), blacks = new Set<number>();
    for (const n of midis) { const k = keyAt(n, low, this.lay); (k.black ? blacks : whites).add(k.i); }
    const key = `${[...whites].sort()}|${[...blacks].sort()}`;
    if (key === this.last) return;
    this.last = key;
    this.down = { whites: [...whites], blacks: [...blacks] };
    this.set(this.white, this.whiteAt, whites, this.whiteLen, this.whiteRest);
    this.set(this.black, this.blackAt, blacks, this.blackLen, this.blackRest);
  }
  /** Where a finger lands on the key a note presses, in world space: on its top, a third of the way in from its near
   *  end, as the key sits now (down, if it's pressed). */
  strike(midi: number, low: number, out = new THREE.Vector3()): THREE.Vector3 {
    const k = keyAt(midi, low, this.lay), mesh = k.black ? this.black : this.white, len = k.black ? this.blackLen : this.whiteLen;
    mesh.geometry.boundingBox ?? mesh.geometry.computeBoundingBox();
    mesh.getMatrixAt(k.i, this.m);
    mesh.updateWorldMatrix(true, false);
    return out.set(0, mesh.geometry.boundingBox!.max.y, len / 2 - len / 3).applyMatrix4(this.m).applyMatrix4(mesh.matrixWorld);
  }
  /** The keyboard's turn in the world: +x up the keys, +y up off them, +z toward the player. */
  turn(out = new THREE.Quaternion()): THREE.Quaternion {
    this.white.updateWorldMatrix(true, false);
    return out.setFromRotationMatrix(this.r.extractRotation(this.white.matrixWorld));
  }
  private set(mesh: THREE.InstancedMesh, at: [number, number, number][], down: Set<number>, len: number, rest: THREE.Color) {
    at.forEach(([x, y, z], i) => {
      const d = down.has(i);
      // turned about its back edge (-z, away from the player), so its near end goes down
      this.m.makeTranslation(x, y, z - len / 2).multiply(this.r.makeRotationX(d ? DIP : 0)).multiply(this.back.makeTranslation(0, 0, len / 2));
      mesh.setMatrixAt(i, this.m);
      mesh.setColorAt(i, d ? LIT : rest);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }
}

/** One drum or cymbal of the kit: what moves on a hit, the material that flashes, and how hard it rings now. */
interface Piece { obj: THREE.Object3D; mats: { mat: THREE.MeshStandardMaterial; base: THREE.Color }[]; rz: number; k: number; cymbal: boolean; swing?: { obj: THREE.Object3D; rest: number; hit: number } }

/** The kit's drums and cymbals, each flashing cyan and giving when it's hit: the colour itself turns, not only a glow on
 *  top, so a white head under a bright lamp still shows it. */
export class Kit {
  private readonly parts = new Map<Part, Piece>();
  private held = new Set<string>();
  /** `obj` moves (a head flexes, a cymbal rocks); `mat` (or each of them), its own copy, glows. */
  add(part: Part, obj: THREE.Object3D, mat: THREE.MeshStandardMaterial | THREE.MeshStandardMaterial[], cymbal = false) {
    const mats = (Array.isArray(mat) ? mat : [mat]).map((m) => { m.emissive.copy(LIT); m.emissiveIntensity = 0; return { mat: m, base: m.color.clone() }; });
    this.parts.set(part, { obj, mats, rz: obj.rotation.z, k: 0, cymbal });
  }
  /** A beater that swings on `part`'s hit: `obj` turns about x from `rest` to `hit` (radians) and back as it rings. */
  swing(part: Part, obj: THREE.Object3D, rest: number, hit: number) {
    const p = this.parts.get(part);
    if (p) { p.swing = { obj, rest, hit }; obj.rotation.x = rest; }
  }
  /** How hard each part rings now, 0 to 1. */
  rings(): Record<string, number> { return Object.fromEntries([...this.parts].map(([p, x]) => [p, Math.round(x.k * 100) / 100])); }
  /** The notes sounding now, as `track:midi` with the part each plays: a note that wasn't sounding last frame is a hit. */
  hear(notes: Map<string, Part>) {
    for (const [n, p] of notes) if (!this.held.has(n)) this.hit(p);
    this.held = new Set(notes.keys());
  }
  /** Where a stick lands on `part`, in world space, and how hard it rings now; null for a part the kit hasn't (the kick
   *  is the foot's, so it's never a stick's). */
  strike(part: Part, out = new THREE.Vector3()): { at: THREE.Vector3; k: number; cymbal: boolean } | null {
    const p = this.parts.get(part);
    if (!p || part === "kick") return null;
    return { at: p.obj.getWorldPosition(out), k: p.k, cymbal: p.cymbal };
  }
  /** The parts a stick plays. */
  sticks(): Part[] { return [...this.parts.keys()].filter((p) => p !== "kick"); }
  hit(part: Part) { const p = this.parts.get(part); if (p) p.k = 1; }
  /** Let each ring die away by `dt` seconds; `t` the page's clock, for a cymbal's rock. */
  tick(dt: number, t: number) {
    for (const p of this.parts.values()) {
      if (p.k <= 0) continue;
      p.k = p.k < 0.01 ? 0 : p.k * Math.exp(-dt / RING);
      for (const m of p.mats) { m.mat.color.lerpColors(m.base, LIT, Math.min(1, p.k * 1.5)); m.mat.emissiveIntensity = p.k * 0.35; }
      // the beater is at the head while the hit is fresh and falls back as it dies away
      if (p.swing) p.swing.obj.rotation.x = p.swing.rest + (p.swing.hit - p.swing.rest) * Math.min(1, p.k * 1.6);
      if (p.cymbal) p.obj.rotation.z = p.rz + Math.sin(t * 38) * p.k * 0.09;
      // a head flexes in from its hoop rather than dropping: it sits a millimetre over its shell, so any drop would
      // sink it into the shell and show the shell's top instead of the flash
      else p.obj.scale.setScalar(1 - p.k * 0.06);
    }
  }
}
