// A bot per archetype, plain enough to read: the tuner pits them against each other, and the page
// gives you one to fight. Each plays its body: the skirmisher hunts the blind spot behind a slow
// turner, the flyer keeps its distance in the air, saves for its beam and dives on what's below until its
// stamina says land, the heavies walk in (the tank guards what it sees coming).
import { mulberry32 } from "@rustybuns/util";
import { typeMul } from "./fields.ts";
import { ARENA, COST, DIVE, frames, HZ, IDLE, ROUND_TICKS, type Fighter, type Input, type Match } from "./sim.ts";

export type Bot = (m: Match) => Input;

export function bot(side: 0 | 1, seed: number): Bot {
  const rnd = mulberry32(seed);
  let hold: Partial<Input> = {}, holdFor = 0, flip = false, turn = 120, rest = 0, dir = rnd() < 0.5 ? 1 : -1;
  const orbit = rnd() < 0.5 ? 1 : -1;
  // A bot's jumps are full jumps: it keeps jump held while it rises (a tap would be a short hop).
  return (m) => { const i = think(m), me = m.f[side]; return me.hop && me.prev.up ? { ...i, up: true } : i; };
  function think(m: Match): Input {
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
    if (off) {
      goTo(0, 0);
      // A light body dashes in the air too, and a hit sends it far: dash back while that still lands on the ring.
      if (me.b.mass < 30 && me.pos.y > 0 && !me.exhausted && me.stamina >= me.b.dashCost) { press("dash"); if (i.dash) return i; }
      // A flyer only flies back with its wings whole and stamina left; otherwise it climbs like anyone else.
      const canFly = me.b.air === "flight" && me.clipped === 0 && !me.exhausted;
      if (me.flying) i.up = true;
      else if (me.vel.y < 1) { if (me.airJumps > 0 || canFly) press("up"); else if (me.rise) { i.up = true; press("heavy"); } }
      return i;
    }

    // A dive is telegraphed: meet it with the launcher if that comes out in time, else guard it.
    if (o.act?.dive && me.state === "guard") { i.guard = true; return i; }
    if (o.act?.dive && me.onGround && d < reach + 4 && rnd() < 0.5) {
      if (frames(me.moves.launcher).startup <= DIVE.tuck + 6 || me.exhausted) { i.up = true; press("heavy"); return i; }
      i.guard = true; return i;
    }

    // Anyone can swat a flyer that hovers low overhead.
    if (above > 1.2 && above < 4.5 && d < reach + 1 && rnd() < 0.5) { i.up = true; press("heavy"); return i; }

    if (threat && !me.exhausted && rnd() < (me.b.mass < 30 ? 0.08 : 0.03)) {
      const k = side ? -1 : 1; i.mx = -dz / d * k; i.mz = dx / d * k; press("dash"); return i;
    }

    switch (me.c.archetype) {
      case "skirmisher": {
        // The blind spot: beside or behind the target, where its slow turn can't follow. Hit when it's open
        // (level with it or behind, winding down, stunned), get out when it isn't.
        const back = { x: o.pos.x - Math.cos(o.yaw) * (o.b.radius + 1.3), z: o.pos.z - Math.sin(o.yaw) * (o.b.radius + 1.3) };
        const behind = (dx * Math.cos(o.yaw) + dz * Math.sin(o.yaw)) / d > 0;
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
        // Keep its distance on the far side from the edge: hover between the target and the middle. Behind
        // on the clock late in the round, that loses on time: close in.
        const late = m.tick > ROUND_TICKS - 40 * HZ && me.hp / me.b.hp < o.hp / o.b.hp;
        const want = late ? 2 : 8, r = Math.hypot(o.pos.x, o.pos.z) || 1, mid = Math.min(1, r / 6);
        const ax = -dx / d * (1 - mid) - (o.pos.x / r) * mid, az = -dz / d * (1 - mid) - (o.pos.z / r) * mid, an = Math.hypot(ax, az) || 1;
        goTo(o.pos.x + (ax / an) * want, o.pos.z + (az / an) * want);
        if (!low && me.clipped === 0 && !me.exhausted) {
          if (!me.flying) press("up");
          else if (me.pos.y < 4) i.up = true;
        } else if (me.flying) i.down = true;
        // Heavy with up held is the launcher: let go of up before any swing.
        const swing = (k: keyof Input) => { i.up = false; press(k); return i; };
        const busy = o.state === "attack" && !!o.act && o.t < frames(o.act.move).startup;
        // The dive: from above, onto a target that isn't already swinging.
        if (me.flying && -above > 2 && d > 1.5 && d < 3 + -above && !busy && rnd() < 0.2) { i.mx = dx / d; i.mz = dz / d; i.down = true; return swing("heavy"); }
        if (d < reach && facing && Math.abs(above) < 1.5) return swing(rnd() < 0.6 ? "heavy" : "light");
        const melee = !me.moves.ultimate.ranged;
        if (me.energy >= 100 && (!melee || d < reach + 0.5)) return swing("ultimate");
        // Bank energy for the beam: a bolt only when there is a beam's worth left over.
        if (facing && d > 3 && d < 11 && me.energy >= COST.beam && rnd() < 0.12) { i.mx = dx / d; i.mz = dz / d; return swing("special"); }
        if (facing && me.energy >= COST.beam + COST.special && rnd() < 0.04) { i.mx = 0; i.mz = 0; return swing("special"); }
        if (me.onGround && me.energy < COST.beam && d > 6 && rnd() < 0.5) { i.mx = 0; i.mz = 0; i.charge = true; }
        return i;
      }
      default: {
        // Circle, never charge: a point on a ring around the target, a little ahead of where we stand on it.
        const fr = o.act ? frames(o.act.move) : null;
        const wind = o.state === "attack" && !!o.act && !!fr && o.t < fr.startup;
        const recovering = o.state === "attack" && !!o.act && !!fr && o.t >= fr.startup + fr.active;
        const open = recovering || o.state === "stun" || o.state === "charge";
        const winding = wind && o.act!.move.power >= 60 && !o.act!.move.ranged && o.b.air !== "flight";
        // The tank reads a big swing's wind-up from the ground and takes it on the guard (a flyer's comes from anywhere).
        if (me.c.archetype === "tank" && winding && d < reach + 1.5 && facing && !me.exhausted) { i.guard = true; return i; }
        const low = me.exhausted || me.stamina < me.b.stamina * 0.3;
        if (--turn <= 0) { dir = -dir; turn = 90 + Math.floor(rnd() * 180); }
        if (rest > 0) rest--;
        // Spacing: just outside its swing; farther when winded, close when it's open.
        const range = open ? reach - 0.4 : low ? reach + 3.5 : reach + 0.35 + Math.sin(m.tick / 40 + side * 2) * 0.4;
        const theta = Math.atan2(-dz, -dx), lead = open || d > reach + 2 ? 0 : 0.15; // 0.05 before orbit movement; --each 3: 2 off target -> 0
        goTo(o.pos.x + Math.cos(theta + dir * lead) * range, o.pos.z + Math.sin(theta + dir * lead) * range);
        // Winded or facing a big wind-up in reach: guard it or back off, don't trade.
        if (low && d < reach + 2 && (wind || o.state === "attack")) { if (!me.exhausted) i.guard = true; i.mx = 0; i.mz = 0; return i; }
        // Commit to a swing only when it's open, or free and we've rested; then circle again.
        if (d < reach + 0.3 && facing && (open || (!wind && rest === 0 && !low))) {
          // Play the type chart: when the target shrugs off its heavy, the launcher may not be.
          if (typeMul(me.moves.launcher.field, o.c.fields) > typeMul(me.moves.heavy.field, o.c.fields) && rnd() < 0.3) i.up = true;
          rest = 4 + Math.floor(rnd() * 14);
          press(i.up || open || rnd() < 0.5 ? "heavy" : "light"); return i;
        }
        // Bait: a swing that falls short, to draw its answer and punish the recovery.
        if (!open && !low && !wind && rest === 0 && d > reach + 0.4 && d < reach + 1.4 && facing && rnd() < 0.006) { rest = 40; press("light"); return i; }
        if (me.energy >= 100) { press("ultimate"); return i; }
        if (d > 6 && facing && me.energy >= COST.beam && rnd() < 0.03) { i.mx = dx / d; i.mz = dz / d; press("special"); return i; }
        if (d > 9 && me.energy < COST.beam && rnd() < 0.5) { i.mx = 0; i.mz = 0; i.charge = true; }
        if (threat && d > 4 && rnd() < 0.5) { i.mx = 0; i.mz = 0; i.guard = true; }
        return i;
      }
    }
  }
}

/** Is `f` in the air because it chose to be? For the HUD and tests. */
export const airborne = (f: Fighter) => f.flying || !f.onGround;
