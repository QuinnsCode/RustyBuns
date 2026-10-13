// Paid tiers, each named for a gem off the beaten path. Free has none. A tier shows as a stamp
// beside a person's name (the top bar, their profile, the rate limits page) and multiplies their
// share of every per-person rate limit (limits.ts). An admin sets one on the rate limits page
// (PUT /api/admin/limits/tier); nothing here takes payment.

import type { Env } from "./env.ts";

export interface Tier { id: string; label: string; mult: number; about: string }

/** Lowest to highest. */
export const TIERS: Tier[] = [
  { id: "tanzanite", label: "Tanzanite", mult: 2, about: "found at the foot of one mountain, Kilimanjaro, and nowhere else" },
  { id: "alexandrite", label: "Alexandrite", mult: 5, about: "green by daylight, red by candlelight" },
  { id: "painite", label: "Painite", mult: 10, about: "once the rarest mineral on Earth: a handful of crystals were known" },
];

export const tierById = (id: unknown): Tier | null => TIERS.find((t) => t.id === id) ?? null;

// Read at most every 30 seconds per isolate, per person, so counting a hit costs one D1 read at most.
const seen = new Map<string, { at: number; tier: Tier | null }>();

export function forgetTiers() { seen.clear(); }

/** The tier `name` is on, or null for free. */
export async function tierOf(env: Env, name: string | null): Promise<Tier | null> {
  if (!name) return null;
  const hit = seen.get(name);
  if (hit && Date.now() - hit.at < 30_000) return hit.tier;
  const row = await env.DB.prepare("SELECT tier FROM users WHERE name = ?").bind(name).first();
  const tier = tierById(row?.tier);
  seen.set(name, { at: Date.now(), tier });
  return tier;
}

/** How many times the stated limit `who` (`@handle`, or an IP, CI token or SITE) gets. */
export async function multOf(env: Env, who: string): Promise<number> {
  return who.startsWith("@") ? (await tierOf(env, who.slice(1)))?.mult ?? 1 : 1;
}
