// One Durable Object per campaign, for a war played a turn at a time over days. Each side gets a
// secret seat link when the campaign starts; the link's token is the player's login, and only its
// hash is kept. The table (map, orders handed in) is one row in the object's SQLite, and every
// resolved turn adds a row to its history. The sequencing is src/war/table.ts, the same code the
// page runs for a game against the AI or a hotseat game.
//
// The end-of-match vote's pointers go over a WebSocket at /pointers: a seat says hello with its
// token as the first message (a browser can't put it in a header, and a URL gets logged), then
// sends where its pointer is, and the object passes that on to the other seat. Nothing about a
// pointer is kept. The votes themselves are POSTs, kept with the table.
import type { BattleResult, Faction, MatchMode, SpaceBattleResult } from "../battle/contract.ts";
import { GALAXIES, type GalaxyId } from "../war/galaxy.ts";
import { fogged, type Campaign, type Orders } from "../war/rules.ts";
import { decodeIn, type PointerIn, type PointerOut } from "../pointer-wire.ts";
import { castVote, handIn, humans, newTable, report, waitingOn, type Seats, type Step, type Table, type TurnRecord, type Vote } from "../war/table.ts";
import { Sockets, type RoomCtx, type RoomSocket } from "@rustybuns/util/room";
import { privateJson as json } from "@rustybuns/util/http";
import type { Started, View } from "./view.ts";

// Cloudflare's SqlStorage, and the in-process one Rusty Buns hosts locally, as far as this uses them.
interface Sql { exec<T = Record<string, unknown>>(query: string, ...bindings: unknown[]): { toArray(): T[] } }
interface State extends RoomCtx { storage: { sql: Sql } }
/** A pointer socket carries its seat once it has said hello. */
type Pointer = { seat: Faction } | null;

export type { Started, View };

const MAX_BODY = 256 * 1024; // room for a played battle's input log (MAX_INPUTS)
const fail = (error: string, status = 400) => json({ error }, status);
const MAX_SOCKETS = 8; // a seat on a couple of devices, twice over
const MAX_FRAME = 256;

export async function hashToken(token: string) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("two-fronts:" + token)));
  return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
}
const newToken = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(24)))).replace(/\+/g, "-").replace(/\//g, "_");

export class CampaignRoom {
  private sql: Sql;
  private sockets: Sockets<Pointer, PointerOut>;

  constructor(private ctx: State, _env: unknown) {
    this.sql = ctx.storage.sql;
    this.sockets = new Sockets(ctx);
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url), path = url.pathname;
    if (req.method === "POST" && path === "/create") return this.create(url.searchParams.get("id") ?? "", await body(req));
    const table = this.load();
    if (!table) return fail("No such campaign", 404);
    if (path === "/pointers") return this.pointers(req);
    const seat = await this.seatOf(req);
    if (!seat) return fail("Not a seat at this campaign", 403);

    if (req.method === "GET" && path === "/") return json(this.view(table, seat));
    if (req.method === "GET" && path === "/history") {
      const rows = this.sql.exec<{ turn: number; orders: string; battle: string | null; log: string }>("SELECT turn, orders, battle, log FROM turns ORDER BY turn").toArray();
      return json(rows.map((r): TurnRecord => ({ turn: r.turn, orders: JSON.parse(r.orders), battle: r.battle ? JSON.parse(r.battle) : null, log: JSON.parse(r.log) })));
    }
    if (req.method === "POST" && path === "/orders") return this.step(seat, handIn(table, seat, (await body(req)) as Orders));
    if (req.method === "POST" && path === "/battle") return this.step(seat, report(table, seat, (await body(req)) as BattleResult | SpaceBattleResult));
    if (req.method === "POST" && path === "/vote") {
      const v = (await body(req)) as { match?: unknown; mode?: unknown } | null;
      if (typeof v?.match !== "string" || typeof v.mode !== "string") return fail("That isn't a vote");
      const res = this.step(seat, castVote(table, seat, v.match, v.mode as MatchMode));
      if (res.ok && this.load()?.vote) this.broadcast({ t: "vote", vote: this.load()!.vote! });
      return res;
    }
    return fail("Not found", 404);
  }

  private pointers(req: Request): Response {
    if (req.headers.get("Upgrade") !== "websocket") return fail("WebSocket only", 426);
    if (this.ctx.getWebSockets().length >= MAX_SOCKETS) return fail("Too many screens on this vote", 503);
    return this.sockets.upgrade(null).response;
  }

  // A pointer socket's frames: hello with the seat token first, then where its pointer is.
  async webSocketMessage(ws: RoomSocket, m: string | ArrayBuffer) {
    if (typeof m !== "string" || m.length > MAX_FRAME) return ws.close(1009, "Too big");
    const frame = this.sockets.frame(ws, m);
    if (!frame) return ws.close(1003, "Not JSON");
    const msg: PointerIn | null = decodeIn(frame.value);
    const seat = this.sockets.who(ws)?.seat;
    if (!seat) {
      const found = msg?.t === "hello" ? await this.seatFor(msg.token) : null;
      if (!found) return ws.close(4003, "Not a seat at this campaign");
      this.sockets.attach(ws, { seat: found });
      return this.sockets.send(ws, { t: "hi", seat: found });
    }
    if (msg?.t !== "at") return;
    this.broadcast({ t: "at", seat, x: msg.x, y: msg.y }, ws);
  }
  webSocketClose(ws: RoomSocket) { try { ws.close(1000); } catch { /* already closed */ } }
  webSocketError() {}

  // To every seat's pointer socket that has said hello, but the one it came from.
  private broadcast(m: PointerOut, from?: RoomSocket) {
    this.sockets.broadcast(m, from, (a) => a !== null);
  }

  private async create(id: string, b: unknown): Promise<Response> {
    if (this.load()) return fail("The campaign already exists", 409);
    const { seats, galaxy = "short", setup = false } = (b ?? {}) as { seats?: Seats; galaxy?: GalaxyId; setup?: boolean };
    const ok = (s: unknown) => s === "human" || s === "ai";
    if (!seats || !ok(seats.marines) || !ok(seats.wooka)) return fail("Say who sits in each seat");
    if (!Object.hasOwn(GALAXIES, galaxy)) return fail("No such galaxy");
    const table = newTable({ marines: seats.marines, wooka: seats.wooka }, galaxy, undefined, setup === true);
    if (!humans(table).length) return fail("Someone has to play");
    this.sql.exec(`CREATE TABLE IF NOT EXISTS campaign (id INTEGER PRIMARY KEY CHECK (id = 1), tbl TEXT NOT NULL, created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS seats (faction TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE);
      CREATE TABLE IF NOT EXISTS turns (turn INTEGER PRIMARY KEY, orders TEXT NOT NULL, battle TEXT, log TEXT NOT NULL, at INTEGER NOT NULL);`);
    const tokens: Partial<Record<Faction, string>> = {};
    for (const f of humans(table)) {
      tokens[f] = newToken();
      this.sql.exec("INSERT INTO seats (faction, token_hash) VALUES (?, ?)", f, await hashToken(tokens[f]!));
    }
    this.sql.exec("INSERT INTO campaign (id, tbl, created) VALUES (1, ?, ?)", JSON.stringify(table), Date.now());
    return json({ id, tokens } satisfies Started, 201);
  }

  private step(seat: Faction, s: Step): Response {
    if (!s.ok) return fail(s.error, 409);
    this.sql.exec("UPDATE campaign SET tbl = ? WHERE id = 1", JSON.stringify(s.table));
    if (s.done) this.sql.exec("INSERT INTO turns (turn, orders, battle, log, at) VALUES (?, ?, ?, ?, ?)",
      s.done.turn, JSON.stringify(s.done.orders), s.done.battle && JSON.stringify(s.done.battle), JSON.stringify(s.done.log), Date.now());
    return json(this.view(s.table, seat));
  }

  // A seat sees who holds what, but the other side's numbers only where it has someone to count
  // them, and never what they've ordered until the turn resolves (attacks are declared without numbers).
  private view(t: Table, seat: Faction): View {
    return { seat, seats: t.seats, campaign: fogged(t.campaign, seat), waiting: waitingOn(t), handedIn: !!t.handedIn[seat], vote: t.vote ?? null };
  }

  private load(): Table | null {
    // A link to a campaign that was never made reads nothing and writes nothing.
    if (!this.sql.exec("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'campaign'").toArray().length) return null;
    const row = this.sql.exec<{ tbl: string }>("SELECT tbl FROM campaign WHERE id = 1").toArray()[0];
    return row ? JSON.parse(row.tbl) : null;
  }

  private async seatOf(req: Request): Promise<Faction | null> {
    const token = req.headers.get("Authorization")?.match(/^Bearer (\S{16,128})$/)?.[1];
    return token ? this.seatFor(token) : null;
  }

  private async seatFor(token: string): Promise<Faction | null> {
    const row = this.sql.exec<{ faction: Faction }>("SELECT faction FROM seats WHERE token_hash = ?", await hashToken(token)).toArray()[0];
    return row?.faction ?? null;
  }
}

async function body(req: Request): Promise<unknown> {
  const text = await req.text();
  if (text.length > MAX_BODY) return null;
  try { return JSON.parse(text); } catch { return null; }
}
