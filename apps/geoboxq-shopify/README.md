# GeoBoxQ for Shopify

A small wrapper that turns a Shopify cart into the store's own box. `POST /pack` takes the cart
(`/cart.js` shape, or a draft order's `line_items`), looks up each variant's size, calls
[GeoBoxQ](../geoboxq/README.md)'s `POST /api/solve` and answers `{ fits, box: { id, name, fill }, tree }`
with the id from the store's own box set.

| Env | What |
|---|---|
| `STORE_BOXES` | JSON list of `{ id, name, l, w, h }`: the store's boxes, in any unit |
| `STORE_DIMS` | JSON map of variant id to `{ l, w, h, wall? }`. A variant with no size gets a 422 naming it |
| `GEOBOXQ_URL` | The GeoBoxQ host |
| `GEOBOXQ_KEY` | This store's key, sent as `Authorization: Bearer`. GeoBoxQ checks it against its `GEOBOXQ_API_KEYS` (comma-separated); when that is unset the endpoint stays open |

`bun run serve` runs it on Bun; `wrangler.jsonc` runs it as a Worker. `bun test test` runs the journey
against the real GeoBoxQ handler with keys on.
