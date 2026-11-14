// The path a shop's page walks to save a design, through the running Worker on the local R2 twin:
// sign each file, PUT it, save the design, read it back from the edge route. Then the refusals a page or a
// stranger would plausibly hit.
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hex } from "@rustybuns/util/bytes";
import { DEMO_ADMIN, local } from "../src/local.ts";
import { presignUrl } from "../src/sign.ts";

setDefaultTimeout(15_000);

const dir = mkdtempSync(join(tmpdir(), "qview3d-"));
let app: Awaited<ReturnType<typeof local>>;
beforeAll(async () => {
  app = await local({ dir });
  await app.bindings.BUCKET.put("orgs/acme/org.json", JSON.stringify({ origins: ["https://shop.acme.test"] }));
});
afterAll(() => { app.stop(); rmSync(dir, { recursive: true, force: true }); });

const sha = async (b: Uint8Array) => hex(await crypto.subtle.digest("SHA-256", b as Uint8Array<ArrayBuffer>));
const post = (path: string, body: unknown, origin = "https://anywhere.test") =>
  fetch(`${app.url}${path}`, { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify(body) });

/** Sign and upload `bytes` as `kind` for the demo org; the key it landed at. */
async function upload(kind: string, type: string, bytes: Uint8Array<ArrayBuffer>) {
  const res = await post("/api/orgs/demo/uploads", { kind, type, size: bytes.length, sha256: await sha(bytes) });
  expect(res.status).toBe(200);
  const s = (await res.json()) as { key: string; exists: boolean; put?: { url: string; headers: Record<string, string> }; url?: string };
  if (!s.exists) expect((await fetch(s.put!.url, { method: "PUT", headers: s.put!.headers, body: bytes })).status).toBe(201);
  return s;
}

describe("saving a design", () => {
  test("files go up signed, the design names them, and the edge serves them for a year", async () => {
    const texture = new Uint8Array([1, 2, 3, 4, 5]), original = new Uint8Array([9, 9, 9]), shot = new Uint8Array([7, 7]);
    const t = await upload("texture", "image/webp", texture);
    const o = await upload("original", "image/png", original);
    const s = await upload("snapshot", "image/png", shot);
    expect(t.key).toBe(`orgs/demo/textures/${await sha(texture)}.webp`);
    expect(o.url).toBeUndefined(); // originals are the print source: never handed out

    const served = await fetch(t.url!);
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(texture);
    expect(served.headers.get("cache-control")).toContain("immutable");
    expect(served.headers.get("access-control-allow-origin")).toBe("*"); // WebGL needs it for a texture

    const again = await post("/api/orgs/demo/uploads", { kind: "texture", type: "image/webp", size: 5, sha256: await sha(texture) });
    expect(await again.json()).toMatchObject({ exists: true }); // the same picture twice is one object

    const design = {
      v: 1, model: "cap", color: "#1f2937", product: "field-cap", snapshot: s.key,
      layers: [{ texture: t.key, original: o.key, u: 0.5, v: 0.55, scale: 0.7, rotation: 0.2 }],
      camera: { azimuth: 0, polar: 1.2, distance: 5.6 },
    };
    const saved = await post("/api/orgs/demo/designs", design);
    expect(saved.status).toBe(201);
    const { url } = (await saved.json()) as { url: string };
    expect(await (await fetch(url)).json()).toEqual(design);
  });

  const SLEEVES = ["front", "back", "left-sleeve"] as const, NO_SLEEVES = ["front", "back"] as const;
  test.each([
    ["crew-tee", "tee", SLEEVES],
    ["crew-sweater", "sweater", SLEEVES],
    ["pullover-hoodie", "hoodie", SLEEVES],
    ["classic-tank", "tank", NO_SLEEVES],
    ["racerback-tank", "racerback", NO_SLEEVES],
  ] as const)("the demo's %s keeps a picture on each of its zones", async (product, model, zones) => {
    const pics = await Promise.all(zones.map((_, i) => upload("texture", "image/webp", new Uint8Array([i + 1, model.length]))));
    const shot = await upload("snapshot", "image/png", new Uint8Array([4, model.length]));
    const at = { u: 0.5, v: 0.5, scale: 0.7, rotation: 0 };
    const design = {
      v: 1, model, color: "#6b7280", product, snapshot: shot.key,
      layers: zones.map((zone, i) => ({ texture: pics[i]!.key, zone, ...at })),
      camera: { azimuth: 0.8, polar: 1.2, distance: 5.6 },
    };
    const saved = await post("/api/orgs/demo/designs", design);
    expect(saved.status).toBe(201);
    expect(await (await fetch(((await saved.json()) as { url: string }).url)).json()).toEqual(design);
    expect(await (await fetch(`${app.url}/api/orgs/demo/products/${product}`)).json()).toMatchObject({ model });
  });

  test("products come from the org's folder", async () => {
    const res = await fetch(`${app.url}/api/orgs/demo/products/cuff-beanie`);
    expect(await res.json()).toMatchObject({ model: "beanie" });
  });
});

describe("refused", () => {
  test.each([
    ["a page the org didn't list", "/api/orgs/acme/uploads", { kind: "texture", type: "image/webp", size: 5, sha256: "a".repeat(64) }, 403],
    ["an org nobody set up", "/api/orgs/nobody/uploads", { kind: "texture", type: "image/webp", size: 5, sha256: "a".repeat(64) }, 404],
    ["a type that kind doesn't take", "/api/orgs/demo/uploads", { kind: "snapshot", type: "image/jpeg", size: 5, sha256: "a".repeat(64) }, 400],
    ["a texture over 4 MB", "/api/orgs/demo/uploads", { kind: "texture", type: "image/webp", size: 5 << 20, sha256: "a".repeat(64) }, 413],
    ["a body that isn't a sign request", "/api/orgs/demo/uploads", { kind: "texture" }, 400],
    ["a design using another org's file", "/api/orgs/demo/designs", { v: 1, model: "cap", color: "#000000", layers: [{ texture: `orgs/acme/textures/${"b".repeat(64)}.webp`, u: 0.5, v: 0.5, scale: 0.5, rotation: 0 }], camera: { azimuth: 0, polar: 1, distance: 5 } }, 400],
    ["a back print on a cap", "/api/orgs/demo/designs", { v: 1, model: "cap", color: "#000000", layers: [{ texture: "orgs/demo/textures/x.webp", zone: "back", u: 0.5, v: 0.5, scale: 0.5, rotation: 0 }], camera: { azimuth: 0, polar: 1, distance: 5 } }, 400],
    ["a sleeve picture on a tank", "/api/orgs/demo/designs", { v: 1, model: "tank", color: "#000000", layers: [{ texture: "orgs/demo/textures/x.webp", zone: "left-sleeve", u: 0.5, v: 0.5, scale: 0.5, rotation: 0 }], camera: { azimuth: 0, polar: 1, distance: 5 } }, 400],
    ["two pictures on a tee's front", "/api/orgs/demo/designs", { v: 1, model: "tee", color: "#000000", layers: [0, 1].map(() => ({ texture: "orgs/demo/textures/x.webp", zone: "front", u: 0.5, v: 0.5, scale: 0.5, rotation: 0 })), camera: { azimuth: 0, polar: 1, distance: 5 } }, 400],
    ["a design whose files were never uploaded", "/api/orgs/demo/designs", { v: 1, model: "cap", color: "#000000", layers: [{ texture: `orgs/demo/textures/${"c".repeat(64)}.webp`, u: 0.5, v: 0.5, scale: 0.5, rotation: 0 }], camera: { azimuth: 0, polar: 1, distance: 5 } }, 400],
  ])("%s", async (_, path, body, status) => {
    expect((await post(path, body)).status).toBe(status);
  });

  test("the listed shop may sign for its org", async () => {
    const res = await post("/api/orgs/acme/uploads", { kind: "texture", type: "image/webp", size: 5, sha256: "a".repeat(64) }, "https://shop.acme.test");
    expect(res.status).toBe(200);
  });

  test("bytes that don't match their signed SHA-256, and a forged link", async () => {
    const res = await post("/api/orgs/demo/uploads", { kind: "texture", type: "image/png", size: 3, sha256: await sha(new Uint8Array([1, 2, 3])) });
    const { put } = (await res.json()) as { put: { url: string; headers: Record<string, string> } };
    expect((await fetch(put.url, { method: "PUT", headers: put.headers, body: new Uint8Array([3, 2, 1]) })).status).toBe(400);
    const forged = put.url.replace(/\.[0-9a-f]+$/, `.${"0".repeat(64)}`);
    expect((await fetch(forged, { method: "PUT", headers: put.headers, body: new Uint8Array([1, 2, 3]) })).status).toBe(403);
  });

  test("originals and org settings are not served", async () => {
    const o = await upload("original", "image/png", new Uint8Array([4, 4]));
    expect((await fetch(`${app.url}/r/${o.key}`)).status).toBe(404);
    expect((await fetch(`${app.url}/r/orgs/demo/org.json`)).status).toBe(404);
  });
});

test("a page hammering the signer, or an admin starting samples, is told to slow down", async () => {
  // A fake of Cloudflare's rate limit binding: two a key, then no.
  const fake = () => {
    const seen = new Map<string, number>();
    return { keys: seen, limit: async ({ key }: { key: string }) => { seen.set(key, (seen.get(key) ?? 0) + 1); return { success: seen.get(key)! <= 2 }; } };
  };
  const limits = { SIGN_LIMIT: fake(), SAMPLE_LIMIT: fake() };
  const limitedDir = mkdtempSync(join(tmpdir(), "qview3d-limits-"));
  const limited = await local({ dir: limitedDir, limits, standInSeconds: 0.3 });
  try {
    const sign = (ip: string) => fetch(`${limited.url}/api/orgs/demo/uploads`, {
      method: "POST", headers: { "content-type": "application/json", origin: "https://anywhere.test", "cf-connecting-ip": ip },
      body: JSON.stringify({ kind: "texture", type: "image/webp", size: 5, sha256: "a".repeat(64) }),
    });
    expect([(await sign("1.1.1.1")).status, (await sign("1.1.1.1")).status]).toEqual([200, 200]);
    const slow = await sign("1.1.1.1");
    expect(slow.status).toBe(429);
    expect(slow.headers.get("retry-after")).toBe("60");
    expect(await slow.json()).toMatchObject({ retryAfter: 60 });
    expect((await sign("2.2.2.2")).status).toBe(200); // another visitor has their own allowance
    expect([...limits.SIGN_LIMIT.keys.keys()]).toEqual(["1.1.1.1:demo", "2.2.2.2:demo"]);

    const start = () => fetch(`${limited.url}/api/orgs/demo/models`, {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${DEMO_ADMIN}` }, body: "{}",
    });
    expect([(await start()).status, (await start()).status]).toEqual([400, 400]); // not photos, but they count
    expect((await start()).status).toBe(429);
    expect([...limits.SAMPLE_LIMIT.keys.keys()]).toEqual(["demo"]);
  } finally {
    limited.stop();
    rmSync(limitedDir, { recursive: true, force: true });
  }
});

test("S3 presigned URLs match AWS's published example", async () => {
  // https://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-query-string-auth.html
  const url = await presignUrl({
    method: "GET", host: "examplebucket.s3.amazonaws.com", path: "/test.txt", region: "us-east-1",
    accessKeyId: "AKIAIOSFODNN7EXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    expires: 86400, date: new Date("2013-05-24T00:00:00Z"),
  });
  expect(new URL(url).searchParams.get("X-Amz-Signature")).toBe("aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404");
});
