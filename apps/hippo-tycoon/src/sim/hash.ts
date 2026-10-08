import type { State } from "./types.ts";

/** FNV-1a over the state's integers. Positions are rounded to 1e-4 so a hash is stable across engines. */
export function hashState(s: State): number {
  let h = 0x811c9dc5;
  const mix = (n: number) => {
    let v = Math.round(n * 10000) | 0;
    for (let i = 0; i < 4; i++) { h ^= v & 0xff; h = Math.imul(h, 0x01000193); v >>>= 8; }
  };
  mix(s.tick); mix(s.rng | 0); mix(s.nextId); mix(s.spawnCd); mix(s.burst); mix(s.over ? 1 : 0);
  for (const c of s.hippos) {
    mix(c.slide); mix(c.gulp); mix(c.cooldown); mix(c.sputter); mix(c.sore);
    mix(c.flooded ? 1 : 0); mix(c.dud ? 1 : 0); mix(c.score); mix(c.bellow);
  }
  for (const d of s.drops) { mix(d.id); mix(d.kind); mix(d.x); mix(d.y); mix(d.vx); mix(d.vy); mix(d.age); }
  for (const k of s.slicks) { mix(k.id); mix(k.x); mix(k.y); mix(k.life); }
  return h >>> 0;
}
