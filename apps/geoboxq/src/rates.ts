// The shipper link: rates for the box GeoBoxQ chose, from whichever shipping aggregator the owner signs in to.
// Vendor-neutral on purpose. RATES_URL is an endpoint that takes `{ parcel, from, to }` and answers
// `{ rates: [{ carrier, service, amount, currency, days? }] }`; a thin adapter in front of the chosen aggregator
// (or the aggregator itself, if it speaks this) is all that is left to plug in. Unset, the route says so.
export interface RatesEnv { RATES_URL?: string; RATES_KEY?: string }
export interface Rate { carrier: string; service: string; amount: number; currency: string; days?: number }

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 200) : null);
const dim = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);

/** Cheapest first; rows the aggregator filled badly are dropped rather than shown. */
export function cleanRates(raw: unknown): Rate[] {
  const list = Array.isArray((raw as { rates?: unknown })?.rates) ? (raw as { rates: unknown[] }).rates : [];
  const out: Rate[] = [];
  for (const r of list as Record<string, unknown>[]) {
    const amount = typeof r?.amount === "string" ? Number(r.amount) : r?.amount;
    const carrier = str(r?.carrier), service = str(r?.service), currency = str(r?.currency);
    if (!carrier || !service || !currency || typeof amount !== "number" || !Number.isFinite(amount) || amount < 0) continue;
    out.push({ carrier, service, amount, currency, ...(typeof r.days === "number" ? { days: r.days } : {}) });
  }
  return out.sort((a, b) => a.amount - b.amount);
}

/**
 * `POST /api/rates` with `{ box: {l,w,h,unit?}, weight?, from, to }`. Returns `{ rates }`, or 501 until an
 * aggregator is linked, or 502 when it fails (its error text is not passed on).
 */
export async function ratesApi(text: string, env: RatesEnv, fetcher: typeof fetch = fetch): Promise<{ status: number; body: unknown }> {
  if (!env.RATES_URL) return { status: 501, body: { error: "no shipping aggregator is linked yet" } };
  let b: { box?: Record<string, unknown>; weight?: unknown; from?: unknown; to?: unknown };
  try { b = JSON.parse(text); } catch { return { status: 400, body: { error: "body is not JSON" } }; }
  const l = dim(b?.box?.l), w = dim(b?.box?.w), h = dim(b?.box?.h), from = str(b?.from), to = str(b?.to);
  if (!l || !w || !h || !from || !to) return { status: 400, body: { error: "send { box: { l, w, h }, from, to } (from and to are postcodes)" } };
  const weight = b.weight === undefined ? undefined : dim(b.weight);
  if (weight === null) return { status: 400, body: { error: "weight must be a positive number" } };
  const unit = b.box?.unit === "cm" ? "cm" : "in";
  try {
    const res = await fetcher(env.RATES_URL, {
      method: "POST",
      headers: { "content-type": "application/json", ...(env.RATES_KEY ? { authorization: `Bearer ${env.RATES_KEY}` } : {}) },
      body: JSON.stringify({ parcel: { l, w, h, unit, ...(weight ? { weight } : {}) }, from, to }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { status: 502, body: { error: `aggregator answered ${res.status}` } };
    return { status: 200, body: { rates: cleanRates(await res.json()) } };
  } catch {
    return { status: 502, body: { error: "aggregator did not answer" } };
  }
}
