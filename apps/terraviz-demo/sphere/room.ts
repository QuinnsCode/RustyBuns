// One shared globe per room: a Durable Object that relays where everyone points and what the lead is looking at.
// The same class is a Cloudflare Durable Object and, on the desktop, Rusty Buns' local twin. It keeps no globe of
// its own: the lead's camera, dataset and tour are the room's state, held so a late joiner lands where everyone
// else is. A room can be taught: the first to join with ?teach=<word> locks the lead to those who know the word,
// so a class follows the teacher's globe and no student can take the wheel. The teacher can open it again.
import { Bad, arr, bool, int, maybe, nul, num, obj, oneOf, str, type Guard, type Of } from "@rustybuns/util/guard";
import { TokenBucket } from "@rustybuns/util/limits";
import { Sockets, type RoomCtx, type RoomSocket } from "@rustybuns/util/room";

type Ctx = RoomCtx & {
  storage: { get<T>(k: string): Promise<T | undefined>; put(k: string, v: unknown): Promise<void>; delete(k: string): Promise<unknown> };
  blockConcurrencyWhile(f: () => Promise<void>): void;
};

/** Hands in one room. */
export const MAX_PEERS = 100;
/** Crowd mode: the room's camera moves on this beat (ms), from the deltas that arrived since the last one. */
export const TICK_MS = 100;
/** Drag messages a socket may send: about 20 a second, a short burst saved. */
const DRAG_RATE = 25, DRAG_BURST = 30;
/** The most the camera may move in one tick, whatever the crowd does (degrees, zoom levels). */
const MAX_STEP = 30, MAX_ZOOM_STEP = 2;
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

/** What the room keeps on a socket: the word they joined with stays here and never reaches another browser. */
type Seat = { id: string; name: string; color: string; word: string };
/** A seat as the room describes it to everyone: a teacher while their word is the room's. */
export type Peer = { id: string; name: string; color: string; teacher: boolean };

/** A field that may be left out, or be null on purpose ("no pointer", "no dataset"): `opt` and `maybe` both read
 *  null as left out, which here is the one thing it is not. */
const orNull = <T>(g: Guard<T>): Guard<T | null | undefined> => (v) => (v === undefined ? undefined : v === null ? null : g(v));
/** What a browser may say. Anything else is dropped. */
const Msg = obj({
  t: oneOf(["ptr", "cam", "ds", "lead", "unlead", "tour", "open", "crowd", "drag"]),
  // a drag: how far this hand pulled the globe since its last message, in degrees of longitude and latitude, and zoom levels
  dx: maybe(num(-MAX_STEP, MAX_STEP)), dy: maybe(num(-MAX_STEP, MAX_STEP)), dz: maybe(num(-MAX_ZOOM_STEP, MAX_ZOOM_STEP)),
  on: maybe(bool()),
  c: orNull(lngLat),
  z: maybe(num(0, 24)), b: maybe(num(-360, 360)), p: maybe(num(0, 90)),
  id: orNull(str(128)),
  url: orNull(str(512)), i: maybe(int(0, 10_000)), state: maybe(oneOf(["playing", "paused", "stopped"])),
});

export class SphereRoom {
  private sockets: Sockets<Seat>;
  private lead: string | null = null;
  private cam: Cam | null = null;
  private ds: string | null = null;
  private tour: Tour | null = null;
  /** The teacher's word, while the room is taught. */
  private key: string | null = null;
  /** Crowd mode: nobody leads, and every hand's pull is blended into the room's one camera. */
  private crowd = false;
  /** What each hand pulled since the last tick, by seat id. */
  private pulls = new Map<string, { dx: number; dy: number; dz: number }>();
  private tick: ReturnType<typeof setTimeout> | null = null;
  private dragBuckets = new WeakMap<RoomSocket, TokenBucket>();
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
      this.crowd = (await ctx.storage.get<boolean>("crowd")) ?? false;
      if (this.crowd) this.cam = (await ctx.storage.get<Cam>("cam")) ?? null; // a lead's camera is not kept; the crowd's is
    })();
    ctx.blockConcurrencyWhile(() => this.ready);
  }

  private teaches(seat: Seat) { return seat.word !== "" && seat.word === this.key; }
  private pub(seat: Seat): Peer { return { id: seat.id, name: seat.name, color: seat.color, teacher: this.teaches(seat) }; }
  private peers(): Array<{ ws: RoomSocket; seat: Seat }> {
    return this.sockets.open().flatMap((ws) => { const seat = this.sockets.who(ws); return seat ? [{ ws, seat }] : []; });
  }

  /** The lock changed: everyone hears it, each with whether they teach under it. */
  private async setKey(key: string | null) {
    this.key = key;
    if (key) await this.ctx.storage.put("key", key); else await this.ctx.storage.delete("key");
    for (const { ws, seat } of this.peers()) this.sockets.send(ws, { t: "locked", locked: !!key, teacher: this.teaches(seat) });
  }

  /** Crowd mode on or off. On, the lead lets go (the crowd steers); the camera starts where `from` says, or where the room was. */
  private async setCrowd(on: boolean, from: Cam | null) {
    if (on === this.crowd) return;
    this.crowd = on;
    this.pulls.clear();
    await this.ctx.storage.put("crowd", on);
    if (on) {
      if (this.lead) await this.setLead(null);
      this.cam = from ?? this.cam ?? { c: [0, 20], z: 1.5, b: 0, p: 0 };
      await this.ctx.storage.put("cam", this.cam);
    }
    this.sockets.broadcast({ t: "crowd", on, cam: on ? this.cam : null });
  }

  /** Who may flip crowd mode: the teacher when the room is taught, anyone otherwise. */
  private mayCrowd(seat: Seat) { return !this.key || this.teaches(seat); }

  /** One beat: add up what each hand pulled, average over the hands that moved, push the camera that far.
   *  The mean is scaled by the square root of the hands, so a crowd pulling one way is a bigger push than one hand
   *  (three hands: 1.7 times) and hands pulling opposite ways cancel exactly. */
  private flush() {
    this.tick = null;
    const pulls = [...this.pulls.values()];
    this.pulls.clear();
    if (!this.crowd || !this.cam || !pulls.length) return;
    const n = pulls.length, k = Math.sqrt(n) / n;
    const sum = (f: (p: { dx: number; dy: number; dz: number }) => number) => pulls.reduce((a, p) => a + f(p), 0) * k;
    const lim = (v: number, m: number) => Math.max(-m, Math.min(m, v));
    const dx = lim(sum((p) => p.dx), MAX_STEP), dy = lim(sum((p) => p.dy), MAX_STEP), dz = lim(sum((p) => p.dz), MAX_ZOOM_STEP);
    if (dx === 0 && dy === 0 && dz === 0) return;
    let lng = this.cam.c[0] + dx;
    lng = ((((lng + 180) % 360) + 360) % 360) - 180;
    this.cam = { ...this.cam, c: [lng, Math.max(-85, Math.min(85, this.cam.c[1] + dy))], z: Math.max(0, Math.min(22, this.cam.z + dz)) };
    void this.ctx.storage.put("cam", this.cam);
    this.sockets.broadcast({ t: "cam", from: "crowd", ...this.cam, hands: n });
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
    if (this.lead && !peers.some((p) => p.seat.id === this.lead)) await this.setLead(null);
    const q = new URL(req.url).searchParams;
    const id = crypto.randomUUID().slice(0, 8);
    const name = clean(q.get("name"), 24) || `Guest ${id.slice(0, 4)}`;
    // the first to bring a word teaches the room; anyone else with the same word teaches too (a reload, a co-teacher)
    const word = clean(q.get("teach"), 64);
    if (word && !this.key) await this.setKey(word); // those already here hear the room lock
    const seat: Seat = { id, name, color: COLORS[parseInt(id.slice(0, 6), 16) % COLORS.length]!, word };
    const { server, response } = this.sockets.upgrade(seat);
    this.sockets.send(server, {
      t: "hello", you: this.pub(seat), peers: peers.map((p) => this.pub(p.seat)), lead: this.lead, cam: this.cam, ds: this.ds, tour: this.tour, locked: !!this.key,
      crowd: this.crowd,
    });
    this.sockets.broadcast({ t: "join", ...this.pub(seat) }, server);
    // a teacher walking into a room nobody leads takes it, so the class follows without a click
    if (this.teaches(seat) && !this.lead) await this.setLead(id);
    return response;
  }

  async webSocketMessage(ws: RoomSocket, raw: string | ArrayBuffer) {
    await this.ready;
    const seat = this.sockets.who(ws), frame = this.sockets.frame(ws, raw);
    if (!seat || !frame) return;
    let m: Of<typeof Msg>;
    try { m = Msg(frame.value); } catch { return; }
    const from = seat.id, leads = from === this.lead, teacher = this.teaches(seat);
    switch (m.t) {
      case "ptr": // anyone's pointer, or null when it leaves the globe
        if (m.c !== undefined) this.sockets.broadcast({ t: "ptr", from, c: m.c }, ws);
        return;
      case "cam": { // only the lead steers
        if (this.crowd || !leads || m.c === undefined || m.c === null || m.z === undefined || m.b === undefined || m.p === undefined) return;
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
      case "crowd": { // crowd mode on or off; turning it on may bring the camera the switcher is looking at
        if (m.on === undefined || !this.mayCrowd(seat)) return;
        const here = m.c && m.z !== undefined ? { c: m.c, z: m.z, b: m.b ?? 0, p: m.p ?? 0 } : null;
        await this.setCrowd(m.on, here);
        return;
      }
      case "drag": { // a hand pulling the globe: kept until the next beat
        if (!this.crowd) return;
        const now = Date.now();
        let b = this.dragBuckets.get(ws);
        if (!b) this.dragBuckets.set(ws, (b = new TokenBucket(DRAG_RATE, DRAG_BURST, now)));
        if (!b.take(now)) return;
        const p = this.pulls.get(from) ?? { dx: 0, dy: 0, dz: 0 };
        p.dx += m.dx ?? 0; p.dy += m.dy ?? 0; p.dz += m.dz ?? 0;
        this.pulls.set(from, p);
        this.tick ??= setTimeout(() => this.flush(), TICK_MS);
        return;
      }
      case "lead": // take the wheel: a classroom, so anyone may, unless a teacher holds the room
        if (this.crowd || (this.key && !teacher)) return;
        if (this.lead !== from) await this.setLead(from);
        return;
      case "unlead":
        if (leads) await this.setLead(null);
        return;
      case "open": // the teacher lets the room go: anyone may lead again
        if (teacher) await this.setKey(null);
        return;
    }
  }

  async webSocketClose(ws: RoomSocket) {
    await this.ready;
    const seat = this.sockets.who(ws);
    ws.serializeAttachment(null); // a closed socket workerd still lists is nobody
    try { ws.close(1000, "bye"); } catch { /* already closed */ }
    if (!seat) return;
    this.pulls.delete(seat.id);
    this.sockets.broadcast({ t: "leave", id: seat.id }, ws);
    if (this.lead === seat.id) await this.setLead(null);
  }

  webSocketError(ws: RoomSocket) { return this.webSocketClose(ws); }
}
