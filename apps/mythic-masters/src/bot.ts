// A bot per archetype, plain enough to read: the tuner pits them against each other, and the page
// gives you one to fight. Each plays its body: the skirmisher hunts the blind spot behind a slow
// turner, the flyer keeps its distance in the air until its stamina says land, the heavies walk in.
import { mulberry32 } from "@rustybuns/util";
import { ARENA, COST, frames, IDLE, type Fighter, type Input, type Match } from "./sim.ts";

export type Bot = (m: Match) => Input;

export function bot(side: 0 | 1, seed: number): Bot {
  const rnd = mulberry32(seed);
  let hold: Partial<Input> = {}, holdFor = 0, flip = false;
  const orbit = rnd() < 0.5 ? 1 : -1;
  return (m) => {
    const me = m.f[side], o = m.f[side ? 0 : 1];
    // Buttons are edges: let go every other tick so the sim sees a press.
    flip = !flip;
    if (holdFor > 0) { holdFor--; return { ...IDLE, ...hold, ...(flip ? {} : { light: false, heavy: false, special: false, ultimate: false, dash: false, up: false }) }; }
    if (me.state === "attack" || me.state === "stun") return IDLE;
    const i: Input = { ...IDLE };
    const dx = o.pos.x - me.pos.x, dz = o.pos.z - me.pos.z, d = Math.hypot(dx, dz) || 1;
    const above = o.pos.y - me.pos.y;
    const reach = me.b.radius + o.b.radius + 1;
    const facing = (dx * Math.cos(me.yaw) + dz * Math.sin(me.yaw)) / d > 0.6;
    const goTo = (gx: number, gz: number) => {
      // Never chase past the edge.
      const gr = Math.hypot(gx, gz), cap = ARENA.radius - 2, x = gr > cap ? (gx / gr) * cap : gx, z = gr > cap ? (gz / gr) * cap : gz;
      // Stay off the edge: pull toward the middle when near it.
      const r = Math.hypot(me.pos.x, me.pos.z), edge = Math.max(0, r - (ARENA.radius - 3)) / 3;
      let vx = x - me.pos.x - (me.pos.x / (r || 1)) * edge * 6, vz = z - me.pos.z - (me.pos.z / (r || 1)) * edge * 6;
      const n = Math.hypot(vx, vz);
      if (n > 0.3) { vx /= n; vz /= n; i.mx = vx; i.mz = vz; }
    };
    const press = (k: keyof Input, frames = 2) => {
      // A dash that would end past the edge isn't worth it.
      if (k === "dash" && Math.hypot(me.pos.x + i.mx * 5, me.pos.z + i.mz * 5) > ARENA.radius - 1) return;
      hold = { ...i, [k]: true }; holdFor = frames; Object.assign(i, { [k]: !me.prev[k] });
    };
    const threat = m.shots.some((s) => s.owner !== side && Math.hypot(s.pos.x - me.pos.x, s.pos.z - me.pos.z) < 4);
    const off = me.pos.y < -0.5 || Math.hypot(me.pos.x, me.pos.z) > ARENA.radius;

    // Off the ring: get back, nothing else matters.
    if (off) { goTo(0, 0); if (me.vel.y < 1) { if (me.airJumps > 0 || me.b.air === "flight") press("up"); else { i.up = true; press("heavy"); } } return i; }

    // Anyone can swat a flyer that hovers low overhead.
    if (above > 1.2 && above < 4.5 && d < reach + 1 && rnd() < 0.5) { i.up = true; press("heavy"); return i; }

    if (threat && !me.exhausted && rnd() < (me.b.mass < 30 ? 0.08 : 0.03)) {
      const k = side ? -1 : 1; i.mx = -dz / d * k; i.mz = dx / d * k; press("dash"); return i;
    }

    switch (me.c.archetype) {
      case "skirmisher": {
        // The blind spot: just behind the target, where its slow turn can't follow. Hit when it's open
        // (back turned, winding down, stunned), get out when it isn't.
        const back = { x: o.pos.x - Math.cos(o.yaw) * (o.b.radius + 1.3), z: o.pos.z - Math.sin(o.yaw) * (o.b.radius + 1.3) };
        const behind = (dx * Math.cos(o.yaw) + dz * Math.sin(o.yaw)) / d > 0.2;
        const open = behind || o.state === "stun" || o.state === "charge" || (o.state === "attack" && !!o.act && o.t > frames(o.act.move).startup + 2);
        if (!behind && d < reach + 3 && me.stamina > me.b.dashCost * 3 && rnd() < 0.05) {
          i.mx = (-dz / d) * orbit + (dx / d) * 0.4; i.mz = (dx / d) * orbit + (dz / d) * 0.4; press("dash"); return i;
        }
        // Circle at arm's length, outside its swing, until its back is turned.
        const gap = d - (reach + 1.5);
        if (!behind && d < reach + 3) goTo(me.pos.x - (dz / d) * orbit * 3 + (dx / d) * gap, me.pos.z + (dx / d) * orbit * 3 + (dz / d) * gap);
        else goTo(back.x, back.z);
        // It turns fast enough that the swing itself aims; no need to face first.
        if (d < reach && Math.abs(above) < 2 && open) { press(o.state === "stun" && rnd() < 0.3 ? "heavy" : "light"); return i; }
        if (d < reach + 0.5 && !open && o.state === "attack" && me.stamina > me.b.dashCost * 2 && rnd() < 0.4) {
          i.mx = (-dz / d) * orbit; i.mz = (dx / d) * orbit; press("dash"); return i;
        }
        if (me.energy >= 100 && d < 8) { press("ultimate"); return i; }
        if (above > 1.5 && d > 3 && me.energy >= COST.special && rnd() < 0.12) { i.mx = 0; i.mz = 0; press("special"); return i; }
        if (d > 7 && me.energy >= COST.special && rnd() < 0.04) { i.mx = 0; i.mz = 0; press("special"); return i; }
        if (d > 9 && me.energy < COST.special && me.onGround) { i.mx = 0; i.mz = 0; i.charge = true; return i; }
        if (d > 6 && rnd() < 0.08 && me.stamina > me.b.dashCost * 3) { i.mx = dx / d; i.mz = dz / d; press("dash"); }
        return i;
      }
      case "flyer": {
        const low = me.stamina < me.b.stamina * 0.3;
        const want = 8;
        goTo(o.pos.x - (dx / d) * want, o.pos.z - (dz / d) * want);
        if (!low && me.clipped === 0 && !me.exhausted) {
          if (!me.flying) press("up");
          else if (me.pos.y < 4) i.up = true;
        } else if (me.flying) i.down = true;
        if (d < reach && facing) { press("heavy"); return i; }
        if (me.energy >= 100) { press("ultimate"); return i; }
        if (facing && me.energy >= COST.beam && rnd() < 0.05) { i.mx = dx / d; i.mz = dz / d; press("special"); return i; }
        if (facing && me.energy >= COST.special && rnd() < 0.04) { i.mx = 0; i.mz = 0; press("special"); return i; }
        if (me.onGround && me.energy < COST.beam && d > 6 && rnd() < 0.5) { i.mx = 0; i.mz = 0; i.charge = true; }
        return i;
      }
      default: {
        goTo(o.pos.x, o.pos.z);
        if (d < reach + 0.3 && facing) { press(rnd() < 0.55 ? "heavy" : "light"); return i; }
        if (me.energy >= 100) { press("ultimate"); return i; }
        if (d > 6 && facing && me.energy >= COST.beam && rnd() < 0.03) { i.mx = dx / d; i.mz = dz / d; press("special"); return i; }
        if (d > 9 && me.energy < COST.beam && rnd() < 0.5) { i.mx = 0; i.mz = 0; i.charge = true; }
        if (threat && d > 4 && rnd() < 0.5) { i.mx = 0; i.mz = 0; i.guard = true; }
        return i;
      }
    }
  };
}

/** Is `f` in the air because it chose to be? For the HUD and tests. */
export const airborne = (f: Fighter) => f.flying || !f.onGround;
