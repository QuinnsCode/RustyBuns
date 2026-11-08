// How the page's bot opens a round and changes it up, wrapped round bot.ts (which stays the tuner's, bit for bit with
// its Rust twin: none of this is in there). A person needs a beat to see the bell, so no opening swings before REACT:
// most rounds the bot takes that beat and comes in ("read"), some it shells up and circles first ("guard"), and now and
// then it crosses the ring at the bell and leaps in with a flying knee ("knee"). Through the fight it sometimes covers up
// after a hit, or for a spell when you are close, so its guard isn't something you only see once.
import { mulberry32 } from "@rustybuns/util";
import { atan2, cos, hypot, sin } from "./dmath.ts";
import type { Bot } from "./bot.ts";
import { ARENA, IDLE, type Fighter, type Input, type Match } from "./sim.ts";

export type Opening = "read" | "guard" | "knee";
/** The share of rounds each opening is picked for. */
export const OPENINGS: Record<Opening, number> = { read: 0.5, guard: 0.3, knee: 0.2 };
/** Ticks (60 Hz) the bot stands at the bell before it does anything: a person's reaction to a start, 0.25 to 0.55 s. */
export const REACT = { min: 15, max: 33 } as const;
/** How long a guard spell lasts (ticks), and the chances of one: right after taking a hit, or each tick you're close. */
export const COVER = { min: 40, max: 100, afterHit: 0.25, close: 0.004, closeM: 6 } as const;
/** A flying knee that hasn't landed by now is called off and the round goes on as usual. */
const KNEE_TICKS = 150;

export function opening(rnd: () => number): Opening {
  const r = rnd();
  return r < OPENINGS.read ? "read" : r < OPENINGS.read + OPENINGS.guard ? "guard" : "knee";
}

/** `inner` with a human start and a guard it sometimes keeps up. `plan` forces the opening (a harness, the tests). */
export function temper(inner: Bot, side: 0 | 1, seed: number, plan?: Opening): Bot {
  const rnd = mulberry32(seed ^ 0x5eed);
  const open = plan ?? opening(rnd);
  const wait = REACT.min + Math.floor(rnd() * (REACT.max - REACT.min + 1));
  let cover = open === "guard" ? spell(rnd) : 0, hp = -1, flip = false;
  const knee = open === "knee" ? { t: 0, thrown: false } : null;
  const tempered: Bot & { opening?: Opening } = (m) => {
    const me = m.f[side], o = m.f[side ? 0 : 1];
    const hit = hp >= 0 && me.hp < hp - 0.5;
    hp = me.hp;
    if (m.tick < wait) return IDLE;
    if (knee && knee.t >= 0) {
      const i = flyingKnee(me, o, knee);
      if (i) return i;
      knee.t = -1;
    }
    if (cover <= 0 && me.state !== "stun" && me.onGround) {
      const near = hypot(o.pos.x - me.pos.x, o.pos.z - me.pos.z) < COVER.closeM;
      if ((hit && rnd() < COVER.afterHit) || (near && rnd() < COVER.close)) cover = spell(rnd);
    }
    // Something it can't guard (off the ring, hanging, out of stamina): let the bot handle it.
    if (cover > 0 && me.onGround && !me.exhausted && me.state !== "ledge") { cover--; flip = !flip; return shell(me, o, flip); }
    cover = 0;
    return inner(m);
  };
  tempered.opening = open;
  return tempered;
}

const spell = (rnd: () => number) => COVER.min + Math.floor(rnd() * (COVER.max - COVER.min));

/** Guard up, facing them, side-stepping round them a little and backing off the edge. */
function shell(me: Fighter, o: Fighter, flip: boolean): Input {
  const dx = o.pos.x - me.pos.x, dz = o.pos.z - me.pos.z, d = hypot(dx, dz) || 1;
  const r = hypot(me.pos.x, me.pos.z), inward = r > ARENA.radius - 4 ? 0.6 : 0;
  const s = flip ? 0.35 : 0.25;
  return { ...IDLE, guard: true, mx: (-dz / d) * s - (me.pos.x / (r || 1)) * inward, mz: (dx / d) * s - (me.pos.z / (r || 1)) * inward };
}

/** The next tick of a flying knee: dash across, run in, leap, and a heavy on the way in. Null once it's thrown and
 *  landed, or called off. */
function flyingKnee(me: Fighter, o: Fighter, k: { t: number; thrown: boolean }): Input | null {
  const t = k.t++;
  if (t > KNEE_TICKS || me.state === "stun" || me.state === "ledge") return null;
  if (k.thrown) return me.state === "attack" || !me.onGround ? IDLE : null;
  const dx = o.pos.x - me.pos.x, dz = o.pos.z - me.pos.z, d = hypot(dx, dz) || 1;
  const a = atan2(dz, dx), toward = { mx: cos(a), mz: sin(a) }, reach = me.b.radius + o.b.radius;
  if (!me.onGround) {
    // In the air: the knee comes on the way in, a press then let go.
    if (me.state === "attack") { k.thrown = true; return IDLE; }
    return { ...IDLE, ...toward, heavy: !me.prev.heavy };
  }
  if (d < reach + 3.2) return { ...IDLE, ...toward, up: true }; // the leap
  if (t < 2 && d > 7 && me.stamina >= me.b.dashCost) return { ...IDLE, ...toward, dash: t === 0 };
  return { ...IDLE, ...toward };
}
