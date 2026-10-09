// A stand-in for api.meshy.ai: enough of Image to 3D to run the whole loop offline.
// Each task goes PENDING -> IN_PROGRESS 50% -> SUCCEEDED over three polls.

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

export interface Fake {
  base: string;
  created: any[];
  /** Next POST answers with this status instead of creating. */
  failNext: number | null;
  /** Tasks Meshy will fail instead of finish. */
  failTasks: Set<string>;
  stop(): void;
}

export async function fakeMeshy(key = "msy_test"): Promise<Fake> {
  const glb = await boxGlb();
  const polls = new Map<string, number>();
  const fake: Fake = { base: "", created: [], failNext: null, failTasks: new Set(), stop: () => server.stop(true) };
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/assets/model.glb") return new Response(glb as Uint8Array<ArrayBuffer>);
      if (req.headers.get("authorization") !== `Bearer ${key}`) return Response.json({ message: "Invalid API key" }, { status: 401 });
      if (url.pathname === "/v1/balance") return Response.json({ balance: 1000 });
      if (url.pathname === "/v1/image-to-3d" && req.method === "POST") {
        if (fake.failNext) { const s = fake.failNext; fake.failNext = null; return Response.json({ message: "nope" }, { status: s }); }
        const id = `task-${fake.created.length + 1}`;
        fake.created.push({ id, ...(await req.json() as object) });
        polls.set(id, 0);
        return Response.json({ result: id });
      }
      const m = /^\/v1\/image-to-3d\/(.+)$/.exec(url.pathname);
      if (m) {
        const id = m[1]!;
        if (!polls.has(id)) return Response.json({ message: "not found" }, { status: 404 });
        const n = polls.get(id)!;
        if (req.method === "DELETE") {
          if (n > 0) return Response.json({ message: "in progress" }, { status: 409 });
          polls.delete(id);
          return new Response(null);
        }
        polls.set(id, n + 1);
        if (n === 0) return Response.json({ id, status: "PENDING", progress: 0 });
        if (n === 1) return Response.json({ id, status: "IN_PROGRESS", progress: 50, thumbnail_url: `${fake.base}/assets/thumb.png` });
        if (fake.failTasks.has(id)) return Response.json({ id, status: "FAILED", progress: 0, task_error: { message: "Image too dark" } });
        return Response.json({ id, status: "SUCCEEDED", progress: 100, consumed_credits: 15, model_urls: { glb: `${fake.base}/assets/model.glb` } });
      }
      return Response.json({ message: "no route" }, { status: 404 });
    },
  });
  fake.base = `http://127.0.0.1:${server.port}`;
  process.env.MESHY_API_BASE = `${fake.base}/v1`;
  return fake;
}
