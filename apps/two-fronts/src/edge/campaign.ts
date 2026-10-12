// One Durable Object per campaign, for a war played a turn at a time over days. Each side gets a
// secret seat link when the campaign starts; the link's token is the player's login, and only its
// hash is kept. The table (map, orders handed in) is one row in the object's SQLite, and every
// resolved turn adds a row to its history. The sequencing is src/war/table.ts, the same code the
// page runs for a game against the AI or a hotseat game.
import type { BattleResult, Faction, SpaceBattleResult } from "../battle/contract.ts";
import { GALAXIES, type GalaxyId } from "../war/galaxy.ts";
import type { Campaign, Orders } from "../war/rules.ts";
import { handIn, humans, newTable, report, waitingOn, type Seats, type Step, type Table, type TurnRecord } from "../war/table.ts";

// Cloudflare's SqlStorage, and the in-process one Rusty Buns hosts locally, as far as this uses them.
interface Sql { exec<T = Record<string, unknown>>(query: string, ...bindings: unknown[]): { toArray(): T[] } }
interface State { storage: { sql: Sql } }

export interface View {
  seat: Faction;
  seats: Seats;
  campaign: Campaign;
  waiting: Faction[];
  handedIn: boolean; // this seat's orders are in for the turn
}

const MAX_BODY = 64 * 1024;
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const fail = (error: string, status = 400) => json({ error }, status);

export async function hashToken(token: string) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("two-fronts:" + token)));
  return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
}
const newToken = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(24)))).replace(/\+/g, "-").replace(/\//g, "_");

export class CampaignRoom {
  private sql: Sql;

  constructor(ctx: State, _env: unknown) {
    this.sql = ctx.storage.sql;
  }

  async fetch(req: Request): Promise<Response> {
    const path = new URL(req.url).pathname;
    if (req.method === "POST" && path === "/create") return this.create(await body(req));
    const table = this.load();
    if (!table) return fail("No such campaign", 404);
    const seat = await this.seatOf(req);
    if (!seat) return fail("Not a seat at this campaign", 403);

    if (req.method === "GET" && path === "/") return json(this.view(table, seat));
    if (req.method === "GET" && path === "/history") {
      const rows = this.sql.exec<{ turn: number; orders: string; battle: string | null; log: string }>("SELECT turn, orders, battle, log FROM turns ORDER BY turn").toArray();
      return json(rows.map((r): TurnRecord => ({ turn: r.turn, orders: JSON.parse(r.orders), battle: r.battle ? JSON.parse(r.battle) : null, log: JSON.parse(r.log) })));
    }
    if (req.method === "POST" && path === "/orders") return this.step(seat, handIn(table, seat, (await body(req)) as Orders));
    if (req.method === "POST" && path === "/battle") return this.step(seat, report(table, seat, (await body(req)) as BattleResult | SpaceBattleResult));
    return fail("Not found", 404);
  }

  private async create(b: unknown): Promise<Response> {
    if (this.load()) return fail("The campaign already exists", 409);
    const { seats, galaxy = "short" } = (b ?? {}) as { seats?: Seats; galaxy?: GalaxyId };
    const ok = (s: unknown) => s === "human" || s === "ai";
    if (!seats || !ok(seats.marines) || !ok(seats.wooka)) return fail("Say who sits in each seat");
    if (!Object.hasOwn(GALAXIES, galaxy)) return fail("No such galaxy");
    const table = newTable({ marines: seats.marines, wooka: seats.wooka }, galaxy);
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
    return json({ tokens }, 201);
  }

  private step(seat: Faction, s: Step): Response {
    if (!s.ok) return fail(s.error, 409);
    this.sql.exec("UPDATE campaign SET tbl = ? WHERE id = 1", JSON.stringify(s.table));
    if (s.done) this.sql.exec("INSERT INTO turns (turn, orders, battle, log, at) VALUES (?, ?, ?, ?, ?)",
      s.done.turn, JSON.stringify(s.done.orders), s.done.battle && JSON.stringify(s.done.battle), JSON.stringify(s.done.log), Date.now());
    return json(this.view(s.table, seat));
  }

  // A seat sees the whole map, but not what the other side has ordered until the turn resolves.
  private view(t: Table, seat: Faction): View {
    return { seat, seats: t.seats, campaign: t.campaign, waiting: waitingOn(t), handedIn: !!t.handedIn[seat] };
  }

  private load(): Table | null {
    // A link to a campaign that was never made reads nothing and writes nothing.
    if (!this.sql.exec("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'campaign'").toArray().length) return null;
    const row = this.sql.exec<{ tbl: string }>("SELECT tbl FROM campaign WHERE id = 1").toArray()[0];
    return row ? JSON.parse(row.tbl) : null;
  }

  private async seatOf(req: Request): Promise<Faction | null> {
    const token = req.headers.get("Authorization")?.match(/^Bearer (\S{16,128})$/)?.[1];
    if (!token) return null;
    const row = this.sql.exec<{ faction: Faction }>("SELECT faction FROM seats WHERE token_hash = ?", await hashToken(token)).toArray()[0];
    return row?.faction ?? null;
  }
}

async function body(req: Request): Promise<unknown> {
  const text = await req.text();
  if (text.length > MAX_BODY) return null;
  try { return JSON.parse(text); } catch { return null; }
}
