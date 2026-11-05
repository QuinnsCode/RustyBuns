// The page's side of walking together (#3663). `?room=CODE` in the world (the room an eqosys party started) opens a
// socket to that room's Region for the region you stand in; without one there is no socket at all and solo play is
// exactly what it was. Your pose goes out at most every SEND_MS and only when it changed; the others come back as
// Ghosts the world draws smoothly between updates. Walk into another region and the socket moves to that one's room.
// The room also keeps one clock for the party (the wilds, the sun and the weather turn on it), and says when a friend
// walks into a wild one so that den is busy for everyone. A dropped socket leaves you walking alone in your own world
// and keeps trying, backing off to every 8 s; nothing about the trip is kept on the server.
import { connectSocket, type Link } from "@rustybuns/util/socket";
import { login } from "../account.ts";
import { decodeServer, delta, Ghost, quantise, SEND_MS, worldClock, type Delta, type Event, type Pose, type ServerMsg } from "./party.ts";

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
  /** Someone else is here now (we joined a room with people in it, or someone joined ours): share what they should know. */
  onCompany?: () => void;
  /** The first time we join a room with others in it, where the first of them stands (to walk over to them). */
  onLand?: (region: number, x: number, z: number) => void;
  /** Where /ws is (default: this page's host). */
  base?: string;
  /** Who we are when not signed in (default: this browser's uid and no name). */
  guest?: { uid: string; name?: string };
  onChange?: () => void;
}

export class Online {
  readonly ghosts = new Map<string, Ghost>();
  status: Status = "joining";
  /** Bytes sent, for the probe's bytes-per-second line. */
  sentBytes = 0;
  private link: Link<Delta | Event> | null = null;
  private landed = false;
  /** The room clock as heard on joining: its age then, and when (performance.now()). */
  private heard: { age: number; at: number } | null = null;
  private region = 0;
  private sent: Pose | null = null;
  private sentAt = -Infinity;

  constructor(readonly room: string, private readonly o: OnlineOpts = {}) {}

  private open(region: number) {
    this.link?.close();
    this.ghosts.clear();
    this.region = region; this.sent = null; this.heard = null; this.status = "joining";
    const base = this.o.base ?? `${typeof location !== "undefined" && location.protocol === "https:" ? "wss" : "ws"}://${typeof location !== "undefined" ? location.host : "localhost"}`;
    const signed = this.o.guest ? null : login();
    const who: Record<string, string> = signed ? { token: signed.token } : { uid: this.o.guest?.uid ?? uid(), ...(this.o.guest?.name ? { name: this.o.guest.name } : {}) };
    const q = new URLSearchParams({ room: this.room, region: String(region), ...who });
    this.link = connectSocket<ServerMsg, Delta | Event>(`${base}/ws?${q}`, {
      decode: decodeServer,
      encode: (d) => { const s = JSON.stringify(d); this.sentBytes += s.length; return s; },
      onOpen: () => { this.status = "in"; this.sent = null; this.o.onChange?.(); },
      onMessage: (m) => this.hear(m, performance.now()),
      onClose: (e) => {
        this.ghosts.clear(); this.sent = null; this.heard = null;
        if (e.code === CLOSE.replaced) { this.status = "off"; this.o.onChange?.(); return null; } // joined from another tab
        if (e.code === CLOSE.signIn) { this.status = "signin"; this.o.onChange?.(); return null; } // a sign-in brings it back
        this.status = e.code === CLOSE.full ? "full" : "offline";
        this.o.onChange?.();
        return 1000 * Math.min(8, 2 ** (e.tries - 1)); // walking alone meanwhile; one refused upgrade every 8 s is cheap
      },
    });
  }

  private hear(m: ServerMsg, now: number) {
    if (m.t === "all") {
      this.heard = { age: m.age, at: now }; this.ghosts.clear();
      for (const p of m.players) { const g = new Ghost(p.id, p.name); g.hear(p.p, now); this.ghosts.set(p.id, g); }
      const first = m.players.find((p) => p.p.r !== undefined && p.p.x !== undefined && p.p.z !== undefined);
      if (first && !this.landed) { this.landed = true; this.o.onLand?.(first.p.r!, first.p.x! / 10, first.p.z! / 10); }
      if (m.players.length) this.o.onCompany?.();
    }
    else if (m.t === "hi") { this.ghosts.set(m.id, new Ghost(m.id, m.name)); this.sent = null; this.o.onCompany?.(); } // they need all of our pose
    else if (m.t === "hunt") this.o.onHunt?.(m.h, m.s, this.ghosts.get(m.id)?.name ?? "");
    else if (m.t === "fought") this.o.onFought?.({ who: this.ghosts.get(m.id)?.name ?? "", c: m.c, lv: m.lv, won: m.won, bound: m.bound });
    else if (m.t === "p") { let g = this.ghosts.get(m.id); if (!g) this.ghosts.set(m.id, (g = new Ghost(m.id, ""))); g.hear(m.d, now); }
    else if (m.t === "den") this.o.onDen?.(m.den, this.ghosts.get(m.id)?.name ?? "", m.c);
    else this.ghosts.delete(m.id);
    this.o.onChange?.();
  }

  /** Where we are now (metres, radians), every frame: it goes out only when it changed and SEND_MS has passed. */
  update(region: number, x: number, z: number, yaw: number, lead: string, now: number, follow: readonly string[] = []) {
    if (region !== this.region) this.open(region);
    // Alone in the room nothing goes out, so a region you walk alone costs nothing and its room sleeps.
    if (!this.link?.open || !this.ghosts.size || now - this.sentAt < SEND_MS) return;
    const pose = quantise(region, x, z, yaw, lead, follow), d = delta(this.sent, pose);
    if (!d) return;
    if (this.link.send(d)) { this.sent = pose; this.sentAt = now; }
  }

  /** Seconds on the room's clock at `now` (performance.now()), or null when not in a room. */
  clock(now: number): number | null { return this.heard ? worldClock(this.heard.age, this.heard.at, now) : null; }

  /** We walked into the wild one at `den`: tell the party. */
  met(den: string, c: string) { this.link?.send({ e: "den", den, c }); }
  /** We took contract `h` (`s` 0) or read its `s`-th sign: the party can follow. */
  hunt(h: string, s: number) { this.link?.send({ e: "hunt", h, s }); }
  /** Our fight at the den we last walked into ended after `s` seconds. */
  fought(c: string, lv: number, won: boolean, bound: boolean, s: number) { this.link?.send({ e: "fought", c, lv, won, bound, s: Math.round(s) }); }

  close() { this.link?.close(); this.link = null; this.ghosts.clear(); this.status = "off"; }
}
