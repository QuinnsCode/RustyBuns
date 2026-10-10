// Abuse limits, pure and clock-injected so the tests drive them by hand.
// TokenBucket guards one socket's messages in the World; RoomMintGate guards
// the Worker's front door.

/** `rate` tokens a second, up to `burst` saved. take() is false once it runs dry. */
export class TokenBucket {
  private tokens: number;
  private at: number;

  constructor(private rate: number, private burst: number, now: number) {
    this.tokens = burst;
    this.at = now;
  }

  take(now: number, cost = 1): boolean {
    this.tokens = Math.min(this.burst, this.tokens + Math.max(0, now - this.at) * this.rate / 1000);
    this.at = now;
    if (this.tokens < cost) return false;
    this.tokens -= cost;
    return true;
  }
}

/**
 * How many distinct rooms one client (by address) may open in a window.
 * Rejoining a room it already touched is free, so reconnects never count.
 * In-memory, so per Worker isolate: a speed bump against a script minting
 * Durable Objects in a loop, not a global quota.
 */
export class RoomMintGate {
  private seen = new Map<string, Map<string, number>>();

  constructor(private max = 12, private windowMs = 60_000, private maxKeys = 10_000) {}

  allow(key: string, room: string, now: number): boolean {
    const rooms = this.seen.get(key) ?? new Map<string, number>();
    this.seen.delete(key);                        // re-insert: the map's order is least recently seen first
    for (const [r, at] of rooms) if (now - at >= this.windowMs) rooms.delete(r);
    const ok = rooms.has(room) || rooms.size < this.max;
    if (ok) rooms.set(room, now);
    if (rooms.size) this.seen.set(key, rooms);
    if (this.seen.size > this.maxKeys) this.seen.delete(this.seen.keys().next().value!);
    return ok;
  }
}
