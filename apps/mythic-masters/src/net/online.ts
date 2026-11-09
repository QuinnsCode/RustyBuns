// The page's side of walking together (#3663). `?room=CODE` in the world (the room an eqosys party started) opens a
// socket to the party's Region room; without one there is no socket at all and solo play is exactly what it was. Your
// pose goes out at most every SEND_MS, only when it changed, and only while a friend is in your region (elsewhere, just
// which region you are in, when it changes); the others come back as Ghosts the world draws smoothly between updates.
// The room also keeps one clock for the party (the wilds, the sun and the weather turn on it), and says when a friend
// walks into a wild one so that den is busy for everyone. A dropped socket leaves you walking alone in your own world
// and keeps trying, backing off to every 8 s; nothing about the trip is kept on the server.
import { connectSocket, type Link } from "@rustybuns/util/socket";
import { fresh, login } from "../account.ts";
import { AGO_MS, bestOffset, sharedDen, type Seen, decodeServer, delta, Ghost, jumped, quantise, SEND_MS, WORLD_CYCLE, type Delta, type Event, type Pose, type ServerMsg } from "./party.ts";

export const roomCode = (search: string) => (new URLSearchParams(search).get("room") ?? "").toUpperCase().match(/^[A-Z0-9]{4,12}$/)?.[0] ?? null;

/** A secret id kept in this browser for a guest; the room only ever shows others a hash of it. */
export function uid(): string {
  const make = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("");
  try {
    const kept = localStorage.getItem("mm-uid");
    if (kept) return kept;
    const made = make();
    localStorage.setItem("mm-uid", made);
    return made;
  } catch { return make(); }
}

/** `in` a room; `joining` the first time; `offline` after a drop (walking alone, trying again); `full` (six already, trying
 *  again now and then); `signin` (no token or it ran out: stopped until you sign in); `off` (open in another tab). */
/** The heartbeat's sentinel ("ping" on the wire) and how often it goes (edge/region.ts DEAD_MS is three missed). */
type Ping = { ping: true };
export const PING_MS = 30_000;
/** No step for this long and you have stopped (`m: 0`): long enough that a slow walk, a decimetre at a time, doesn't flicker it. */
const STILL_MS = 100;
/** A share of a lair's creature (`hurt`) goes out this often at most: 4 a second, under the room's 8. */
const HURT_MS = 250;

export type Status = "joining" | "in" | "offline" | "full" | "signin" | "off";
/** The room's close codes (edge/region.ts, edge/worker.ts). */
const CLOSE = { replaced: 4001, full: 4003, signIn: 4401 } as const;

export interface OnlineOpts {
  /** A friend walked into the wild one at `den` (creature `c`). */
  onDen?: (den: string, who: string, c: string) => void;
  /** A friend took contract `h` (`s` 0) or read its `s`-th sign. */
  onHunt?: (h: string, s: number, who: string) => void;
  /** A friend's fight ended, and the room believed the report. */
  onFought?: (f: { who: string; c: string; lv: number; won: boolean; bound: boolean }) => void;
  /** A friend fighting the creature at lair `den` has taken `d` thousandths of its health off it, all told. */
  onHurt?: (den: string, id: string, d: number) => void;
  /** A friend flushed a flock (`h`: its heading) or picked a food patch; `at` is when on the world clock, when it was earlier. */
  onLife?: (k: "flush" | "pick", id: string, h: number, at?: number) => void;
  /** What a friend who was here first knew: flocks landed somewhere new, and dens they are busy at. */
  onSeen?: (s: Pick<Seen, "roost" | "busy">) => void;
  /** Someone else is here now (we joined a room with people in it, or someone joined ours), or the room trusts where we
   *  stand again after a jump: share what they should know. */
  onCompany?: () => void;
  /** The first time we join a room with others in it, where the first of them stands (to walk over to them). */
  onLand?: (region: number, x: number, z: number, name: string) => void;
  /** The regions our save has opened: the room believes a jump (travel, a campfire) only into one of them. */
  opened?: () => readonly number[];
  /** Where we stand this instant (the world's pose): a den or contract taken mid-frame, after a jump and before the
   *  frame's `update`, is checked against it, not against the frame before (#3800). */
  posed?: () => { region: number; x: number; z: number; yaw: number; lead: string; follow: readonly string[] } | null;
  /** Where /ws is (default: this page's host). */
  base?: string;
  /** Who we are when not signed in (default: this browser's uid and no name). */
  guest?: { uid: string; name?: string };
  onChange?: () => void;
}

export class Online {
  readonly ghosts = new Map<string, Ghost>();
  /** Our own public id in the room (its `all`), as friends' pages know us; empty until seated. */
  you = "";
  status: Status = "joining";
  /** Bytes sent, for the probe's bytes-per-second line. */
  sentBytes = 0;
  private link: Link<Delta | Event | Ping> | null = null;
  private pinger: ReturnType<typeof setInterval> | undefined;
  private landed = false;
  /** Who was here before us (the room's `all`): the first of them we hear a pose from is the one we land beside. */
  private before = new Set<string>();
  /** World-clock samples (its age, and when we read it, performance.now()): the join's, then a few asked for. */
  private heard: { age: number; at: number }[] = [];
  /** Where we stand (quantised), every frame, for a den event; and the last den, to tell the room again after a drop. */
  private here: Pose | null = null;
  private lastDen: { den: string; c: string; lv: number; at: number; n: number; d: number } | null = null;
  /** When we last moved (performance.now()): `m` stays 1 a moment after, so a slow walk doesn't flicker it. */
  private movedAt = -Infinity;
  private sent: Pose | null = null;
  private sentAt = -Infinity;
  /** The opened regions the room last heard from us (joined with commas), so it hears again only when one opens. */
  private claimed = "";

  constructor(readonly room: string, private readonly o: OnlineOpts = {}) {}

  private open() {
    this.link?.close();
    this.ghosts.clear();
    this.sent = null; this.heard = []; this.status = "joining";
    const base = this.o.base ?? `${typeof location !== "undefined" && location.protocol === "https:" ? "wss" : "ws"}://${typeof location !== "undefined" ? location.host : "localhost"}`;
    const signed = this.o.guest ? null : login();
    const who: Record<string, string> = signed ? { token: signed.token } : { uid: this.o.guest?.uid ?? uid(), ...(this.o.guest?.name ? { name: this.o.guest.name } : {}) };
    const q = new URLSearchParams({ room: this.room, ...who });
    this.link = connectSocket<ServerMsg, Delta | Event | Ping>(`${base}/ws?${q}`, {
      decode: decodeServer,
      encode: (d) => { const s = "ping" in d ? "ping" : JSON.stringify(d); this.sentBytes += s.length; return s; },
      onOpen: () => {
        this.status = "in"; this.sent = null; this.claimed = ""; this.claim(); this.o.onChange?.();
        // The heartbeat: the runtime answers it without waking the room, and a page that vanishes stops it.
        clearInterval(this.pinger);
        this.pinger = setInterval(() => { if (this.link?.open) this.link.send({ ping: true }); }, PING_MS);
        // Three more clock samples over two seconds; keep the best (a busy page reads one late).
        for (const ms of [300, 1000, 2000]) setTimeout(() => this.link?.send({ e: "time" }), ms);
        this.retell(); // back after a drop in the middle of a fight: the room forgot the den
      },
      onMessage: (m) => this.hear(m, performance.now()),
      onClose: (e) => {
        this.ghosts.clear(); this.sent = null;
        if (e.code === CLOSE.replaced) { this.status = "off"; this.o.onChange?.(); return null; } // joined from another tab
        if (e.code === CLOSE.signIn) { this.status = "signin"; this.o.onChange?.(); return null; } // a sign-in brings it back
        this.status = e.code === CLOSE.full ? "full" : "offline";
        this.o.onChange?.();
        return 1000 * Math.min(8, 2 ** (e.tries - 1)); // walking alone meanwhile; one refused upgrade every 8 s is cheap
      },
    });
  }

  /** A friend's (or the room's) catch-up on the wilds: each pick and flush with its time on the world clock, then the roosts and busy dens. */
  private told(m: Seen) { for (const p of m.picks) this.o.onLife?.("pick", p.id, 0, p.at); for (const f of m.flown) this.o.onLife?.("flush", f.id, f.h, f.at); this.o.onSeen?.({ roost: m.roost, busy: m.busy }); }

  private hear(m: ServerMsg, now: number) {
    if (m.t === "all") {
      this.heard = [{ age: m.age, at: now }]; this.ghosts.clear(); this.you = m.you;
      for (const p of m.players) { const g = new Ghost(p.id, p.name); g.hear(p.p, now); this.ghosts.set(p.id, g); }
      if (!this.landed) for (const p of m.players) this.before.add(p.id);
      for (const g of this.ghosts.values()) this.land(g);
      if (m.players.length) this.o.onCompany?.();
      if (m.seen) this.told(m.seen); // what the room kept of the region's wilds, told by friends who may have left
    }
    else if (m.t === "hi") { this.ghosts.set(m.id, new Ghost(m.id, m.name)); this.sent = null; this.o.onCompany?.(); } // they need all of our pose
    else if (m.t === "vouch") { this.retell(); if (this.ghosts.size) this.o.onCompany?.(); return; } // the den it refused, then the contracts
    else if (m.t === "time") { this.heard.push({ age: m.age, at: now }); if (this.heard.length > 8) this.heard.shift(); return; }
    else if (m.t === "life") this.o.onLife?.(m.k, m.f, m.h);
    else if (m.t === "seen") this.told(m);
    else if (m.t === "hunt") this.o.onHunt?.(m.h, m.s, this.ghosts.get(m.id)?.name ?? "");
    else if (m.t === "hurt") { this.o.onHurt?.(m.den, m.id, m.d); return; }
    else if (m.t === "fought") this.o.onFought?.({ who: this.ghosts.get(m.id)?.name ?? "", c: m.c, lv: m.lv, won: m.won, bound: m.bound });
    else if (m.t === "p") {
      let g = this.ghosts.get(m.id);
      if (!g) this.ghosts.set(m.id, (g = new Ghost(m.id, "")));
      const was = g.pose.r;
      g.hear(m.d, now); this.land(g);
      // A friend who walks into our region from another: catch them up, as for one who just joined.
      if (was !== undefined && was !== g.pose.r && g.pose.r === this.here?.r) this.o.onCompany?.();
    }
    else if (m.t === "den") this.o.onDen?.(m.den, this.ghosts.get(m.id)?.name ?? "", m.c);
    else this.ghosts.delete(m.id);
    this.o.onChange?.();
  }

  /** Where we are now (metres, radians), every frame: it goes out only when it changed and SEND_MS has passed. `colour`
   *  is the one our ground hums in (world/hues.ts). */
  update(region: number, x: number, z: number, yaw: number, lead: string, now: number, follow: readonly string[] = [], colour?: number) {
    if (this.status === "off") return; // open in another tab: that one has the room
    const was = this.here;
    if (was && (was.x !== Math.round(x * 10) || was.z !== Math.round(z * 10))) this.movedAt = now;
    this.here = quantise(region, x, z, yaw, lead, follow, now - this.movedAt < STILL_MS, colour);
    // Just stopped: say so (and where) at once, out of turn, so a friend's page never coasts past where you stand.
    if (was?.m === 1 && this.here.m === 0 && this.nearby()) { this.sendPose(); return; }
    if (!this.link) this.open();
    else if (this.status === "signin") { const l = this.o.guest ? null : login(); if (l && fresh(l)) this.open(); return; } // signed in again
    if (!this.link?.open || now - this.sentAt < SEND_MS) return;
    this.claim(); // before any pose, so a jump into a region that just opened is believed
    const pose = this.here, jump = jumped(this.sent, pose, now - this.sentAt);
    // Nobody here, or nobody in your region: only which region you are in goes out (when it changes), so the room can
    // sleep; and where travel just took you, once, so the room knows you got there the game's way.
    if (!this.ghosts.size && !jump) return;
    if (this.sent?.r === region && ![...this.ghosts.values()].some((g) => g.pose.r === region) && !jump) return;
    const d = delta(this.sent, pose);
    if (!d) return;
    if (this.link.send(d)) { this.sent = pose; this.sentAt = now; }
  }

  /** Seconds on the room's clock at `now` (performance.now()), or null when not in a room. */
  clock(now: number): number | null { return this.heard.length ? (((bestOffset(this.heard) + now) / 1000) % WORLD_CYCLE + WORLD_CYCLE) % WORLD_CYCLE : null; }

  /** We walked into the wild one at `den` (creature `c`, level `lv`): tell the party. */
  met(den: string, c: string, lv: number) {
    this.lastDen = { den, c, lv, at: performance.now(), n: 0, d: 0 };
    this.refresh();
    // Where we stand first (alone in a region we may not have said for a while): the room checks the den against it.
    if (this.sendPose()) this.link?.send({ e: "den", den, c, lv, ago: 0, n: 0 });
  }
  /** Tell the room the regions we have opened, when that changed since it last heard. */
  private claim() {
    const rs = this.o.opened?.(), key = rs?.join(",") ?? "";
    if (rs && key !== this.claimed && this.link?.send({ e: "open", rs: [...rs] })) this.claimed = key;
  }
  /** Tell the room the den we last walked into again, with how long ago, so a fight report from it is believed: after a
   *  drop (the room forgot it), or when the room trusts where we stand again (it refused it meanwhile). */
  private retell() {
    const d = this.lastDen, ago = d ? performance.now() - d.at : Infinity;
    this.refresh();
    if (d && ago < AGO_MS && this.sendPose() && this.link?.send({ e: "den", den: d.den, c: d.c, lv: d.lv, ago: Math.max(1, Math.round(ago)), n: d.n }) && d.d) this.link.send({ e: "hurt", d: d.d });
  }
  /** At the lair we last walked into, we have taken `d` thousandths of its creature's health off, all told: the friends
   *  fighting it take it off theirs. The page calls it every frame; it goes out when it grew, HURT_MS apart at most. */
  hurt(d: number, now = performance.now()) {
    const l = this.lastDen, v = Math.round(d);
    if (!l || !sharedDen(l.den) || v <= l.d || now - this.hurtAt < HURT_MS || !this.link?.open) return;
    if (this.link.send({ e: "hurt", d: v })) { l.d = v; this.hurtAt = now; }
  }
  private hurtAt = -Infinity;
  /** Where we stand this instant, from `posed`, before a den or contract goes out, so a jump this very frame is the
   *  pose the room checks it against; and the regions we have opened, first, so a jump into one just opened is believed. */
  private refresh() {
    const p = this.o.posed?.(), now = performance.now();
    if (!p || this.status === "off") return;
    const was = this.here;
    if (was && (was.x !== Math.round(p.x * 10) || was.z !== Math.round(p.z * 10))) this.movedAt = now;
    this.here = quantise(p.region, p.x, p.z, p.yaw, p.lead, p.follow, now - this.movedAt < STILL_MS);
    this.claim();
  }
  /** Our pose now, out of turn, if it changed: true when the room has it. */
  private sendPose(): boolean {
    const h = this.here;
    if (!h || !this.link?.open) return false;
    const d = delta(this.sent, h);
    if (!d) return true;
    if (!this.link.send(d)) return false;
    this.sent = h; this.sentAt = performance.now();
    return true;
  }
  /** Start lands us beside a friend who was already here: the first of them whose pose we hear (a page alone sends
   *  none, so it may come a moment after we join). Once a trip, and never the one who came first. */
  private land(g: Ghost) {
    if (this.landed || !this.before.has(g.id)) return;
    const p = g.pose;
    if (p.r === undefined || p.x === undefined || p.z === undefined) return;
    this.landed = true;
    this.o.onLand?.(p.r, p.x / 10, p.z / 10, g.name);
  }

  /** The patches we picked and flocks we flushed lately, with their world-clock times, for a friend who just arrived
   *  (their pose isn't in yet, so no region check). */
  seen(s: Seen) {
    if ((s.picks.length || s.flown.length || s.roost.length || s.busy.length) && this.ghosts.size)
      this.link?.send({ e: "seen", picks: s.picks.slice(-30), flown: s.flown.slice(-30), roost: s.roost.slice(-30), busy: s.busy.slice(-12) });
  }
  /** Is a friend in the region we stand in? */
  private nearby() { return [...this.ghosts.values()].some((g) => g.pose.r !== undefined && g.pose.r === this.here?.r); }
  /** We flushed a flock or picked a patch: only worth telling while a friend is in our region. */
  life(k: "flush" | "pick", id: string, h = 0) {
    if (!this.nearby()) return;
    this.link?.send({ e: "life", k, id, h: Math.round(h * 1000) / 1000 });
  }
  /** We took contract `h` (`s` 0) or read its `s`-th sign: the party can follow. */
  hunt(h: string, s: number) { this.refresh(); if (this.sendPose()) this.link?.send({ e: "hunt", h, s }); } // where we stand first: the room checks the board
  /** Our fight at the den we last walked into ended after `s` seconds. */
  fought(c: string, lv: number, won: boolean, bound: boolean, s: number) {
    if (this.lastDen) this.lastDen.n++;
    this.link?.send({ e: "fought", c, lv, won, bound, s: Math.round(s) });
  }

  close() { clearInterval(this.pinger); this.link?.close(); this.link = null; this.ghosts.clear(); this.status = "off"; }

  /** The colour each other player's ground hums in, as they last said (world/hues.ts). */
  colours(): { id: string; colour?: number }[] { return [...this.ghosts.values()].map((g) => ({ id: g.id, colour: g.pose.c })); }

  /** The others and the region each is in, for the chip. */
  where(): { name: string; region: number }[] { return [...this.ghosts.values()].flatMap((g) => (g.pose.r === undefined ? [] : [{ name: g.name, region: g.pose.r }])); }
}
