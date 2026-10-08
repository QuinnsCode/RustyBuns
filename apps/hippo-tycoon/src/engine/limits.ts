// Abuse limits, pure and clock-injected so the tests drive them by hand.
// TokenBucket guards one socket's messages in the Room; RoomMintGate and
// originAllowed guard the Worker's front door.

/** `rate` tokens a second, up to `burst` saved. take() is false once it runs dry. */
export class TokenBucket {
  private tokens: number;
  private at: number;

  constructor(private rate: number, private burst: number, now: number) {
    this.tokens = burst;
    this.at = now;
  }

  take(now: number, rate = this.rate, burst = this.burst): boolean {
    this.tokens = Math.min(burst, this.tokens + Math.max(0, now - this.at) * rate / 1000);
    this.at = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
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

const privateV4 = (h: string) => {
  const p = h.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = p as [number, number];
  return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254);
};

/**
 * A browser's WebSocket upgrade carries its page's Origin. Allow our own
 * origin, and localhost or LAN addresses for dev servers. No Origin at all is
 * not a browser (a script can send any header it likes anyway), so it passes.
 */
export function originAllowed(origin: string | null, url: URL): boolean {
  if (origin === null) return true;
  let o: URL;
  try { o = new URL(origin); } catch { return false; }
  if (o.host === url.host) return true;
  const h = o.hostname.replace(/^\[|\]$/g, "");
  return h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h === "::1" || privateV4(h);
}
