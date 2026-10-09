import { test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import host, { _reset } from "../desktop/host.ts";
import { fakeMeshy, type Fake } from "./fake-meshy.ts";

const root = mkdtempSync(join(tmpdir(), "meshy-host-"));
const ctx = { env: {}, dataDir: join(root, "data"), identity: {}, reporter: { breadcrumb() {}, report() {}, escaped() {} } } as any;
const call = async (path: string, init?: RequestInit) => (await host.fetch(new Request(`http://local${path}`, init), ctx))!;
const post = (path: string, body: unknown) => call(path, { method: "POST", body: JSON.stringify(body) });
let fake: Fake;

beforeAll(async () => { mkdirSync(ctx.dataDir, { recursive: true }); fake = await fakeMeshy("msy_good"); _reset(); delete process.env.MESHY_API_KEY; });
afterAll(() => { _reset(); fake.stop(); rmSync(root, { recursive: true, force: true }); });

test("not our route: falls through", async () => {
  expect(await host.fetch(new Request("http://local/index.html"), ctx)).toBeNull();
});

test("a bad key is refused and not saved; a good one is saved user-only", async () => {
  const bad = await post("/api/key", { key: "msy_bad" });
  expect(bad.status).toBe(401);
  expect((await bad.json()).error).toContain("rejected");
  expect(existsSync(join(ctx.dataDir, "meshy-key"))).toBe(false);

  const good = await post("/api/key", { key: "msy_good" });
  expect(await good.json()).toEqual({ balance: 1000 });
  expect(statSync(join(ctx.dataDir, "meshy-key")).mode & 0o777).toBe(0o600);
  const st = await (await call("/api/status")).json();
  expect(st.hasKey).toBe(true);
  // Not even the last characters: the key never comes back out.
  expect(JSON.stringify(st)).not.toContain("good");
});

test("workspace routes: open, upload, folders, image, no escapes", async () => {
  expect((await call("/api/jobs")).status).toBe(409);
  const dir = join(root, "My Game");
  mkdirSync(dir);
  expect((await post("/api/workspace/open", { dir })).status).toBe(200);
  expect(existsSync(join(dir, "002_ready"))).toBe(true);

  expect((await post("/api/folders", { name: "forest" })).status).toBe(200);
  expect((await post("/api/folders", { name: "../escape" })).status).toBe(400);
  expect((await post("/api/folders", { name: "already done" })).status).toBe(400);

  const up = await call("/api/upload?folder=forest&name=flora_oak.png", { method: "POST", body: new Uint8Array([1, 2, 3]) });
  const sum = await up.json();
  expect(sum.folders).toEqual(["", "forest"]);
  expect(sum.jobs[0].key).toBe("forest/flora_oak.png");
  expect((await call("/api/upload?folder=..&name=x.png", { method: "POST", body: "x" })).status).toBe(400);
  expect((await call("/api/upload?folder=&name=notes.txt", { method: "POST", body: "x" })).status).toBe(400);
  expect(existsSync(join(root, "x.png"))).toBe(false);

  const img = await call(`/img/${encodeURIComponent("forest/flora_oak.png")}`);
  expect([img.status, img.headers.get("content-type")]).toEqual([200, "image/png"]);
  expect((await call("/img/..%2F..%2Fdata%2Fmeshy-key")).status).toBe(404);

  // A card action that can't happen is a 400 with a reason, not a crash.
  const r = await post("/api/jobs/cancel", { key: "forest/flora_oak.png" });
  expect([r.status, (await r.json()).error]).toEqual([400, "nothing to cancel"]);
  _reset();
});

test("spend guards: confirmed amount, batch limit and balance are checked by the host", async () => {
  const dir = join(root, "Guarded");
  mkdirSync(dir);
  await post("/api/workspace/open", { dir });
  for (const n of ["environ_a.png", "environ_b.png", "item_c.png"]) {
    await call(`/api/upload?folder=&name=${n}`, { method: "POST", body: new Uint8Array([1]) });
  }
  // 30 + 30 + 15 = 75 credits
  const changed = await post("/api/jobs/send", { credits: 60 });
  expect([changed.status, (await changed.json()).error]).toEqual([402, expect.stringContaining("more than the 60 you confirmed")]);

  expect((await (await post("/api/settings", { batchCap: 50 })).json()).batchCap).toBe(50);
  const capped = await post("/api/jobs/send", { credits: 75 });
  expect([capped.status, (await capped.json()).error]).toEqual([402, expect.stringContaining("over your 50-credit batch limit")]);

  // Under the limit: goes through (the fake account has 1000).
  const one = await post("/api/jobs/send", { keys: ["item_c.png"], credits: 15 });
  expect(one.status).toBe(200);
  expect((await one.json()).jobs.find((j: any) => j.key === "item_c.png").state).not.toBe("new");

  await post("/api/settings", { batchCap: 0 });
  const st = await (await call("/api/status")).json();
  expect([st.settings.batchCap, st.settings.confirmSends]).toEqual([0, true]);
  _reset();
});

test("engine sync: refuses a folder inside the workspace", async () => {
  const dir = join(root, "Synced");
  mkdirSync(dir);
  await post("/api/workspace/open", { dir });
  expect((await post("/api/sync", { dir: join(dir, "002_ready"), engine: "unity" })).status).toBe(400);
  const ok = await post("/api/sync", { dir: join(root, "UnityProject", "Assets", "Meshy"), engine: "unity" });
  expect((await ok.json()).sync.engine).toBe("unity");
  expect(existsSync(join(root, "UnityProject", "Assets", "Meshy"))).toBe(true);
  expect((await (await post("/api/sync", { off: true })).json()).sync).toBeNull();
  _reset();
});

test("new routes: steps and concepts go through the spend guards; text cards, library, usage", async () => {
  const dir = join(root, "Routes");
  mkdirSync(dir);
  await post("/api/workspace/open", { dir });
  await post("/api/settings", { batchCap: 300 });

  const t = await post("/api/create/text", { folder: "", name: "char_knight", prompt: "a stout knight" });
  expect((await t.json()).jobs[0]).toMatchObject({ key: "char_knight.prompt.txt", source: "text", prompt: "a stout knight" });
  expect((await post("/api/create/text", { folder: "", name: "char_knight", prompt: "again" })).status).toBe(400);
  expect((await post("/api/create/text", { folder: "../x", name: "a", prompt: "b" })).status).toBe(400);

  // A step on a card that isn't finished is skipped and costs nothing.
  const op = await post("/api/jobs/op", { keys: ["char_knight.prompt.txt"], kind: "remesh", params: {}, credits: 0 });
  expect((await op.json()).skipped).toEqual(["char_knight: The card needs a finished model first."]);
  expect((await post("/api/jobs/op", { keys: [], kind: "explode", params: {} })).status).toBe(400);

  // Concepts: confirmed amount and batch limit are checked.
  const c1 = await post("/api/concepts", { kind: "text-to-image", params: { ai_model: "nano-banana-pro", prompt: "a lamp" }, name: "item_lamp", folder: "", credits: 3 });
  expect([c1.status, (await c1.json()).error]).toEqual([402, expect.stringContaining("more than the 3 you confirmed")]);
  await post("/api/settings", { batchCap: 5 });
  const c2 = await post("/api/concepts", { kind: "text-to-image", params: { ai_model: "nano-banana-pro", prompt: "a lamp" }, name: "item_lamp", folder: "", credits: 9 });
  expect((await c2.json()).error).toContain("over your 5-credit batch limit");
  await post("/api/settings", { batchCap: 300 });
  const c3 = await post("/api/concepts", { kind: "text-to-image", params: { ai_model: "nano-banana", prompt: "a lamp" }, name: "item_lamp", folder: "", credits: 3 });
  expect((await c3.json()).concepts[0]).toMatchObject({ kind: "text-to-image", name: "item_lamp", estimate: 3 });

  expect((await (await call("/api/animations?search=pun")).json()).map((a: any) => a.action_id)).toEqual([42]);
  const u = await call("/api/usage");
  expect([u.status, (await u.json()).error]).toEqual([403, "Usage history comes with Meshy's Studio and Enterprise plans."]);
  _reset();
});
