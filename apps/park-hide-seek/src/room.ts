// A Hunt plus the bots that play in it. The page runs one for single player and
// the world runs one for LAN games; both call tick() on a timer and send each
// person view(id).

import { HuntBot } from "./hunt/bots.ts";
import { Hunt, type Msg } from "./hunt/game.ts";
import { hashString } from "./geo.ts";

export const TICK_MS = 50;

export class Room {
  readonly game: Hunt;
  private bots = new Map<string, HuntBot>();

  constructor(seed = Date.now()) { this.game = new Hunt(seed); }

  handle(id: string, m: Msg, now: number) { this.game.handle(id, m, now); }

  tick(now: number) {
    const g = this.game;
    g.tick(now);
    for (const p of g.players) {
      if (!p.bot) continue;
      let b = this.bots.get(p.id);
      if (!b) { b = new HuntBot(p.id, p.bot, hashString(p.id)); this.bots.set(p.id, b); }
      if (g.phase === "lobby" || g.phase === "over") continue;
      for (const m of b.tick(g, now)) g.handle(p.id, m, now);
    }
    for (const id of this.bots.keys()) if (!g.players.some((p) => p.id === id)) this.bots.delete(id);
  }
}
