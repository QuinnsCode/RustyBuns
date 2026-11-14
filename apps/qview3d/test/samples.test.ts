// A shop makes a sample of its own product, through the running Worker on the local R2 twin and the stand-in
// Meshy: upload photos with the admin key, start the sample, poll until it's ready, and the product loads with
// its model. Then the refusals that stand in front of a billed call.
import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hex, sha256 } from "@rustybuns/util/bytes";
import { Product, Sample } from "../src/api.ts";
import { DEMO_ADMIN, local } from "../src/local.ts";

setDefaultTimeout(20_000);

const dir = mkdtempSync(join(tmpdir(), "qview3d-samples-"));
let app: Awaited<ReturnType<typeof local>>;
beforeAll(async () => {
  app = await local({ dir, standInSeconds: 0.3 });
  // An org that hasn't paid for samples.
  await app.bindings.BUCKET.put("orgs/nopaid/org.json", JSON.stringify({ origins: ["*"], admins: [await sha256(DEMO_ADMIN)], samples: 0 }));
});
afterAll(() => { app.stop(); rmSync(dir, { recursive: true, force: true }); });

const admin = { authorization: `Bearer ${DEMO_ADMIN}` };
const post = (path: string, body: unknown, headers: Record<string, string> = admin) =>
  fetch(`${app.url}${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

async function photo(org: string, bytes: Uint8Array<ArrayBuffer>) {
  const sha = hex(await crypto.subtle.digest("SHA-256", bytes));
  const res = await post(`/api/orgs/${org}/uploads`, { kind: "photo", type: "image/jpeg", size: bytes.length, sha256: sha });
  expect(res.status).toBe(200);
  const s = (await res.json()) as { key: string; url?: string; put: { url: string; headers: Record<string, string> } };
  expect(s.url).toBeUndefined(); // product photos are never served
  expect((await fetch(s.put.url, { method: "PUT", headers: s.put.headers, body: bytes })).status).toBe(201);
  return s.key;
}

test("photos in, a sample model out, and the widget's product names it", async () => {
  const photos = [await photo("demo", new Uint8Array([1, 2, 3])), await photo("demo", new Uint8Array([4, 5, 6]))];
  const started = await post("/api/orgs/demo/models", { name: "Trail tumbler", photos });
  expect(started.status).toBe(202);
  let s = Sample(await started.json());
  expect(s.status).toBe("generating");
  expect(app.standIn!.started.at(-1)?.map((u) => u.slice(0, 23))).toEqual(["data:image/jpeg;base64,", "data:image/jpeg;base64,"]);

  for (let i = 0; i < 40 && s.status === "generating"; i++) {
    await Bun.sleep(100);
    s = Sample(await (await fetch(`${app.url}/api/orgs/demo/models/${s.id}`, { headers: admin })).json());
  }
  expect(s).toMatchObject({ status: "ready", progress: 100, product: s.id });

  const product = Product(await (await fetch(`${app.url}/api/orgs/demo/products/${s.product}`)).json());
  expect(product).toMatchObject({ name: "Trail tumbler", model: "custom", colors: [] });
  const glb = await fetch(`${app.url}/r/${product.glb}`);
  expect(new TextDecoder().decode((await glb.arrayBuffer()).slice(0, 4))).toBe("glTF");
  expect(glb.headers.get("cache-control")).toContain("immutable");
});

test.each([
  ["starting one without the admin key", "/api/orgs/demo/models", { name: "x", photos: ["orgs/demo/photos/a.jpg"] }, {}, 401],
  ["starting one with a wrong key", "/api/orgs/demo/models", { name: "x", photos: ["orgs/demo/photos/a.jpg"] }, { authorization: "Bearer not-the-key" }, 401],
  ["uploading a product photo without the key", "/api/orgs/demo/uploads", { kind: "photo", type: "image/jpeg", size: 3, sha256: "a".repeat(64) }, {}, 401],
  ["another org's photo", "/api/orgs/demo/models", { name: "x", photos: [`orgs/nopaid/photos/${"a".repeat(64)}.jpg`] }, admin, 400],
  ["a photo never uploaded", "/api/orgs/demo/models", { name: "x", photos: [`orgs/demo/photos/${"b".repeat(64)}.jpg`] }, admin, 400],
])("refused: %s", async (_, path, body, headers, status) => {
  expect((await post(path, body, headers)).status).toBe(status);
});

test("an org with no samples left is told so before Meshy is called", async () => {
  const before = app.standIn!.started.length;
  const res = await post("/api/orgs/nopaid/models", { name: "x", photos: [await photo("nopaid", new Uint8Array([7]))] });
  expect(res.status).toBe(402);
  expect(app.standIn!.started.length).toBe(before);
});
