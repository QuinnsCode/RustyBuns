// The jam room's gear from @rustybuns/models, where the studio used to draw its own boxes: the bass seat's analog mono
// synth (`monosynth`, played like keys: its keys go down and light as its notes sound, played.ts's Keys) and the
// monitors, the detailed powered speakers Sound Guy Simulator rigs (`gear`), fitted to each monitor's box.
import * as THREE from "three";
import { gear, gearLook, type GearLook } from "@rustybuns/models/gear";
import { MONO_KEY_FRONT, MONO_KEY_TOP, monosynth, type MonoSynth } from "@rustybuns/models/monosynth";
import { POLY_KEY_FRONT, POLY_KINDS, polysynth, type PolyKind } from "@rustybuns/models/polysynth";
import { BOX_KEY_FRONT, bassbox } from "@rustybuns/models/bassbox";
import { Keys, layout } from "./played.ts";
import type { Reach, Spot } from "./room.ts";

/** A spot's id as a seed, so a room's bass synth grows the same for everyone. */
export const seedOf = (id: string) => [...id].reduce((h, c) => Math.imul(h, 31) + c.charCodeAt(0), 7) >>> 0;

/** How far (metres) in front of the seat the bass synth's keys start: as near as the stage synth's, in a seated reach. */
const EDGE = 0.3;
/** How far the synth sits nearer the seat than the spot's thing (a rig's box stood further out than keys need). */
const pull = (s: Spot, front = MONO_KEY_FRONT, edge = EDGE) => Math.max(0, s.thing.ahead - front - edge);
/** The box's stand goes all the way under it, so it stands further out than the mono's keys, clear of the stool. */
const BOX_EDGE = 0.42;
/** What stands at a bass seat: the big analog mono, or the little silver bass-line box. */
export type BassKind = "mono" | "box";

/** The bass seat's mono synth, on the spot's thing (pulled in toward the seat until its keys are in reach) with its keys toward the seat (+z in the thing's frame), and
 *  its keys to press. It may run a little past the spot's old box either side: the rig it replaces was narrower. */
export function bassSynth(s: Spot, kind: BassKind = "mono"): { synth: MonoSynth; keys: Keys } {
  const box = kind === "box", synth = box ? bassbox(seedOf(s.id), { keyTop: MONO_KEY_TOP }) : monosynth(seedOf(s.id), { fit: s.thing.w + 0.12 }), k = synth.keys;
  synth.group.position.z = box ? pull(s, BOX_KEY_FRONT, BOX_EDGE) : pull(s);
  const keys = new Keys(k.white, k.whiteAt, k.black, k.blackAt, layout(k.whites), k.whiteLen, k.blackLen, k.whiteRest, k.blackRest);
  return { synth, keys };
}

/**
 * The keys seat's synth (@rustybuns/models/polysynth): a classic 61-key poly, FM slab or drawbar organ, picked by the
 * spot's id (or `kind`), its white keys where the stage synth's were (their top 2.2 cm over the spot's thing, their near
 * edge 0.43 of its depth toward the seat), so `keysReach` still puts a seated player's palms on them.
 */
export function keysSynth(s: Spot, kind?: PolyKind): { synth: MonoSynth & { kind: PolyKind }; keys: Keys } {
  const t = s.thing, synth = polysynth(seedOf(s.id), { fit: t.w + 0.1, keyTop: t.h + 0.022, kind: keysKind(s, kind) }), k = synth.keys;
  synth.group.position.z = t.d * 0.43 - POLY_KEY_FRONT;
  return { synth, keys: new Keys(k.white, k.whiteAt, k.black, k.blackAt, layout(k.whites), k.whiteLen, k.blackLen, k.whiteRest, k.blackRest) };
}

/** A made instrument's family: an FM voice grows as the FM slab, the tine piano, the drawbar or the combo organ, an
 *  analog one as the poly or the string machine, the seed picking which (the same for everyone in the sesh). */
export function madeKind(voice: "fm" | "analog", seed: number): PolyKind {
  const of: readonly PolyKind[] = voice === "fm" ? ["fm-slab", "tine-ep", "drawbar", "combo"] : ["wood-poly", "strings"];
  return of[(seed >>> 0) % of.length]!;
}

/** Which family stands at a keys seat: the one asked for, else the spot's id picks (the same for everyone in the room). */
export const keysKind = (s: Spot, asked?: PolyKind): PolyKind => asked ?? POLY_KINDS[seedOf(s.id) % POLY_KINDS.length]!;

/** Where a seated player's palms go at the bass synth: just over the near half of its white keys (as `keysReach`). */
export function bassReach(s: Spot, kind: BassKind = "mono"): Reach | null {
  if (s.kind !== "bass") return null;
  // the box's buttons are short: the palms go over them nearer their front edge
  if (kind === "box") return { ahead: s.thing.ahead - pull(s, BOX_KEY_FRONT, BOX_EDGE) - BOX_KEY_FRONT + 0.03, up: MONO_KEY_TOP + 0.06 };
  return { ahead: s.thing.ahead - pull(s) - MONO_KEY_FRONT + 0.07, up: MONO_KEY_TOP + 0.06 };
}

/** A monitor `w` x `h` x `d` (metres), its front toward -z as a prop's is: a powered fill speaker for a small one, a
 *  passive 15" top for a big one, each at its own proportions as large as the box lets it, on a plinth up
 *  to the box's height. `paint` is the cabinet (a wood the room picked). */
export function speaker(w: number, h: number, d: number, paint?: THREE.Material): THREE.Group {
  const look: GearLook = gearLook();
  if (paint) look.paint = look.shell = paint;
  const id = h > 0.7 ? "top-15-passive" : "fill-8-powered", model = gear(id, { look });
  const bounds = new THREE.Box3().setFromObject(model), size = bounds.getSize(new THREE.Vector3());
  const k = Math.min(w / size.x, d / size.z, h / size.y), lift = h - size.y * k;
  model.scale.setScalar(k);
  model.position.y = lift - bounds.min.y * k;
  model.rotation.y = Math.PI;
  const g = new THREE.Group();
  g.add(model);
  if (lift > 0.001) {
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(size.x * k, lift, size.z * k), look.paint);
    plinth.position.y = lift / 2;
    g.add(plinth);
  }
  return g;
}
