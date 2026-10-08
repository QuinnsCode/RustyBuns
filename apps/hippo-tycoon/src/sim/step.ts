// One 30 Hz tick, in a fixed order:
//   inputs -> hippos -> spawn -> drop physics -> chomp resolve -> effects -> clock
import { resolveGulps } from "./gulp.ts";
import { stepEffects } from "./effects.ts";
import { stepDrops } from "./physics.ts";
import { seedOf } from "./rng.ts";
import {
  BELLOW_TICKS, DEFAULT_ROUND_SECS, GULP_BACK, GULP_COOLDOWN, GULP_OUT, OVERFLOW_TICKS, SEATS,
  SLIDE_SPEED, SORE_FACTOR, SPAWN_FIRST, secs,
} from "./rules.ts";
import { spawn } from "./spawn.ts";
import type { Event, Hippo, Input, State } from "./types.ts";

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

export function newHippo(seat: number): Hippo {
  return { seat, slide: 0, gulp: -1, cooldown: 0, sputter: 0, sore: 0, flooded: false, dud: false, score: 0, bellow: 0 };
}

export function newState(seed: number, roundSecs = DEFAULT_ROUND_SECS): State {
  return {
    tick: 0, seed, rng: seedOf(seed), roundTicks: secs(roundSecs), over: false, nextId: 1,
    spawnCd: SPAWN_FIRST, burst: 0,
    hippos: Array.from({ length: SEATS }, (_, i) => newHippo(i)),
    drops: [], slicks: [],
  };
}

function driveHippo(h: Hippo, inp: Input, out: Event[]) {
  if (h.cooldown > 0) h.cooldown--;
  if (h.sputter > 0) h.sputter--;
  if (h.sore > 0) h.sore--;
  if (h.bellow > 0) h.bellow--;
  if (h.gulp >= 0 && ++h.gulp > GULP_OUT + GULP_BACK) { h.gulp = -1; h.dud = false; }

  if (h.sputter === 0) {
    const speed = SLIDE_SPEED * (h.sore > 0 ? SORE_FACTOR : 1);
    h.slide = clamp(h.slide + clamp(inp.move, -1, 1) * speed, -1, 1);
    if (inp.gulp && h.cooldown === 0 && h.gulp < 0) {
      h.gulp = 0; h.cooldown = GULP_COOLDOWN;
      h.dud = h.flooded; h.flooded = false;
      out.push({ t: "gulp", seat: h.seat });
    }
  }
  if (inp.bellow) { h.bellow = BELLOW_TICKS; out.push({ t: "bellow", seat: h.seat }); }
}

/** Advance one tick. `inputs[seat]` is that seat's input (human or bot). */
export function step(s: State, inputs: readonly Input[]): Event[] {
  const out: Event[] = [];
  if (s.over) return out;
  for (const h of s.hippos) driveHippo(h, inputs[h.seat]!, out);
  spawn(s, out);
  stepDrops(s);
  resolveGulps(s, out);
  stepEffects(s, out);
  s.tick++;
  if (s.tick === s.roundTicks - OVERFLOW_TICKS) out.push({ t: "overflow" });
  if (s.tick >= s.roundTicks) { s.over = true; out.push({ t: "end" }); }
  return out;
}
