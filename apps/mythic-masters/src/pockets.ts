// Pockets: the dense places that load on their own (docs/WORLD-EXPANSION.md, step 4 of #3161). A pocket is a layout,
// walls round the ring, a roof, its own fog and its own lights, laid over a region's arena look, so a lair can be
// dark and lit by lanterns without costing the open world anything. The first is the Pine Barrens' mythic lair.
import * as THREE from "three";

export interface Pocket {
  name: string;
  /** The region whose arena look it borrows (floor, lake, colours) and whose mythic it holds. */
  region: string;
  /** Rock all round: metres out past the ring, how tall, how rough (metres the face juts in and out), and its colour. */
  walls: { out: number; height: number; jag: number; color: number };
  /** A low dome over the ring, metres above the floor at its crown. */
  roof: { height: number; color: number };
  /** Fog from `near` to `far` metres, in `color`; the sky behind it is the same colour. */
  fog: { near: number; far: number; color: number };
  /** Where the light comes from: lanterns and fires, each `flicker` 0 (steady) to 1. */
  lights: { at: [number, number, number]; color: number; power: number; flicker: number }[];
}

export const POCKETS: Record<string, Pocket> = {
  "pine-barrens-lair": {
    name: "The hollow under Leeds Point",
    region: "pine-barrens",
    walls: { out: 5, height: 12, jag: 1.4, color: 0x5a4a3a },
    roof: { height: 15, color: 0x3e3328 },
    fog: { near: 14, far: 48, color: 0x1c1a16 },
    lights: [
      { at: [-10, 4, 9], color: 0xffa04a, power: 90, flicker: 0.5 }, // a hunter's lantern left on a ledge
      { at: [-6, 3, -12], color: 0xffa04a, power: 70, flicker: 0.6 },
      { at: [12, 2.5, -4], color: 0x9fe07a, power: 60, flicker: 0.25 }, // bog-light over the black water
    ],
  },
};

/** A seeded bump for the rock: the same pocket always has the same walls. */
const bump = (a: number, b: number) => { const s = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453; return s - Math.floor(s) - 0.5; };

/** Rough rock to stand inside: faces drawn from within (BackSide), so a camera outside the walls still sees in. */
function rock(geo: THREE.BufferGeometry, jag: number, color: number) {
  const p = geo.attributes.position!;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), r = Math.hypot(x, z), k = r > 1e-3 ? 1 + (bump(Math.atan2(z, x) * 7, y * 0.6) * jag) / r : 1;
    p.setXYZ(i, x * k, y + bump(x, z) * jag * 0.3, z * k);
  }
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 1, flatShading: true, side: THREE.BackSide }));
  m.receiveShadow = true;
  return m;
}

/** Walls, roof and lights of pocket `p` round a ring of radius R, into `g`; the tick flickers the lanterns. */
export function buildPocket(g: THREE.Group, p: Pocket, R: number): (t: number) => void {
  const r = R + p.walls.out;
  const walls = rock(new THREE.CylinderGeometry(r, r + 2, p.walls.height + 2, 48, 6, true).translate(0, p.walls.height / 2 - 1, 0), p.walls.jag, p.walls.color);
  const roof = rock(new THREE.SphereGeometry(r, 48, 12, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, (p.roof.height - p.walls.height) / r, 1).translate(0, p.walls.height, 0), p.walls.jag, p.roof.color);
  g.add(walls, roof);
  const lamps = p.lights.map((l) => {
    const light = new THREE.PointLight(l.color, l.power, r * 1.6, 1.6);
    light.position.set(...l.at);
    const glow = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8), new THREE.MeshBasicMaterial({ color: l.color }));
    glow.position.copy(light.position);
    g.add(light, glow);
    return { light, base: l.power, flicker: l.flicker, phase: l.at[0] * 1.7 + l.at[2] };
  });
  return (t) => { for (const l of lamps) l.light.intensity = l.base * (1 - l.flicker * 0.25 * (1 + Math.sin(t * 9 + l.phase) * Math.sin(t * 3.1 + l.phase * 2))); };
}
