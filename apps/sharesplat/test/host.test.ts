import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { r2 } from "@rustybuns/shell-bun";
import { jwksOf, newKey, sign } from "@rustybuns/util/token";
import { check } from "@rustybuns/util/guard";
import { Hosted } from "../src/api.ts";
import { handle, type Env } from "../src/worker.ts";

const signer = { EQOSYS_SIGNING_KEY: await newKey() };
const eqosys = Bun.serve({ port: 0, fetch: async () => Response.json(await jwksOf(signer)) });
const iss = `http://localhost:${eqosys.port}`;
const dir = mkdtempSync(join(tmpdir(), "sharesplat-"));
const env: Env = { SPLATS: r2(join(dir, "bucket")), EQOSYS_URL: iss };
afterAll(() => { eqosys.stop(true); rmSync(dir, { recursive: true, force: true }); });

const tokenFor = async (id: string, app = "sharesplat") =>
  (await sign(signer, iss, { user: { id, email: `${id}@example.com`, name: id }, app, source: "eqosys", access: [] }))!;
const call = (path: string, init: RequestInit = {}) => handle(new Request(`https://shop.test${path}`, init), env);
const upload = (bytes: Uint8Array, token?: string) =>
  call("/api/splats", { method: "POST", body: new Blob([new Uint8Array(bytes)]), headers: token ? { authorization: `Bearer ${token}` } : {} });

test("a seller puts a cleaned product online, embeds it, and takes it down", async () => {
  const spz = Bun.gzipSync(new TextEncoder().encode("NGSP a cleaned carton"));
  const ana = await tokenFor("ana"), bo = await tokenFor("bo");

  expect((await upload(spz)).status).toBe(401);
  expect((await upload(spz, await tokenFor("ana", "qview3d"))).status).toBe(401); // a token for another app
  expect((await upload(new TextEncoder().encode("ply\nformat ascii"), ana)).status).toBe(400);

  const res = await upload(spz, ana);
  expect(res.status).toBe(201);
  const hosted = check(Hosted, await res.json())!;
  expect(hosted.page).toBe(`https://shop.test/p/${hosted.id}`);
  // Again is the same product, not a second one.
  expect((await upload(spz, ana)).status).toBe(200);
  expect((await upload(spz, bo)).status).toBe(409);

  // The product's one URL opens the embed on its file; the file is open to any page and cached for good.
  const page = await call(`/p/${hosted.id}`);
  expect(page.status).toBe(302);
  const embed = new URL(page.headers.get("location")!);
  expect(embed.searchParams.get("embed")).toBe("1");
  const file = await call(embed.searchParams.get("src")!);
  expect(new Uint8Array(await file.arrayBuffer())).toEqual(spz);
  expect(file.headers.get("access-control-allow-origin")).toBe("*");
  expect(file.headers.get("cache-control")).toContain("immutable");

  // Only its owner takes it down.
  const down = (token: string) => call(`/api/splats/${hosted.id}`, { method: "DELETE", headers: { authorization: `Bearer ${token}` } });
  expect((await down(bo)).status).toBe(404);
  expect((await down(ana)).status).toBe(204);
  expect((await call(`/p/${hosted.id}`)).status).toBe(404);
  expect((await call(new URL(hosted.src).pathname)).status).toBe(404);
});
