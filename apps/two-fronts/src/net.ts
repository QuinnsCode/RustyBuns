// The page's side of a campaign played online: a few JSON calls to the Worker, which hands them
// to the campaign's Durable Object (src/edge/). The seat token is the login, so it travels in a
// header and in the link's #fragment, never in a URL a server logs.
import type { BattleResult, Faction, MatchMode, SpaceBattleResult } from "./battle/contract.ts";
import { Claimed, EQOSYS_HEADER, Started, View, Wars, type PartyAsk, type War } from "./edge/view.ts";
import { fresh, login } from "./eqosys.ts";
import type { GalaxyId } from "./war/galaxy.ts";
import type { Orders } from "./war/rules.ts";
import type { Seats, Vote } from "./war/table.ts";
import { decodeOut, type PointerIn, type PointerOut } from "./pointer-wire.ts";
import type { Guard } from "@rustybuns/util/guard";
import { connectSocket } from "@rustybuns/util/socket";

export type { View, War };

/** The signed-in player's eqosys token while it's good, else nothing: sent where a seat can become the account's. */
const account = () => { const l = login(); return l && fresh(l) ? l.token : undefined; };
export interface Online { id: string; token: string; invite?: string } // invite: the other side's token, kept by whoever started it

async function call<T>(guard: Guard<T>, path: string, token?: string, body?: unknown, eqosys?: string): Promise<T> {
  const res = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: { ...(token && { Authorization: `Bearer ${token}` }), ...(eqosys && { [EQOSYS_HEADER]: eqosys }), "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? `The server said ${res.status}`);
  try { return guard(data); } catch { throw new Error("The server sent something this page can't read"); }
}

/** A new online war; signed in, the starter's `side` is their account's, and it goes on their list of wars. */
export const startOnline = (seats: Seats, galaxy: GalaxyId, side: Faction) => call(Started, "/api/campaigns", undefined, { seats, galaxy, setup: true, side }, account());
/** A seat's view. Signed in, the first open of a seat no account holds yet (an invite) makes it this account's. */
export const fetchView = (g: Online) => call(View, `/api/campaigns/${g.id}`, g.token, undefined, account());
/** The signed-in player's wars, the newest first; none signed out. */
export const fetchWars = async (): Promise<War[]> => { const t = account(); return t ? call(Wars, "/api/wars", undefined, undefined, t) : []; };
/** A war of yours opened on this device: a token of its own for your seat there. */
export const openWar = (id: string) => call(Claimed, `/api/campaigns/${id}/seat`, undefined, {}, account());
export const sendOrders = (g: Online, o: Orders) => call(View, `/api/campaigns/${g.id}/orders`, g.token, o);
export const sendBattle = (g: Online, r: BattleResult | SpaceBattleResult) => call(View, `/api/campaigns/${g.id}/battle`, g.token, r);
export const sendVote = (g: Online, match: string, mode: MatchMode) => call(View, `/api/campaigns/${g.id}/vote`, g.token, { match, mode });
/**
 * Claim this page's seat in the war a party started: the room eqosys gave the party, and the seat it gave this player.
 * The seat is the eqosys account's, so the same account claims it again on another device.
 */
export const claimSeat = (room: string, ask: PartyAsk) => call(Claimed, `/api/parties/${encodeURIComponent(room)}`, undefined, ask, account() ?? "");


// The vote screen's live line to the other seat: where each pointer is, and the votes as they land.
// The token goes in the first message, not the URL. Coordinates are 0..1 across the vote screen.
export function pointerSocket(g: Online, on: (m: PointerOut) => void) {
  let ready = false, last = 0, later: ReturnType<typeof setTimeout> | undefined;
  const link = connectSocket<PointerOut, PointerIn>(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/campaigns/${g.id}/pointers`, {
    decode: decodeOut,
    onOpen: () => { link.send({ t: "hello", token: g.token }); },
    onMessage: (m) => { if (m.t === "hi") ready = true; else on(m); },
  });
  return {
    // At most twenty a second, and the last one always goes.
    at(x: number, y: number) {
      clearTimeout(later);
      const wait = 50 - (performance.now() - last);
      if (wait > 0) { later = setTimeout(() => this.at(x, y), wait); return; }
      if (!ready || !link.open) return;
      last = performance.now();
      link.send({ t: "at", x, y });
    },
    close: () => { clearTimeout(later); link.close(); },
  };
}

export const seatLink = (id: string, token: string) => `${location.origin}${location.pathname}#c=${id}&s=${encodeURIComponent(token)}`;

// A seat link opened in this browser: #c=<campaign id>&s=<seat token>.
export function linkInHash(): Online | null {
  const p = new URLSearchParams(location.hash.slice(1)), id = p.get("c"), token = p.get("s");
  return id && token ? { id, token } : null;
}
