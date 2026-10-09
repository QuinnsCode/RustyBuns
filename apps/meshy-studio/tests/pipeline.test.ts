import { test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { INBOX, RAW, READY, SENT, Workspace } from "../engine/workspace.ts";
import { fakeMeshy, PNG, type Fake } from "./fake-meshy.ts";

let root: string;
let fake: Fake;
beforeAll(async () => { root = mkdtempSync(join(tmpdir(), "meshy-pipe-")); fake = await fakeMeshy(); });
afterAll(() => { fake.stop(); rmSync(root, { recursive: true, force: true }); });

async function open(name: string) {
  const ws = new Workspace(join(root, name), () => "msy_test", 20);
  await ws.open();
  return ws;
}
const run = async (ws: Workspace, n = 6) => { for (let i = 0; i < n; i++) await ws.tick(); };

test("per card: pick any model, see what each costs, override any option", async () => {
  const ws = await open("models");
  writeFileSync(join(ws.dir, INBOX, "flora_fern.png"), PNG);
  writeFileSync(join(ws.dir, INBOX, "flora_moss.png"), PNG);
  await ws.scan();
  const card = ws.summary().jobs.find((j) => j.key === "flora_fern.png")!;
  expect(card.model).toBe("meshy-6-lite");
  expect(card.modelCosts).toEqual({
    "meshy-7.1": { full: 30, draft: 20, problems: [] },
    "meshy-6": { full: 30, draft: 20, problems: [] },
    "meshy-6-lite": { full: 15, draft: 5, problems: [] },
    "meshy-t2": { full: 15, draft: 5, problems: [] },
    lowpoly: { full: 30, draft: 20, problems: [] },
  });

  await ws.edit("flora_fern.png", { model: "meshy-7.1" });
  expect(ws.get("flora_fern.png").estimate).toBe(30);
  await ws.edit("flora_fern.png", { overrides: { geometry_resolution: "4k", texture_resolution: "8k", enable_pbr: true, pose_mode: "a-pose" } });
  expect(ws.get("flora_fern.png").estimate).toBe(40);
  // Setting an option Meshy would reject is refused, nothing changed (picking a model adapts instead: below).
  await expect(ws.edit("flora_fern.png", { overrides: { ai_model: "meshy-6-lite" } })).rejects.toThrow("2k only");
  expect(ws.get("flora_fern.png").estimate).toBe(40);
  await ws.edit("flora_fern.png", { clear: ["texture_resolution"] });
  expect(ws.get("flora_fern.png").estimate).toBe(35);

  // One model for several cards at once.
  expect(await ws.editMany(["flora_fern.png", "flora_moss.png"], { model: "meshy-6" })).toEqual([]);
  expect(ws.summary().jobs.map((j) => j.model)).toEqual(["meshy-6", "meshy-6"]);

  await ws.send(["flora_fern.png"]);
  await run(ws);
  const body = fake.created.find((c) => c.id === ws.get("flora_fern.png").taskId);
  expect([body.ai_model, body.enable_pbr, body.pose_mode, body.target_polycount, "geometry_resolution" in body]).toEqual(["meshy-6", true, "a-pose", 15000, false]);
  await expect(ws.edit("flora_fern.png", { model: "meshy-t2" })).rejects.toThrow("already sent");
});

test("multi-image: __front/__back views are one card, sent together; combine and split", async () => {
  const ws = await open("multi");
  for (const f of ["environ_rock__back.png", "environ_rock__front.png", "environ_rock__front.texture.png", "item_a.png", "item_b.png"]) writeFileSync(join(ws.dir, INBOX, f), PNG);
  await ws.scan();
  const rock = ws.get("environ_rock__views");
  expect([rock.source, rock.file, rock.views, rock.outName, rock.textureImage]).toEqual(["multi", "environ_rock__front.png", ["environ_rock__back.png"], "environ_rock", true]);
  expect(ws.summary().jobs.find((j) => j.key === "environ_rock__views")!.modelCosts!["meshy-t2"]).toBeUndefined();
  await expect(ws.edit(rock.key, { model: "meshy-t2" })).rejects.toThrow("isn't available");

  const key = await ws.combine(["item_a.png", "item_b.png"]);
  expect(key).toBe("item_a__views");
  expect(existsSync(join(ws.dir, INBOX, "item_a__2.png"))).toBe(true);
  expect(ws.get(key).views).toEqual(["item_a__2.png"]);
  await ws.split(key);
  expect(ws.jobs.has("item_a-1.png") && ws.jobs.has("item_a-2.png")).toBe(true);

  await ws.send([rock.key]);
  await run(ws);
  const body = fake.calls["multi-image-to-3d"].at(-1);
  expect([body.image_urls.length, body.ai_model, body.texture_image_url?.startsWith("data:"), "model_type" in body]).toEqual([2, "meshy-7.1", true, false]);
  expect(rock.state).toBe("done");
  expect(existsSync(join(ws.dir, INBOX, SENT, "environ_rock__back.png")) && existsSync(join(ws.dir, INBOX, SENT, "environ_rock__front.texture.png"))).toBe(true);
  expect(existsSync(join(ws.dir, READY, "environ_rock.glb"))).toBe(true);
});

test("text to 3D: a .prompt.txt is a card; preview, then refine for the texture", async () => {
  const ws = await open("text");
  writeFileSync(join(ws.dir, INBOX, "char_knight_h1.9.prompt.txt"), "a stout knight in rusty armour\n");
  await ws.scan();
  const k = ws.get("char_knight_h1.9.prompt.txt");
  expect([k.source, k.prompt, k.outName, k.size, k.estimate]).toEqual(["text", "a stout knight in rusty armour", "char_knight", { height: 1.9 }, 30]);
  await ws.edit(k.key, { model: "meshy-6-lite" });
  expect(k.estimate).toBe(15); // preview 5 + refine 10
  expect(ws.summary().jobs[0]!.draftEstimate).toBe(5);
  await ws.send();
  await run(ws, 8);
  const [preview, refine] = fake.calls["text-to-3d"].slice(-2);
  expect([preview.mode, preview.prompt, preview.ai_model, preview.pose_mode, "should_texture" in preview]).toEqual(["preview", "a stout knight in rusty armour", "meshy-6-lite", "t-pose", false]);
  expect([refine.mode, refine.preview_task_id, refine.ai_model]).toEqual(["refine", k.taskId, "meshy-6-lite"]);
  expect([k.textured, k.ops?.map((o) => `${o.kind}:${o.state}`)]).toEqual([true, ["refine:done"]]);
  expect(k.modelTask?.kind).toBe("text-to-3d");
});

test("steps chain on a finished model: remesh, UV unwrap, convert, rig, motion, animate", async () => {
  const ws = await open("steps");
  writeFileSync(join(ws.dir, INBOX, "char_hero.png"), PNG);
  await ws.scan();
  const hero = ws.get("char_hero.png");
  // Steps need a finished model.
  expect(await ws.addOp([hero.key], "remesh", {})).toEqual(["char_hero: The card needs a finished model first."]);
  await ws.send();
  await run(ws);
  expect(hero.state).toBe("done");

  expect(await ws.addOp([hero.key], "animate", { action_ids: [1] })).toEqual(["char_hero: Rig the character first."]);
  expect(ws.estimateOp([hero.key], "animate", { action_ids: [1, 7] }).count).toBe(0);
  await ws.addOp([hero.key], "remesh", { topology: "quad", target_polycount: 8000, target_formats: ["fbx"] });
  await ws.addOp([hero.key], "uv-unwrap", {});
  await ws.addOp([hero.key], "convert", { target_formats: ["blend", "usdz"] });
  // UV unwrap leaves it untextured, and Meshy only rigs textured models.
  expect(await ws.addOp([hero.key], "rig", {})).toEqual(["char_hero: Meshy rigs textured models: texture it first."]);
  await ws.addOp([hero.key], "retexture", { style: "prompt", prompt: "polished steel" });
  await ws.addOp([hero.key], "rig", {});
  await ws.addOp([hero.key], "animate", { action_ids: [7, 42], post_process: { operation_type: "fbx2usdz" }, label: "Jump and punch" });
  await ws.addOp([hero.key], "motion", { prompt: "a victory dance", mode: "swift", duration: 4.5 });
  await ws.addOp([hero.key], "animate", { fromMotion: true, label: "Victory" });
  expect(hero.ops!.map((o) => o.estimate)).toEqual([5, 5, 1, 10, 5, 6, 3, 3]);
  await run(ws, 30);
  expect(hero.ops!.map((o) => `${o.kind}:${o.state}`)).toEqual(["remesh:done", "uv-unwrap:done", "convert:done", "retexture:done", "rig:done", "animate:done", "motion:done", "animate:done"]);

  const c = fake.calls;
  expect(c.remesh.at(-1)).toMatchObject({ input_task_id: hero.taskId, topology: "quad", target_polycount: 8000, target_formats: ["glb", "fbx"] });
  expect(c["uv-unwrap"].at(-1).input_task_id).toBe(c.remesh.at(-1).id);
  expect(c.convert.at(-1)).toMatchObject({ input_task_id: c["uv-unwrap"].at(-1).id, target_formats: ["blend", "usdz"] });
  // Retexture takes the UV-unwrapped model as a file (it doesn't accept uv-unwrap task ids); rig takes the retexture task.
  expect([c.retexture.at(-1).model_url?.startsWith("data:application/octet-stream;base64,"), c.retexture.at(-1).text_style_prompt]).toEqual([true, "polished steel"]);
  expect(c.rigging.at(-1)).toMatchObject({ input_task_id: c.retexture.at(-1).id, height_meters: 1.8 });
  expect(c.animations.at(-2)).toMatchObject({ rig_task_id: hero.rigTaskId, action_ids: [7, 42], post_process: { operation_type: "fbx2usdz" } });
  expect(c["text-to-motion"].at(-1)).toMatchObject({ prompt: "a victory dance", mode: "swift", duration: 4.5 });
  expect(c.animations.at(-1)).toMatchObject({ rig_task_id: hero.rigTaskId, motion_task_id: c["text-to-motion"].at(-1).id });
  expect("action_id" in c.animations.at(-1)).toBe(false);

  for (const f of ["char_hero.fbx", "char_hero.blend", "char_hero.usdz", "char_hero.rigged.glb", "char_hero.rigged.fbx", "char_hero.walking.glb", "char_hero.walking.armature.glb",
    "char_hero.anim-jump-and-punch.glb", "char_hero.anim-jump-and-punch.usdz", "char_hero.anim-victory.fbx"]) expect([f, existsSync(join(ws.dir, RAW, f))]).toEqual([f, true]);
  expect(hero.extras?.some((f) => /^char_hero\.motion-.+\.bvh$/.test(f))).toBe(true);
  expect(hero.readyExtras).toEqual(["char_hero.anim-jump-and-punch.glb", "char_hero.anim-victory.glb", "char_hero.rigged.glb", "char_hero.running.glb", "char_hero.walking.glb"]);
  expect(existsSync(join(ws.dir, READY, "char_hero.rigged.glb"))).toBe(true);
  // Spent counts every step.
  expect(hero.textured).toBe(true);
  expect(ws.summary().spent).toBe(15 + 5 + 5 + 1 + 10 + 5 + 3 + 10 + 3);
});

test("a failed step stops the ones after it until retried; cancelling drops them", async () => {
  const ws = await open("stepfail");
  writeFileSync(join(ws.dir, INBOX, "item_box.png"), PNG);
  await ws.scan();
  await ws.send();
  await run(ws);
  const box = ws.get("item_box.png");
  await ws.addOp([box.key], "remesh", {});
  await ws.addOp([box.key], "resize", { mode: "height", meters: 2, origin_at: "center" });
  await ws.tick();
  fake.failTasks.add(box.ops![0]!.taskId!);
  await run(ws, 4);
  expect(box.ops!.map((o) => o.state)).toEqual(["failed", "queued"]);
  expect(fake.calls.resize.length).toBe(0);
  expect(ws.retryCost(box)).toBe(5);
  await ws.retry(box.key);
  await run(ws, 8);
  expect(box.ops!.map((o) => o.state)).toEqual(["done", "done"]);
  expect(fake.calls.resize.at(-1)).toMatchObject({ resize_height: 2, origin_at: "center" });
  expect(box.size).toEqual({ auto: true }); // Meshy sized it: 002 keeps that

  await ws.addOp([box.key], "convert", { target_formats: ["stl"] });
  await ws.addOp([box.key], "remesh", {});
  await ws.cancel(box.key, box.ops![2]!.id);
  expect(box.ops!.length).toBe(2);
});

test("concept images: text to image lands in 000; multi-view becomes one card sent by task id", async () => {
  const ws = await open("concepts");
  mkdirSync(join(ws.dir, INBOX, "props"));
  await expect(ws.addConcept("text-to-image", { ai_model: "nano-banana", prompt: "", }, { name: "x" })).rejects.toThrow("prompt");
  await expect(ws.addConcept("text-to-image", { ai_model: "nano-banana", prompt: "a", aspect_ratio: "3:2" }, { name: "x" })).rejects.toThrow("3:2");
  const one = await ws.addConcept("text-to-image", { ai_model: "nano-banana-2", prompt: "a mossy crate", aspect_ratio: "4:3", remove_background: true, pose_mode: "t-pose" }, { folder: "props", name: "item_crate" });
  const multi = await ws.addConcept("text-to-image", { ai_model: "gpt-image-2", prompt: "a lantern", generate_multi_view: true }, { name: "item_lantern" });
  expect([one.estimate, multi.estimate]).toEqual([6, 9]);
  await run(ws, 4);
  expect(fake.calls["text-to-image"].at(-2)).toEqual({ id: one.taskId, ai_model: "nano-banana-2", prompt: "a mossy crate", aspect_ratio: "4:3", pose_mode: "t-pose", remove_background: true });
  expect([one.state, one.files, multi.files]).toEqual(["done", ["item_crate.png"], ["item_lantern__1.png", "item_lantern__2.png", "item_lantern__3.png"]]);
  const crate = ws.get("props/item_crate.png");
  const lantern = ws.get("item_lantern__views");
  expect([crate.inputTaskId, lantern.source, lantern.inputTaskId]).toEqual([one.taskId, "multi", multi.taskId]);
  // item_ is smart topology, which Multi-Image to 3D doesn't have: the card uses meshy-6-lite.
  expect([ws.summary().jobs.find((j) => j.key === lantern.key)!.model, lantern.estimate, ws.summary().jobs.find((j) => j.key === lantern.key)!.problems]).toEqual(["meshy-6-lite", 15, []]);

  // Image to image from a card's picture.
  const vary = await ws.addConcept("image-to-image", { ai_model: "gpt-image-2", prompt: "make it rusty" }, { folder: "props", name: "item_crate_rusty", references: [crate.key] });
  expect(vary.estimate).toBe(12);
  await ws.send();
  await run(ws, 8);
  expect(fake.calls["image-to-image"].at(-1).reference_image_urls[0].startsWith("data:image/png")).toBe(true);
  expect(fake.created.find((b) => b.id === crate.taskId)).toMatchObject({ input_task_id: one.taskId });
  expect("image_url" in fake.created.find((b) => b.id === crate.taskId)).toBe(false);
  expect(fake.calls["multi-image-to-3d"].at(-1)).toMatchObject({ input_task_id: multi.taskId });
  expect(ws.jobs.has("props/item_crate_rusty.png")).toBe(true);
  // The varied image arrived after Send, so it's a new card, not sent.
  expect(ws.get("props/item_crate_rusty.png").state).toBe("new");
  expect(ws.summary().spent).toBe(3 + 3 + 3 + 15 + 15);
});

test("picking a model adapts what it can't take instead of refusing", async () => {
  const ws = await open("adapt");
  writeFileSync(join(ws.dir, INBOX, "char_brute.png"), PNG);
  await ws.scan();
  const card = ws.summary().jobs[0]!;
  expect(card.modelCosts!["meshy-t2"].problems).toEqual([]);
  await ws.edit("char_brute.png", { overrides: { texture_resolution: "8k" } });
  await ws.edit("char_brute.png", { model: "meshy-t2" });
  const t2 = ws.get("char_brute.png");
  expect(t2.overrides).toMatchObject({ model_type: "smart-topology", ai_model: "meshy-t2", target_polycount: null });
  expect(ws.summary().jobs[0]!.options.target_polycount).toBeUndefined();
  await ws.edit("char_brute.png", { model: "meshy-6-lite" });
  expect(ws.get("char_brute.png").overrides).toMatchObject({ ai_model: "meshy-6-lite", texture_resolution: "2k" });
  expect(ws.get("char_brute.png").estimate).toBe(15);
});
