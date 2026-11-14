// From nothing to a friend's shop that saves designs, through the running Worker on an empty bucket and a stand-in
// eqosys that signs tokens the way the real one does (its studios in the token). The owner makes the org for the
// friend's studio; the friend, signed in, adds a product and a script key; their page embeds it and Save works.
import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hex } from "@rustybuns/util/bytes";
import { jwksOf, newKey, sign, type StudioRole } from "@rustybuns/util/token";
import { KeyReply, Mine, SignReply } from "../src/api.ts";
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
const CAP = { name: "Fern cap", model: "cap", colors: ["#2f5d3a", "#f4efe6"] };

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

test.each([
  ["a token from another eqosys", async () => (await sign({ EQOSYS_SIGNING_KEY: await newKey() }, iss, { user: { id: "x", email: "", name: "x" }, app: "qview3d", source: "eqosys", access: [], studios: [{ id: "qntbr", name: "QNTBR", role: "owner" }] }))!],
  ["an owner token for another app", async () => (await sign(signer, iss, { user: { id: "x", email: "", name: "x" }, app: "park-hide-seek", source: "eqosys", access: [], studios: [{ id: "qntbr", name: "QNTBR", role: "owner" }] }))!],
])("refused: making an org with %s", async (_, token) => {
  expect((await call("/api/orgs/sneaky", "PUT", { studio: "x", origins: ["*"], samples: 99 }, as(await token()))).status).toBe(401);
});
