// A stand-in for api.meshy.ai: every endpoint the app calls, enough to run the whole
// pipeline offline. Each task goes PENDING -> IN_PROGRESS 50% -> SUCCEEDED over three polls,
// and inputs are checked the way Meshy checks them (the task ids they point at must exist).

import { Document, NodeIO } from "@gltf-transform/core";

/** A 2 x 4 x 1 box centred on (5, 10, 0): wrong size, wrong origin, like a fresh Meshy model. */
export async function boxGlb(): Promise<Uint8Array> {
  const doc = new Document();
  const buf = doc.createBuffer();
  const p: number[] = [];
  for (const x of [4, 6]) for (const y of [8, 12]) for (const z of [-0.5, 0.5]) p.push(x, y, z);
  const pos = doc.createAccessor().setType("VEC3").setArray(new Float32Array(p)).setBuffer(buf);
  const idx = doc.createAccessor().setType("SCALAR").setArray(new Uint16Array([0, 1, 2, 1, 3, 2, 4, 6, 5, 5, 6, 7, 0, 4, 1, 1, 4, 5, 2, 3, 6, 3, 7, 6])).setBuffer(buf);
  const mesh = doc.createMesh().addPrimitive(doc.createPrimitive().setAttribute("POSITION", pos).setIndices(idx));
  doc.createScene().addChild(doc.createNode("box").setMesh(mesh));
  return new NodeIO().writeBinary(doc);
}

export const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const KINDS = ["image-to-3d", "multi-image-to-3d", "text-to-3d", "retexture", "remesh", "resize", "convert", "uv-unwrap", "rigging", "animations", "text-to-motion", "text-to-image", "image-to-image"] as const;
type FakeKind = (typeof KINDS)[number];
const PREFIX: Record<FakeKind, string> = {
  "image-to-3d": "task", "multi-image-to-3d": "multi", "text-to-3d": "text", retexture: "tex", remesh: "remesh", resize: "resize",
  convert: "convert", "uv-unwrap": "uv", rigging: "rig", animations: "anim", "text-to-motion": "motion", "text-to-image": "t2i", "image-to-image": "i2i",
};
const CREDITS: Record<FakeKind, number> = {
  "image-to-3d": 15, "multi-image-to-3d": 15, "text-to-3d": 5, retexture: 10, remesh: 5, resize: 1, convert: 1, "uv-unwrap": 5,
  rigging: 5, animations: 3, "text-to-motion": 10, "text-to-image": 3, "image-to-image": 3,
};

export interface Fake {
  base: string;
  /** Request bodies by endpoint, in order. */
  calls: Record<FakeKind, any[]>;
  /** Image to 3D and Retexture bodies (older tests read these). */
  created: any[];
  retextured: any[];
  /** Next POST answers with this status instead of creating. */
  failNext: number | null;
  /** Tasks Meshy will fail instead of finish. */
  failTasks: Set<string>;
  stop(): void;
}

export async function fakeMeshy(key = "msy_test"): Promise<Fake> {
  const glb = await boxGlb();
  const polls = new Map<string, number>();
  const tasks = new Map<string, { kind: FakeKind; body: any }>();
  const calls = Object.fromEntries(KINDS.map((k) => [k, []])) as unknown as Record<FakeKind, any[]>;
  const fake: Fake = { base: "", calls, created: calls["image-to-3d"], retextured: calls.retexture, failNext: null, failTasks: new Set(), stop: () => server.stop(true) };
  const bad = (message: string, status = 400) => Response.json({ message }, { status });
  const has = (id: unknown, ...kinds: FakeKind[]) => typeof id === "string" && tasks.has(id) && (!kinds.length || kinds.includes(tasks.get(id)!.kind));

  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const a = (p: string) => `${fake.base}/assets/${p}`;
      if (url.pathname === "/assets/model.glb") return new Response(glb as Uint8Array<ArrayBuffer>);
      if (url.pathname.endsWith(".png")) return new Response(PNG);
      if (url.pathname.startsWith("/assets/")) return new Response(`fake ${url.pathname}`);
      if (req.headers.get("authorization") !== `Bearer ${key}`) return bad("Invalid API key", 401);
      if (url.pathname === "/v1/balance") return Response.json({ balance: 1000 });
      if (url.pathname === "/v1/animations/library") {
        const all = [
          { action_id: 1, name: "Walk", key: "walk", category: "WalkAndRun", preview_url: a("walk.gif") },
          { action_id: 7, name: "Jump", key: "jump", category: "BodyMovements", preview_url: a("jump.gif") },
          { action_id: 42, name: "Punch", key: "punch", category: "Fighting", preview_url: a("punch.gif") },
        ];
        const s = url.searchParams.get("search")?.toLowerCase();
        const c = url.searchParams.get("category");
        return Response.json(all.filter((x) => (!s || x.name.toLowerCase().includes(s) || x.key.includes(s)) && (!c || x.category === c)));
      }
      if (url.pathname === "/v1/usage/tasks") return bad("Usage needs a Studio or Enterprise team", 403);

      const m = /^\/v[12]\/([a-z0-9-]+)(?:\/([^/]+))?$/.exec(url.pathname);
      const kind = m?.[1] as FakeKind;
      if (!m || !KINDS.includes(kind) || (kind === "text-to-3d") !== url.pathname.startsWith("/v2/")) return bad("no route", 404);

      if (!m[2] && req.method === "POST") {
        if (fake.failNext) { const s = fake.failNext; fake.failNext = null; return bad("nope", s); }
        const body = await req.json() as any;
        // The checks Meshy makes on inputs.
        if (kind === "retexture" && !has(body.input_task_id, "text-to-3d", "image-to-3d", "remesh") && !body.model_url) return bad("invalid input task");
        if (kind === "remesh" && !has(body.input_task_id, "text-to-3d", "image-to-3d", "retexture") && !body.model_url) return bad("invalid input task");
        if (kind === "uv-unwrap" && !has(body.input_task_id, "text-to-3d", "image-to-3d", "remesh") && !body.model_url) return bad("invalid input task");
        if ((kind === "resize" || kind === "convert" || kind === "rigging") && !has(body.input_task_id) && !body.model_url) return bad("invalid input task");
        if (kind === "text-to-3d" && body.mode === "refine" && !has(body.preview_task_id, "text-to-3d")) return bad("preview not found", 404);
        if (kind === "text-to-3d" && body.mode !== "refine" && !body.prompt) return bad("prompt required");
        if (kind === "animations") {
          if (!has(body.rig_task_id, "rigging")) return bad("rig task not found", 404);
          if ([body.action_id, body.action_ids, body.motion_task_id].filter((x) => x !== undefined).length !== 1) return bad("exactly one animation source");
          if (body.motion_task_id && !has(body.motion_task_id, "text-to-motion")) return bad("motion task not found", 404);
        }
        if (kind === "multi-image-to-3d" && !body.input_task_id && !(body.image_urls?.length >= 1 && body.image_urls.length <= 4)) return bad("1 to 4 images");
        if (kind === "image-to-image" && !(body.reference_image_urls?.length >= 1) && !body.input_task_id) return bad("references required");
        if (kind === "image-to-3d" && !body.image_url && !has(body.input_task_id, "text-to-image", "image-to-image")) return bad("image required");
        const id = `${PREFIX[kind]}-${calls[kind].length + 1}`;
        calls[kind].push({ id, ...body });
        tasks.set(id, { kind, body });
        polls.set(id, 0);
        return Response.json({ result: id });
      }

      const id = m[2]!;
      const t = tasks.get(id);
      if (!t || t.kind !== kind) return bad("not found", 404);
      const n = polls.get(id)!;
      if (req.method === "DELETE") {
        if (n > 0) return bad("in progress", 409);
        tasks.delete(id);
        return new Response(null);
      }
      polls.set(id, n + 1);
      if (n === 0) return Response.json({ id, status: "PENDING", progress: 0 });
      if (n === 1) return Response.json({ id, status: "IN_PROGRESS", progress: 50, thumbnail_url: a("thumb.png") });
      if (fake.failTasks.has(id)) return Response.json({ id, status: "FAILED", progress: 0, task_error: { message: "Image too dark" } });

      const b = t.body;
      const out: Record<string, unknown> = { id, status: "SUCCEEDED", progress: 100, consumed_credits: CREDITS[kind], thumbnail_url: a("thumb.png") };
      if (["image-to-3d", "multi-image-to-3d", "text-to-3d", "retexture", "remesh", "resize", "convert", "uv-unwrap"].includes(kind)) {
        const urls: Record<string, string> = {};
        for (const f of b.target_formats ?? ["glb"]) urls[f] = f === "glb" ? a("model.glb") : a(`model.${f}`);
        if (urls.obj) urls.mtl = a("model.mtl");
        out.model_urls = urls;
        // Untextured shapes come back without texture maps.
        if (kind === "retexture" || b.mode === "refine" || (kind !== "text-to-3d" && b.should_texture !== false && kind !== "uv-unwrap" && kind !== "convert")) {
          out.texture_urls = [{ base_color: a("base_color.png") }];
        }
        if (b.multi_view_thumbnails) out.thumbnail_urls = { front: a("front.png"), back: a("back.png") };
      }
      if (kind === "rigging") out.result = {
        rigged_character_glb_url: a("model.glb"), rigged_character_fbx_url: a("rig.fbx"),
        basic_animations: { walking_glb_url: a("model.glb"), walking_fbx_url: a("walk.fbx"), walking_armature_glb_url: a("model.glb"), running_glb_url: a("model.glb") },
      };
      if (kind === "animations") out.result = {
        animation_glb_url: a("model.glb"), animation_fbx_url: a("anim.fbx"),
        ...(b.post_process?.operation_type === "fbx2usdz" ? { processed_usdz_url: a("anim.usdz") } : {}),
      };
      if (kind === "text-to-motion") out.result = { motion_url: a(b.mode === "swift" ? "clip.bvh" : "clip.fbx"), motion_format: b.mode === "swift" ? "bvh" : "fbx", duration_ms: b.duration * 1000 };
      if (kind === "text-to-image" || kind === "image-to-image") out.image_urls = b.generate_multi_view ? [a("v1.png"), a("v2.png"), a("v3.png")] : [a("img.png")];
      return Response.json(out);
    },
  });
  fake.base = `http://127.0.0.1:${server.port}`;
  process.env.MESHY_API_BASE = `${fake.base}/v1`;
  return fake;
}
