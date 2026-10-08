import { GOLD, SLICK_AGE, SLICK_LIFE } from "./rules.ts";
import type { Event, State } from "./types.ts";

/** Uneaten gold splatters into a slick; slicks dry up. */
export function stepEffects(s: State, out: Event[]) {
  const stale = s.drops.filter((d) => d.kind === GOLD && d.age >= SLICK_AGE);
  if (stale.length) {
    for (const d of stale) {
      s.slicks.push({ id: s.nextId++, x: d.x, y: d.y, life: SLICK_LIFE });
      out.push({ t: "slick", x: d.x, y: d.y });
    }
    s.drops = s.drops.filter((d) => !(d.kind === GOLD && d.age >= SLICK_AGE));
  }
  for (const k of s.slicks) k.life--;
  if (s.slicks.some((k) => k.life <= 0)) s.slicks = s.slicks.filter((k) => k.life > 0);
}
