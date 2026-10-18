// A store's wrapper around GeoBoxQ. `POST /pack` takes a Shopify cart (the `/cart.js` shape, or a draft order's
// line items), looks up each variant's size, asks GeoBoxQ's `POST /api/solve`, and answers in the store's own box ids.
// Config is env: STORE_BOXES (the store's box set), STORE_DIMS (variant id -> size), GEOBOXQ_URL, GEOBOXQ_KEY.

export interface StoreBox { id: string; name: string; l: number; w: number; h: number }
export interface Dims { l: number; w: number; h: number; wall?: number }
export interface Env { GEOBOXQ_URL?: string; GEOBOXQ_KEY?: string; STORE_BOXES?: string; STORE_DIMS?: string; fetch?: typeof fetch }
interface Line { variant_id?: number | string; title?: string; quantity?: number }

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

/** Cart lines to GeoBoxQ items. Variants with no size are returned apart: the store has to say how big they are. */
export function toItems(lines: Line[], dims: Record<string, Dims>) {
  const items: { name: string; l: number; w: number; h: number; qty: number; wall?: number }[] = [];
  const missing: string[] = [];
  for (const line of lines) {
    const id = String(line.variant_id ?? "");
    const d = dims[id];
    if (!d) { missing.push(line.title ?? id); continue; }
    items.push({ name: line.title ?? id, ...d, qty: Math.max(1, Math.floor(line.quantity ?? 1)) });
  }
  return { items, missing };
}

export async function handle(req: Request, env: Env): Promise<Response> {
  const { pathname } = new URL(req.url);
  if (pathname === "/health") return json({ ok: true });
  if (pathname !== "/pack") return json({ error: "not found" }, 404);
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  let cart: { items?: Line[]; line_items?: Line[] };
  let boxes: StoreBox[];
  let dims: Record<string, Dims>;
  try {
    cart = await req.json() as typeof cart;
    boxes = JSON.parse(env.STORE_BOXES ?? "[]");
    dims = JSON.parse(env.STORE_DIMS ?? "{}");
  } catch { return json({ error: "body or store config is not JSON" }, 400); }
  const lines = cart?.items ?? cart?.line_items;
  if (!Array.isArray(lines)) return json({ error: "send a Shopify cart: { items: [...] }" }, 400);
  const { items, missing } = toItems(lines, dims);
  if (missing.length) return json({ error: "no size for these products", missing }, 422);
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (env.GEOBOXQ_KEY) headers.authorization = `Bearer ${env.GEOBOXQ_KEY}`;
  const res = await (env.fetch ?? fetch)(`${env.GEOBOXQ_URL ?? "https://geoboxq.qntbr.com"}/api/solve`, {
    method: "POST", headers, body: JSON.stringify({ boxes: boxes.map(({ name, l, w, h }) => ({ name, l, w, h })), items }),
  });
  const out = await res.json() as { error?: string; fits?: boolean; box?: { index: number; fill: number } | null; tree?: unknown };
  if (!res.ok) return json({ error: out.error ?? "GeoBoxQ refused the cart" }, res.status === 401 ? 502 : res.status);
  const box = out.box ? boxes[out.box.index]! : null;
  return json({ fits: Boolean(out.fits), box: box && { id: box.id, name: box.name, fill: out.box!.fill }, tree: out.tree });
}

export default { fetch: (req: Request, env: Env) => handle(req, env) };
