// One shared globe per room: a Durable Object that relays where everyone points and what the lead is looking at.
// The same class is a Cloudflare Durable Object and, on the desktop, Rusty Buns' local twin. It keeps no globe of
// its own: the lead's camera, dataset and tour are the room's state, held so a late joiner lands where everyone
// else is. A room can be taught: the first to join with ?teach=<word> locks the lead to those who know the word,
// so a class follows the teacher's globe and no student can take the wheel. The teacher can open it again.
import { Bad, arr, int, maybe, nul, num, obj, oneOf, str, type Guard, type Of } from "@rustybuns/util/guard";
import { Sockets, type RoomCtx, type RoomSocket } from "@rustybuns/util/room";

type Ctx = RoomCtx & {
  storage: { get<T>(k: string): Promise<T | undefined>; put(k: string, v: unknown): Promise<void>; delete(k: string): Promise<unknown> };
  blockConcurrencyWhile(f: () => Promise<void>): void;
};

export const MAX_PEERS = 64;
const COLORS = ["#f97316", "#22c55e", "#3b82f6", "#e11d48", "#a855f7", "#14b8a6", "#eab308", "#ec4899"];

export const clean = (s: string | null | undefined, max: number) => (s ?? "").replace(/\p{C}/gu, "").trim().slice(0, max);

/** A place on the globe: [lng, lat], the longitude unwrapped as MapLibre reports it. */
const lngLat: Guard<[number, number]> = (v) => {
  const [lng, lat] = arr(num(-540, 540), 2, { min: 2 })(v) as [number, number];
  if (lat < -90 || lat > 90) throw new Bad("a latitude from -90 to 90", [1]);
  return [lng, lat];
};
/** The lead's view, as MapLibre takes it: centre [lng, lat], zoom, bearing, pitch. */
export const Cam = obj({ c: lngLat, z: num(0, 24), b: num(-360, 360), p: num(0, 90) });
export type Cam = Of<typeof Cam>;
/** The lead's tour: the script's address (null when it came from somewhere followers can't fetch), the engine's
 *  task index and whether it runs. */
export const Tour = obj({ url: nul(str(512)), i: int(0, 10_000), state: oneOf(["playing", "paused", "stopped"]) });
export type Tour = Of<typeof Tour>;

export type Peer = { id: string; name: string; color: string; teacher: boolean };

/** A field that may be left out, or be null on purpose ("no pointer", "no dataset"): `opt` and `maybe` both read
 *  null as left out, which here is the one thing it is not. */
const orNull = <T>(g: Guard<T>): Guard<T | null | undefined> => (v) => (v === undefined ? undefined : v === null ? null : g(v));
/** What a browser may say. Anything else is dropped. */
const Msg = obj({
  t: oneOf(["ptr", "cam", "ds", "lead", "unlead", "tour", "open"]),
  c: orNull(lngLat),
  z: maybe(num(0, 24)), b: maybe(num(-360, 360)), p: maybe(num(0, 90)),
  id: orNull(str(128)),
  url: orNull(str(512)), i: maybe(int(0, 10_000)), state: maybe(oneOf(["playing", "paused", "stopped"])),
});

export class SphereRoom {
  private sockets: Sockets<Peer>;
  private lead: string | null = null;
  private cam: Cam | null = null;
  private ds: string | null = null;
  private tour: Tour | null = null;
  /** The teacher's word, while the room is taught. */
  private key: string | null = null;
  /** The saved state, read. workerd holds events until blockConcurrencyWhile settles; the local twin may not, so
   *  every handler waits on this itself rather than let a join race the read and lose the lock. */
  private ready: Promise<void>;

  constructor(private ctx: Ctx, _env: unknown) {
    this.sockets = new Sockets(ctx, { maxBytes: 1024, rate: 40, burst: 80 });
    this.ready = (async () => {
      this.lead = (await ctx.storage.get<string>("lead")) ?? null;
      this.ds = (await ctx.storage.get<string>("ds")) ?? null;
      this.key = (await ctx.storage.get<string>("key")) ?? null;
      this.tour = (await ctx.storage.get<Tour>("tour")) ?? null;
    })();
    ctx.blockConcurrencyWhile(() => this.ready);
  }

  private peers(): Array<{ ws: RoomSocket; peer: Peer }> {
    return this.sockets.open().flatMap((ws) => { const peer = this.sockets.who(ws); return peer ? [{ ws, peer }] : []; });
  }

  private async setLead(id: string | null) {
    this.lead = id;
    if (!id) { this.cam = null; this.tour = null; await this.ctx.storage.delete("tour"); }
    await this.ctx.storage.put("lead", id);
    this.sockets.broadcast({ t: "lead", id });
  }

  async fetch(req: Request): Promise<Response> {
    if (req.headers.get("Upgrade")?.toLowerCase() !== "websocket") return new Response("websocket only", { status: 400 });
    await this.ready;
    const peers = this.peers();
    if (peers.length >= MAX_PEERS) return new Response("this globe is full", { status: 503 });
    // a lead saved before a restart whose socket didn't come back: nobody can follow a ghost
    if (this.lead && !peers.some((p) => p.peer.id === this.lead)) await this.setLead(null);
    const q = new URL(req.url).searchParams;
    const id = crypto.randomUUID().slice(0, 8);
    const name = clean(q.get("name"), 24) || `Guest ${id.slice(0, 4)}`;
    // the first to bring a word teaches the room; anyone else with the same word teaches too (a reload, a co-teacher)
    const word = clean(q.get("teach"), 64);
    if (word && !this.key) { this.key = word; await this.ctx.storage.put("key", word); }
    const teacher = !!word && word === this.key;
    const peer: Peer = { id, name, color: COLORS[parseInt(id.slice(0, 6), 16) % COLORS.length]!, teacher };
    const { server, response } = this.sockets.upgrade(peer);
    this.sockets.send(server, {
      t: "hello", you: peer, peers: peers.map((p) => p.peer), lead: this.lead, cam: this.cam, ds: this.ds, tour: this.tour, locked: !!this.key,
    });
    this.sockets.broadcast({ t: "join", ...peer }, server);
    // a teacher walking into a room nobody leads takes it, so the class follows without a click
    if (teacher && !this.lead) await this.setLead(id);
    return response;
  }

  async webSocketMessage(ws: RoomSocket, raw: string | ArrayBuffer) {
    await this.ready;
    const peer = this.sockets.who(ws), frame = this.sockets.frame(ws, raw);
    if (!peer || !frame) return;
    let m: Of<typeof Msg>;
    try { m = Msg(frame.value); } catch { return; }
    const from = peer.id, leads = from === this.lead;
    switch (m.t) {
      case "ptr": // anyone's pointer, or null when it leaves the globe
        if (m.c !== undefined) this.sockets.broadcast({ t: "ptr", from, c: m.c }, ws);
        return;
      case "cam": { // only the lead steers
        if (!leads || m.c === undefined || m.c === null || m.z === undefined || m.b === undefined || m.p === undefined) return;
        this.cam = { c: m.c, z: m.z, b: m.b, p: m.p };
        this.sockets.broadcast({ t: "cam", from, ...this.cam }, ws);
        return;
      }
      case "ds": { // the lead's dataset: an id TerraViz's own loader resolves, or null for none
        if (!leads || m.id === undefined) return;
        this.ds = m.id === null ? null : clean(m.id, 128) || null;
        await this.ctx.storage.put("ds", this.ds);
        this.sockets.broadcast({ t: "ds", from, id: this.ds }, ws);
        return;
      }
      case "tour": { // the lead's tour, as TerraViz's engine reports it
        if (!leads || m.url === undefined || m.i === undefined || m.state === undefined) return;
        this.tour = m.state === "stopped" ? null : { url: m.url, i: m.i, state: m.state };
        await this.ctx.storage.put("tour", this.tour);
        this.sockets.broadcast({ t: "tour", from, tour: this.tour }, ws);
        return;
      }
      case "lead": // take the wheel: a classroom, so anyone may, unless a teacher holds the room
        if (this.key && !peer.teacher) return;
        if (this.lead !== from) await this.setLead(from);
        return;
      case "unlead":
        if (leads) await this.setLead(null);
        return;
      case "open": // the teacher lets the room go: anyone may lead again
        if (!peer.teacher) return;
        this.key = null;
        await this.ctx.storage.delete("key");
        this.sockets.broadcast({ t: "locked", locked: false });
        return;
    }
  }

  async webSocketClose(ws: RoomSocket) {
    await this.ready;
    const peer = this.sockets.who(ws);
    ws.serializeAttachment(null); // a closed socket workerd still lists is nobody
    try { ws.close(1000, "bye"); } catch { /* already closed */ }
    if (!peer) return;
    this.sockets.broadcast({ t: "leave", id: peer.id }, ws);
    if (this.lead === peer.id) await this.setLead(null);
  }

  webSocketError(ws: RoomSocket) { return this.webSocketClose(ws); }
}
