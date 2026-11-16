// From nothing to a friend's shop that saves designs, through the running Worker on an empty bucket and a stand-in
// eqosys that signs tokens the way the real one does (its studios in the token). The owner makes the org for the
// friend's studio; the friend, signed in, adds a product and a script key; their page embeds it and Save works; then
// they change the product on /orgs.html and the widget's cached read shows it at once.
import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hex } from "@rustybuns/util/bytes";
import { jwksOf, newKey, sign, type StudioRole } from "@rustybuns/util/token";
import { KeyReply, Mine, Product, SandboxReply, SignReply } from "../src/api.ts";
import { fieldsOf, productBody } from "../src/product-form.ts";
import { local } from "../src/local.ts";

setDefaultTimeout(20_000);

const dir = mkdtempSync(join(tmpdir(), "qview3d-orgs-"));
const signer = { EQOSYS_SIGNING_KEY: await newKey() };
const eqosys = Bun.serve({ port: 0, fetch: async () => Response.json(await jwksOf(signer)) });
const iss = `http://localhost:${eqosys.port}`;
let app: Awaited<ReturnType<typeof local>>;
beforeAll(async () => { app = await local({ dir, seed: false, eqosys: iss }); });
afterAll(() => { app.stop(); eqosys.stop(true); rmSync(dir, { recursive: true, force: true }); });

const tokenFor = async (id: string, studios: StudioRole[]) =>
  (await sign(signer, iss, { user: { id, email: `${id}@example.com`, name: id }, app: "qview3d", source: "eqosys", access: ["member"], studios }))!;
const owner = await tokenFor("boss", [{ id: "qntbr", name: "QNTBR", role: "owner" }]);
const fern = await tokenFor("fern", [{ id: "fern-studio", name: "Fern Hats", role: "owner" }]);
const maker = await tokenFor("max", [{ id: "fern-studio", name: "Fern Hats", role: "maker" }]);

const call = (path: string, method: string, body?: unknown, h: Record<string, string> = {}) =>
  fetch(`${app.url}${path}`, { method, headers: { "content-type": "application/json", ...h }, body: body === undefined ? undefined : JSON.stringify(body) });
const as = (token: string) => ({ authorization: `Bearer ${token}` });
const CAP: Product = { name: "Fern cap", model: "cap", colors: ["#2f5d3a", "#f4efe6"] };

test("the owner makes a friend's org; the friend adds a product and a key; their page saves a design", async () => {
  const before = Mine(await (await call("/api/mine", "GET", undefined, as(fern))).json());
  expect(before).toEqual({ owner: false, shops: [{ studio: "fern-studio", name: "Fern Hats", role: "owner" }] });

  // Only the owner makes an org.
  const setup = { studio: "fern-studio", origins: ["https://fernhats.example"], samples: 1 };
  expect((await call("/api/orgs/fern", "PUT", setup, as(fern))).status).toBe(403);
  expect((await call("/api/orgs/fern", "PUT", setup, as(owner))).status).toBe(201);

  // The friend, signed in, writes a product; a maker in the studio and a stranger can't.
  expect((await call("/api/orgs/fern/products/cap", "PUT", CAP, as(maker))).status).toBe(403);
  expect((await call("/api/orgs/fern/products/cap", "PUT", CAP)).status).toBe(401);
  expect((await call("/api/orgs/fern/products/cap", "PUT", CAP, as(fern))).status).toBe(200);
  expect(await (await fetch(`${app.url}/api/orgs/fern/products/cap`)).json()).toEqual(CAP);

  // A key for a script, shown once, writes products too.
  const { key } = KeyReply(await (await call("/api/orgs/fern/keys", "POST", {}, as(fern))).json());
  expect((await call("/api/orgs/fern/products/beanie", "PUT", { ...CAP, name: "Fern beanie", model: "beanie" }, as(key))).status).toBe(200);
  expect((await call("/api/orgs/fern/products/beanie", "PUT", CAP, as("qv_not-the-key"))).status).toBe(403);

  const after = Mine(await (await call("/api/mine", "GET", undefined, as(fern))).json());
  expect(after.shops[0]?.org).toMatchObject({ id: "fern", origins: ["https://fernhats.example"], samples: 1, keys: 1 });
  expect(after.shops[0]?.org?.products.map((p) => p.id).sort()).toEqual(["beanie", "cap"]);
  expect(Mine(await (await call("/api/mine", "GET", undefined, as(owner))).json()).owner).toBe(true);

  // The friend's page: upload a texture, save a design. Another site can't use the org.
  const page = { origin: "https://fernhats.example" };
  const bytes = new Uint8Array([3, 1, 4, 1, 5]);
  const sha = hex(await crypto.subtle.digest("SHA-256", bytes));
  const signed = SignReply(await (await call("/api/orgs/fern/uploads", "POST", { kind: "texture", type: "image/webp", size: bytes.length, sha256: sha }, page)).json());
  expect((await fetch(signed.put!.url, { method: "PUT", headers: signed.put!.headers, body: bytes })).status).toBe(201);
  const design = { v: 1, model: "cap", color: "#2f5d3a", product: "cap", layers: [{ texture: signed.key, u: 0.5, v: 0.5, scale: 0.4, rotation: 0 }], camera: { azimuth: 0, polar: 1.2, distance: 2 } };
  expect((await call("/api/orgs/fern/designs", "POST", design, page)).status).toBe(201);
  expect((await call("/api/orgs/fern/designs", "POST", design, { origin: "https://elsewhere.example" })).status).toBe(403);
});

test("the friend changes the cap on /orgs.html; the next page load shows it, though the widget's read is cached", async () => {
  const widget = async () => Product(await (await fetch(`${app.url}/api/orgs/fern/products/cap`, { headers: { origin: "https://fernhats.example" } })).json());
  expect((await widget()).colors).toEqual(CAP.colors);
  // The read is cached: a row changed behind the Worker's back isn't seen for a minute.
  await app.bindings.DB.prepare("UPDATE products SET body = ? WHERE org = 'fern' AND id = 'cap'").bind(JSON.stringify({ ...CAP, colors: ["#000000"] })).run();
  expect((await widget()).colors).toEqual(CAP.colors);

  // The page: Change fills the editor from /api/mine, the friend types new colours, switches the back off
  // (a cap has only a front, so that stays), sets where a picture lands, and saves.
  const row = Mine(await (await call("/api/mine", "GET", undefined, as(fern))).json()).shops[0]!.org!.products.find((p) => p.id === "cap")!;
  const fields = { ...fieldsOf(row.product), colors: "#2F5D3A, #fc0, #f4efe6", across: "50", up: "60", size: "30" };
  expect((await call("/api/orgs/fern/products/cap", "PUT", productBody(fields), as(fern))).status).toBe(200);
  expect(await widget()).toEqual({ ...CAP, colors: ["#2f5d3a", "#ffcc00", "#f4efe6"], place: { u: 0.5, v: 0.6, scale: 0.3, rotation: 0 } });

  // A tee with its sleeve switched off: the page's own check, then the Worker refuses a design on it.
  const tee = productBody({ ...fieldsOf({ name: "Fern tee", model: "tee", colors: ["#f4efe6"] }), print: ["front", "back"] });
  expect(tee.print).toEqual(["front", "back"]);
  expect((await call("/api/orgs/fern/products/tee", "PUT", tee, as(fern))).status).toBe(200);
  expect(() => productBody({ ...fieldsOf(tee), print: [] })).toThrow("print zone");
  expect(() => productBody({ ...fieldsOf(tee), colors: "green" })).toThrow();
  const design = { v: 1, model: "tee", color: "#f4efe6", product: "tee", layers: [], camera: { azimuth: 0, polar: 1.2, distance: 2 } };
  expect((await call("/api/orgs/fern/designs", "POST", { ...design, layers: [{ texture: "orgs/fern/textures/x.webp", zone: "left-sleeve", u: 0.5, v: 0.5, scale: 0.4, rotation: 0 }] }, { origin: "https://fernhats.example" })).status).toBe(400);

  // Its own sites, from the same page; the owner's allowance stays the owner's.
  expect((await call("/api/orgs/fern/sites", "PUT", { origins: ["https://fernhats.example", "https://fern.shop"] }, as(fern))).status).toBe(200);
  expect((await call("/api/orgs/fern/sites", "PUT", { origins: ["https://x.example"] }, as(maker))).status).toBe(403);
  expect((await call("/api/orgs/fern/sites", "PUT", { origins: ["fern.shop"] }, as(fern))).status).toBe(400);
  expect(Mine(await (await call("/api/mine", "GET", undefined, as(fern))).json()).shops[0]?.org).toMatchObject({ origins: ["https://fernhats.example", "https://fern.shop"], samples: 1 });
});

test("a shop owner starts their own shop, or keeps the sandbox they were sent, with nobody in between", async () => {
  const ivy = await tokenFor("ivy", [{ id: "ivy-studio", name: "Ivy Caps!", role: "owner" }, { id: "fern-studio", name: "Fern Hats", role: "maker" }]);
  // A maker can't start one; a studio that has a shop can't start another; a taken id is refused.
  expect((await call("/api/mine/shops", "POST", { studio: "fern-studio" }, as(ivy))).status).toBe(403);
  expect((await call("/api/mine/shops", "POST", { studio: "fern-studio" }, as(fern))).status).toBe(409);
  expect((await call("/api/mine/shops", "POST", { studio: "ivy-studio", org: "fern" }, as(ivy))).status).toBe(409);

  // Start my shop: named after the studio, the starter tee, no sites yet, so no page shows it until they add theirs.
  const started = await call("/api/mine/shops", "POST", { studio: "ivy-studio" }, as(ivy));
  expect(started.status).toBe(201);
  const shop = Mine(await (await call("/api/mine", "GET", undefined, as(ivy))).json()).shops.find((s) => s.studio === "ivy-studio")!.org!;
  expect(shop).toMatchObject({ id: "ivy-caps", origins: [], samples: 0 });
  expect(shop.products.map((p) => p.id)).toEqual(["my-tee"]);
  const design = { v: 1, model: "tee", color: "#1f2937", product: "my-tee", layers: [], camera: { azimuth: 0, polar: 1.2, distance: 2 } };
  expect((await call("/api/orgs/ivy-caps/designs", "POST", design, { origin: "https://ivycaps.example" })).status).toBe(403);
  expect((await call("/api/orgs/ivy-caps/sites", "PUT", { origins: ["https://ivycaps.example"] }, as(ivy))).status).toBe(200);
  expect((await call("/api/orgs/ivy-caps/designs", "POST", design, { origin: "https://ivycaps.example" })).status).toBe(201);
  expect((await call("/api/mine/shops", "POST", { studio: "ivy-studio" }, as(ivy))).status).toBe(409);

  // Keep a sandbox: the owner hands one out, its person signs in and keeps it with the link's key.
  const { org: sbOrg, key: sbKey } = SandboxReply(await (await call("/api/sandboxes", "POST", { for: "Oak" }, as(owner))).json());
  const sb = { org: sbOrg, key: sbKey };
  const oak = await tokenFor("oak", [{ id: "oak-studio", name: "Oak Tees", role: "owner" }]);
  expect((await call("/api/mine/shops", "POST", { studio: "oak-studio", sandbox: { org: sb.org, key: "qv_wrong" } }, as(oak))).status).toBe(404);
  expect((await call("/api/mine/shops", "POST", { studio: "oak-studio", sandbox: { org: "ivy-caps", key: sb.key } }, as(oak))).status).toBe(404);
  expect((await call("/api/mine/shops", "POST", { studio: "oak-studio", sandbox: sb }, as(oak))).status).toBe(200);
  const kept = Mine(await (await call("/api/mine", "GET", undefined, as(oak))).json()).shops[0]!.org!;
  expect(kept).toMatchObject({ id: sb.org, origins: ["*"] });
  expect(kept.expires).toBeUndefined();
  expect(kept.products.map((p) => p.id)).toEqual(["my-tee"]);
  // Kept once: another studio can't take it with the same link.
  const pine = await tokenFor("pine", [{ id: "pine-studio", name: "Pine", role: "owner" }]);
  expect((await call("/api/mine/shops", "POST", { studio: "pine-studio", sandbox: sb }, as(pine))).status).toBe(404);
});

test.each([
  ["a token from another eqosys", async () => (await sign({ EQOSYS_SIGNING_KEY: await newKey() }, iss, { user: { id: "x", email: "", name: "x" }, app: "qview3d", source: "eqosys", access: [], studios: [{ id: "qntbr", name: "QNTBR", role: "owner" }] }))!],
  ["an owner token for another app", async () => (await sign(signer, iss, { user: { id: "x", email: "", name: "x" }, app: "park-hide-seek", source: "eqosys", access: [], studios: [{ id: "qntbr", name: "QNTBR", role: "owner" }] }))!],
])("refused: making an org with %s", async (_, token) => {
  expect((await call("/api/orgs/sneaky", "PUT", { studio: "x", origins: ["*"], samples: 99 }, as(await token()))).status).toBe(401);
});
