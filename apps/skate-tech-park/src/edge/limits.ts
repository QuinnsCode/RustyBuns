// Abuse limits for the online game, pure and clock-injected so tests drive them by hand.

/** `rate` tokens a second, up to `burst` saved. take() is false once it runs dry. */
export class TokenBucket {
  private tokens: number;
  private at: number;

  constructor(private rate: number, private burst: number, now: number) {
    this.tokens = burst;
    this.at = now;
  }

  take(now: number): boolean {
    this.tokens = Math.min(this.burst, this.tokens + Math.max(0, now - this.at) * this.rate / 1000);
    this.at = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

/** How many distinct rooms one address may touch in a window; rejoining one it touched is free. Per isolate. */
export class RoomMintGate {
  private seen = new Map<string, Map<string, number>>();

  constructor(private max = 12, private windowMs = 60_000, private maxKeys = 10_000) {}

  allow(key: string, room: string, now: number): boolean {
    const rooms = this.seen.get(key) ?? new Map<string, number>();
    this.seen.delete(key);
    for (const [r, at] of rooms) if (now - at >= this.windowMs) rooms.delete(r);
    const ok = rooms.has(room) || rooms.size < this.max;
    if (ok) rooms.set(room, now);
    if (rooms.size) this.seen.set(key, rooms);
    if (this.seen.size > this.maxKeys) this.seen.delete(this.seen.keys().next().value!);
    return ok;
  }
}

/** A browser's upgrade carries its page's Origin: allow our own, and localhost for dev. No Origin is not a browser. */
export function originAllowed(origin: string | null, url: URL): boolean {
  if (origin === null) return true;
  let o: URL;
  try { o = new URL(origin); } catch { return false; }
  if (o.host === url.host) return true;
  const h = o.hostname.replace(/^\[|\]$/g, "");
  return h === "localhost" || h.endsWith(".localhost") || h === "::1" || h === "127.0.0.1";
}
