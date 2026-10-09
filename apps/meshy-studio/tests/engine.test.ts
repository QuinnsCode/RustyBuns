import { test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeIO, getBounds } from "@gltf-transform/core";
import { parseLabel } from "../engine/labels.ts";
import { estimateCredits, STARTER_PRESETS } from "../engine/presets.ts";
import { fitGlb } from "../engine/fit.ts";
import { INBOX, RAW, READY, SENT, Workspace } from "../engine/workspace.ts";
import { boxGlb, fakeMeshy, type Fake } from "./fake-meshy.ts";
import { importExpr } from "../engine/blender.ts";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
let root: string;
let fake: Fake;
beforeAll(async () => { root = mkdtempSync(join(tmpdir(), "meshy-")); fake = await fakeMeshy(); });
afterAll(() => { fake.stop(); rmSync(root, { recursive: true, force: true }); });

const bounds = async (glb: Uint8Array) => {
  const doc = await new NodeIO().readBinary(glb);
  return getBounds(doc.getRoot().listScenes()[0]!);
};

test("labels: prefix picks the preset, tokens override and are stripped", () => {
  const a = parseLabel("flora_oak_h12_bottom.png", STARTER_PRESETS);
  expect([a.preset.prefix, a.outName, a.size, a.origin, a.unknownPrefix]).toEqual(["flora_", "flora_oak", { height: 12 }, "bottom", false]);
  const b = parseLabel("item_coin_center_l0.25.jpg", STARTER_PRESETS);
  expect([b.preset.prefix, b.outName, b.size, b.origin]).toEqual(["item_", "item_coin", { longest: 0.25 }, "center"]);
  const c = parseLabel("char_hero.png", STARTER_PRESETS);
  expect([c.size, c.origin]).toEqual([{ height: 1.8 }, "bottom"]);
  const d = parseLabel("rock_center_piece.png", STARTER_PRESETS);
  expect([d.unknownPrefix, d.outName, d.origin]).toEqual([true, "rock_center_piece", "bottom"]);
});

test("credit estimate follows Meshy's price table", () => {
  const by = (p: string) => STARTER_PRESETS.find((x) => x.prefix === p)!.options;
  expect(estimateCredits(by("item_"))).toBe(15);
  expect(estimateCredits(by("flora_"))).toBe(15);
  expect(estimateCredits(by("environ_"))).toBe(30);
  expect(estimateCredits(by("environ_"), "mossy bark")).toBe(40);
  expect(estimateCredits({ ai_model: "meshy-7.1", should_texture: false })).toBe(20);
});

test("fit: scales to height and puts the origin at the bottom centre", async () => {
  const out = await fitGlb(await boxGlb(), { height: 2 }, "bottom");
  expect(out.scale).toBeCloseTo(0.5);
  const { min, max } = await bounds(out.glb);
  expect(max[1] - min[1]).toBeCloseTo(2);
  expect(min[1]).toBeCloseTo(0);
  expect((min[0] + max[0]) / 2).toBeCloseTo(0);
  expect((min[2] + max[2]) / 2).toBeCloseTo(0);
});

test("fit: longest side and centre origin", async () => {
  const out = await fitGlb(await boxGlb(), { longest: 1 }, "center");
  const { min, max } = await bounds(out.glb);
  expect(Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2])).toBeCloseTo(1);
  expect((min[1] + max[1]) / 2).toBeCloseTo(0);
});

test("workspace: drop, send, poll, download, fit; ledger first, folders kept", async () => {
  const dir = join(root, "game");
  const ws = new Workspace(dir, () => "msy_test", 1);
  await ws.open();
  for (const d of [INBOX, join(INBOX, SENT), RAW, READY]) expect(existsSync(join(dir, d))).toBe(true);
  expect(existsSync(join(dir, "meshy-presets.json"))).toBe(true);

  mkdirSync(join(dir, INBOX, "forest"));
  writeFileSync(join(dir, INBOX, "forest", "flora_oak_h12.png"), PNG);
  writeFileSync(join(dir, INBOX, "forest", "flora_oak_h12.txt"), "mossy bark");
  writeFileSync(join(dir, INBOX, "item_coin.png"), PNG);
  await ws.scan();
  expect(ws.summary().folders).toEqual(["", "forest"]);
  expect(ws.get("forest/flora_oak_h12.png").texturePrompt).toBe("mossy bark");
  expect(ws.get("forest/flora_oak_h12.png").estimate).toBe(25);

  // Nothing goes until Send.
  await ws.tick();
  expect(fake.created.length).toBe(0);

  await ws.send();
  await ws.tick(); // limit 1: one submitted
  expect(fake.created.length).toBe(1);
  const first = fake.created[0];
  expect(first.image_url.startsWith("data:image/png;base64,")).toBe(true);
  expect(first.target_formats).toEqual(["glb"]);
  const coin = ws.get("item_coin.png");
  expect([coin.state, coin.where, coin.taskId]).toEqual(["running", "sent", "task-1"]);
  expect(existsSync(join(dir, INBOX, SENT, "item_coin.png"))).toBe(true);
  const ledger = await Bun.file(join(dir, "meshy-jobs.json")).json();
  expect(ledger.jobs["item_coin.png"].taskId).toBe("task-1");
  const oak = ws.get("forest/flora_oak_h12.png");
  expect(oak.state).toBe("queued");

  for (let i = 0; i < 8; i++) await ws.tick();
  expect(oak.state).toBe("done");
  expect(oak.raw).toBe("forest/flora_oak.glb");
  const ready = await Bun.file(join(dir, READY, "forest", "flora_oak.glb")).bytes();
  const b = await bounds(ready);
  expect(b.max[1] - b.min[1]).toBeCloseTo(12);
  expect(coin.state).toBe("done");
  expect(fake.created.find((c) => c.id === oak.taskId).texture_prompt).toBe("mossy bark");
  expect(existsSync(join(dir, INBOX, SENT, "forest", "flora_oak_h12.png"))).toBe(true);

  // Re-fit for free: change the size, no new Meshy call.
  const calls = fake.created.length;
  await ws.edit("forest/flora_oak_h12.png", { size: { height: 3 } });
  const r2 = await bounds(await Bun.file(join(dir, READY, "forest", "flora_oak.glb")).bytes());
  expect(r2.max[1] - r2.min[1]).toBeCloseTo(3);
  expect(fake.created.length).toBe(calls);

  // Finished models also land in the engine folder, renames included.
  const unity = join(root, "UnityGame", "Assets", "Meshy");
  await ws.setSync({ dir: unity, engine: "unity" });
  expect(existsSync(join(unity, "forest", "flora_oak.glb"))).toBe(true);
  expect(existsSync(join(unity, "item_coin.glb"))).toBe(true);
  await ws.edit("forest/flora_oak_h12.png", { outName: "oak_tall" });
  expect(existsSync(join(unity, "forest", "oak_tall.glb"))).toBe(true);
  expect(existsSync(join(unity, "forest", "flora_oak.glb"))).toBe(false);
  expect(ws.summary().spent).toBe(30);

  // A reopened workspace remembers everything.
  const again = new Workspace(dir, () => "msy_test");
  await again.open();
  expect(again.get("forest/flora_oak_h12.png").state).toBe("done");
  expect(again.sync?.engine).toBe("unity");
});

test("workspace: Meshy failure, retry, 402 pauses, cancel while pending, move between folders", async () => {
  const dir = join(root, "game2");
  const ws = new Workspace(dir, () => "msy_test", 10);
  await ws.open();
  mkdirSync(join(dir, INBOX, "props"));
  writeFileSync(join(dir, INBOX, "item_a.png"), PNG);
  writeFileSync(join(dir, INBOX, "item_b.png"), PNG);
  await ws.scan();

  await ws.move("item_b.png", "props");
  expect(existsSync(join(dir, INBOX, "props", "item_b.png"))).toBe(true);

  fake.failNext = 402;
  await ws.send();
  await ws.tick();
  expect(ws.pause?.reason).toContain("Out of Meshy credits");
  expect(ws.get("item_a.png").state).toBe("queued");

  await ws.send(); // resume
  await ws.tick();
  const a = ws.get("item_a.png");
  const b = ws.get("props/item_b.png");
  expect([a.state, b.state]).toEqual(["running", "running"]);

  // Cancel while PENDING: refunded, image back in 000.
  await ws.cancel("props/item_b.png");
  expect(b.state).toBe("new");
  expect(existsSync(join(dir, INBOX, "props", "item_b.png"))).toBe(true);

  fake.failTasks.add(a.taskId!);
  for (let i = 0; i < 4; i++) await ws.tick();
  expect([a.state, a.error]).toEqual(["failed", "Image too dark"]);

  await ws.retry("item_a.png");
  expect(a.state).toBe("queued");
  for (let i = 0; i < 5; i++) await ws.tick();
  expect(a.state).toBe("done");
});

test("no key pauses instead of failing every card", async () => {
  const dir = join(root, "game3");
  const ws = new Workspace(dir, () => null);
  await ws.open();
  writeFileSync(join(dir, INBOX, "item_x.png"), PNG);
  await ws.scan();
  await ws.send();
  await ws.tick();
  expect(ws.pause?.reason).toContain("API key");
  expect(ws.get("item_x.png").state).toBe("queued");
});

test("blender: the import script is valid Python with any path", () => {
  const expr = importExpr(['/a/b "c"/d\\e.glb', "/x/ünï.glb"]);
  expect(expr.split("\n")[2]).toBe('for p in ["/a/b \\"c\\"/d\\\\e.glb","/x/ünï.glb"]: bpy.ops.import_scene.gltf(filepath=p)');
});
