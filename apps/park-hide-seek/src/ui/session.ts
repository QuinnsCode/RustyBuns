// Where the match runs, from the page's point of view. Local: the Room runs
// right here (single player, no host needed). Net: the Room runs in a world,
// this machine's or a friend's or an online room's, and views arrive over a WebSocket.

import { worldUrl, playerId } from "@rustybuns/shell-bun/client";
import { connectSocket, type Link } from "@rustybuns/util/socket";
import { UPDATE_CLOSE, UPDATE_TEXT } from "@rustybuns/util/protocol";
import { STORE_URL } from "../api.ts";
import { isServerMsg, type BotLevel, type Look, type Msg, type ServerMsg, type View } from "../hunt/game.ts";
import type { Role } from "../hunt/sim.ts";
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

  constructor(name: string, look: Look, opts: { role?: Role; bots?: number; level?: BotLevel } = {}) {
    const now = Date.now();
    this.room.game.join(this.me, name, now, { host: true, look });
    if (opts.role) this.room.game.firstRole = { id: this.me, role: opts.role };
    for (let i = 0; i < (opts.bots ?? 3); i++) this.room.game.handle(this.me, { t: "bot", level: opts.level ?? "normal" }, now);
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
  private link: Link<Msg>;

  /** host: this machine's world at /ws. guest: `http://ip:port/ws` with the join query. online: /ws?room=CODE on the site. */
  constructor(readonly kind: "host" | "guest" | "online", target: string, params: Record<string, string | undefined> = {}) {
    this.onStatus({ state: "connecting" });
    this.link = connectSocket<ServerMsg, Msg>(worldUrl(target, params), {
      decode: (v) => (isServerMsg(v) ? v : null), queue: 50,
      onOpen: () => this.onStatus({ state: "online" }),
      onMessage: (m) => { this.offset = m.view.now - Date.now(); this.onView(m.view); },
      onClose: (e) => {
        // A refused upgrade gives the page no status code, so name the usual causes.
        const error = e.code === UPDATE_CLOSE ? `${UPDATE_TEXT}: ${STORE_URL}`
          : e.code === 4001 ? "You joined from somewhere else."
          : e.seen ? "Lost the connection to the host."
          : kind === "online" ? "Couldn't reach that room. It may be full (8 players), or the server is busy; try again in a minute."
          : kind === "guest" ? "Couldn't join. Check the address and passphrase, that the host clicked Host a game, that you're on the same network, and that you both run the same build."
          : "Couldn't open the game world on this machine.";
        this.onStatus({ state: "closed", error });
      },
    });
  }

  send(m: Msg) { this.link.send(m); }
  close() { this.link.close(1000); }
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
