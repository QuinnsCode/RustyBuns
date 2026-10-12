// A page's copy of a battle. The world's snapshots say where everything is; this keeps a Game
// that looks like it so the scene and the HUD draw it the way they draw a game on your own.
// Everyone else is drawn INTERP seconds behind the newest snapshot, eased between the two
// around then, so they glide rather than jump 20 times a second. Your own soldier moves the
// moment you press a key (Game.predict) and is pulled back to the world's word on it only as
// far as it drifts past what the lag explains. Shots stay the world's call.

import { Game, type GameEvent, type Input, type Soldier, type Stash } from "../sim/game.ts";
import { ORDER } from "../sim/weapons.ts";
import { battleGame } from "./room.ts";
import { unpackSoldier, type FromWorld, type RosterEntry, type Setup, type Snap, type SoldierState } from "./wire.ts";

/** How far behind the newest snapshot everyone else is drawn, in seconds: two snapshots' worth. */
export const INTERP = 0.1;
/** Past this far off the world's word, your soldier jumps there rather than eases. */
export const SNAP_DIST = 3;
/** The lag a snapshot of your own soldier is taken to be behind you by, in seconds. */
const LAG = 0.15;

type Sample = { t: number; s: SoldierState };

export class Mirror {
  readonly game: Game;
  readonly setup: Setup;
  roster: RosterEntry[];
  private samples = new Map<number, Sample[]>();
  private latest = 0;
  /** The battle's clock as this page reckons it: the newest snapshot's, run on by the page's own. */
  private clock = 0;
  private pending: GameEvent[] = [];

  constructor(welcome: Extract<FromWorld, { t: "welcome" }>) {
    this.setup = welcome.setup;
    this.game = battleGame(welcome.setup);
    this.game.me = welcome.me;
    this.roster = welcome.roster;
    this.applyRoster();
    for (const [path, h, lines] of welcome.files) this.game.setFile(path, h, lines);
    this.apply(welcome.snap, true);
  }

  get me(): Soldier { return this.game.you(); }

  private applyRoster() {
    for (const r of this.roster) this.game.ensurePlayer(r.id, r.team, r.name).score = r.score;
    for (const r of this.roster) this.game.soldiers[r.id]!.deaths = r.deaths;
  }

  /** A snapshot in: the field, the files, the events to play, and new samples to draw everyone from. */
  apply(snap: Snap, first = false) {
    const g = this.game;
    if (snap.roster) this.roster = snap.roster, this.applyRoster();
    for (const [path, h, lines] of snap.files) g.setFile(path, h, lines);
    const seen = new Set<number>();
    for (const st of snap.soldiers) {
      const id = st[0]!;
      seen.add(id);
      const s = g.soldiers[id] ?? g.ensurePlayer(id, "you", "");
      if (id === g.me) this.reconcile(s, st, snap, first);
      else {
        const list = this.samples.get(id) ?? [];
        list.push({ t: snap.time, s: st });
        while (list.length > 8) list.shift();
        this.samples.set(id, list);
        if (first || s.hidden) unpackSoldier(st, s);
      }
    }
    for (const s of g.soldiers) s.hidden = !seen.has(s.id);
    g.shots = snap.shots.map(([id, owner, team, weapon, x, y, z, vx, vy, vz, age]) => ({ id, owner, team, weapon, x, y, z, vx, vy, vz, age, dead: false }));
    g.stashes = snap.stashes.map(([id, x, y, z]): Stash => ({ id, path: "stash", lines: 0, compound: -1, x, y, z, w: 1.6, d: 1.6, h: 1.3, hp: 1, ttl: 1 }));
    g.pickups = snap.pickups;
    g.objective = snap.objective;
    snap.cleared.forEach((c, i) => (g.cleared[i] = c));
    g.status = snap.status, g.winner = snap.winner;
    if (snap.time >= this.latest) this.latest = snap.time, this.clock = Math.max(this.clock, snap.time);
    if (first) this.clock = snap.time;
    this.pending.push(...snap.events);
  }

  /** Your own soldier: the world's say on what you can't predict (HP, ammo, fire, going down), and where you are only if you've drifted. */
  private reconcile(s: Soldier, st: SoldierState, snap: Snap, first: boolean) {
    const was = s.alive, local = { x: s.x, y: s.y, z: s.z, vx: s.vx, vy: s.vy, vz: s.vz, yaw: s.yaw, pitch: s.pitch, crouch: s.crouch, prone: s.prone, roll: s.roll, grounded: s.grounded };
    unpackSoldier(st, s);
    if (snap.you) {
      ORDER.forEach((w, i) => (s.ammo[w] = snap.you!.ammo[i] ?? s.ammo[w]));
      s.cd = snap.you.cd, s.heat = snap.you.heat, s.shieldT = snap.you.shieldT, s.rollCd = snap.you.rollCd;
    }
    // Down, just back, or only just here: the world's word on everything.
    if (first || !s.alive || !was) return;
    const ex = s.x - local.x, ey = s.y - local.y, ez = s.z - local.z, e = Math.hypot(ex, ey, ez);
    Object.assign(s, local);
    if (e > SNAP_DIST) return void Object.assign(s, { x: local.x + ex, y: local.y + ey, z: local.z + ez });
    // The snapshot is a little behind you: as far as you'd have moved in that time isn't drift.
    const allow = Math.hypot(local.vx, local.vz) * LAG + 0.05;
    if (e <= allow) return;
    const k = (0.25 * (e - allow)) / e;
    s.x += ex * k, s.y += ey * k, s.z += ez * k;
  }

  /** The events that came in since the last frame, to play once. */
  take(): GameEvent[] {
    const out = this.pending;
    this.pending = [];
    return out;
  }

  /** A frame: your soldier moves on your keys, everyone else is drawn from INTERP ago, the rounds fly on. */
  frame(dt: number, input: Input) {
    const g = this.game;
    // Run the clock on, never more than a snapshot's gap past the newest (a stalled link freezes, not races).
    this.clock = Math.min(this.clock + dt, this.latest + 0.25);
    g.time = this.clock;
    g.predict(g.me, input, dt);
    const at = this.clock - INTERP;
    for (const [id, list] of this.samples) {
      const s = g.soldiers[id];
      if (!s || s.hidden || !list.length) continue;
      let i = list.findIndex((p) => p.t > at);
      if (i < 0) i = list.length;
      const a = list[Math.max(0, i - 1)]!, b = list[Math.min(list.length - 1, i)]!;
      const k = b.t > a.t ? Math.max(0, Math.min(1, (at - a.t) / (b.t - a.t))) : 1;
      unpackSoldier(k < 0.5 ? a.s : b.s, s);
      const lerp = (j: number) => a.s[j]! + (b.s[j]! - a.s[j]!) * k;
      let dy = b.s[7]! - a.s[7]!;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      Object.assign(s, { x: lerp(1), y: lerp(2), z: lerp(3), vx: lerp(4), vy: lerp(5), vz: lerp(6), yaw: a.s[7]! + dy * k, pitch: lerp(8) });
    }
    for (const p of g.shots) p.x += p.vx * dt, p.y += p.vy * dt, p.z += p.vz * dt, p.age += dt;
  }
}
