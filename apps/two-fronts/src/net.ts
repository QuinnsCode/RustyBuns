// The page's side of a campaign played online: a few JSON calls to the Worker, which hands them
// to the campaign's Durable Object (src/edge/). The seat token is the login, so it travels in a
// header and in the link's #fragment, never in a URL a server logs.
import type { BattleResult, Faction, MatchMode, SpaceBattleResult } from "./battle/contract.ts";
import { Started, View } from "./edge/view.ts";
import type { GalaxyId } from "./war/galaxy.ts";
import type { Orders } from "./war/rules.ts";
import type { Seats, Vote } from "./war/table.ts";
import { decodeOut, type PointerIn, type PointerOut } from "./pointer-wire.ts";
import type { Guard } from "@rustybuns/util/guard";
import { connectSocket } from "@rustybuns/util/socket";

export type { View };
export interface Online { id: string; token: string; invite?: string } // invite: the other side's token, kept by whoever started it

async function call<T>(guard: Guard<T>, path: string, token?: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/campaigns${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { ...(token && { Authorization: `Bearer ${token}` }), "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? `The server said ${res.status}`);
  try { return guard(data); } catch { throw new Error("The server sent something this page can't read"); }
}

export const startOnline = (seats: Seats, galaxy: GalaxyId) => call(Started, "", undefined, { seats, galaxy, setup: true });
export const fetchView = (g: Online) => call(View, `/${g.id}`, g.token);
export const sendOrders = (g: Online, o: Orders) => call(View, `/${g.id}/orders`, g.token, o);
export const sendBattle = (g: Online, r: BattleResult | SpaceBattleResult) => call(View, `/${g.id}/battle`, g.token, r);
export const sendVote = (g: Online, match: string, mode: MatchMode) => call(View, `/${g.id}/vote`, g.token, { match, mode });

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
