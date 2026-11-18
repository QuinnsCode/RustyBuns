// Chat as a party and a space both have it (party.ts, space.ts): a line is up to SAY_MAX characters (STUDIO_SAY_MAX in a studio's space), trimmed, and each
// socket may send SAY_RATE a second with a burst of SAY_BURST. Who may speak (mute, membership) is the room's own call.
import { TokenBucket } from "@rustybuns/util/limits";
import type { RoomSocket } from "@rustybuns/util/room";

export const SAY_MAX = 280, STUDIO_SAY_MAX = 2000, SAY_RATE = 2, SAY_BURST = 5;
/** A party host's game moves (party.ts `game`): short, and their own rate, so a busy chat never holds a move up. */
export const GAME_MAX = 200, GAME_RATE = 4, GAME_BURST = 10;
export type Said = { from: { id: string; name: string }; text: string; at: number };

/** One bucket a socket, in memory: a woken room starts every socket full. */
export class ChatGate {
  private buckets = new WeakMap<RoomSocket, TokenBucket>();
  constructor(private rate = SAY_RATE, private burst = SAY_BURST) {}

  /** The line to keep, or null when it is empty or this socket is over its rate. */
  line(ws: RoomSocket, text: string, now = Date.now(), max = SAY_MAX): string | null {
    const t = text.trim();
    if (!t) return null;
    let b = this.buckets.get(ws);
    if (!b) this.buckets.set(ws, (b = new TokenBucket(this.rate, this.burst, now)));
    return b.take(now) ? t.slice(0, max) : null;
  }
}
