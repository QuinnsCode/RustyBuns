// The hunt. Campers drop into a zone round a real attraction and hide; park
// rangers come looking. A ranger catches a camper by reaching them: there's
// no "find" button. To narrow things down they call out (nearby campers rustle),
// listen for footsteps, sweep with a flashlight at night, and use radio questions.
//
// Bigfoot hides near where the search area ends up. Whoever reaches him first
// ends the round: a camper wins it for every camper still out, a ranger for the
// rangers. Otherwise campers just have to last the hunt.
//
// One Hunt runs wherever the match is hosted (the page for single player, the
// world for LAN games). Everyone gets view(id): a ranger is only ever sent the
// campers they can actually see from where they stand.

import { rng, type Pt } from "../geo.ts";
import { cellAt, type Grid } from "../grid.ts";
import { NO_ASKS, RADIO, askBlocked, answerText, parseAsk, radioGrid, resolve, toKm, type Ask, type AskKind, type Clue, type RadioState } from "../clues.ts";
import { CLIFF, ZONES, zoneById, type Zone } from "../zones/zone.ts";
import { MOVE, TAG_REACH, canSee, clearSky, resolve as pushOut, soundJitter, stepReach, type Body, type Role, type Sky, type TimeOfDay } from "./sim.ts";
import { describe, type Weather } from "../weather.ts";

export const HUNT = {
  dropSecs: 15,
  hideSecs: 30,
  huntSecs: 180,
  resultsSecs: 12,
  survivalBonus: 30,
  catchPoints: 40,
  callCooldownSecs: 10,
  callRadius: 55,
  maxPlayers: 8,
  /** A drop has to be this far from the ranger cabin. */
  dropClear: 45,
  /** Campers see rangers (hi-vis vests, radios crackling) this far off. */
  rangerVisible: 120,
  /** The search area shrinks between these seconds into the hunt, to this fraction of the zone. */
  shrinkFrom: 35,
  shrinkTo: 150,
  finalRadius: 0.3,
  /** Bigfoot hides within this fraction of the final circle's radius from its centre. */
  bigfootSpread: 0.5,
  /** Reach him to find him; he can only be seen this close (less in the dark), even standing in the open. */
  bigfootReach: 2,
  bigfootSight: 6,
  bigfootPoints: 100,
  /** Once the circle starts closing he howls now and then; everyone hears it, placed this roughly. */
  howlEverySecs: 25,
  howlJitter: 30,
};

/** The search area: a circle that closes in on a point during the hunt. */
export interface Circle { x0: number; y0: number; r0: number; x1: number; y1: number; r1: number; from: number; to: number }

export function circleAt(c: Circle, now: number): { x: number; y: number; r: number } {
  const t = Math.max(0, Math.min(1, (now - c.from) / (c.to - c.from || 1)));
  return { x: c.x0 + (c.x1 - c.x0) * t, y: c.y0 + (c.y1 - c.y0) * t, r: c.r0 + (c.r1 - c.r0) * t };
}

/**
 * The circle as players get it: where it is now and where it'll be a moment
 * later, so it closes smoothly on screen without giving away where it ends up
 * (that's where Bigfoot is). You can still watch which way it's heading.
 */
export function circleAhead(c: Circle, now: number, ms = 3000): Circle {
  const a = circleAt(c, now), b = circleAt(c, now + ms);
  return { x0: a.x, y0: a.y, r0: a.r, x1: b.x, y1: b.y, r1: b.r, from: now, to: now + ms };
}

/** How far the circle has closed: 0 before it starts, 1 once it's done. */
export function closed(huntStartedAt: number, now: number): number {
  return Math.max(0, Math.min(1, (now - huntStartedAt - HUNT.shrinkFrom * 1000) / ((HUNT.shrinkTo - HUNT.shrinkFrom) * 1000)));
}

export function outside(c: Circle | null, now: number, x: number, y: number): boolean {
  if (!c) return false;
  const k = circleAt(c, now);
  return Math.hypot(x - k.x, y - k.y) > k.r + 1;
}

/** Inside the zone, on ground you can stand on and walk out of, clear of the ranger cabin. */
export function dropOk(z: Zone, x: number, y: number): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !z.inside(x, y, 4)) return false;
  if (Math.hypot(x - z.station.x, y - z.station.y) < HUNT.dropClear || !z.reachable(x, y)) return false;
  return z.slope(x, y) < CLIFF * 0.8;
}

export type BotLevel = "easy" | "normal" | "hard";
export type Phase = "lobby" | "drop" | "hide" | "hunt" | "results" | "over";
export type Hat = "none" | "beanie" | "cap" | "bucket";

export interface Look { shirt: number; pants: number; skin: number; hat: Hat; pack: boolean }
export const SHIRTS = ["#d9482b", "#2f7d32", "#2b6cb0", "#e0a526", "#8e44ad", "#e86fa1", "#1aa39a", "#f2efe6"];
export const PANTS = ["#3b3f4a", "#6b5236", "#2d4a6b", "#5b6b3a"];
export const SKINS = ["#f2d0b5", "#e0b089", "#c68a5e", "#8d5a3b", "#5b3a27"];
export const HATS: Hat[] = ["none", "beanie", "cap", "bucket"];

export type Msg =
  | { t: "name"; name: string }
  | { t: "look"; look: Look }
  | { t: "settings"; zone?: string; tod?: TimeOfDay; live?: boolean; laps?: number }
  | { t: "bot"; level: BotLevel }
  | { t: "kick"; id: string }
  | { t: "start" }
  | { t: "lobby" }
  | { t: "drop"; x: number; y: number }
  | { t: "pos"; x: number; y: number; yaw: number; pitch: number; crouch: boolean; run: boolean; light: boolean }
  | { t: "call" }
  | { t: "ask"; ask: Ask };

export interface Actor extends Body {
  id: string;
  role: Role;
  pitch: number;
  light: boolean;
  caughtAt: number | null;
  caughtBy: string | null;
  drop: Pt | null;
  /** Server clock of the last accepted move, for the speed check. */
  movedAt: number;
}

export type CueKind = "step" | "rustle" | "call" | "caught" | "howl";
export interface Cue { id: number; kind: CueKind; x: number; y: number; at: number; by: string; to: "rangers" | "campers" | "all" }

export interface AskLog { at: number; ask: Ask; by: string; x: number; y: number; answers: { id: string; text: string; clue: Clue }[] }

export interface RoundResult { id: string; role: Role; caughtAt: number | null; points: number; bigfoot?: boolean }

/** Where Bigfoot is, sent only to someone who can see him (or once he's found). */
export interface BigfootView { x: number; y: number; yaw: number; foundBy: string | null }

export interface PlayerView { id: string; name: string; bot: BotLevel | null; score: number; online: boolean; look: Look }

/** What one player may know about another actor right now. */
export interface ActorView { id: string; role: Role; x: number; y: number; yaw: number; pitch: number; crouch: boolean; run: boolean; light: boolean; caughtAt: number | null }

export interface View {
  me: string;
  hostId: string | null;
  phase: Phase;
  now: number;
  endsAt: number;
  zone: string;
  /** The lobby's choice: a zone id or "random". */
  zonePick: string;
  /** The lobby's time of day: what's played with live weather off, or if it can't be fetched. */
  tod: TimeOfDay;
  /** Play in the park's live weather and real time of day. */
  live: boolean;
  laps: number;
  players: PlayerView[];
  round: null | {
    id: number;
    n: number;
    total: number;
    rangers: string[];
    /** Your own state; null if you're not in this round. */
    you: Actor | null;
    others: ActorView[];
    cues: Cue[];
    asks: AskLog[];
    radio: (RadioState & { x: number; y: number }) | null;
    huntStartedAt: number;
    circle: Circle | null;
    /** Bigfoot, if you can see him. */
    bigfoot: BigfootView | null;
    /** The conditions this round is played in. */
    sky: Sky;
    /** The live reading behind `sky`, if there is one. */
    weather: Weather | null;
    /** Everyone's result, once the round is over. */
    results: RoundResult[] | null;
  };
  log: string[];
}

interface Player { id: string; name: string; bot: BotLevel | null; score: number; online: boolean; look: Look }
interface Round {
  id: number;
  n: number;
  zone: string;
  rangers: string[];
  actors: Map<string, Actor>;
  cues: Cue[];
  asks: AskLog[];
  radio: Map<string, RadioState>;
  huntStartedAt: number;
  circle: Circle | null;
  bigfoot: { x: number; y: number; yaw: number } | null;
  foundBy: string | null;
  lastHowl: number;
  results: RoundResult[] | null;
  /** null while the live weather is on its way; settled by the time the hunt starts. */
  sky: Sky | null;
  weather: Weather | null;
  lastCall: Map<string, number>;
  lastStep: Map<string, number>;
  /** ranger id -> camper id -> last time seen, so a camper doesn't flicker at the edge of sight. */
  seen: Map<string, Map<string, number>>;
}

const NAME = /^[^\p{C}]{1,24}$/u;
const WHO = /\u0001([^\u0001]*)\u0001/g;
const who = (id: string) => `\u0001${id}\u0001`;
const BOT_NAMES = ["Juniper", "Sequoia", "Marmot", "Pika", "Bison", "Osprey", "Yucca", "Aspen"];

export function randomLook(r: () => number = Math.random): Look {
  return { shirt: Math.floor(r() * SHIRTS.length), pants: Math.floor(r() * PANTS.length), skin: Math.floor(r() * SKINS.length), hat: HATS[Math.floor(r() * HATS.length)], pack: r() < 0.6 };
}

export class Hunt {
  players: Player[] = [];
  hostId: string | null = null;
  phase: Phase = "lobby";
  endsAt = 0;
  zonePick = "random";
  tod: TimeOfDay = "night";
  live = true;
  laps = 1;
  round: Round | null = null;
  schedule: string[][] = [];
  log: string[] = [];
  version = 0;
  private rand: () => number;
  private joins = 0;
  private rounds = 0;
  private cueIds = 0;
  private names = new Map<string, string>();
  private grids = new Map<string, Grid>();

  constructor(seed = Date.now()) { this.rand = rng(seed); }

  zone(): Zone { return zoneById(this.round?.zone ?? (this.zonePick === "random" ? ZONES[0].id : this.zonePick)); }
  /** The round's conditions, or the lobby's while the live weather is on its way. */
  sky(): Sky { return this.round?.sky ?? clearSky(this.tod); }
  radioGrid(z = this.zone()): Grid {
    let g = this.grids.get(z.data.id);
    if (!g) { g = radioGrid(z); this.grids.set(z.data.id, g); }
    return g;
  }

  // ---- players ----------------------------------------------------------------

  join(id: string, name: string, now: number, opts: { host?: boolean; bot?: BotLevel; look?: Look } = {}): boolean {
    const have = this.players.find((p) => p.id === id);
    if (have) { have.online = true; if (NAME.test(name)) have.name = name; this.touch(); return true; }
    if (this.players.length >= HUNT.maxPlayers) return false;
    this.players.push({ id, name: NAME.test(name) ? name : "Camper", bot: opts.bot ?? null, score: 0, online: true, look: opts.look ?? randomLook(this.rand) });
    if (opts.host || (!this.hostId && !opts.bot)) this.hostId = id;
    this.say(`${who(id)} joined`);
    this.touch();
    return true;
  }

  leave(id: string, now: number) {
    const p = this.players.find((q) => q.id === id);
    if (!p) return;
    if (this.phase === "lobby" || this.phase === "over") {
      this.players = this.players.filter((q) => q.id !== id);
      this.say(`${who(id)} left`);
    } else {
      p.online = false;
      this.say(`${who(id)} dropped out`);
      const r = this.round;
      // Without a ranger there's no round; a camper who leaves just stops counting.
      if (r && r.rangers.includes(id) && r.rangers.every((x) => !this.players.find((q) => q.id === x)?.online)) this.endRound(now);
    }
    if (this.hostId === id) this.hostId = this.players.find((q) => q.online && !q.bot)?.id ?? null;
    this.touch();
  }

  handle(id: string, m: Msg, now: number) {
    const p = this.players.find((q) => q.id === id);
    if (!p) return;
    const host = id === this.hostId;
    const r = this.round;
    const a = r?.actors.get(id);
    switch (m.t) {
      case "name": if (NAME.test(m.name)) { p.name = m.name.trim() || p.name; this.touch(); } return;
      case "look": p.look = m.look; this.touch(); return;
      case "settings":
        if (!host || this.phase !== "lobby") return;
        if (m.zone && (m.zone === "random" || ZONES.some((z) => z.id === m.zone))) this.zonePick = m.zone;
        if (m.tod === "day" || m.tod === "dusk" || m.tod === "night") this.tod = m.tod;
        if (typeof m.live === "boolean") this.live = m.live;
        if (m.laps === 1 || m.laps === 2) this.laps = m.laps;
        this.touch();
        return;
      case "bot": {
        if (!host || this.phase !== "lobby" || this.players.length >= HUNT.maxPlayers) return;
        const name = BOT_NAMES.find((n) => !this.players.some((q) => q.name === n)) ?? "Ranger Rick";
        this.join(`bot-${++this.joins}-${Math.floor(this.rand() * 1e6)}`, name, now, { bot: m.level });
        return;
      }
      case "kick":
        if (!host || m.id === id || this.phase !== "lobby") return;
        this.leave(m.id, now);
        return;
      case "start": this.start(id, now); return;
      case "lobby": if (host && this.phase === "over") { this.phase = "lobby"; this.round = null; this.touch(); } return;
      case "drop": {
        if (this.phase !== "drop" || !a || a.role !== "camper") return;
        if (!this.canDrop(m.x, m.y)) return;
        a.drop = [m.x, m.y];
        this.touch();
        return;
      }
      case "pos": this.move(a, m, now); return;
      case "call": this.call(a, now); return;
      case "ask": this.ask(a, m.ask, now); return;
    }
  }

  // ---- match flow -------------------------------------------------------------

  private start(id: string, now: number) {
    if (id !== this.hostId || (this.phase !== "lobby" && this.phase !== "over")) return;
    const online = this.players.filter((p) => p.online);
    if (online.length < 2) return;
    this.players = online;
    for (const p of this.players) p.score = 0;
    // Everyone is a ranger once per lap; two rangers once there are five or more players.
    const per = this.players.length >= 5 ? 2 : 1;
    // A fresh order each match, so the host isn't always the first ranger.
    const ids = this.players.map((p) => p.id);
    for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(this.rand() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
    const order: string[] = [];
    for (let l = 0; l < this.laps; l++) order.push(...ids);
    this.schedule = [];
    for (let i = 0; i < order.length; i += per) this.schedule.push(order.slice(i, i + per).concat(order.slice(0, Math.max(0, i + per - order.length))));
    this.round = null;
    this.say(`New match: ${this.schedule.length} rounds`);
    this.startRound(0, now);
  }

  private startRound(n: number, now: number) {
    while (n < this.schedule.length && !this.schedule[n].some((id) => this.players.find((p) => p.id === id)?.online)) n++;
    const online = this.players.filter((p) => p.online);
    if (n >= this.schedule.length || online.length < 2) { this.finish(); return; }
    const rangers = this.schedule[n].filter((id) => online.some((p) => p.id === id));
    const zone = this.zonePick === "random" ? ZONES[Math.floor(this.rand() * ZONES.length)].id : this.zonePick;
    const z = zoneById(zone);
    const actors = new Map<string, Actor>();
    for (const p of online) {
      const role: Role = rangers.includes(p.id) ? "ranger" : "camper";
      actors.set(p.id, { id: p.id, role, x: z.station.x, y: z.station.y, yaw: z.station.yaw, pitch: 0, stamina: 1, crouch: false, run: false, light: this.live || this.tod !== "day", caughtAt: null, caughtBy: null, drop: null, movedAt: now });
    }
    this.round = {
      id: ++this.rounds, n, zone, rangers, actors, cues: [], asks: [], radio: new Map(rangers.map((id) => [id, { x: 0, y: 0, cooldownUntil: 0, used: NO_ASKS(), lastAsk: null }])),
      huntStartedAt: 0, circle: null, bigfoot: null, foundBy: null, lastHowl: 0, results: null, sky: this.live ? null : clearSky(this.tod), weather: null,
      lastCall: new Map(), lastStep: new Map(), seen: new Map(),
    };
    this.phase = "drop";
    this.endsAt = now + HUNT.dropSecs * 1000;
    this.say(`Round ${n + 1}: ${z.data.name}. ${rangers.map(who).join(" and ")} ${rangers.length > 1 ? "are" : "is"} on patrol`);
    this.touch();
  }

  // ---- weather ----------------------------------------------------------------

  /** The round waiting on live weather, and where to look it up: whoever hosts fetches it. */
  wantsWeather(): { round: number; center: [number, number] } | null {
    const r = this.round;
    if (!r || r.sky || (this.phase !== "drop" && this.phase !== "hide")) return null;
    return { round: r.id, center: zoneById(r.zone).data.center };
  }

  /**
   * The live weather for a round, or null if it couldn't be had (then the
   * lobby's time of day stands). Too late once the hunt has started.
   */
  setWeather(round: number, w: Weather | null, now: number) {
    const r = this.round;
    if (!r || r.id !== round || r.sky || (this.phase !== "drop" && this.phase !== "hide")) return;
    r.sky = w?.sky ?? clearSky(this.tod);
    r.weather = w;
    for (const a of r.actors.values()) a.light = a.role === "ranger" && r.sky.tod !== "day";
    this.say(w ? `Live from ${zoneById(r.zone).data.name}: ${describe(w)}` : `No live weather, so it's ${this.tod} as picked in the lobby`);
    this.touch();
  }

  canDrop(x: number, y: number, z = this.zone()): boolean { return dropOk(z, x, y); }

  randomDrop(z = this.zone()): Pt {
    for (let k = 0; k < 2000; k++) {
      const a = this.rand() * Math.PI * 2, d = Math.sqrt(this.rand()) * z.R;
      const x = Math.cos(a) * d, y = Math.sin(a) * d;
      if (this.canDrop(x, y, z)) return [x, y];
    }
    return [0, 0];
  }

  private finish() {
    this.phase = "over";
    this.endsAt = 0;
    const best = [...this.players].sort((a, b) => b.score - a.score)[0];
    if (best) this.say(`${who(best.id)} wins with ${best.score} points`);
    this.touch();
  }

  private endRound(now: number) {
    const r = this.round!;
    const huntEnd = Math.min(now, r.huntStartedAt + HUNT.huntSecs * 1000);
    const results: RoundResult[] = [];
    let caught = 0;
    const lasted = this.phase === "hunt" && now >= r.huntStartedAt + HUNT.huntSecs * 1000 - 50;
    const finder = r.foundBy ? r.actors.get(r.foundBy) : undefined;
    // Lasting the whole hunt, or a camper finding Bigfoot, counts as camping out.
    const campersWin = lasted || finder?.role === "camper";
    const bonus = (id: string) => (id === r.foundBy ? HUNT.bigfootPoints : 0);
    for (const a of r.actors.values()) {
      if (a.role !== "camper") continue;
      const secs = a.caughtAt !== null ? Math.round((a.caughtAt - r.huntStartedAt) / 1000)
        : lasted ? HUNT.huntSecs
        : Math.round(Math.max(0, huntEnd - (r.huntStartedAt || huntEnd)) / 1000);
      const pts = secs + (a.caughtAt === null && campersWin ? HUNT.survivalBonus : 0) + bonus(a.id);
      if (a.caughtAt !== null) caught++;
      results.push({ id: a.id, role: "camper", caughtAt: a.caughtAt, points: pts, bigfoot: a.id === r.foundBy || undefined });
    }
    for (const id of r.rangers) {
      const catches = [...r.actors.values()].filter((a) => a.caughtBy === id).length;
      results.push({ id, role: "ranger", caughtAt: null, points: catches * HUNT.catchPoints + bonus(id), bigfoot: id === r.foundBy || undefined });
    }
    for (const res of results) { const p = this.players.find((q) => q.id === res.id); if (p) p.score += res.points; }
    r.results = results;
    const campers = results.filter((x) => x.role === "camper").length;
    if (finder) this.say(finder.role === "camper" ? `Bigfoot found! ${campers - caught} camper${campers - caught === 1 ? "" : "s"} camped out` : "The rangers found Bigfoot");
    else this.say(caught === campers ? "Every camper caught!" : `${campers - caught} camper${campers - caught === 1 ? "" : "s"} camped out successfully`);
    this.phase = "results";
    this.endsAt = now + HUNT.resultsSecs * 1000;
    this.touch();
  }

  tick(now: number) {
    const r = this.round;
    if (!r) return;
    if (this.phase === "drop" && now >= this.endsAt) {
      const z = this.zone();
      for (const a of r.actors.values()) {
        if (a.role !== "camper") continue;
        const [x, y] = a.drop ?? (a.drop = this.randomDrop(z));
        a.x = x; a.y = y; a.yaw = Math.atan2(-x, -y); a.movedAt = now;
      }
      this.phase = "hide";
      this.endsAt = now + HUNT.hideSecs * 1000;
      this.say("Campers are in the park. Hide!");
      this.touch();
    } else if (this.phase === "hide" && now >= this.endsAt) {
      const z = this.zone();
      // The weather never came: play the lobby's pick.
      r.sky ??= clearSky(this.tod);
      for (const id of r.rangers) {
        const a = r.actors.get(id)!;
        // Step out of the cabin's front door.
        a.x = z.station.x + Math.cos(z.station.yaw) * 6; a.y = z.station.y + Math.sin(z.station.yaw) * 6;
        a.yaw = Math.atan2(-a.x, -a.y); a.movedAt = now;
      }
      this.phase = "hunt";
      r.huntStartedAt = now;
      // Close in on somewhere walkable, away from the cabin.
      let end = this.randomDrop(z);
      for (let k = 0; k < 20 && Math.hypot(end[0], end[1]) > z.R * (1 - HUNT.finalRadius) * 0.9; k++) end = this.randomDrop(z);
      r.circle = { x0: 0, y0: 0, r0: z.R, x1: end[0], y1: end[1], r1: z.R * HUNT.finalRadius, from: now + HUNT.shrinkFrom * 1000, to: now + HUNT.shrinkTo * 1000 };
      r.bigfoot = this.bigfootSpot(z, r.circle);
      r.lastHowl = now;
      this.endsAt = now + HUNT.huntSecs * 1000;
      this.say(`The rangers are out${r.sky.tod === "night" ? " with flashlights" : ""}!`);
      this.touch();
    } else if (this.phase === "hunt") {
      this.tags(r, now);
      this.footsteps(r, now);
      this.howl(r, now);
      if (this.findBigfoot(r, now)) { this.endRound(now); return; }
      r.cues = r.cues.filter((c) => now - c.at < 6000);
      const campers = [...r.actors.values()].filter((a) => a.role === "camper");
      if (campers.every((a) => a.caughtAt !== null || !this.players.find((p) => p.id === a.id)?.online)) this.endRound(now);
      else if (now >= this.endsAt) this.endRound(now);
    } else if (this.phase === "results" && now >= this.endsAt) {
      this.startRound(r.n + 1, now);
    }
  }

  // ---- actions ----------------------------------------------------------------

  /** Accept a client's position if it could have got there; otherwise pull it back. */
  private move(a: Actor | undefined, m: Extract<Msg, { t: "pos" }>, now: number) {
    if (!a || a.caughtAt !== null) return;
    if (this.phase !== "hide" && this.phase !== "hunt") return;
    if (this.phase === "hide" && a.role === "ranger") return; // counting in the cabin
    const z = this.zone();
    const dt = Math.min(1, Math.max(0.01, (now - a.movedAt) / 1000));
    const max = MOVE[a.role].run * 1.4 * dt + 0.6;
    let dx = m.x - a.x, dy = m.y - a.y;
    const d = Math.hypot(dx, dy);
    if (d > max) { dx *= max / d; dy *= max / d; }
    a.x += dx; a.y += dy;
    pushOut(z, a);
    a.yaw = m.yaw; a.pitch = Math.max(-1.4, Math.min(1.4, m.pitch));
    a.crouch = !!m.crouch; a.run = !!m.run && !a.crouch; a.light = !!m.light && a.role === "ranger";
    a.movedAt = now;
    this.touch();
  }

  private tags(r: Round, now: number) {
    const z = this.zone();
    for (const id of r.rangers) {
      const g = r.actors.get(id)!;
      if (!this.players.find((p) => p.id === id)?.online) continue;
      for (const c of r.actors.values()) {
        if (c.role !== "camper" || c.caughtAt !== null) continue;
        if (Math.hypot(c.x - g.x, c.y - g.y) > TAG_REACH || Math.abs(z.height(c.x, c.y) - z.height(g.x, g.y)) > 2) continue;
        c.caughtAt = now;
        c.caughtBy = id;
        c.crouch = false;
        this.cue(r, "caught", c.x, c.y, id, "all", now);
        this.say(`${who(id)} caught ${who(c.id)} after ${Math.round((now - r.huntStartedAt) / 1000)} s`);
        this.touch();
      }
    }
  }

  /** A bush near where the search area ends up, on ground you can stand on. */
  private bigfootSpot(z: Zone, c: Circle): { x: number; y: number; yaw: number } {
    const reach = c.r1 * HUNT.bigfootSpread;
    const bushes = z.near(c.x1, c.y1, reach).filter((p) => p.kind === "bush" && Math.hypot(p.x - c.x1, p.y - c.y1) < reach && dropOk(z, p.x, p.y));
    const b = bushes.length ? bushes[Math.floor(this.rand() * bushes.length)] : null;
    return { x: b?.x ?? c.x1, y: b?.y ?? c.y1, yaw: this.rand() * Math.PI * 2 };
  }

  /** Anyone still in the hunt who reaches Bigfoot finds him. */
  private findBigfoot(r: Round, now: number): boolean {
    const f = r.bigfoot;
    if (!f || r.foundBy) return !!r.foundBy;
    const z = this.zone();
    for (const a of r.actors.values()) {
      if (a.caughtAt !== null || !this.players.find((p) => p.id === a.id)?.online) continue;
      if (Math.hypot(a.x - f.x, a.y - f.y) > HUNT.bigfootReach || Math.abs(z.height(a.x, a.y) - z.height(f.x, f.y)) > 2.5) continue;
      r.foundBy = a.id;
      this.cue(r, "caught", f.x, f.y, a.id, "all", now);
      this.say(`${who(a.id)} found Bigfoot after ${Math.round((now - r.huntStartedAt) / 1000)} s!`);
      this.touch();
      return true;
    }
    return false;
  }

  /** Every so often, a howl from roughly where he is. The wind blurs it more. */
  private howl(r: Round, now: number) {
    const f = r.bigfoot;
    if (!f || closed(r.huntStartedAt, now) <= 0 || now - r.lastHowl < HUNT.howlEverySecs * 1000) return;
    r.lastHowl = now - this.rand() * 5000;
    const j = soundJitter(this.sky(), HUNT.howlJitter), a = this.rand() * Math.PI * 2, d = Math.sqrt(this.rand()) * j;
    this.cue(r, "howl", f.x + Math.cos(a) * d, f.y + Math.sin(a) * d, "bigfoot", "all", now);
    this.touch();
  }

  /** Running is loud; walking is quiet; crouching is silent. */
  private footsteps(r: Round, now: number) {
    const sky = this.sky();
    for (const a of r.actors.values()) {
      if (a.role !== "camper" || a.caughtAt !== null || a.crouch) continue;
      const moving = now - a.movedAt < 300;
      if (!moving) continue;
      // Rain drowns them out.
      const every = a.run ? 450 : 700, reach = stepReach(sky, a.run ? 45 : 14);
      if (now - (r.lastStep.get(a.id) ?? 0) < every) continue;
      // Only if some ranger is close enough to hear.
      if (!r.rangers.some((id) => { const g = r.actors.get(id)!; return Math.hypot(g.x - a.x, g.y - a.y) < reach; })) continue;
      r.lastStep.set(a.id, now);
      const j = soundJitter(sky, 1);
      this.cue(r, "step", a.x + (this.rand() - 0.5) * 3 * j, a.y + (this.rand() - 0.5) * 3 * j, a.id, "rangers", now);
    }
  }

  callBlocked(id: string, now: number): string | null {
    const r = this.round;
    if (this.phase !== "hunt" || !r?.rangers.includes(id)) return "only rangers, during the hunt";
    const last = r.lastCall.get(id) ?? -Infinity;
    if (now - last < HUNT.callCooldownSecs * 1000) return "catching your breath";
    return null;
  }

  /** "Anybody out there?" Campers in earshot give themselves away with a rustle. */
  private call(a: Actor | undefined, now: number) {
    const r = this.round;
    if (!a || !r || this.callBlocked(a.id, now)) return;
    r.lastCall.set(a.id, now);
    this.cue(r, "call", a.x, a.y, a.id, "all", now);
    for (const c of r.actors.values()) {
      if (c.role !== "camper" || c.caughtAt !== null) continue;
      const d = Math.hypot(c.x - a.x, c.y - a.y);
      if (d > HUNT.callRadius) continue;
      const moving = now - c.movedAt < 400;
      // Close by, nobody stays perfectly still; farther out, it's a coin toss unless you're moving.
      if (d > 28 && !moving && this.rand() < 0.5) continue;
      // Wind makes a rustle harder to place.
      const j = soundJitter(this.sky(), 1 + d * 0.12);
      this.cue(r, "rustle", c.x + (this.rand() - 0.5) * 2 * j, c.y + (this.rand() - 0.5) * 2 * j, c.id, "rangers", now + 300 + this.rand() * 900);
    }
    this.touch();
  }

  askBlocked(id: string, ask: Ask, now: number): string | null {
    const r = this.round, s = r?.radio.get(id), a = r?.actors.get(id);
    if (this.phase !== "hunt" || !s || !a) return "only rangers, during the hunt";
    return askBlocked(this.radioGrid(), { ...s, x: toKm(a.x), y: toKm(a.y) }, ask, now);
  }

  private ask(a: Actor | undefined, ask: Ask, now: number) {
    const r = this.round;
    if (!a || !r || this.askBlocked(a.id, ask, now)) return;
    const g = this.radioGrid(), s = r.radio.get(a.id)!;
    const sx = toKm(a.x), sy = toKm(a.y);
    const log: AskLog = { at: Math.round((now - r.huntStartedAt) / 1000), ask, by: a.id, x: a.x, y: a.y, answers: [] };
    for (const c of r.actors.values()) {
      if (c.role !== "camper" || c.caughtAt !== null) continue;
      const clue = resolve(g, ask, sx, sy, s.lastAsk, cellAt(g, toKm(c.x), toKm(c.y)));
      log.answers.push({ id: c.id, text: answerText(g, clue), clue });
    }
    r.asks.push(log);
    s.used[ask.kind]++;
    s.lastAsk = [sx, sy];
    s.cooldownUntil = now + RADIO.cooldownSecs * 1000;
    this.touch();
  }

  private cue(r: Round, kind: CueKind, x: number, y: number, by: string, to: Cue["to"], at: number) {
    r.cues.push({ id: ++this.cueIds, kind, x, y, at, by, to });
  }

  // ---- views ------------------------------------------------------------------

  view(me: string, now: number): View {
    const r = this.round;
    const z = r ? zoneById(r.zone) : null;
    const mine = r?.actors.get(me) ?? null;
    const done = this.phase === "results" || this.phase === "over";
    // Out of the round (caught, or joined late): watch everything.
    const spectator = !mine || mine.caughtAt !== null || done;
    let round: View["round"] = null;
    if (r && z) {
      const others: ActorView[] = [];
      let seen = r.seen.get(me);
      if (!seen) r.seen.set(me, (seen = new Map()));
      for (const a of r.actors.values()) {
        if (a.id === me) continue;
        if (this.phase === "drop") continue; // nobody is on the ground yet
        if (!spectator && !this.visibleTo(z, mine!, a, now, seen)) continue;
        others.push({ id: a.id, role: a.role, x: a.x, y: a.y, yaw: a.yaw, pitch: a.pitch, crouch: a.crouch, run: a.run, light: a.light, caughtAt: a.caughtAt });
      }
      const role = mine?.role;
      const cues = r.cues.filter((c) => c.at <= now && (spectator || c.to === "all" || (c.to === "rangers" ? role === "ranger" : role === "camper") || c.by === me));
      // A camper hears every question, but only learns their own answer; rangers hear everything.
      const asks = r.asks.map((l) => ({ ...l, answers: l.answers.filter((x) => spectator || role === "ranger" || x.id === me) }));
      const rs = r.radio.get(me);
      round = {
        id: r.id, n: r.n, total: this.schedule.length, rangers: r.rangers,
        you: mine && { ...mine, drop: mine.drop },
        others, cues, asks,
        radio: rs && mine ? { ...rs, x: toKm(mine.x), y: toKm(mine.y) } : null,
        huntStartedAt: r.huntStartedAt,
        circle: r.circle && circleAhead(r.circle, now),
        bigfoot: this.bigfootFor(z, r, mine, spectator, now, seen),
        sky: this.sky(),
        weather: r.weather,
        results: r.results,
      };
    }
    return {
      me, hostId: this.hostId, phase: this.phase, now, endsAt: this.endsAt,
      zone: r?.zone ?? this.zone().data.id, zonePick: this.zonePick, tod: this.tod, live: this.live, laps: this.laps,
      players: this.players.map(({ id, name, bot, score, online, look }) => ({ id, name, bot, score, online, look })),
      round,
      log: this.log.slice(-6).map((l) => this.logText(l)),
    };
  }

  /** Bigfoot: to everyone once found or once the round's over, otherwise only up close and in sight. */
  private bigfootFor(z: Zone, r: Round, me: Actor | null, spectator: boolean, now: number, seen: Map<string, number>): BigfootView | null {
    const f = r.bigfoot;
    if (!f || this.phase === "hide") return null;
    let ok = spectator || !!r.foundBy;
    if (!ok && me) {
      ok = Math.hypot(f.x - me.x, f.y - me.y) < HUNT.bigfootSight && canSee(z, this.sky(), me, { x: f.x, y: f.y, crouch: false });
      if (ok) seen.set("bigfoot", now);
      ok ||= now - (seen.get("bigfoot") ?? -Infinity) < 400;
    }
    return ok ? { ...f, foundBy: r.foundBy } : null;
  }

  /** Teammates always; rangers to campers from afar; campers to rangers only by sight. */
  private visibleTo(z: Zone, me: Actor, a: Actor, now: number, seen: Map<string, number>): boolean {
    if (a.role === me.role) return true;
    if (a.caughtAt !== null) return true;
    if (this.phase === "hide") return false; // rangers are in the cabin
    if (me.role === "camper") return Math.hypot(a.x - me.x, a.y - me.y) < HUNT.rangerVisible;
    // Outside the search area, a camper stands out like a flare.
    const ok = outside(this.round!.circle, now, a.x, a.y) || canSee(z, this.sky(), { ...me }, a);
    if (ok) seen.set(a.id, now);
    // Linger a moment, so the edge of a flashlight doesn't strobe.
    return ok || now - (seen.get(a.id) ?? -Infinity) < 400;
  }

  nameOf(id: string) { return this.players.find((p) => p.id === id)?.name ?? this.names.get(id) ?? "someone"; }
  logText(line: string) { return line.replace(WHO, (_, id) => this.nameOf(id)); }
  private say(s: string) { this.log.push(s); if (this.log.length > 50) this.log.shift(); }
  private touch() {
    this.version++;
    for (const p of this.players) this.names.set(p.id, p.name);
  }
}

// ---- the wire ---------------------------------------------------------------

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function parseMsg(raw: unknown): Msg | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, any>;
  switch (m.t) {
    case "name": return typeof m.name === "string" ? { t: "name", name: m.name.slice(0, 24) } : null;
    case "look": {
      const l = m.look ?? {};
      const ok = num(l.shirt) && num(l.pants) && num(l.skin) && HATS.includes(l.hat)
        && l.shirt >= 0 && l.shirt < SHIRTS.length && l.pants >= 0 && l.pants < PANTS.length && l.skin >= 0 && l.skin < SKINS.length;
      return ok ? { t: "look", look: { shirt: l.shirt | 0, pants: l.pants | 0, skin: l.skin | 0, hat: l.hat, pack: !!l.pack } } : null;
    }
    case "settings": return { t: "settings", zone: typeof m.zone === "string" ? m.zone : undefined, tod: m.tod, live: typeof m.live === "boolean" ? m.live : undefined, laps: num(m.laps) ? m.laps : undefined };
    case "bot": return ["easy", "normal", "hard"].includes(m.level) ? { t: "bot", level: m.level } : null;
    case "kick": return typeof m.id === "string" ? { t: "kick", id: m.id } : null;
    case "start": case "lobby": case "call": return { t: m.t };
    case "drop": return num(m.x) && num(m.y) ? { t: "drop", x: m.x, y: m.y } : null;
    case "pos": return num(m.x) && num(m.y) && num(m.yaw) && num(m.pitch)
      ? { t: "pos", x: m.x, y: m.y, yaw: m.yaw, pitch: m.pitch, crouch: !!m.crouch, run: !!m.run, light: !!m.light } : null;
    case "ask": { const ask = parseAsk(m.ask); return ask ? { t: "ask", ask } : null; }
  }
  return null;
}

export type { AskKind };
