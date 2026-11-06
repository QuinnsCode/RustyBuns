// Chat as a party and a space both have it (party.ts, space.ts): a line is up to SAY_MAX characters, trimmed, and each
// socket may send SAY_RATE a second with a burst of SAY_BURST. Who may speak (mute, membership) is the room's own call.
import { TokenBucket } from "@rustybuns/util/limits";
import type { RoomSocket } from "@rustybuns/util/room";

export const SAY_MAX = 280, SAY_RATE = 2, SAY_BURST = 5;
export type Said = { from: { id: string; name: string }; text: string; at: number };

/** One bucket a socket, in memory: a woken room starts every socket full. */
export class ChatGate {
  private buckets = new WeakMap<RoomSocket, TokenBucket>();

  /** The line to keep, or null when it is empty or this socket is over its rate. */
  line(ws: RoomSocket, text: string, now = Date.now()): string | null {
    const t = text.trim();
    if (!t) return null;
    let b = this.buckets.get(ws);
    if (!b) this.buckets.set(ws, (b = new TokenBucket(SAY_RATE, SAY_BURST, now)));
    return b.take(now) ? t.slice(0, SAY_MAX) : null;
  }
}
