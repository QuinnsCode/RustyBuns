// Agent Galaxy: every world is a plot on one shared map, and people walk through it as small characters. This is the
// map's logic with no platform in it, as relay.ts is to the Room: the Worker's Galaxy Durable Object (edge/galaxy.ts)
// and the local dev server (scripts/dev.ts) each hand it their storage and their sockets.
// - Plots sit on a square grid that spirals out from the middle. Plot 0, at (0, 0), is the common city
//   (commonCity.ts): ours, nobody's. Each claim takes the next cell of the spiral, but every third cell stays
//   free, kept for invites, so there are empty plots to walk past.
// - A plot is known to the page by a public id, never by its room: a room's link is its key (it can drive the room's
//   agent tools), so the map hands out a one-way hash of it and the server looks the room up when a page asks for a
//   plot's picture or world.
// - A plot is a person's: signed in through eqosys (who.ts), `eq:<sub>`. Each person has one world, the first room
//   they signed in from (POST /api/me/world), and claims a plot for it once that world is made (lock.ts): the AI's
//   write loaded clean and the page saved it (POST /api/r/<room>/made). Nothing sent out names the person or the room.
// - Players are name-less robots with a plot and a spot on it. A move goes only to players on the same or a touching
//   plot.
// - A person's robot is a pick from fixed lists (Look), never free text or a colour of their own. It is kept for them
//   (GET and PUT /api/galaxy/robot) and goes with their player to those near.
import { sha256 } from "@rustybuns/util/bytes";
import { arr, bool, check, int, nul, num, obj, oneOf, opt, str, type Of } from "@rustybuns/util/guard";
import { json, readJson } from "@rustybuns/util/http";
import { TokenBucket } from "@rustybuns/util/limits";
import { MAKE_FIRST } from "./lock.ts";
import { fromPage } from "./relay.ts";
import { Made } from "./saved.ts";
import { SIGN_FIRST, type SignReply, Signs } from "./sign.ts";
import { ROOM } from "./tools.ts";

// ---------- the spiral ----------

/** Cell `n` of the spiral as grid (x, y): x runs west to east, y north to south. Ring k (k >= 1) is the 8k cells
 *  around the square of side 2k - 1; it starts just south of its north-east corner and goes round clockwise on screen. */
export function spiral(n: number): { x: number; y: number } {
  if (n === 0) return { x: 0, y: 0 };
  const k = Math.ceil((Math.sqrt(n + 1) - 1) / 2);
  const i = n - (2 * k - 1) ** 2, side = Math.floor(i / (2 * k)), t = i % (2 * k);
  switch (side) {
    case 0: return { x: k, y: -k + 1 + t };
    case 1: return { x: k - 1 - t, y: k };
    case 2: return { x: -k, y: k - 1 - t };
    default: return { x: -k + 1 + t, y: -k };
  }
}

/** The spiral cell at (x, y): `spiral`'s inverse. */
export function cellOf(x: number, y: number): number {
  const k = Math.max(Math.abs(x), Math.abs(y));
  if (k === 0) return 0;
  const base = (2 * k - 1) ** 2;
  if (x === k && y > -k) return base + (y + k - 1);
  if (y === k) return base + 2 * k + (k - 1 - x);
  if (x === -k) return base + 4 * k + (k - 1 - y);
  return base + 6 * k + (x + k - 1);
}

/** Every third cell is never claimed: it waits for an invite (PR 5), so the map always has empty plots. */
export const keptFree = (n: number) => n > 0 && n % 3 === 0;

// ---------- what goes over the wire ----------

const Coord = int(-10_000, 10_000);
/** A plot as the page sees it: where it is, its public id (null when empty), whether it is the common city, and its
 *  sign's version (sign.ts; 0 for none). */
export const Plot = obj({ x: Coord, y: Coord, id: nul(str(32)), empty: bool(), city: bool(), signed: int(0, 1_000_000_000) });
export type Plot = Of<typeof Plot>;
export const Plots = obj({ plots: arr(Plot, 64) });
export type Plots = Of<typeof Plots>;
/** A claim's answer: the plot this room holds. */
export const Claimed = obj({ x: Coord, y: Coord, id: str(32) });
export type Claimed = Of<typeof Claimed>;
/** A claim's body, and POST /api/me/world's: the room the page is in. */
export const RoomBody = obj({ room: str(32, { re: ROOM }) });
/** POST /api/me/world's answer: the room that is this person's world (the first one they sent, kept for good). */
export const MyWorld = obj({ room: str(32, { re: ROOM }) });
export type MyWorld = Of<typeof MyWorld>;

/** A robot's paints (a Look names one by its place here) and the shapes each part comes in. */
export const PAINTS = ["#ff4f8b", "#2cc6d6", "#ffb02e", "#7ccf4a", "#9a7bff", "#e9eef5", "#e0533a", "#4a5568"] as const;
export const PARTS = {
  head: ["box", "dome", "screen"],
  eyes: ["two", "visor", "one"],
  top: ["antenna", "propeller", "ears"],
  feet: ["wheels", "legs", "hover"],
} as const;
export const Look = obj({ paint: int(0, PAINTS.length - 1), head: oneOf(PARTS.head), eyes: oneOf(PARTS.eyes), top: oneOf(PARTS.top), feet: oneOf(PARTS.feet) });
export type Look = Of<typeof Look>;
/** The robot someone has before they build one, from their plot's id: the same on every screen. */
export function lookOf(id: string): Look {
  const n = parseInt(id.slice(0, 6), 16) || 0;
  const pick = <T>(list: readonly T[], by: number) => list[Math.floor(n / by) % list.length]!;
  return { paint: n % PAINTS.length, head: pick(PARTS.head, 8), eyes: pick(PARTS.eyes, 24), top: pick(PARTS.top, 72), feet: pick(PARTS.feet, 216) };
}
/** GET and PUT /api/galaxy/robot answer: your robot, or null when you haven't built one. PUT sends { look }. */
export const Robot = obj({ look: nul(Look) });
export type Robot = Of<typeof Robot>;
export const RobotBody = obj({ look: Look });

/** A player: a robot, a plot, and a spot on it (0 to 1 across, x west to east, z north to south). */
export const Walker = obj({ id: str(32), look: Look, x: Coord, y: Coord, px: num(0, 1), pz: num(0, 1) });
export type Walker = Of<typeof Walker>;
/** The page to the galaxy: where its player is now, or the robot it now is. */
export const ToAt = obj({ t: oneOf(["at"]), x: Coord, y: Coord, px: num(0, 1), pz: num(0, 1) });
export const ToLook = obj({ t: oneOf(["look"]), look: Look });
export type ToGalaxy = Of<typeof ToAt> | Of<typeof ToLook>;
/** The galaxy to a page: everyone near you (after you join or change plot), one player who moved, or one who left. */
export const FromGalaxy = obj({ t: oneOf(["players", "player", "gone"]), players: opt(arr(Walker, 200)), player: opt(Walker), id: opt(str(32)) });
export type FromGalaxy = Of<typeof FromGalaxy>;

/** The radius of plots a page may ask for around a point: 3 is a 7 by 7 square. */
export const VIEW_MAX = 3;

// ---------- storage ----------

/** The part of a Durable Object's storage the galaxy and the saved worlds use; `memoryKv` is the same in memory. */
export interface Kv {
  get(keys: string[]): Promise<Map<string, unknown>>;
  put<T>(entries: Record<string, T>): Promise<void>;
  delete(keys: string[]): Promise<unknown>;
}

export const memoryKv = (): Kv => {
  const m = new Map<string, unknown>();
  return {
    get: async (keys) => new Map(keys.filter((k) => m.has(k)).map((k) => [k, structuredClone(m.get(k))])),
    put: async (entries) => { for (const [k, v] of Object.entries(entries)) m.set(k, structuredClone(v)); },
    delete: async (keys) => { for (const k of keys) m.delete(k); },
  };
};

const Cell = obj({ owner: str(210), room: str(32, { re: ROOM }), id: str(32) });

/** The id the map knows a room's plot by: a one-way hash, so the map never hands out a room's link. */
export const plotId = async (room: string) => (await sha256(`agent-page-plot:${room}`)).slice(0, 16);
const near = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.abs(a.x - b.x) <= 1 && Math.abs(a.y - b.y) <= 1;

export class Galaxy {
  // Claims one at a time, so two rooms that press at once never get the same cell.
  private chain: Promise<unknown> = Promise.resolve();
  // A burst of claims (a script making rooms) can't fill the map: a few a second.
  private claims = new TokenBucket(3, 30, Date.now());
  /** `who`: the person behind a request, `eq:<sub>`, or null (who.ts, with the platform's eqosys origin). */
  constructor(private kv: Kv, private who: (req: Request) => Promise<string | null> = async () => null) { this.signs = new Signs(kv); }
  private signs: Signs;

  /** The plot at the cell `key` points to (`o:<owner>` or `r:<room>`), or null. */
  private async plotAt(key: string): Promise<Claimed | null> {
    const n = (await this.kv.get([key])).get(key);
    if (typeof n !== "number") return null;
    const c = check(Cell, (await this.kv.get([`c:${n}`])).get(`c:${n}`));
    return c ? { ...spiral(n), id: c.id } : null;
  }

  /** The plot this owner holds, or null. */
  mine(owner: string): Promise<Claimed | null> { return this.plotAt(`o:${owner}`); }
  /** The plot this room's world sits on, or null. */
  plotOf(room: string): Promise<Claimed | null> { return this.plotAt(`r:${room}`); }

  /** The robot this person built, or null. */
  async robotOf(person: string): Promise<Look | null> {
    return check(Look, (await this.kv.get([`l:${person}`])).get(`l:${person}`));
  }

  /** The robot of whoever holds this room's plot. */
  private async robotOn(room: string): Promise<Look | null> {
    const n = (await this.kv.get([`r:${room}`])).get(`r:${room}`);
    const cell = typeof n === "number" ? check(Cell, (await this.kv.get([`c:${n}`])).get(`c:${n}`)) : null;
    return cell ? this.robotOf(cell.owner) : null;
  }

  /** This person's world: the room kept for them, or null when they have none yet. */
  async worldOf(person: string): Promise<string | null> {
    const room = (await this.kv.get([`p:${person}`])).get(`p:${person}`);
    return typeof room === "string" && ROOM.test(room) ? room : null;
  }

  /** This person's world, `room` being kept as it the first time: one world per person, whatever they send after. */
  myWorld(person: string, room: string): Promise<string> {
    const run = this.chain.then(async () => {
      const had = await this.worldOf(person);
      if (had) return had;
      await this.kv.put({ [`p:${person}`]: room });
      return room;
    });
    this.chain = run.catch(() => undefined);
    return run;
  }

  /** The plot this owner already has, or the next free cell of the spiral. One plot per owner. */
  claim(owner: string, room: string): Promise<Claimed> {
    const run = this.chain.then(async () => {
      const had = await this.mine(owner);
      if (had) return had;
      const got = await this.kv.get(["next"]);
      const from = got.get("next");
      let n = typeof from === "number" ? from : 1;
      while (keptFree(n)) n++;
      const id = await plotId(room);
      await this.kv.put({ next: n + 1, [`o:${owner}`]: n, [`r:${room}`]: n, [`c:${n}`]: { owner, room, id }, [`i:${id}`]: room });
      return { ...spiral(n), id };
    });
    this.chain = run.catch(() => undefined);
    return run;
  }

  /** The plots in the square of radius `r` around (x, y): owner never sent, only where, the public id and empty or not. */
  async around(x: number, y: number, r: number): Promise<Plot[]> {
    const cells: { x: number; y: number; n: number }[] = [];
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) cells.push({ x: x + dx, y: y + dy, n: cellOf(x + dx, y + dy) });
    const got = await this.kv.get(cells.filter((c) => c.n > 0).map((c) => `c:${c.n}`));
    const held = cells.map((c) => check(Cell, got.get(`c:${c.n}`)));
    const signed = await this.signs.versions(held.map((cell) => cell?.owner ?? ""));
    return cells.map((c, i) => {
      if (c.n === 0) return { x: c.x, y: c.y, id: "city", empty: false, city: true, signed: 0 };
      const cell = held[i];
      return { x: c.x, y: c.y, id: cell?.id ?? null, empty: !cell, city: false, signed: signed[i] ?? 0 };
    });
  }

  /** The signature standing on the plot with this public id, or null. */
  private async signOn(id: string) {
    const room = await this.roomOf(id);
    if (!room) return null;
    const n = (await this.kv.get([`r:${room}`])).get(`r:${room}`);
    const cell = typeof n === "number" ? check(Cell, (await this.kv.get([`c:${n}`])).get(`c:${n}`)) : null;
    return cell ? this.signs.read(cell.owner) : null;
  }

  /** The room behind a plot's public id, or null. */
  async roomOf(id: string): Promise<string | null> {
    const room = (await this.kv.get([`i:${id}`])).get(`i:${id}`);
    return typeof room === "string" && ROOM.test(room) ? room : null;
  }

  /** A player's socket, before it opens: only from a page this server served, for a room that holds a plot. The player
   *  starts in the middle of their own plot. */
  async seat(req: Request): Promise<Walker | Response> {
    if (req.headers.get("Upgrade") !== "websocket") return json({ error: "this is the galaxy's socket" }, 426);
    if (!fromPage(req)) return json({ error: "only this site's page may walk the galaxy" }, 403);
    const room = new URL(req.url).searchParams.get("room") ?? "";
    if (!ROOM.test(room)) return json({ error: "which room? ?room=<room>" }, 400);
    const plot = await this.plotOf(room);
    if (!plot) return json({ error: "claim a plot first: POST /api/galaxy/claim" }, 409);
    return { id: plot.id, look: (await this.robotOn(room)) ?? lookOf(plot.id), x: plot.x, y: plot.y, px: 0.5, pz: 0.5 };
  }

  /** The galaxy's doors, `rest` being the path after /api/galaxy. `forward` reaches a room's own doors (its picture
   *  and its saved world). The socket is the platform's to upgrade (`seat`). */
  async http(req: Request, rest: string, forward: (room: string, rest: string) => Promise<Response>): Promise<Response> {
    const url = new URL(req.url);
    if (rest === "/plots" && req.method === "GET") {
      const at = (k: string) => Math.trunc(Number(url.searchParams.get(k) ?? 0)) || 0;
      const x = Math.max(-10_000, Math.min(10_000, at("x"))), y = Math.max(-10_000, Math.min(10_000, at("y")));
      const r = Math.max(0, Math.min(VIEW_MAX, at("r") || 1));
      return json({ plots: await this.around(x, y, r) } satisfies Plots);
    }
    if (rest === "/me/world" && req.method === "POST") {
      if (!fromPage(req)) return json({ error: "only this site's page may ask for your world" }, 403);
      const person = await this.who(req);
      if (!person) return json({ error: "Sign in with eqosys first: your world is kept for your account." }, 401);
      const body = await readJson(req, RoomBody);
      if (!body) return json({ error: "send { room }: the room this browser is in" }, 400);
      return json({ room: await this.myWorld(person, body.room) } satisfies MyWorld);
    }
    if (rest === "/robot" && (req.method === "GET" || req.method === "PUT")) {
      if (req.method === "PUT" && !fromPage(req)) return json({ error: "only this site's page may change your robot" }, 403);
      const person = await this.who(req);
      if (!person) return json({ error: "Sign in with eqosys first: your robot is kept for your account." }, 401);
      if (req.method === "GET") return json({ look: await this.robotOf(person) } satisfies Robot);
      const body = await readJson(req, RobotBody);
      if (!body) return json({ error: "send { look }: a robot's parts" }, 400);
      await this.kv.put({ [`l:${person}`]: body.look });
      return json({ look: body.look } satisfies Robot);
    }
    if (rest === "/claim" && req.method === "POST") {
      if (!fromPage(req)) return json({ error: "only this site's page may claim a plot" }, 403);
      const person = await this.who(req);
      if (!person) return json({ error: "Sign in with eqosys first: a plot is a signed-in person's world." }, 401);
      const body = await readJson(req, RoomBody);
      if (!body) return json({ error: "send { room }: your world's room" }, 400);
      if ((await this.worldOf(person)) !== body.room) return json({ error: "Claim from your own world: that room isn't it." }, 403);
      const had = await this.mine(person);
      if (had) return json(had satisfies Claimed);
      const made = await readJson(await forward(body.room, "/made"), Made);
      if (!made?.made) return json({ error: MAKE_FIRST }, 409);
      if (!(await this.signs.read(person))) return json({ error: SIGN_FIRST }, 409);
      if (!this.claims.take(Date.now())) return json({ error: "too many new plots at once: try again in a moment" }, 429);
      return json((await this.claim(person, body.room)) satisfies Claimed);
    }
    if (rest === "/sign") {
      if (req.method !== "GET" && !fromPage(req)) return json({ error: "only this site's page may sign" }, 403);
      const person = await this.who(req);
      if (!person) return json({ error: "Sign in with eqosys first: a sign is a signed-in person's." }, 401);
      return this.signs.http(req, person);
    }
    const sign = rest.match(/^\/sign\/([a-z0-9]{1,32})$/);
    if (sign && req.method === "GET") return json({ strokes: await this.signOn(sign[1]!) } satisfies SignReply);
    const m = rest.match(/^\/(picture|world)\/([a-z0-9]{1,32})$/);
    if (m && req.method === "GET") {
      const room = await this.roomOf(m[2]!);
      return room ? forward(room, `/${m[1]}`) : json({ error: "no world on that plot" }, 404);
    }
    return json({ error: `nothing at /api/galaxy${rest}: try GET /api/galaxy/plots?x=0&y=0` }, 404);
  }
}

// ---------- players ----------

/** One platform's sockets as the players' logic sees them: who is on each, keep a player's new spot, send one. */
export interface Hub<S> {
  list(): { s: S; p: Walker }[];
  save(s: S, p: Walker): void;
  send(s: S, m: FromGalaxy): void;
}

/** A player came in: they hear who is near, and those near see them. */
export function joined<S>(hub: Hub<S>, s: S, p: Walker) {
  const others = hub.list().filter((e) => e.s !== s && e.p.id !== p.id);
  hub.send(s, { t: "players", players: others.filter((o) => near(o.p, p)).map((o) => o.p) });
  for (const o of others) if (near(o.p, p)) hub.send(o.s, { t: "player", player: p });
}

/** A frame from a player, its new spot or its new robot: checked, kept, and sent on to the players on the same or a touching plot (the old plot's
 *  too, so they see them go). One who changed plot hears who is near the new one. */
export function walked<S>(hub: Hub<S>, s: S, raw: unknown) {
  const at = check(ToAt, raw), dressed = at ? null : check(ToLook, raw);
  const me = (at || dressed) && hub.list().find((e) => e.s === s);
  if (!me) return;
  const p: Walker = at ? { ...me.p, x: at.x, y: at.y, px: at.px, pz: at.pz } : { ...me.p, look: dressed!.look };
  hub.save(s, p);
  const others = hub.list().filter((e) => e.s !== s && e.p.id !== p.id);
  for (const o of others) if (near(o.p, p) || near(o.p, me.p)) hub.send(o.s, { t: "player", player: p });
  if (p.x !== me.p.x || p.y !== me.p.y) hub.send(s, { t: "players", players: others.filter((o) => near(o.p, p)).map((o) => o.p) });
}

/** A player left: those near them see them go. */
export function left<S>(hub: Hub<S>, s: S, p: Walker) {
  for (const o of hub.list()) if (o.s !== s && o.p.id !== p.id && near(o.p, p)) hub.send(o.s, { t: "gone", id: p.id });
}
