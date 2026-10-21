// Pay to play, for looks only: a few deck, truck and wheel finishes cost money, and no part changes how the board rides.
// What you own is pure data here so the page and the tests share it. Taking the money is a `Checkout`: the page
// ships the test one (it just says yes, nothing is charged). A real one is a call to a Worker that talks to the payment
// provider and answers whether it was paid: `stripeCheckout`, served by src/edge/pay.ts (secrets in README).
import { uid } from "./net/client.ts";
import { CATALOG, DEFAULT_PARTS, type Part, type Parts } from "./parts.ts";

export type Item = { part: Part; id: string };
/** Resolves true once the item is paid for. */
export type Checkout = (item: Item, cents: number) => Promise<boolean>;

export const testCheckout: Checkout = async () => true;

const PENDING = "skate-tech-park.pending";
/** Real payment: sends the player to Stripe's hosted page (the Worker names the price). They come back to `/?paid=1`
 * and `Wallet.sync` picks up what the webhook recorded, so this never resolves true itself. On the dev server, where
 * there is no Worker, it falls back to the free test checkout. */
export const stripeCheckout: Checkout = async (item) => {
  const res = await fetch("/api/checkout", { method: "POST", body: JSON.stringify({ uid: uid(), item: key(item) }) }).catch(() => null);
  if (!res || res.status === 404 || res.status === 501) return import.meta.env.DEV ? true : false;
  const { url } = (await res.json().catch(() => ({}))) as { url?: string };
  if (!url) return false;
  try { localStorage.setItem(PENDING, key(item)); } catch { /* it just isn't switched on after paying */ }
  location.assign(url);
  return false;
};

/** The item the player was paying for when they left for Stripe, if any (cleared once read). */
export function takePending(): Item | null {
  try {
    const k = localStorage.getItem(PENDING);
    localStorage.removeItem(PENDING);
    const [part, id] = (k ?? "").split(":");
    return part && id ? { part: part as Part, id } : null;
  } catch { return null; }
}

const key = (i: Item) => `${i.part}:${i.id}`;
const choices = (part: Part) => CATALOG[part] as readonly { id: string; price?: number }[];

/** The price in cents of a part, 0 when it is free or unknown. */
export function priceOf(item: Item): number {
  return choices(item.part).find((c) => c.id === item.id)?.price ?? 0;
}

export class Wallet {
  private bought: Set<string>;
  constructor(owned: Iterable<string> = [], private save: (owned: string[]) => void = () => {}) {
    this.bought = new Set(owned);
  }
  /** Takes the server's list of what was paid for. */
  sync(owned: Iterable<string>) { for (const k of owned) this.bought.add(k); this.save([...this.bought]); }
  owns(item: Item): boolean { return priceOf(item) === 0 || this.bought.has(key(item)); }
  /** Charges through `checkout`, and keeps the item only if it was paid. Buying what you own costs nothing. */
  async buy(item: Item, checkout: Checkout): Promise<boolean> {
    if (this.owns(item)) return true;
    let paid = false;
    try { paid = await checkout(item, priceOf(item)); } catch { /* a failed checkout is a no */ }
    if (paid) { this.bought.add(key(item)); this.save([...this.bought]); }
    return paid;
  }
  /** A choice with anything unowned put back to the default, so a saved or hand-edited board can't wear what wasn't bought. */
  allowed(parts: Parts): Parts {
    const out = { ...parts };
    for (const p of Object.keys(CATALOG) as Part[]) if (!this.owns({ part: p, id: out[p] })) out[p] = DEFAULT_PARTS[p];
    return out;
  }
}

const KEY = "skate-tech-park.owned";
/** The wallet kept in this browser, topped up from the server's record of paid purchases (`/api/owned`) by `Wallet.sync`. */
export function localWallet(): Wallet {
  let owned: string[] = [];
  try { owned = JSON.parse(localStorage.getItem(KEY) ?? "[]"); } catch { /* none yet */ }
  return new Wallet(owned, (o) => { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch { /* private window */ } });
}

export const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/** Asks the Worker what this player has paid for. Empty where there is no Worker. */
export async function fetchOwned(): Promise<string[]> {
  try {
    const res = await fetch(`/api/owned?uid=${uid()}`);
    return res.ok ? ((await res.json()) as { owned: string[] }).owned : [];
  } catch { return []; }
}
