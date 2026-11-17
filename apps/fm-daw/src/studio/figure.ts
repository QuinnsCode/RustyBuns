// An eqosys avatar (@rustybuns/util/avatar) in the room: @rustybuns/models' character, the same chunky figure the eqosys
// picker shows, with a name tag over it. It stands, walks, sits on the room's seats (0.48 m: its feet swing clear of the
// floor, as a toy's do), plays, beams while it holds a note, and can look at someone and nod to the beat. Feet at y 0.
import * as THREE from "three";
import type { Avatar } from "@rustybuns/util/avatar";
import { character } from "@rustybuns/models/character";

export interface Figure {
  group: THREE.Group;
  /** Pose it for this frame: walking `speed` m/s, sitting, playing, and `t` seconds since the page opened; `look` a point
   *  in the room to turn its head to, `beat` the beats since the groove started, to nod on. */
  pose(o: { speed: number; seated: boolean; playing: boolean; t: number; look?: THREE.Vector3 | null; beat?: number | null }): void;
  dispose(): void;
}

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
  return {
    group,
    pose({ speed, seated, playing, t, look = null, beat = null }) {
      c.group.position.y = seated ? SEAT - c.seat : 0;
      c.pose({ t, speed, seated, play: playing ? "keys" : null, note: playing, look, beat });
      if (tag) { c.head.getWorldPosition(at); group.worldToLocal(at); tag.position.set(0, at.y + 0.55, 0); }
    },
    dispose() {
      c.dispose();
      tag?.material.map?.dispose(); tag?.material.dispose();
    },
  };
}
