import { expect, test } from "bun:test";
import { handle } from "../src/worker.ts";
import { handle as geoboxq } from "../../geoboxq/src/worker.ts";

// The wrapper against the real GeoBoxQ handler, with its API keys on: a Shopify cart in, the store's box id out.
const upstream = (req: RequestInfo | URL, init?: RequestInit) => geoboxq(new Request(req, init), { GEOBOXQ_API_KEYS: "store-a" } as never);
const env = {
  GEOBOXQ_URL: "https://box.test", GEOBOXQ_KEY: "store-a", fetch: upstream as typeof fetch,
  STORE_BOXES: JSON.stringify([{ id: "gid://shopify/Box/1", name: "Small mailer", l: 8, w: 6, h: 3 }, { id: "gid://shopify/Box/2", name: "Medium carton", l: 12, w: 9, h: 6 }]),
  STORE_DIMS: JSON.stringify({ "11": { l: 6, w: 4, h: 2 }, "12": { l: 5, w: 5, h: 5 } }),
};
const pack = (body: unknown, e = env) => handle(new Request("http://w/pack", { method: "POST", body: JSON.stringify(body) }), e);

test("a cart maps to the smallest of the store's own boxes", async () => {
  const small = await (await pack({ items: [{ variant_id: 11, title: "Soap", quantity: 1 }] })).json() as any;
  expect(small).toMatchObject({ fits: true, box: { id: "gid://shopify/Box/1", name: "Small mailer" } });
  const more = await (await pack({ items: [{ variant_id: 11, title: "Soap", quantity: 2 }, { variant_id: 12, title: "Candle" }] })).json() as any;
  expect(more.box.id).toBe("gid://shopify/Box/2");
  const huge = await (await pack({ items: [{ variant_id: 12, title: "Candle", quantity: 9 }] })).json() as any;
  expect(huge).toMatchObject({ fits: false, box: null });
});

test("a product with no size is named, and a wrong store key is a bad gateway, not a leak", async () => {
  const res = await pack({ items: [{ variant_id: 99, title: "Mystery" }] });
  expect(res.status).toBe(422);
  expect(await res.json()).toMatchObject({ missing: ["Mystery"] });
  expect((await pack({ items: [{ variant_id: 11 }] }, { ...env, GEOBOXQ_KEY: "wrong" })).status).toBe(502);
  // A body that isn't a cart object is a 400, whatever JSON it is.
  for (const body of [null, 5, "cart", [1], {}]) expect((await pack(body)).status).toBe(400);
});
