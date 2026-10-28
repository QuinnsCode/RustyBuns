// The page's side of a room: `?room=ABCD` joins one, and it sends our pose and hears everyone else's.
// No room in the address, or no server behind /ws (the dev server, the desktop app), and it stays single player.
import { decodeServer, type Pose, type Rider } from "./room.ts";

const SEND_MS = 50;

/** A secret id kept in this browser; the server only ever shows others a hash of it. */
export function uid(): string {
  try {
    const kept = localStorage.getItem("stp-uid");
    if (kept) return kept;
    const made = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("");
    localStorage.setItem("stp-uid", made);
    return made;
  } catch { return Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join(""); }
}

export const roomCode = (search: string) => (new URLSearchParams(search).get("room") ?? "").toUpperCase().match(/^[A-Z0-9]{4,8}$/)?.[0] ?? null;
/** `&pve=1`: a room where boards pass through each other. */
export const pveMode = (search: string) => new URLSearchParams(search).get("pve") === "1";
export const newRoomCode = () => Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[b % 32]).join("");

export type Status = "joining" | "in" | "full" | "off";

export class Online {
  riders: Rider[] = [];
  status: Status = "joining";
  private ws: WebSocket | null = null;
  private sentAt = 0;
  private retry = 0;

  constructor(readonly room: string, private level: string, private pve: boolean, private real: boolean, private onChange: () => void) { this.connect(); }

  private connect() {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const q = new URLSearchParams({ room: this.room, level: this.level, uid: uid(), ...(this.pve ? { pve: "1" } : {}), ...(this.real ? { real: "1" } : {}) });
    const ws = new WebSocket(`${proto}://${location.host}/ws?${q}`);
    this.ws = ws;
    ws.onopen = () => { this.status = "in"; this.retry = 0; this.onChange(); };
    ws.onmessage = (e) => {
      try {
        const m = decodeServer(JSON.parse(String(e.data)));
        if (m?.t === "view") { this.riders = m.view.riders; this.onChange(); }
      } catch {}
    };
    ws.onclose = (e) => {
      this.riders = [];
      if (e.code === 4001) { this.status = "off"; this.onChange(); return; } // this rider joined from another tab
      this.status = this.status === "joining" && ++this.retry > 1 ? "full" : "joining"; // never got in: the room is full, or there is no server
      this.onChange();
      if (this.retry < 4) setTimeout(() => this.connect(), 1000 * (1 + this.retry));
    };
  }

  /** Send our pose, at most every 50 ms. */
  send(pose: Pose, now: number) {
    if (this.ws?.readyState !== WebSocket.OPEN || now - this.sentAt < SEND_MS) return;
    this.sentAt = now;
    this.ws.send(JSON.stringify({ skin: pose.skin, n: pose.n.map((v) => Math.round(v * 1000) / 1000) }));
  }
}
