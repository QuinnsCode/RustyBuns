// One Durable Object per party per occupied region (src/net/wire.ts `roomOf`), never one per player. It relays: each
// page walks and fights in its own sim, and the room only passes on where everyone stands, who leads their line-up,
// and which dens someone walked into, so a den one of the party fights is quiet for all of them.
//
// Cheap by design (bun scripts/cost.ts prices it): hibernating sockets (`Sockets`), so the room is billed only while
// a message is being handled; no timer, since a pending one would keep it billed between messages (each pose goes
// straight on to the others, and messages out are free); nothing in storage (a save is the player's own page).
// What must outlive hibernation rides on the sockets' attachments: who sits where, and the quiet dens.
// The Worker (worker.ts) checks the eqosys token and vouches who the player is in X-User-Id and X-User-Name.
import { Sockets, type RoomCtx, type RoomSocket } from "@rustybuns/util/room";
import { check } from "@rustybuns/util/guard";
import { CLOSE_FULL, CLOSE_REPLACED, MAX_PARTY, Up, type Down, type Walker } from "../net/wire.ts";

/** A pose is 5 a second; a lead or a den now and then on top. A frame past 200 bytes is no pose. */
const LIMITS = { maxBytes: 200, rate: 8, burst: 16 };
/** How long a den someone walked into stays quiet, as on the page (src/world/view.ts CALM_MS). */
export const CALM_MS = 90_000;
/** Quiet dens kept at once: an attachment holds a couple of KB. */
const CALM_MAX = 24;

/** What a socket carries through hibernation: who, in which seat, leading with what, and the room's quiet dens. */
interface Seat { id: string; name: string; s: number; lead: string; calm: [string, number][] }

export class RegionRoom {
  private sockets: Sockets<Seat, Down>;

  constructor(ctx: RoomCtx, _env: unknown) {
    this.sockets = new Sockets(ctx, LIMITS);
  }

  private seats(): Seat[] {
    const out = new Map<number, Seat>();
    for (const ws of this.sockets.open()) { const a = this.sockets.who(ws); if (a) out.set(a.s, a); }
    return [...out.values()].sort((a, b) => a.s - b.s);
  }

  /** The dens still quiet, from every socket's copy (a woken room has nothing else). */
  private calm(now = Date.now()): [string, number][] {
    const all = new Map<string, number>();
    for (const a of this.seats()) for (const [den, until] of a.calm) if (until > now) all.set(den, Math.max(until, all.get(den) ?? 0));
    return [...all].sort((a, b) => b[1] - a[1]).slice(0, CALM_MAX);
  }

  async fetch(req: Request): Promise<Response> {
    if (req.headers.get("Upgrade")?.toLowerCase() !== "websocket") return new Response("websocket only", { status: 426 });
    const id = req.headers.get("X-User-Id"), name = req.headers.get("X-User-Name") || "Walker";
    if (!id) return new Response("who are you?", { status: 401 });
    const seats = this.seats(), mine = seats.find((a) => a.id === id), calm = this.calm();
    const taken = new Set(seats.map((a) => a.s));
    const s = mine?.s ?? [...Array(MAX_PARTY).keys()].find((k) => !taken.has(k));
    const lead = new URL(req.url).searchParams.get("lead") ?? "";
    const { server, response } = this.sockets.upgrade({ id, name, s: s ?? -1, lead: /^[a-z0-9-]{1,40}$/.test(lead) ? lead : "", calm });
    if (s === undefined) { server.close(CLOSE_FULL, "the party is full here"); return response; }
    this.sockets.replace(server, (a) => a.id === id, CLOSE_REPLACED);
    this.sockets.send(server, { t: "hi", you: s, now: Date.now(), calm: calm.map(([den]) => den) });
    this.who();
    return response;
  }

  webSocketMessage(ws: RoomSocket, raw: string | ArrayBuffer) {
    const f = this.sockets.frame(ws, raw), me = this.sockets.who(ws);
    const m = f && me && me.s >= 0 ? check(Up, f.value) : null;
    if (!m || !me) return;
    if (m.t === "p") this.sockets.broadcast({ t: "v", p: [[me.s, m.x, m.z, m.h]] }, ws);
    else if (m.t === "lead" && m.id !== me.lead) { this.sockets.attach(ws, { ...me, lead: m.id }); this.who(); }
    else if (m.t === "calm") {
      const calm = this.calm();
      if (calm.some(([den]) => den === m.den)) return;
      calm.unshift([m.den, Date.now() + CALM_MS]);
      for (const w of this.sockets.open()) { const a = this.sockets.who(w); if (a) this.sockets.attach(w, { ...a, calm: calm.slice(0, CALM_MAX) }); }
      this.sockets.broadcast({ t: "calm", den: m.den, s: me.s }, ws);
    }
  }

  webSocketClose(ws: RoomSocket) { this.gone(ws); }
  webSocketError(ws: RoomSocket) { this.gone(ws); }

  private gone(ws: RoomSocket) {
    try { ws.close(1000, "bye"); } catch { /* closed */ }
    this.who();
  }

  /** Who is here, to everyone: a page that hears of someone new sends its pose again, so a still walker is seen too. */
  private who() {
    const walkers: Walker[] = this.seats().filter((a) => a.s >= 0).map(({ s, name, lead }) => ({ s, name: name.slice(0, 40), lead }));
    this.sockets.broadcast({ t: "who", walkers });
  }
}
