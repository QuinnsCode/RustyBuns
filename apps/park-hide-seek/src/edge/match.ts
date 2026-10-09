// Quick play online: everyone who presses Play within the same few seconds is
// handed the same room code, and that room starts when the window closes, with
// AI in the empty spots. One Matchmaker Durable Object (idFromName("quick"))
// keeps the open window, and tells each new room's World when to start, so the
// World starts it on an alarm whether or not anyone's tab is awake. QuickMatch
// is the pure part, clock-injected for tests.

export const QUICK = {
  /** How long a quick room waits for people before it starts. */
  windowMs: 12_000,
  /** Too little time left to connect: open a fresh room instead. */
  minLeftMs: 3_000,
  /** People per quick room; AI fills it out to a game. */
  maxPeople: 6,
  /** Players a quick room starts with, people and AI. */
  size: 4,
};

export type DONamespace = { idFromName(n: string): unknown; get(id: unknown): { fetch(r: Request): Promise<Response> } };

// No 0/O or 1/I, so a code read out loud comes out right. Q marks a quick room.
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const quickCode = () => "Q" + Array.from(crypto.getRandomValues(new Uint32Array(5)), (n) => CODE_CHARS[n % CODE_CHARS.length]).join("");

export class QuickMatch {
  private open: { room: string; until: number; people: Set<string> } | null = null;

  constructor(private code: () => string = quickCode) {}

  /** The room for this player, and how long until it starts. Asking again gets the same answer. */
  /** `opened` is true for the first player of a new room. */
  pick(uid: string, now: number): { room: string; startsIn: number; opened: boolean } {
    const o = this.open;
    const fresh = !o || o.until - now < QUICK.minLeftMs || (o.people.size >= QUICK.maxPeople && !o.people.has(uid));
    if (fresh) this.open = { room: this.code(), until: now + QUICK.windowMs, people: new Set() };
    this.open!.people.add(uid);
    return { room: this.open!.room, startsIn: this.open!.until - now, opened: fresh };
  }
}

export class Matchmaker {
  private quick = new QuickMatch();

  constructor(_ctx: unknown, private env: { WORLD: DONamespace }) {}

  async fetch(req: Request): Promise<Response> {
    const uid = new URL(req.url).searchParams.get("uid") ?? "";
    const now = Date.now();
    const { room, startsIn, opened } = this.quick.pick(uid, now);
    if (opened) {
      const world = this.env.WORLD.get(this.env.WORLD.idFromName(room));
      await world.fetch(new Request(`https://world/quick?at=${now + startsIn}`, { method: "POST" })).catch(() => {});
    }
    return Response.json({ room, startsIn }, { headers: { "Cache-Control": "no-store" } });
  }
}
