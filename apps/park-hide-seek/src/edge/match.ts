// Quick play online: everyone who presses Play within the same few seconds is
// handed the same room code, and that room starts when the window closes, with
// AI in the empty spots. One Matchmaker Durable Object (idFromName("quick"))
// keeps the open window; QuickMatch is the pure part, clock-injected for tests.

export const QUICK = {
  /** How long a quick room waits for people before it starts. */
  windowMs: 12_000,
  /** Too little time left to connect: open a fresh room instead. */
  minLeftMs: 3_000,
  /** People per quick room; AI fills it out to a game. */
  maxPeople: 6,
};

// No 0/O or 1/I, so a code read out loud comes out right. Q marks a quick room.
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const quickCode = () => "Q" + Array.from(crypto.getRandomValues(new Uint32Array(5)), (n) => CODE_CHARS[n % CODE_CHARS.length]).join("");

export class QuickMatch {
  private open: { room: string; until: number; people: Set<string> } | null = null;

  constructor(private code: () => string = quickCode) {}

  /** The room for this player, and how long until it starts. Asking again gets the same answer. */
  pick(uid: string, now: number): { room: string; startsIn: number } {
    const o = this.open;
    const fresh = !o || o.until - now < QUICK.minLeftMs || (o.people.size >= QUICK.maxPeople && !o.people.has(uid));
    if (fresh) this.open = { room: this.code(), until: now + QUICK.windowMs, people: new Set() };
    this.open!.people.add(uid);
    return { room: this.open!.room, startsIn: this.open!.until - now };
  }
}

export class Matchmaker {
  private quick = new QuickMatch();

  constructor(_ctx: unknown, _env: unknown) {}

  fetch(req: Request): Response {
    const uid = new URL(req.url).searchParams.get("uid") ?? "";
    return Response.json(this.quick.pick(uid, Date.now()), { headers: { "Cache-Control": "no-store" } });
  }
}
