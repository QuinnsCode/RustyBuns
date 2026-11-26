// A player's real hands (#5204): Sound Guy Simulator's skinned hands (@rustybuns/rig/hand) on the figure's wrists in
// place of the character's stub hands, and, seated at an instrument, aimed at what sounds. At the keys a finger presses
// the very key that goes down (Keys.strike), the others lifted over their neighbours, and the arm reaches there (a
// two-bone reach from the shoulder, the elbow down and out). At the kit each fist holds a stick whose tip lands on the
// drum or cymbal that flashes (Kit.strike) and lifts off it as the ring dies. Anywhere else the hands ride the wrists as
// the character poses them. With a guitar on (figure.ts hangs it), the fretting hand closes round the neck at the fret
// and the picking hand strums across the strings. At the DJ table each hand's index goes to the control it touches
// (booth-3d.ts says which), pressing it, then hovers there. Plain three.js; the page hands it the spot's keys or kit and
// the notes sounding there, or what's touched at the decks.
import { record } from "@rustybuns/util";
import * as THREE from "three";
import { FINGERS, HAND, HandSolver, PALM, SKIN_TONE, gripFor, handMesh, localQuats, placeHand, type Finger, type HandMesh, type Side, type What } from "@rustybuns/rig/hand";
import type { Play } from "@rustybuns/models/character";
import type { Keys, Kit, Part } from "./played.ts";

/** What a seated player's hands aim at: the spot's keys and the notes sounding on them (from `low`, as Keys.press), or its kit. */
export interface Aim { keys?: Keys; kit?: Kit; notes: number[]; low: number; touch?: Touch }
/** At the DJ table: where each hand's index finger goes (world space), pressed down on it or hovering, and the table's
 *  turn in the world (+x along it, +y up, +z toward the DJ). */
export interface Touch { turn: THREE.Quaternion; right: { at: THREE.Vector3; down: boolean }; left: { at: THREE.Vector3; down: boolean } }
/** A guitar being played: the model (figure.ts hangs it, standing on its end in its own frame: the neck up +y, the
 *  strings' face +z), the fret the fretting hand is at, and where the pick is across the strings (-1 to 1). */
export interface Strum { guitar: THREE.Object3D; fret: number; pick: number }

/** The guitar model's neck (@rustybuns/models/gear `guitar`, metres in its frame): the nut's height, the scale length
 *  (nut to bridge), the neck's middle off the body's face, and where the pick crosses the strings. */
export const NECK = { nut: 0.895, scale: 0.64, z: 0.004, pickY: 0.3, face: 0.03 };
/** How far the fist round the neck reaches past the grip toward the headstock with its index (metres, before the build's scale). */
const INDEX_SPAN = 0.026;
/** How far up the neck (its frame's y) a finger frets `fret`: just behind the fret wire, as a player presses. */
export const fretY = (fret: number) => NECK.nut - NECK.scale * (1 - Math.pow(2, -(Math.max(0.5, fret) - 0.4) / 12));

/** A drumstick: its length (metres), how far of it sticks out past the fist, and its radius where it's held. */
export const STICK = { length: 0.4, out: 0.33, r: 0.0085 };
/** How high a stick tip lifts off what it hit once the ring has died, and a hovering fingertip off the keys (metres). */
const LIFT = 0.17, HOVER = 0.012;
/** How fast (per second) a hand moves to where it's aimed, and a finger to its curl: quick, so a hit lands with its note. */
const MOVE = 40, CURL = 45;

const FIST: What = { kind: "cable", radius: STICK.r }, REST: What = { kind: "rest" }, NECK_GRIP: What = { kind: "cable", radius: 0.021 }, PICK: What = { kind: "plug" };
let solver: HandSolver | null = null;
const solved = new Map<string, THREE.Quaternion[]>();
/** A grip's joint turns, solved once for every figure. */
function turnsFor(w: What): THREE.Quaternion[] {
  const g = gripFor(w);
  let t = solved.get(g.key);
  if (!t) solved.set(g.key, (t = localQuats((solver ??= new HandSolver()).pose(g))));
  return t;
}

/** A finger's three curls (radians, negative toward the palm): pressing a key, and lifted over one. */
const PRESS: [number, number, number] = [-0.5, -0.6, -0.35], LIFTED: [number, number, number] = [-0.12, -0.55, -0.3];
const KNUCKLE_Y = HAND.bones[HAND.chains.index[0]].at[1];
/** A hand over the keys: the wrist a touch over the knuckles, and bent at most this far off its forearm (radians), so the
 *  wrist's skin stays inside the sleeve. */
const PITCH = -0.12, WRIST_BEND = 0.4;
/** Where a finger's tip joint sits in the hand frame (right hand; the left mirrors x) at a curl. */
function tipAt(f: Exclude<Finger, "thumb">, curl: readonly number[], out = new THREE.Vector3()) {
  const c = HAND.chains[f].map((j) => HAND.bones[j]);
  let y = KNUCKLE_Y, z = c[0].at[2], e = 0;
  for (let i = 0; i < 3; i++) { e += curl[i]; const l = Math.abs(c[i + 1].at[2] - c[i].at[2]); y += Math.sin(e) * l; z -= Math.cos(e) * l; }
  return out.set(c[0].at[0], y, z);
}
const DIGITS = FINGERS.filter((f): f is Exclude<Finger, "thumb"> => f !== "thumb");

interface Arm { side: Side; shoulder: THREE.Object3D; elbow: THREE.Object3D; wrist: THREE.Object3D; upper: number; fore: number }
interface Hand {
  arm: Arm; mesh: HandMesh; stick: THREE.Mesh;
  /** joint turns now, and the curl of each finger now (keys) */
  turns: THREE.Quaternion[]; curls: Record<Finger, number[]>;
  /** where its wrist is aimed now, world space (null: riding the character's wrist) */
  at: THREE.Vector3 | null; tip: THREE.Vector3 | null;
  /** keys: the note it last played (it stays over it, lifted); sticks: the part it last hit */
  note: number | null; part: Part | null;
  /** keys: how far the hand tips down from the keyboard's level (radians), following its forearm */
  pitch: number;
  /** sticks: the way its forearm ran last frame, wrist to elbow (world space; null before the first) */
  fore: THREE.Vector3 | null;
}

export interface Hands {
  /** After the character's own pose: playing `play` with its hands aimed at `aim` (seated at an instrument), or riding its wrists. */
  pose(o: { play: Play | null; aim: Aim | null; sticks: boolean; t: number; strum?: Strum | null }): void;
  /** Each finger's tip (world space): the right hand's, then the left's. */
  tips(): { right: Record<Finger, THREE.Vector3>; left: Record<Finger, THREE.Vector3> };
  /** Each stick's tip (world space), right then left. */
  stickTips(): [THREE.Vector3, THREE.Vector3];
  dispose(): void;
}

const v = () => new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
/** Where each arm's elbow goes (the shoulder's parent's space: +x the figure's right, +z behind it): down, out and back at the keys, more out at the kit. */
const POLE = { keys: { 1: new THREE.Vector3(0.6, -1, 0.45), [-1]: new THREE.Vector3(-0.6, -1, 0.45) }, kit: { 1: new THREE.Vector3(0.8, -1, 0.3), [-1]: new THREE.Vector3(-0.8, -1, 0.3) } } as Record<"keys" | "kit", Record<Side, THREE.Vector3>>;

/** Wear real hands on the character in `group` (`root` the character's own group, whose stub hands they replace). */
export function hands(group: THREE.Group, root: THREE.Object3D, height: number): Hands {
  const arms: Arm[] = [];
  const tones: THREE.Color[] = [];
  root.traverse((o) => {
    if (o.name !== "hand" || !o.parent?.parent?.parent) return;
    const wrist = o.parent, elbow = wrist.parent!, shoulder = elbow.parent!;
    arms.push({ side: shoulder.position.x < 0 ? -1 : 1, shoulder, elbow, wrist, upper: elbow.position.length(), fore: wrist.position.length() });
    if (o instanceof THREE.Mesh && o.material instanceof THREE.MeshStandardMaterial) tones.push(o.material.color);
  });
  // the character's hand, thumb and fingers stay (the page measures its palms from them) but aren't drawn
  for (const a of arms) for (const c of a.wrist.children) c.visible = false;
  const tone = tones[0] ?? new THREE.Color("#b57a58");
  const skin = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.58, metalness: 0, color: new THREE.Color(tone.r / SKIN_TONE.r, tone.g / SKIN_TONE.g, tone.b / SKIN_TONE.b) });
  const nail = new THREE.MeshStandardMaterial({ color: tone.clone().lerp(new THREE.Color("#f0d8d0"), 0.45), roughness: 0.35, metalness: 0 });
  const wood = new THREE.MeshStandardMaterial({ color: "#d9b98a", roughness: 0.55 });
  const stickGeo = new THREE.CylinderGeometry(0.006, 0.0095, STICK.length, 8);
  const k = Math.min(1.08, Math.max(0.9, height / 1.72));
  const list: Hand[] = arms.sort((a, b) => b.side - a.side).map((arm) => {
    const mesh = handMesh(arm.side, skin, nail), stick = new THREE.Mesh(stickGeo, wood);
    group.add(mesh.root, stick);
    stick.visible = false;
    const rest = turnsFor(REST);
    return { arm, mesh, stick, turns: rest.map((q) => q.clone()), curls: record(FINGERS, () => [...LIFTED]), at: null, tip: null, note: null, part: null, pitch: PITCH, fore: null };
  });

  const place = new THREE.Matrix4(), world = new THREE.Matrix4(), inv = new THREE.Matrix4(), basis = new THREE.Matrix4(), scale = new THREE.Vector3(k, k, k);
  const q = new THREE.Quaternion(), q2 = new THREE.Quaternion(), turn = new THREE.Quaternion();
  const a = v(), b = v(), c = v(), d = v(), goal = v(), tip = v();
  /** The character's wrist to the hand frame: fingers down the forearm, the palm toward the body, the thumb forward. */
  const onWrist = (s: Side) => new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, s), new THREE.Vector3(s, 0, 0), new THREE.Vector3(0, 1, 0));
  const wristTurn = { 1: onWrist(1), [-1]: onWrist(-1) } as Record<Side, THREE.Matrix4>;
  let last = -1;

  /** Bend the arm so its wrist lands on `target` (world space), the elbow toward `pole` (in the shoulder's parent's space). */
  const ra = v(), rb = v(), rc = v(), rd = v();
  function reach(arm: Arm, target: THREE.Vector3, pole: THREE.Vector3) {
    const parent = arm.shoulder.parent!;
    parent.updateWorldMatrix(true, false);
    const t = parent.worldToLocal(ra.copy(target)).sub(arm.shoulder.position);
    const U = arm.upper, F = arm.fore, dist = THREE.MathUtils.clamp(t.length(), Math.abs(U - F) + 0.01, U + F - 0.002);
    const bend = Math.acos(THREE.MathUtils.clamp((dist * dist - U * U - F * F) / (2 * U * F), -1, 1));
    t.normalize();
    // the wrist as the bent arm holds it, hanging; turned to point at the target, then about that line to put the elbow by the pole
    q.setFromUnitVectors(rb.set(0, -U - F * Math.cos(bend), -F * Math.sin(bend)).normalize(), t);
    const elbowAt = rc.set(0, -1, 0).applyQuaternion(q), want = rd.copy(pole).normalize();
    elbowAt.addScaledVector(t, -elbowAt.dot(t)); want.addScaledVector(t, -want.dot(t));
    if (elbowAt.lengthSq() > 1e-8 && want.lengthSq() > 1e-8) {
      elbowAt.normalize(); want.normalize();
      const ang = Math.atan2(rb.crossVectors(elbowAt, want).dot(t), elbowAt.dot(want));
      q.premultiply(q2.setFromAxisAngle(t, ang));
    }
    arm.shoulder.quaternion.copy(q);
    arm.elbow.rotation.set(bend, 0, 0);
    arm.wrist.rotation.set(0, 0, 0);
    arm.shoulder.updateMatrixWorld(true);
  }

  /** Put a hand's bones on: its wrist frame `world` (world space, no scale), its joints at `turns`. */
  function put(h: Hand, frame: THREE.Matrix4) {
    group.updateWorldMatrix(true, false);
    place.copy(inv.copy(group.matrixWorld).invert()).multiply(frame).scale(scale);
    placeHand(h.mesh, place, h.turns);
  }

  /** A finger's curl eased toward `to`, and the joint turns set from every finger's curl (the thumb keeps the rest pose's). */
  function curl(h: Hand, want: Record<Finger, readonly number[]>, e: number) {
    const rest = turnsFor(REST);
    for (const f of DIGITS) {
      const cur = h.curls[f];
      HAND.chains[f].slice(0, 3).forEach((j, i) => { cur[i] += (want[f][i] - cur[i]) * e; h.turns[j].setFromAxisAngle(a.set(1, 0, 0), cur[i]); });
    }
    for (const j of HAND.chains.thumb) h.turns[j].copy(rest[j]);
    h.turns[0].identity();
  }

  const ease = (h: Hand, key: "at" | "tip", to: THREE.Vector3, e: number) => (h[key] ? h[key]!.lerp(to, e) : (h[key] = to.clone()));

  /** How far a note's key is to the player's right (metres; negative, their left). */
  const across = (keys: Keys, n: number, low: number) => group.worldToLocal(keys.strike(n, low, a)).x;
  /** Which hand plays which notes: a key on the player's right the right hand, on their left the left, so neither reaches
   *  across the body; and if one hand has them all, the other takes the one at its end, as a player reaches with the free
   *  hand rather than stretching. Each hand's notes from its thumb side out (the right's lowest first, the left's highest). */
  function split(keys: Keys, notes: number[], low: number): Record<Side, number[]> {
    const up = [...notes].sort((x, y) => x - y), right = up.filter((n) => across(keys, n, low) >= 0), left = up.filter((n) => across(keys, n, low) < 0);
    if (!left.length && right.length > 1) left.push(right.shift()!);
    else if (!right.length && left.length > 1) right.push(left.pop()!);
    return { 1: right, [-1]: left.reverse() } as Record<Side, number[]>;
  }

  function home(keys: Keys, low: number, side: Side): number {
    let best = low, bestD = Infinity;
    for (const w of keys.lay.whites) { const gap = Math.abs(across(keys, low + w, low) - side * 0.14); if (gap < bestD) (bestD = gap), (best = low + w); }
    return best;
  }

  function onKeys(h: Hand, keys: Keys, mine: number[], low: number, eMove: number, eCurl: number) {
    keys.turn(turn);
    // palm down over the keys, the fingers sloping a touch down to them, or more, to follow a forearm coming up from a low elbow
    world.makeRotationFromQuaternion(turn).multiply(basis.makeRotationX(h.pitch));
    const side = h.arm.side;
    const press = mine[0] ?? null;
    if (press !== null) h.note = press;
    // until it plays, a hand waits over the white key a hand's width to its own side
    const note = h.note ?? home(keys, low, side);
    // the index on the first key; any other notes in this hand to whichever free finger is nearest
    const want: Record<Finger, readonly number[]> = { thumb: LIFTED, index: LIFTED, middle: LIFTED, ring: LIFTED, little: LIFTED };
    if (press !== null) want.index = PRESS;
    const lead = tipAt("index", press !== null ? PRESS : LIFTED, tip).multiplyScalar(k);
    lead.x *= side;
    keys.strike(note, low, goal);
    if (press === null) goal.addScaledVector(UP, HOVER);
    // the pad, under the tip joint by its radius, lands on the key
    goal.addScaledVector(UP, HAND.bones[HAND.tips.index].radius * k);
    const wrist = goal.sub(lead.applyMatrix4(world));
    if (mine.length > 1) {
      world.setPosition(wrist);
      for (const n of mine.slice(1)) {
        const at = keys.strike(n, low, b);
        let best: Exclude<Finger, "thumb"> = "middle", bestD = Infinity;
        for (const f of DIGITS) {
          if (want[f] === PRESS) continue;
          const dd = tipAt(f, PRESS, c).multiplyScalar(k);
          dd.x *= side;
          const gap = dd.applyMatrix4(world).distanceTo(at);
          if (gap < bestD) (bestD = gap), (best = f);
        }
        want[best] = PRESS;
      }
    }
    curl(h, want, eCurl);
    land(h, wrist, eMove);
  }

  /** A hand over something flat in `turn`'s frame (`world` its wrist's turn): the arm reaches its wrist to `wrist`, and
   *  next frame the hand tips to within a wrist's bend of its forearm's slope back toward the elbow. */
  function land(h: Hand, wrist: THREE.Vector3, eMove: number) {
    ease(h, "at", wrist, eMove);
    reach(h.arm, h.at!, POLE.keys[h.arm.side]);
    world.setPosition(h.arm.wrist.getWorldPosition(c));
    put(h, world);
    const fore = h.arm.elbow.getWorldPosition(b).sub(c).applyQuaternion(turn.invert());
    const slope = Math.atan2(-fore.y, Math.hypot(fore.z, fore.x) * Math.sign(fore.z || 1));
    // slower than the hand moves: the tip's place hangs on the tip, so close in (a mixer's filter knobs, right by the
    // body) a quick tip set the fingertip twitching 3 cm every few frames
    h.pitch += (Math.max(PITCH, slope - WRIST_BEND) - h.pitch) * eMove * 0.25;
  }

  const LIFT_ALL: Record<Finger, readonly number[]> = { thumb: LIFTED, index: LIFTED, middle: LIFTED, ring: LIFTED, little: LIFTED };
  const PRESS_INDEX: Record<Finger, readonly number[]> = { ...LIFT_ALL, index: PRESS };
  /** At the DJ table: the index on the control it touches, pressed or hovering just over it. */
  function onTouch(h: Hand, t: Touch, eMove: number, eCurl: number) {
    const p = h.arm.side > 0 ? t.right : t.left;
    turn.copy(t.turn);
    world.makeRotationFromQuaternion(turn).multiply(basis.makeRotationX(h.pitch));
    const lead = tipAt("index", p.down ? PRESS : LIFTED, tip).multiplyScalar(k);
    lead.x *= h.arm.side;
    goal.copy(p.at).addScaledVector(UP, (p.down ? 0 : HOVER * 2) + HAND.bones[HAND.tips.index].radius * k);
    curl(h, p.down ? PRESS_INDEX : LIFT_ALL, eCurl);
    land(h, goal.sub(lead.applyMatrix4(world)), eMove);
  }

  /** With a guitar on: the left hand closed round the neck at the fret, its palm behind the neck and its fingers round
   *  onto the fretboard; the right a pinch holding the pick over the strings, its palm to them, swung across them. */
  const gx = v(), gy = v(), gz = v(), gripAt = v();
  function onGuitar(h: Hand, st: Strum, eMove: number) {
    st.guitar.updateWorldMatrix(true, false);
    const m = st.guitar.matrixWorld;
    gx.setFromMatrixColumn(m, 0).normalize(); gy.setFromMatrixColumn(m, 1).normalize(); gz.setFromMatrixColumn(m, 2).normalize();
    let w: What;
    if (h.arm.side < 0) {
      // the neck runs through the fist: the palm behind it (+y to the strings' face), the fingers down round its edge
      world.makeBasis(gy, b.copy(gz).negate(), a.copy(gx).negate());
      gripAt.set(0, PALM.front - 0.021, -0.078).multiplyScalar(k).applyMatrix4(world);
      goal.set(0, fretY(st.fret) - INDEX_SPAN * k, NECK.z).applyMatrix4(m).sub(gripAt);
      w = NECK_GRIP;
    } else {
      // over the strings by the pickups, the palm to them, the fingers down the body; the pinch swings across the strings
      world.makeBasis(a.copy(gy).negate(), gz, b.copy(gx).negate());
      goal.set(0, NECK.pickY, NECK.face + 0.035 * k).applyMatrix4(m).addScaledVector(gx, -0.07 * k + st.pick * 0.045);
      w = PICK;
    }
    ease(h, "at", goal, eMove);
    reach(h.arm, h.at!, POLE.keys[h.arm.side]);
    world.setPosition(h.arm.wrist.getWorldPosition(c));
    h.turns.forEach((q, j) => q.copy(turnsFor(w)[j]));
    put(h, world);
  }

  function onKit(h: Hand, kit: Kit, eMove: number) {
    const side = h.arm.side, s = h.part ? kit.strike(h.part, b) : null;
    if (!s) { ride(h, FIST); return; }
    // the strike point: a drum a touch in from its middle toward the player, a cymbal near its edge, raised as the ring dies
    h.arm.shoulder.getWorldPosition(c);
    const toward = d.copy(c).sub(s.at).setY(0).normalize();
    goal.copy(s.at).addScaledVector(toward, s.cymbal ? 0.15 : 0.03).addScaledVector(UP, LIFT * (1 - Math.min(1, s.k * 1.3)) + 0.004);
    ease(h, "tip", goal, eMove);
    // the stick from a fist low and ahead of the shoulder to the tip, the fist's thumb side along it, turned about the stick
    // so its wrist runs down the forearm (its back up and out, before there's a forearm to follow)
    group.updateWorldMatrix(true, false);
    const fwd = a.set(0, 0, -1).transformDirection(group.matrixWorld), out = b.set(side, 0, 0).transformDirection(group.matrixWorld);
    const fist = c.addScaledVector(fwd, 0.3).addScaledVector(UP, -0.28).addScaledVector(out, 0.06);
    const dir = d.copy(h.tip!).sub(fist).normalize();
    const x = a.copy(dir).multiplyScalar(-side);
    let y: THREE.Vector3, z: THREE.Vector3;
    if (h.fore) { z = c.copy(h.fore).addScaledVector(x, -h.fore.dot(x)).normalize(); y = b.crossVectors(z, x); }
    else { y = b.addScaledVector(UP, 1.2).addScaledVector(x, -b.dot(x)).normalize(); z = c.crossVectors(x, y); }
    world.makeBasis(x, y, z);
    const grip = tip.set(0, PALM.front - STICK.r, -0.078).multiplyScalar(k).applyMatrix4(world);
    const held = goal.copy(h.tip!).addScaledVector(dir, -STICK.out);
    reach(h.arm, held.sub(grip), POLE.kit[side]);
    world.setPosition(h.arm.wrist.getWorldPosition(a));
    h.turns.forEach((t, j) => t.copy(turnsFor(FIST)[j]));
    put(h, world);
    h.fore = h.arm.elbow.getWorldPosition(h.fore ?? v()).sub(a).normalize();
    // the stick where the fist holds it now (the arm may have fallen short)
    const from = a.add(grip);
    h.stick.position.copy(from).addScaledVector(dir, STICK.out - STICK.length / 2);
    h.stick.quaternion.setFromUnitVectors(UP, dir);
    group.worldToLocal(h.stick.position);
    h.stick.quaternion.premultiply(q.setFromRotationMatrix(inv.extractRotation(group.matrixWorld)).invert());
    h.stick.visible = true;
  }

  /** The hand on the character's wrist as it posed it, closed as `w`, with a stick in it if it holds one. */
  function ride(h: Hand, w: What, sticks = false) {
    h.at = h.tip = h.fore = null;
    h.arm.wrist.updateWorldMatrix(true, false);
    world.copy(h.arm.wrist.matrixWorld);
    world.decompose(a, q, b);
    world.makeRotationFromQuaternion(q).multiply(wristTurn[h.arm.side]).setPosition(a);
    h.turns.forEach((t, j) => t.copy(turnsFor(w)[j]));
    put(h, world);
    h.stick.visible = sticks;
    if (sticks) {
      // across the fist, out past the thumb
      const dir = a.set(-h.arm.side, 0, 0).transformDirection(world), grip = b.set(0, PALM.front - STICK.r, -0.078).multiplyScalar(k).applyMatrix4(world);
      h.stick.position.copy(grip).addScaledVector(dir, STICK.out - STICK.length / 2);
      h.stick.quaternion.setFromUnitVectors(UP, dir);
      group.worldToLocal(h.stick.position);
      h.stick.quaternion.premultiply(q.setFromRotationMatrix(inv.extractRotation(group.matrixWorld)).invert());
    }
  }

  let rings: Record<string, number> = {};
  return {
    pose({ play, aim, sticks, t, strum = null }) {
      const dt = last < 0 ? 1 : Math.min(0.25, Math.max(0, t - last));
      last = t;
      const eMove = 1 - Math.exp(-dt * MOVE), eCurl = 1 - Math.exp(-dt * CURL);
      group.updateMatrixWorld(true);
      if (strum) { for (const h of list) { h.stick.visible = false; onGuitar(h, strum, eMove); } return; }
      if (aim?.touch && play === "keys") { for (const h of list) { h.stick.visible = false; onTouch(h, aim.touch, eMove, eCurl); } return; }
      if (aim?.kit && sticks) {
        // a fresh hit goes to the hand on its side, or the other if that one is still on another fresh hit
        const now = aim.kit.rings();
        for (const p of aim.kit.sticks()) {
          if ((now[p] ?? 0) <= (rings[p] ?? 0) + 0.15) continue;
          const at = aim.kit.strike(p, c)!.at;
          group.worldToLocal(at);
          let h = list.find((x) => x.arm.side === (at.x < 0 ? -1 : 1)) ?? list[0];
          if (h.part && h.part !== p && (now[h.part] ?? 0) > 0.6) h = list.find((x) => x !== h) ?? h;
          h.part = p;
        }
        rings = now;
        const parts = aim.kit.sticks();
        for (const h of list) {
          if (!h.part) h.part = parts.find((p) => { const at = aim.kit!.strike(p, c)!.at; group.worldToLocal(at); return Math.sign(at.x) === h.arm.side; }) ?? parts[0] ?? null;
          onKit(h, aim.kit, eMove);
        }
        return;
      }
      const hand = aim?.keys && play === "keys" ? split(aim.keys, aim.notes, aim.low) : null;
      for (const h of list) {
        if (aim?.keys && hand) onKeys(h, aim.keys, hand[h.arm.side], aim.low, eMove, eCurl);
        else ride(h, sticks ? FIST : REST, sticks);
      }
    },
    tips() {
      const one = (h: Hand) => record(FINGERS, (f) => h.mesh.bones[HAND.tips[f]].getWorldPosition(v()));
      group.updateMatrixWorld(true);
      return { right: one(list[0]), left: one(list[1]) };
    },
    stickTips() {
      group.updateMatrixWorld(true);
      return list.map((h) => new THREE.Vector3(0, STICK.length / 2, 0).applyMatrix4(h.stick.matrixWorld)) as [THREE.Vector3, THREE.Vector3];
    },
    dispose() {
      for (const h of list) {
        group.remove(h.mesh.root, h.stick);
        h.mesh.root.traverse((o) => { if (o instanceof THREE.Mesh && !(o instanceof THREE.SkinnedMesh)) o.geometry.dispose(); });
      }
      skin.dispose(); nail.dispose(); wood.dispose(); stickGeo.dispose();
    },
  };
}
