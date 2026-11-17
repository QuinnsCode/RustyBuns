// An eqosys avatar (@rustybuns/util/avatar) in the room: @rustybuns/models' character, the same chunky figure the eqosys
// picker shows, with a name tag over it. It stands, walks, sits on the room's seats (0.48 m: its feet swing clear of the
// floor, as a toy's do), plays, beams while it holds a note, and can look at someone and nod to the beat. Feet at y 0.
import * as THREE from "three";
import { clamp } from "@rustybuns/util";
import type { Avatar } from "@rustybuns/util/avatar";
import { character, type Play } from "@rustybuns/models/character";
import type { Reach, SpotKind } from "./room.ts";

export interface Figure {
  group: THREE.Group;
  /** Pose it for this frame: walking `speed` m/s, sitting, its hands on `play` (keys or sticks; null: free), `note` while
   *  one sounds, and `t` seconds since the page opened; `look` a point in the room to turn its head to, `beat` the beats
   *  since the groove started, to nod on;
   *  `reach`, seated: where its palms should be (metres ahead of the seat and up off the floor); it shifts on its seat, as
   *  a player sets a stool's height and pulls it in, so its hands land there whatever its build. `sticks`: a drumstick in
   *  each hand (sat at the kit). */
  pose(o: { speed: number; seated: boolean; play: Play | null; note: boolean; t: number; look?: THREE.Vector3 | null; beat?: number | null; reach?: Reach | null; sticks?: boolean }): void;
  /** How solid the head (and its hair and hat) is drawn, 0 to 1: your own, seen up close beside it, so you see past it. */
  fade(k: number): void;
  dispose(): void;
}

/**
 * Where a seated figure's hands are at its spot: on the keys whenever it sits at them, so you see your hands over the
 * keys before you press one; the sticks only while a drum sounds (the sticks pose strikes all the time); a bass's
 * strings while a note sounds. Anywhere else, the keys pose while a note sounds, and hands free.
 */
export function handsOn(kind: SpotKind | undefined, note: boolean): Play | null {
  if (kind === "keys") return "keys";
  if (!note) return null;
  return kind === "drums" ? "sticks" : kind === "bass" ? "strings" : "keys";
}

/** How far (metres) a figure shifts on its seat, up or down and in or back, to reach. */
export const SHIFT = 0.1;

/** A drumstick's length (metres), and how far (radians) it tips off the fist's axis: resting toward the snare and the floor tom. */
const STICK = 0.4, STICK_TILT = 0.5;

/** The top of a stool or the desk's chair in the room (room.ts builds them at 0.45, 0.06 thick). */
const SEAT = 0.48;

function nameTag(name: string): THREE.Sprite {
  const c = document.createElement("canvas");
  c.width = 256; c.height = 48;
  const g = c.getContext("2d");
  if (g) {
    g.fillStyle = "rgba(21,23,27,0.75)"; g.beginPath(); g.roundRect(0, 4, 256, 40, 12); g.fill();
    g.fillStyle = "#f4f1ea"; g.font = "600 26px 'Barlow Condensed', sans-serif"; g.textAlign = "center"; g.fillText(name.slice(0, 18), 128, 33);
  }
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false }));
  s.scale.set(0.8, 0.15, 1);
  return s;
}

/** `name` null: no tag over its head (you, seen over your own shoulder, don't need yours). */
export function figure(a: Avatar, name: string | null): Figure {
  const group = new THREE.Group(), c = character(a, { seed: name ? [...name].reduce((h, ch) => Math.imul(h, 31) + ch.charCodeAt(0), 7) >>> 0 : 1 });
  group.add(c.group);
  const tag = name === null ? null : nameTag(name || "Someone");
  if (tag) group.add(tag);
  const at = new THREE.Vector3();
  // the head's own copies of its materials, made the first time it fades (the body shares them: the hands are skin too)
  let faded: THREE.Material[] | null = null, now = 1;
  // where its palms sit in each play pose, from the seat (measured once: a build's arms don't change)
  const palms = new Map<Play, Reach>(), hands: THREE.Object3D[] = [];
  c.group.traverse((o) => { if (o.name === "hand") hands.push(o); });
  // a drumstick in each fist, out past the thumb along the grip, shown at the kit
  const wood = new THREE.MeshStandardMaterial({ color: "#d9b98a", roughness: 0.55 }), stickGeo = new THREE.CylinderGeometry(0.007, 0.01, STICK, 8);
  const sticks = hands.map((h) => {
    const m = new THREE.Mesh(stickGeo, wood);
    m.rotation.x = STICK_TILT;
    m.translateY(-STICK * 0.35);
    m.visible = false;
    h.add(m);
    return m;
  });
  const palm = (p: Play, t: number): Reach => {
    let r = palms.get(p);
    if (!r) {
      c.group.position.set(0, SEAT - c.seat, 0);
      c.pose({ t, seated: true, play: p });
      group.updateMatrixWorld(true);
      let ahead = 0, up = 0;
      for (const h of hands) { group.worldToLocal(h.getWorldPosition(at)); ahead -= at.z / hands.length; up += at.y / hands.length; }
      palms.set(p, (r = { ahead, up }));
    }
    return r;
  };
  return {
    group,
    pose({ speed, seated, play, note, t, look = null, beat = null, reach = null, sticks: holding = false }) {
      for (const m of sticks) m.visible = holding;
      const p = seated && play && reach && hands.length ? palm(play, t) : null;
      const up = p && reach ? clamp(reach.up - p.up, -SHIFT, SHIFT) : 0, ahead = p && reach ? clamp(reach.ahead - p.ahead, -SHIFT, SHIFT) : 0;
      c.group.position.set(0, seated ? SEAT - c.seat + up : 0, -ahead);
      c.pose({ t, speed, seated, play, note, look, beat });
      if (tag) { c.head.getWorldPosition(at); group.worldToLocal(at); tag.position.set(0, at.y + 0.55, 0); }
    },
    fade(k) {
      if (k === now) return;
      now = k;
      if (!faded) {
        faded = [];
        c.head.traverse((o) => {
          if (!(o instanceof THREE.Mesh) || Array.isArray(o.material)) return;
          const m: THREE.Material = o.material.clone();
          m.transparent = true;
          o.material = m;
          faded?.push(m);
        });
      }
      // see-through, it writes no depth, or its far side would hide what's behind it
      // at 0 it's gone, not a faint haze over the keys
      for (const m of faded) { m.opacity = k; m.depthWrite = k >= 1; m.visible = k > 0; }
    },
    dispose() {
      for (const m of faded ?? []) m.dispose();
      stickGeo.dispose(); wood.dispose();
      c.dispose();
      tag?.material.map?.dispose(); tag?.material.dispose();
    },
  };
}
