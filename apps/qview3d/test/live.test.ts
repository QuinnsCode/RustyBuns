// A fresh deploy, bucket empty, the way a friend first meets it: their agent reads /v1/embed.md, pastes the two
// lines it names, and the demo product loads. The public demo stores nothing.
import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Product } from "../src/api.ts";
import { local } from "../src/local.ts";

setDefaultTimeout(15_000);

const dir = mkdtempSync(join(tmpdir(), "qview3d-live-"));
let app: Awaited<ReturnType<typeof local>>;
beforeAll(async () => { app = await local({ dir, seed: false }); });
afterAll(() => { app.stop(); rmSync(dir, { recursive: true, force: true }); });

test("the guide an agent follows names this host, and the demo it names is there", async () => {
  const guide = await (await fetch(`${app.url}/v1/embed.md`)).text();
  expect(guide).toContain(`<script type="module" src="${app.url}/v1/qview3d.js"></script>`);
  expect(guide).toContain("PolyForm Noncommercial");
  const product = guide.match(/<qview-3d org="(\w+)" product="([\w-]+)">/);
  expect(product).not.toBeNull();
  const res = await fetch(`${app.url}/api/orgs/${product![1]}/products/${product![2]}`, { headers: { origin: "https://friend.example" } });
  expect(Product(await res.json())).toMatchObject({ model: "cap" });
  expect((await fetch(`${app.url}/llms.txt`)).status).toBe(200);
});

test("the public demo keeps no files, from any page", async () => {
  const res = await fetch(`${app.url}/api/orgs/demo/uploads`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://friend.example" },
    body: JSON.stringify({ kind: "texture", type: "image/webp", size: 5, sha256: "a".repeat(64) }),
  });
  expect(res.status).toBe(403);
});
