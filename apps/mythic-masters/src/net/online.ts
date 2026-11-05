// The page's side of walking together (#3663). `?room=CODE` in the world (the room an eqosys party started) opens a
// socket to that room's Region for the region you stand in; without one there is no socket at all and solo play is
// exactly what it was. Your pose goes out at most every SEND_MS and only when it changed; the others come back as
// Ghosts the world draws smoothly between updates. Walk into another region and the socket moves to that one's room.
// A dropped socket leaves you walking alone and tries again; nothing about the trip is kept on the server.
import { connectSocket, type Link } from "@rustybuns/util/socket";
import { login } from "../account.ts";
import { decodeServer, delta, Ghost, quantise, SEND_MS, type Delta, type Pose, type ServerMsg } from "./party.ts";

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

export type Status = "joining" | "in" | "full" | "off";

export interface OnlineOpts {
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
  private link: Link<Delta> | null = null;
  private region = 0;
  private sent: Pose | null = null;
  private sentAt = -Infinity;

  constructor(readonly room: string, private readonly o: OnlineOpts = {}) {}

  private open(region: number) {
    this.link?.close();
    this.ghosts.clear();
    this.region = region; this.sent = null; this.status = "joining";
    const base = this.o.base ?? `${typeof location !== "undefined" && location.protocol === "https:" ? "wss" : "ws"}://${typeof location !== "undefined" ? location.host : "localhost"}`;
    const signed = this.o.guest ? null : login();
    const who: Record<string, string> = signed ? { token: signed.token } : { uid: this.o.guest?.uid ?? uid(), ...(this.o.guest?.name ? { name: this.o.guest.name } : {}) };
    const q = new URLSearchParams({ room: this.room, region: String(region), ...who });
    this.link = connectSocket<ServerMsg, Delta>(`${base}/ws?${q}`, {
      decode: decodeServer,
      encode: (d) => { const s = JSON.stringify(d); this.sentBytes += s.length; return s; },
      onOpen: () => { this.status = "in"; this.sent = null; this.o.onChange?.(); },
      onMessage: (m) => this.hear(m, performance.now()),
      onClose: (e) => {
        this.ghosts.clear(); this.sent = null;
        if (e.code === 4001) { this.status = "off"; this.o.onChange?.(); return null; } // this player joined from another tab
        this.status = !e.seen && e.tries > 1 ? "full" : "joining"; // never got in: the room is full, or there is no server
        this.o.onChange?.();
        return e.tries < 6 ? 1000 * Math.min(8, 2 ** e.tries) : null;
      },
    });
  }

  private hear(m: ServerMsg, now: number) {
    if (m.t === "all") { this.ghosts.clear(); for (const p of m.players) { const g = new Ghost(p.id, p.name); g.hear(p.p, now); this.ghosts.set(p.id, g); } }
    else if (m.t === "hi") this.ghosts.set(m.id, new Ghost(m.id, m.name));
    else if (m.t === "p") { let g = this.ghosts.get(m.id); if (!g) this.ghosts.set(m.id, (g = new Ghost(m.id, ""))); g.hear(m.d, now); }
    else this.ghosts.delete(m.id);
    this.o.onChange?.();
  }

  /** Where we are now (metres, radians), every frame: it goes out only when it changed and SEND_MS has passed. */
  update(region: number, x: number, z: number, yaw: number, lead: string, now: number) {
    if (region !== this.region) this.open(region);
    if (!this.link?.open || now - this.sentAt < SEND_MS) return;
    const pose = quantise(region, x, z, yaw, lead), d = delta(this.sent, pose);
    if (!d) return;
    if (this.link.send(d)) { this.sent = pose; this.sentAt = now; }
  }

  close() { this.link?.close(); this.link = null; this.ghosts.clear(); this.status = "off"; }
}
