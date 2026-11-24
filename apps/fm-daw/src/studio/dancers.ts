// The crowd out on an open-air room's dance floor (Desert Gathering): a dozen people in front of the stacks, each their
// own look from the room's seed (so everyone in the sesh sees the same faces), facing the wall, nodding on the beat
// and bouncing a little, each a touch out of step with the next. Only drawn: you walk round them, they don't block you
// or play. `floorSpots` is pure, for the test.
import * as THREE from "three";
import { mulberry32 } from "@rustybuns/util";
import { randomAvatar } from "@rustybuns/util/avatar";
import { figure, type Figure } from "./figure.ts";
import { thingBox, type StudioDef } from "./room.ts";

/** Where `n` people stand on the floor: in front of the stacks, a pace apart, clear of every seat and what it plays. */
export function floorSpots(def: StudioDef, n: number, seed: number): { x: number; z: number; yaw: number }[] {
  const r = mulberry32(seed), out: { x: number; z: number; yaw: number }[] = [];
  const stacks = def.outdoor?.stacks ?? [];
  if (!stacks.length) return out;
  const mx = stacks.reduce((t, s) => t + s.at[0], 0) / stacks.length, mz = stacks.reduce((t, s) => t + s.at[1], 0) / stacks.length;
  const clear = (x: number, z: number) => def.spots.every((s) => { const b = thingBox(s); return Math.hypot(x - s.at[0], z - s.at[1]) > 1.2 && Math.hypot(x - b.cx, z - b.cz) > Math.max(b.hw, b.hd) + 0.8; })
    && out.every((p) => Math.hypot(p.x - x, p.z - z) > 0.85) && Math.hypot(x - def.door.at[0], z - def.door.at[1]) > 1.5;
  for (let tries = 0; out.length < n && tries < n * 40; tries++) {
    // most of them a few metres out from the booth, thinning toward the back
    const x = mx + (r() - 0.5) * 12, z = mz + 6 + r() ** 1.6 * 11;
    if (!clear(x, z)) continue;
    // facing the wall, a little turned each
    out.push({ x, z, yaw: Math.atan2(x - mx, z - mz) * 0.6 + (r() - 0.5) * 0.4 });
  }
  return out;
}

export class Dancers {
  readonly group = new THREE.Group();
  private people: { fig: Figure; at: { x: number; z: number; yaw: number }; phase: number; bounce: number }[] = [];

  constructor(def: StudioDef, n = 12) {
    const seed = (def.outdoor?.seed ?? 1) + 77, r = mulberry32(seed);
    for (const at of floorSpots(def, n, seed)) {
      const fig = figure(randomAvatar(r), null);
      fig.group.position.set(at.x, 0, at.z); fig.group.rotation.y = at.yaw;
      this.group.add(fig.group);
      this.people.push({ fig, at, phase: r() * 0.3, bounce: 0.02 + r() * 0.035 });
    }
  }

  /** This frame: `t` seconds, and the groove's `beat` (or none: they keep a slow sway of their own). */
  tick(t: number, beat: number | null) {
    for (const [i, p] of this.people.entries()) {
      if (beat === null) {
        // between tracks: standing about, weight shifting, now and then turning to the one beside them to talk
        p.fig.pose({ speed: 0, seated: false, play: null, note: false, t: t + p.phase * 3, beat: null });
        p.fig.group.position.y = 0;
        const chat = Math.max(0, Math.sin(t * 0.21 + i * 1.7) - 0.6) * 2.2; // 0 most of the time, up to about 0.9
        p.fig.group.rotation.y = p.at.yaw + 0.05 * Math.sin(t * 0.4 + p.phase * 5) + (i % 2 ? 1 : -1) * chat;
        continue;
      }
      p.fig.pose({ speed: 0, seated: false, play: null, note: false, t: t + p.phase * 3, beat: beat - p.phase });
      // a bounce on every beat, and a slow sway side to side over two bars
      p.fig.group.position.y = p.bounce * Math.abs(Math.sin(Math.PI * (beat - p.phase)));
      p.fig.group.rotation.y = p.at.yaw + 0.12 * Math.sin((Math.PI / 4) * (beat - p.phase));
    }
  }

  dispose() { for (const p of this.people) p.fig.dispose(); }
}
