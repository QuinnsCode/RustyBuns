// Required Notice: Copyright (c) 2026 Ryan Quinn (QNTBR) (https://qntbr.com). PolyForm Noncommercial 1.0.0, see ../LICENSE.
//
// A stand-in for Meshy's multi-image-to-3D on this machine, for `bun run dev` and the tests: it takes the same
// calls, counts progress up over a few seconds, and hands back a model made here (a tumbler: a shape none of the
// hats are, so a sample is easy to tell apart). Bun only; the Worker never imports it.
import * as THREE from "three";
import { toGlb } from "@rustybuns/models/glb";

export type StandIn = { base: string; key: string; started: string[][]; stop(): void };

/** A tumbler with a lid and a band, about the size of a hat: what every stand-in sample comes back as. */
async function tumbler(): Promise<ArrayBuffer> {
  const g = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: 0x2f7d6d, roughness: 0.45, metalness: 0.2 });
  const pts = [[0, 0], [0.62, 0], [0.66, 0.04], [0.8, 1.7], [0.8, 1.74]].map(([r, y]) => new THREE.Vector2(r, y));
  g.add(new THREE.Mesh(new THREE.LatheGeometry(pts, 64), steel));
  const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.82, 0.82, 0.14, 64), new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.6 }));
  lid.position.y = 1.8;
  g.add(lid);
  return toGlb(g);
}

export async function standInMeshy(o: { seconds?: number } = {}): Promise<StandIn> {
  const glb = await tumbler();
  const seconds = o.seconds ?? 8;
  const tasks = new Map<string, number>();
  const started: string[][] = [];
  const key = "msy_stand_in";
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/assets/sample.glb") return new Response(glb, { headers: { "content-type": "model/gltf-binary" } });
      if (req.headers.get("authorization") !== `Bearer ${key}`) return Response.json({ message: "bad key" }, { status: 401 });
      if (req.method === "POST" && url.pathname === "/openapi/v1/multi-image-to-3d") {
        const body: unknown = await req.json().catch(() => null);
        const images = body && typeof body === "object" && "image_urls" in body && Array.isArray(body.image_urls) ? body.image_urls.filter((x): x is string => typeof x === "string") : [];
        if (!images.length || images.some((i) => !i.startsWith("data:image/"))) return Response.json({ message: "image_urls" }, { status: 400 });
        const id = `task-${tasks.size + 1}`;
        tasks.set(id, Date.now());
        started.push(images);
        return Response.json({ result: id });
      }
      const m = url.pathname.match(/^\/openapi\/v1\/multi-image-to-3d\/(.+)$/);
      const at = m && tasks.get(m[1]!);
      if (req.method === "GET" && at) {
        const progress = Math.min(100, Math.round(((Date.now() - at) / (seconds * 1000)) * 100));
        return Response.json(progress < 100
          ? { id: m![1], status: "IN_PROGRESS", progress }
          : { id: m![1], status: "SUCCEEDED", progress: 100, model_urls: { glb: `${url.origin}/assets/sample.glb` } });
      }
      return Response.json({ message: "not found" }, { status: 404 });
    },
  });
  return { base: `http://localhost:${server.port}/openapi/v1`, key, started, stop: () => server.stop(true) };
}
