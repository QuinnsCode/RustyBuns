// The page's side of a campaign played online: a few JSON calls to the Worker, which hands them
// to the campaign's Durable Object (src/edge/). The seat token is the login, so it travels in a
// header and in the link's #fragment, never in a URL a server logs.
import type { BattleResult, Faction } from "./battle/contract.ts";
import type { View } from "./edge/campaign.ts";
import type { GalaxyId } from "./war/galaxy.ts";
import type { Orders } from "./war/rules.ts";
import type { Seats } from "./war/table.ts";

export type { View };
export interface Online { id: string; token: string; invite?: string } // invite: the other side's token, kept by whoever started it

async function call<T>(path: string, token?: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/campaigns${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { ...(token && { Authorization: `Bearer ${token}` }), "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? `The server said ${res.status}`);
  return data as T;
}

export const startOnline = (seats: Seats, galaxy: GalaxyId) => call<{ id: string; tokens: Partial<Record<Faction, string>> }>("", undefined, { seats, galaxy });
export const fetchView = (g: Online) => call<View>(`/${g.id}`, g.token);
export const sendOrders = (g: Online, o: Orders) => call<View>(`/${g.id}/orders`, g.token, o);
export const sendBattle = (g: Online, r: BattleResult) => call<View>(`/${g.id}/battle`, g.token, r);

export const seatLink = (id: string, token: string) => `${location.origin}${location.pathname}#c=${id}&s=${encodeURIComponent(token)}`;

// A seat link opened in this browser: #c=<campaign id>&s=<seat token>.
export function linkInHash(): Online | null {
  const p = new URLSearchParams(location.hash.slice(1)), id = p.get("c"), token = p.get("s");
  return id && token ? { id, token } : null;
}
