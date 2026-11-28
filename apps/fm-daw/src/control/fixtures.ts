// The 3D rooms' lights as DMX fixtures (#6474): a room marks each lamp it makes with `rigLamp`, and the show desk
// finds them in the scene and sets them. Set to null, a lamp is back as the room built it.
// Structural types only, so this takes no three.
import type { Lit } from "./dmx.ts";

/** A spot light, as far as the desk needs one: pan and tilt move the point it aims at across the floor. */
export interface Lamp {
  intensity: number;
  color: { getHex(): number; getHexString(): string; setHex(hex: number): unknown };
  position: { y: number };
  target: { position: { x: number; z: number } };
}

export interface Fixture {
  name: string;
  /** Its own colour, which it keeps until the desk gives it another. */
  home: [number, number, number];
  set(lit: Lit | null): void;
  /** The light as it burns now: its share of full brightness, its colour, and the floor point it aims at. */
  seen(): { level: number; color: string; aim: [number, number] };
}

const rigged = new WeakMap<object, Fixture>();
/** A ceiling lamp as a fixture: 128 on pan and tilt is where it was built to point, either end a ceiling's height off. */
export function rigLamp(lamp: Lamp, name: string) {
  const full = lamp.intensity, hex = lamp.color.getHex(), { x, z } = lamp.target.position, reach = lamp.position.y;
  rigged.set(lamp, {
    name,
    home: [(hex >> 16) & 0xff, (hex >> 8) & 0xff, hex & 0xff],
    set(lit) {
      lamp.intensity = lit ? (full * lit.dimmer) / 255 : full;
      lamp.color.setHex(lit ? (lit.red << 16) | (lit.green << 8) | lit.blue : hex);
      lamp.target.position.x = x + (lit ? ((lit.pan - 128) / 128) * reach : 0);
      lamp.target.position.z = z + (lit ? ((lit.tilt - 128) / 128) * reach : 0);
    },
    seen: () => ({ level: full ? lamp.intensity / full : 0, color: `#${lamp.color.getHexString()}`, aim: [lamp.target.position.x, lamp.target.position.z] }),
  });
}
/** Every fixture under `scene`, in the order built: the desk's fixture 1 is the first. */
export function fixturesIn(scene: { traverse(f: (o: object) => void): void }): Fixture[] {
  const out: Fixture[] = [];
  scene.traverse((o) => { const f = rigged.get(o); if (f) out.push(f); });
  return out;
}
