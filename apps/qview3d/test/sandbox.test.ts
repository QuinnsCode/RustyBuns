// The owner hands someone a sandbox, through the running Worker and a stand-in eqosys: one link, opened with no
// account. Its key reads the sandbox and writes their product, any page shows it and saves designs, the agent guide
// names it, it ends on its date, and making a shop with its org id keeps it for good.
import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hex } from "@rustybuns/util/bytes";
import { jwksOf, newKey, sign, type StudioRole } from "@rustybuns/util/token";
import { Product, SandboxReply, Shop, SignReply } from "../src/api.ts";
import { local } from "../src/local.ts";

setDefaultTimeout(20_000);

const dir = mkdtempSync(join(tmpdir(), "qview3d-sandbox-"));
const signer = { EQOSYS_SIGNING_KEY: await newKey() };
const eqosys = Bun.serve({ port: 0, fetch: async () => Response.json(await jwksOf(signer)) });
const iss = `http://localhost:${eqosys.port}`;
let app: Awaited<ReturnType<typeof local>>;
beforeAll(async () => { app = await local({ dir, seed: false, eqosys: iss }); });
afterAll(() => { app.stop(); eqosys.stop(true); rmSync(dir, { recursive: true, force: true }); });

const tokenFor = async (id: string, studios: StudioRole[]) =>
  (await sign(signer, iss, { user: { id, email: `${id}@example.com`, name: id }, app: "qview3d", source: "eqosys", access: ["member"], studios }))!;
const call = (path: string, method: string, body?: unknown, h: Record<string, string> = {}) =>
  fetch(`${app.url}${path}`, { method, headers: { "content-type": "application/json", ...h }, body: body === undefined ? undefined : JSON.stringify(body) });
const as = (token: string) => ({ authorization: `Bearer ${token}` });
const MUG: Product = { name: "Fern hoodie", model: "hoodie", colors: ["#2f5d3a"] };

test("the owner sends a sandbox link; the friend sets up their product and puts it on any page; it ends, or becomes a shop", async () => {
  const owner = await tokenFor("boss", [{ id: "qntbr", name: "QNTBR", role: "owner" }]);
  const stranger = await tokenFor("fern", [{ id: "fern-studio", name: "Fern Hats", role: "owner" }]);
  expect((await call("/api/sandboxes", "POST", {}, as(stranger))).status).toBe(403);
  expect((await call("/api/sandboxes", "POST", {})).status).toBe(401);

  const res = await call("/api/sandboxes", "POST", { for: "Fern's Hats!", samples: 1, days: 7 }, as(owner));
  expect(res.status).toBe(201);
  const box = SandboxReply(await res.json());
  expect(box.org).toMatch(/^try-fern-s-hats-[0-9a-f]{6}$/);
  expect(box.expires - Date.now()).toBeGreaterThan(6.9 * 86_400_000);

  // The link opens the sandbox page, and its fragment carries what the page signs in with.
  const link = new URL(box.link);
  expect(link.pathname).toBe("/try.html");
  const fragment = new URLSearchParams(link.hash.slice(1));
  expect(fragment.get("org")).toBe(box.org);
  const key = fragment.get("key")!;

  // The page reads the sandbox with the key: a tee is there to show at once. A wrong key learns nothing.
  const shop = Shop(await (await call(`/api/orgs/${box.org}`, "GET", undefined, as(key))).json());
  expect(shop).toMatchObject({ id: box.org, origins: ["*"], samples: 1, keys: 1, expires: box.expires });
  expect(shop.products.map((p) => p.id)).toEqual(["my-tee"]);
  expect((await call(`/api/orgs/${box.org}`, "GET", undefined, as("qv_not-the-key"))).status).toBe(404);

  // They add their product; any page shows it and saves a design on it.
  expect((await call(`/api/orgs/${box.org}/products/fern-hoodie`, "PUT", MUG, as(key))).status).toBe(200);
  const page = { origin: "https://localhost-of-theirs.example" };
  expect(Product(await (await call(`/api/orgs/${box.org}/products/fern-hoodie`, "GET", undefined, page)).json())).toEqual(MUG);
  const bytes = new Uint8Array([2, 7, 1, 8]);
  const sha = hex(await crypto.subtle.digest("SHA-256", bytes));
  const signed = SignReply(await (await call(`/api/orgs/${box.org}/uploads`, "POST", { kind: "texture", type: "image/webp", size: bytes.length, sha256: sha }, page)).json());
  expect((await fetch(signed.put!.url, { method: "PUT", headers: signed.put!.headers, body: bytes })).status).toBe(201);
  const design = { v: 1, model: "hoodie", color: "#2f5d3a", product: "fern-hoodie", layers: [{ texture: signed.key, u: 0.5, v: 0.5, scale: 0.4, rotation: 0 }], camera: { azimuth: 0, polar: 1.2, distance: 2 } };
  expect((await call(`/api/orgs/${box.org}/designs`, "POST", design, page)).status).toBe(201);

  // The line for their coding agent: the guide's tags name their sandbox, not the demo.
  const guide = await (await fetch(`${app.url}/v1/embed.md?org=${box.org}&product=fern-hoodie`)).text();
  expect(guide).toContain(`<qview-3d org="${box.org}" product="fern-hoodie"></qview-3d>`);
  expect(guide).toContain(`/v1/frame?org=${box.org}&product=fern-hoodie`);

  // Past its date it is gone everywhere, until the owner makes it a shop, which keeps the product and has no end.
  await app.bindings.DB.prepare("UPDATE orgs SET expires = ? WHERE id = ?").bind(Date.now() - 1, box.org).run();
  expect((await call(`/api/orgs/${box.org}`, "GET", undefined, as(key))).status).toBe(404);
  expect((await call(`/api/orgs/${box.org}/uploads`, "POST", { kind: "texture", type: "image/webp", size: 4, sha256: sha }, page)).status).toBe(404);
  expect((await call(`/api/orgs/${box.org}`, "PUT", { studio: "fern-studio", origins: ["https://fernhats.example"], samples: 0 }, as(owner))).status).toBe(201);
  const kept = Shop(await (await call(`/api/orgs/${box.org}`, "GET", undefined, as(stranger))).json());
  expect(kept.expires).toBeUndefined();
  expect(kept.products.map((p) => p.id)).toEqual(["fern-hoodie", "my-tee"]);
});
