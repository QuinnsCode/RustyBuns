// A page's copy of a battle. The world's snapshots say where everything is; this keeps a Game
// that looks like it so the scene and the HUD draw it the way they draw a game on your own.
// Everyone else is drawn INTERP seconds behind the newest snapshot, eased between the two
// around then, so they glide rather than jump 20 times a second. Your own soldier moves the
// moment you press a key (Game.predict). Each frame's input goes out numbered; a snapshot says
// the newest the world had, so your soldier is put where the world has it and the frames since
// are played again on top, then eased there. Shots stay the world's call; each input says what
// time everyone was drawn at, so the world checks your rounds against where they were then.

import { Game, type GameEvent, type Input, type Soldier, type Stash } from "../sim/game.ts";
import { ORDER } from "../sim/weapons.ts";
import { battleGame } from "./room.ts";
import { unpackSoldier, type FromWorld, type RosterEntry, type Setup, type Snap, type SoldierState } from "./wire.ts";

/** How far behind the newest snapshot everyone else is drawn, in seconds: two snapshots' worth. */
export const INTERP = 0.1;
/** Past this far off the world's word, your soldier jumps there rather than eases. */
export const SNAP_DIST = 3;
/** Of what's left between your soldier and the world's word (with your frames since played again), the share closed per snapshot. */
const EASE = 0.5;
/** Frames kept for playing again: a few seconds of a stalled link. */
const KEEP_FRAMES = 240;

type Sample = { t: number; s: SoldierState };
type Frame = { seq: number; input: Input; dt: number };

export class Mirror {
  readonly game: Game;
  readonly setup: Setup;
  roster: RosterEntry[];
  private samples = new Map<number, Sample[]>();
  private latest = 0;
  /** The battle's clock as this page reckons it: the newest snapshot's, run on by the page's own. */
  private clock = 0;
  private pending: GameEvent[] = [];
  private seq = 0;
  /** Your frames the world hadn't had as of the newest snapshot. */
  private unacked: Frame[] = [];

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

  /**
   * Your own soldier: the world's word on it as of the newest input it had, with your frames
   * since played again on top. That's where you'd be had the world seen them, so a correction
   * only takes out real drift, never the strafe you're in the middle of.
   */
  private reconcile(s: Soldier, st: SoldierState, snap: Snap, first: boolean) {
    const was = s.alive, local = { x: s.x, y: s.y, z: s.z, yaw: s.yaw, pitch: s.pitch };
    unpackSoldier(st, s);
    if (snap.you) {
      ORDER.forEach((w, i) => ((s.ammo[w] = snap.you!.ammo[i] ?? s.ammo[w]), (s.loaded[w] = snap.you!.loaded[i] ?? s.loaded[w])));
      s.reload = snap.you.reload, s.cd = snap.you.cd, s.heat = snap.you.heat, s.shieldT = snap.you.shieldT, s.rollCd = snap.you.rollCd;
      const ack = snap.you.seq;
      this.unacked = this.unacked.filter((f) => f.seq > ack);
    }
    // Down, just back, or only just here: the world's word on everything.
    if (first || !s.alive || !was) return;
    for (const f of this.unacked) this.game.predict(s.id, f.input, f.dt);
    // Where you look is yours alone.
    s.yaw = local.yaw, s.pitch = local.pitch;
    const ex = s.x - local.x, ey = s.y - local.y, ez = s.z - local.z, e = Math.hypot(ex, ey, ez);
    if (e > SNAP_DIST || e < 0.01) return;
    s.x = local.x + ex * EASE, s.y = local.y + ey * EASE, s.z = local.z + ez * EASE;
  }

  /** The events that came in since the last frame, to play once. */
  take(): GameEvent[] {
    const out = this.pending;
    this.pending = [];
    return out;
  }

  /**
   * A frame: your soldier moves on your keys, everyone else is drawn from INTERP ago, the rounds
   * fly on. Hands back the input to send, numbered and stamped with the time everyone's drawn at.
   */
  frame(dt: number, input: Input): Input {
    const g = this.game;
    // Run the clock on, never more than a snapshot's gap past the newest (a stalled link freezes, not races).
    this.clock = Math.min(this.clock + dt, this.latest + 0.25);
    g.time = this.clock;
    const at = this.clock - INTERP, sent: Input = { ...input, seq: ++this.seq, view: Math.round(at * 1000) / 1000 };
    g.predict(g.me, input, dt);
    this.unacked.push({ seq: sent.seq!, input, dt });
    if (this.unacked.length > KEEP_FRAMES) this.unacked.shift();
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
    return sent;
  }
}
