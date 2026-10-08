// Bots for the hunt. A bot sees only view(id), like a person: a ranger bot
// has to find campers with its flashlight, its ears and its radio.
//
// Ranger: sweep bush to bush (preferring wherever the radio says campers could
// be), call out now and then, run to rustles and footsteps, chase what it sees.
// Camper: drop somewhere bushy, crouch in a bush, bolt when a ranger gets close.
// Bigfoot: everyone runs for him once they see him; rangers (and the bolder
// campers, later in the hunt) search the bushes where the circle is closing.

import { rng, type Pt } from "../geo.ts";
import { cellAt } from "../grid.ts";
import { allAsks, possible, resolve, toKm, type Clue } from "../clues.ts";
import { zoneById, type Prop, type Zone } from "../zones/zone.ts";
import { step, wrap, type Body, type MoveInput } from "./sim.ts";
import { circleAt, closed, type BotLevel, type Hunt, type Msg, type View } from "./game.ts";

// bold: the chance a camper bot goes looking for Bigfoot once the circle is closing.
const LEVEL: Record<BotLevel, { react: number; callEvery: number; radio: boolean; panic: number; sweep: number; bold: number }> = {
  easy: { react: 900, callEvery: 22, radio: false, panic: 7, sweep: 2.5, bold: 0.15 },
  normal: { react: 450, callEvery: 14, radio: true, panic: 12, sweep: 3.5, bold: 0.45 },
  hard: { react: 250, callEvery: 11, radio: true, panic: 17, sweep: 4.5, bold: 0.75 },
};

export class HuntBot {
  private rand: () => number;
  private roundId = -1;
  private body: Body | null = null;
  private goal: Pt | null = null;
  private running = false;
  private crouching = false;
  private nextThink = 0;
  private nextCall = 0;
  private visited = new Set<Prop>();
  private heard = new Set<number>();
  /** Bushes to check round a rustle or footstep, nearest first. */
  private search: Prop[] = [];
  private fleeUntil = 0;
  private bold = false;
  private stuck = { x: 0, y: 0, at: 0, detourUntil: 0, dir: 0 };
  private lastTick = 0;

  constructor(readonly id: string, readonly level: BotLevel, seed: number) { this.rand = rng(seed); }

  /** Called every host tick; returns messages to apply as this player. */
  tick(game: Hunt, now: number): Msg[] {
    const dt = this.lastTick ? Math.min(0.2, (now - this.lastTick) / 1000) : 0;
    this.lastTick = now;
    const v = game.view(this.id, now);
    const r = v.round, you = r?.you;
    if (!r || !you) return [];
    if (r.id !== this.roundId) this.reset(r.id, now);
    const z = zoneById(v.zone);
    const out: Msg[] = [];

    if (v.phase === "drop" && you.role === "camper" && !you.drop && now > this.nextThink) {
      const [x, y] = this.pickDrop(game, z);
      out.push({ t: "drop", x, y });
      this.nextThink = now + 99999;
      return out;
    }
    const active = (v.phase === "hide" && you.role === "camper") || (v.phase === "hunt" && you.caughtAt === null);
    if (!active) { this.body = null; return out; }
    // Sync from the host's copy (it may have pushed us out of a tree).
    if (!this.body || Math.hypot(this.body.x - you.x, this.body.y - you.y) > 2) this.body = { x: you.x, y: you.y, yaw: you.yaw, stamina: you.stamina, crouch: you.crouch, run: you.run };

    if (now >= this.nextThink) {
      this.nextThink = now + LEVEL[this.level].react * (0.7 + this.rand() * 0.6);
      if (you.role === "ranger") out.push(...this.thinkRanger(game, v, z, now));
      else this.thinkCamper(v, z, now);
    }
    if (dt > 0) out.push(this.move(z, you.role, dt, now, r!.sky.tod !== "day" && you.role === "ranger"));
    return out;
  }

  private reset(id: number, now: number) {
    this.roundId = id;
    this.body = null; this.goal = null; this.running = false; this.crouching = false;
    this.visited.clear(); this.heard.clear(); this.search = []; this.fleeUntil = 0;
    this.bold = this.rand() < LEVEL[this.level].bold;
    this.nextCall = now + 8000 + this.rand() * 6000;
    this.nextThink = now + 1500 + this.rand() * 4000;
  }

  // ---- movement ---------------------------------------------------------------

  private move(z: Zone, role: "camper" | "ranger", dt: number, now: number, light: boolean): Msg {
    const b = this.body!;
    let fwd = 0;
    if (this.goal) {
      const dx = this.goal[0] - b.x, dy = this.goal[1] - b.y, d = Math.hypot(dx, dy);
      if (d > 0.8) {
        let want = Math.atan2(dx, dy);
        // Unstick: if we haven't got anywhere in a second, try going round.
        if (now - this.stuck.at > 1000) {
          if (Math.hypot(b.x - this.stuck.x, b.y - this.stuck.y) < 0.6 && !this.crouching) { this.stuck.detourUntil = now + 1200; this.stuck.dir = this.rand() < 0.5 ? -1.3 : 1.3; }
          this.stuck = { ...this.stuck, x: b.x, y: b.y, at: now };
        }
        if (now < this.stuck.detourUntil) want += this.stuck.dir;
        b.yaw += wrap(want - b.yaw) * Math.min(1, dt * 8);
        fwd = 1;
      }
    }
    const inp: MoveInput = { fwd, right: 0, run: this.running, crouch: this.crouching };
    step(z, b, role, inp, dt);
    return { t: "pos", x: b.x, y: b.y, yaw: b.yaw, pitch: 0, crouch: b.crouch, run: b.run, light };
  }

  // ---- camper -----------------------------------------------------------------

  private pickDrop(game: Hunt, z: Zone): Pt {
    let best: Pt = game.randomDrop(z), score = -Infinity;
    for (let k = 0; k < 40; k++) {
      const p = game.randomDrop(z);
      const bushes = z.near(p[0], p[1], 15).filter((q) => q.kind === "bush").length;
      const s = Math.min(bushes, 6) + Math.hypot(p[0] - z.station.x, p[1] - z.station.y) / 40 + this.rand() * 3;
      if (s > score) { score = s; best = p; }
    }
    return best;
  }

  private thinkCamper(v: View, z: Zone, now: number) {
    const b = this.body!;
    const r = v.round!;
    const rangers = r.others.filter((o) => o.role === "ranger" && o.caughtAt === null);
    const L = LEVEL[this.level];
    let threat: (typeof rangers)[number] | null = null, td = Infinity;
    for (const g of rangers) { const d = Math.hypot(g.x - b.x, g.y - b.y); if (d < td) { td = d; threat = g; } }
    // Spotted? (A ranger close by and facing us, or right on top of us.)
    const facing = threat ? Math.abs(wrap(Math.atan2(b.x - threat.x, b.y - threat.y) - threat.yaw)) < 0.6 : false;
    if (threat && (td < L.panic * 0.5 || (td < L.panic && facing))) {
      // Run for a bush on the far side from the ranger.
      const away = Math.atan2(b.x - threat.x, b.y - threat.y);
      const target = this.bestBush(z, b, (p) => {
        const ang = Math.abs(wrap(Math.atan2(p.x - b.x, p.y - b.y) - away));
        const d = Math.hypot(p.x - b.x, p.y - b.y);
        return ang < 1.1 && d > 15 && d < 60 ? d * 0.3 + ang * 10 : Infinity;
      });
      this.goal = target ? [target.x, target.y] : [b.x + Math.sin(away) * 30, b.y + Math.cos(away) * 30];
      this.running = true; this.crouching = false;
      this.fleeUntil = now + 2500;
      return;
    }
    if (now < this.fleeUntil) return;
    this.running = false;
    if (r.bigfoot && !r.bigfoot.foundBy) { this.goal = [r.bigfoot.x, r.bigfoot.y]; this.running = true; this.crouching = false; return; }
    // Bold campers go looking once the circle is halfway in, sweeping bushes round its middle
    // (it closes on Bigfoot, so the middle is the best guess).
    const c0 = r.circle;
    if (this.bold && c0 && closed(r.huntStartedAt, now) > 0.5) {
      const k0 = circleAt(c0, now);
      for (const p of z.near(b.x, b.y, 3)) if (p.kind === "bush" && Math.hypot(p.x - b.x, p.y - b.y) < 3) this.visited.add(p);
      const near = (g: Pt) => Math.hypot(g[0] - k0.x, g[1] - k0.y) <= k0.r * 0.5;
      if (!this.goal || !near(this.goal) || Math.hypot(this.goal[0] - b.x, this.goal[1] - b.y) < 1.2) {
        const target = this.bestBush(z, b, (p) => (this.visited.has(p) || !near([p.x, p.y]) ? Infinity : Math.hypot(p.x - b.x, p.y - b.y) + this.rand() * 6), 250);
        if (target) this.goal = [target.x, target.y];
      }
      this.crouching = false;
      return;
    }
    // The search area is closing: get well inside it before it reaches us.
    const c = r.circle, kc = c && circleAt(c, now);
    const inFinal = (x: number, y: number) => !kc || Math.hypot(x - kc.x, y - kc.y) < kc.r * 0.6;
    if (c && !inFinal(b.x, b.y)) {
      const k = circleAt(c, now);
      const margin = k.r - Math.hypot(b.x - k.x, b.y - k.y);
      if (margin < 25 || closed(r.huntStartedAt, now) > 0) {
        if (!this.goal || !inFinal(this.goal[0], this.goal[1])) {
          const target = this.bestBush(z, b, (p) => (inFinal(p.x, p.y) ? Math.hypot(p.x - b.x, p.y - b.y) + this.rand() * 10 : Infinity), 250);
          this.goal = target ? [target.x, target.y] : [kc!.x, kc!.y];
        }
        this.crouching = false;
        this.running = margin < 3;
        return;
      }
    }
    // Hide: get into the best nearby bush and crouch.
    const inBush = z.bushAt(b.x, b.y);
    if (inBush && (!this.goal || Math.hypot(this.goal[0] - inBush.x, this.goal[1] - inBush.y) < 1)) { this.crouching = true; this.goal = [inBush.x, inBush.y]; return; }
    if (!this.goal || !z.bushAt(this.goal[0], this.goal[1])) {
      const st = z.station;
      const target = this.bestBush(z, b, (p) => {
        const d = Math.hypot(p.x - b.x, p.y - b.y);
        return d > 70 || !inFinal(p.x, p.y) ? Infinity : d - Math.hypot(p.x - st.x, p.y - st.y) * 0.2 + this.rand() * 8;
      });
      if (target) this.goal = [target.x, target.y];
    }
    this.crouching = !!inBush;
  }

  private bestBush(z: Zone, b: Body, score: (p: Prop) => number, reach = 70): Prop | null {
    let best: Prop | null = null, s = Infinity;
    for (const p of z.near(b.x, b.y, reach)) {
      if (p.kind !== "bush") continue;
      const v = score(p);
      if (v < s) { s = v; best = p; }
    }
    return best;
  }

  // ---- ranger -----------------------------------------------------------------

  private thinkRanger(game: Hunt, v: View, z: Zone, now: number): Msg[] {
    const out: Msg[] = [];
    const b = this.body!;
    const r = v.round!;
    const L = LEVEL[this.level];
    // Mark bushes we've swept past.
    for (const p of z.near(b.x, b.y, L.sweep)) if (p.kind === "bush" && Math.hypot(p.x - b.x, p.y - b.y) < L.sweep) this.visited.add(p);

    if (r.bigfoot && !r.bigfoot.foundBy) { this.goal = [r.bigfoot.x, r.bigfoot.y]; this.running = true; return out; }
    const seen = r.others.filter((o) => o.role === "camper" && o.caughtAt === null);
    if (seen.length) {
      let t = seen[0], td = Infinity;
      for (const c of seen) { const d = Math.hypot(c.x - b.x, c.y - b.y); if (d < td) { td = d; t = c; } }
      this.goal = [t.x, t.y]; this.running = true;
      return out;
    }
    // Howls are worth chasing once the circle has closed in enough to make them count.
    const howls = closed(r.huntStartedAt, now) > 0.5;
    const cue = r.cues.filter((c) => (c.kind === "rustle" || c.kind === "step" || (howls && c.kind === "howl")) && now - c.at < 5000 && !this.heard.has(c.id))
      .sort((a, c) => Math.hypot(a.x - b.x, a.y - b.y) - Math.hypot(c.x - b.x, c.y - b.y))[0];
    if (cue) {
      this.heard.add(cue.id);
      // Head there, then check every bush round it (cues are only roughly placed).
      const reach = cue.kind === "howl" ? 20 : cue.kind === "rustle" ? 4 + Math.hypot(cue.x - b.x, cue.y - b.y) * 0.15 : 5;
      this.search = z.near(cue.x, cue.y, reach + 2).filter((p) => p.kind === "bush" && Math.hypot(p.x - cue.x, p.y - cue.y) < reach + 2)
        .sort((p, q) => Math.hypot(p.x - cue.x, p.y - cue.y) - Math.hypot(q.x - cue.x, q.y - cue.y));
      this.goal = [cue.x, cue.y];
      this.running = Math.hypot(cue.x - b.x, cue.y - b.y) > 12;
      return out;
    }
    if (this.goal && Math.hypot(this.goal[0] - b.x, this.goal[1] - b.y) > 1.2) {
      const far = Math.hypot(this.goal[0] - b.x, this.goal[1] - b.y);
      // Jog to far-off places when there's breath to spare; walk (and look) up close.
      if (far < 8) this.running = false;
      else if (far > 35 && b.stamina > 0.6) this.running = true;
      else if (b.stamina < 0.2) this.running = false;
    } else {
      this.running = false;
      this.search = this.search.filter((p) => !this.visited.has(p));
      const next = this.search.shift();
      this.goal = next ? [next.x, next.y] : this.nextSweep(game, v, z, b);
    }
    if (now >= this.nextCall && !game.callBlocked(this.id, now)) {
      out.push({ t: "call" });
      this.nextCall = now + L.callEvery * 1000 * (0.8 + this.rand() * 0.4);
    }
    if (L.radio) { const ask = this.pickAsk(game, v, now); if (ask) out.push(ask); }
    return out;
  }

  /** Where campers could be, per the radio (union over campers still out). */
  private radioMask(game: Hunt, v: View): Uint8Array | null {
    const r = v.round!;
    const by = new Map<string, Clue[]>();
    for (const l of r.asks) for (const a of l.answers) { if (!by.has(a.id)) by.set(a.id, []); by.get(a.id)!.push(a.clue); }
    if (!by.size) return null;
    const g = game.radioGrid();
    const union = new Uint8Array(g.cols * g.rows);
    for (const [, clues] of by) { const m = possible(g, clues); for (let i = 0; i < m.length; i++) union[i] |= m[i]; }
    return union;
  }

  private nextSweep(game: Hunt, v: View, z: Zone, b: Body): Pt {
    const mask = this.radioMask(game, v), g = game.radioGrid();
    const c = v.round!.circle, k = c ? circleAt(c, v.now) : null;
    let best: Prop | null = null, s = Infinity;
    for (const p of z.props) {
      if (p.kind !== "bush" || this.visited.has(p)) continue;
      if (k && Math.hypot(p.x - k.x, p.y - k.y) > k.r) continue;
      let score = Math.hypot(p.x - b.x, p.y - b.y) + this.rand() * 12;
      // Everyone can see where the search area ends up, and campers head there.
      // Campers (and Bigfoot) are towards the middle, and the more it's closed the surer that is.
      if (k) {
        const late = closed(v.round!.huntStartedAt, v.now);
        score += Math.max(0, Math.hypot(p.x - k.x, p.y - k.y) - k.r * (1 - 0.5 * late)) * (0.6 + 1.5 * late);
      }
      if (mask && !mask[cellAt(g, toKm(p.x), toKm(p.y))]) score += 400;
      if (score < s) { s = score; best = p; }
    }
    if (best) return [best.x, best.y];
    this.visited.clear();
    const a = this.rand() * Math.PI * 2, d = Math.sqrt(this.rand()) * z.R * 0.9;
    return [Math.cos(a) * d, Math.sin(a) * d];
  }

  private pickAsk(game: Hunt, v: View, now: number): Msg | null {
    const r = v.round!, s = r.radio;
    if (!s || now < s.cooldownUntil) return null;
    const g = game.radioGrid();
    const options = allAsks(g).filter((a) => !game.askBlocked(this.id, a, now));
    if (!options.length) return null;
    const mask = this.radioMask(game, v);
    const cells: number[] = [];
    for (const i of g.parkCells) if (!mask || mask[i]) cells.push(i);
    if (cells.length < 20) return null;
    const stride = Math.max(1, Math.floor(cells.length / 800));
    let best: Msg | null = null, bestScore = 0.15;
    for (const ask of options) {
      let yes = 0, n = 0;
      for (let k = 0; k < cells.length; k += stride) {
        const c = resolve(g, ask, s.x, s.y, s.lastAsk, cells[k]);
        const y = c.kind === "radar" ? c.yes : c.kind === "compass" ? c.plus : c.kind === "thermo" ? c.hotter : c.kind === "match" ? c.same : c.closer;
        if (y) yes++;
        n++;
      }
      const score = Math.min(yes / n, 1 - yes / n);
      if (score > bestScore) { bestScore = score; best = { t: "ask", ask }; }
    }
    return best;
  }
}
