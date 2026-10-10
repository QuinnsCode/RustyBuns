// Where the match runs, from the page's point of view. Local: the Room runs
// right here (single player, no host needed). Net: the Room runs in a world,
// this machine's or a friend's or an online room's, and views arrive over a WebSocket.

import { worldSocket, playerId } from "@rustybuns/shell-bun/client";
import type { Look, Msg, View } from "../hunt/game.ts";
import { Room, TICK_MS } from "../room.ts";
import { fetchWeather } from "../weather.ts";

export type SessionStatus = { state: "connecting" | "online" | "closed"; error?: string };

export interface Session {
  readonly kind: "solo" | "host" | "guest" | "online";
  send(m: Msg): void;
  close(): void;
  /** Server clock minus this clock, in ms. */
  offset: number;
  onView: (v: View) => void;
  onStatus: (s: SessionStatus) => void;
}

export class LocalSession implements Session {
  readonly kind = "solo";
  offset = 0;
  onView: (v: View) => void = () => {};
  onStatus: (s: SessionStatus) => void = () => {};
  private room = new Room(Date.now(), fetchWeather);
  private timer: ReturnType<typeof setInterval>;
  private sent = -1;
  readonly me = "you";

  constructor(name: string, look: Look) {
    const now = Date.now();
    this.room.game.join(this.me, name, now, { host: true, look });
    for (let i = 0; i < 3; i++) this.room.game.handle(this.me, { t: "bot", level: "normal" }, now);
    this.timer = setInterval(() => { this.room.tick(Date.now()); this.push(); }, TICK_MS);
    queueMicrotask(() => { this.onStatus({ state: "online" }); this.push(); });
  }

  send(m: Msg) { this.room.handle(this.me, m, Date.now()); if (m.t !== "pos") this.push(); }
  close() { clearInterval(this.timer); this.onStatus({ state: "closed" }); }

  private push() {
    const g = this.room.game;
    if (g.version === this.sent) return;
    this.sent = g.version;
    this.onView(g.view(this.me, Date.now()));
  }

  /** The page's own hunt, for the radio grid. */
  get hunt() { return this.room.game; }
}

export class NetSession implements Session {
  offset = 0;
  onView: (v: View) => void = () => {};
  onStatus: (s: SessionStatus) => void = () => {};
  private ws: WebSocket;
  private closed = false;
  private queue: string[] = [];
  private seen = false;

  /** host: this machine's world at /ws. guest: `http://ip:port/ws` with the join query. online: /ws?room=CODE on the site. */
  constructor(readonly kind: "host" | "guest" | "online", target: string, params: Record<string, string | undefined> = {}) {
    this.ws = worldSocket(target, params);
    this.onStatus({ state: "connecting" });
    this.ws.onopen = () => { for (const m of this.queue.splice(0)) this.ws.send(m); this.onStatus({ state: "online" }); };
    this.ws.onmessage = (e) => {
      let m: any;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m.t !== "view") return;
      this.seen = true;
      this.offset = m.view.now - Date.now();
      this.onView(m.view);
    };
    this.ws.onclose = (e) => {
      if (this.closed) return;
      // A refused upgrade gives the page no status code, so name the usual causes.
      const error = e.code === 4001 ? "You joined from somewhere else."
        : this.seen ? "Lost the connection to the host."
        : kind === "online" ? "Couldn't reach that room. It may be full (8 players), or the server is busy; try again in a minute."
        : kind === "guest" ? "Couldn't join. Check the address and passphrase, that the host clicked Host a game, that you're on the same network, and that you both run the same build."
        : "Couldn't open the game world on this machine.";
      this.onStatus({ state: "closed", error });
    };
  }

  send(m: Msg) {
    const s = JSON.stringify(m);
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(s);
    else if (this.queue.length < 50) this.queue.push(s);
  }
  close() { this.closed = true; this.ws.close(1000); }
}

export { playerId };

/**
 * Online, one id per tab, kept across reloads so a reload rejoins as the same
 * player, but two tabs are two players (handy for trying it alone).
 */
export function tabPlayerId(): string {
  try {
    const have = sessionStorage.getItem("phs.uid");
    if (have) return have;
    const id = crypto.randomUUID().replace(/-/g, "");
    sessionStorage.setItem("phs.uid", id);
    return id;
  } catch { return crypto.randomUUID().replace(/-/g, ""); }
}
