// Required Notice: Copyright (c) 2026 Ryan Quinn (QNTBR) (https://qntbr.com). PolyForm Noncommercial 1.0.0, see ../LICENSE.
//
// Samples: a shop's own product, from its photos, as a model the widget can print on. An admin uploads 1 to 4
// photos (kind "photo", private), then:
//
//   POST /api/orgs/<org>/models        {name, photos}   start one (202): Meshy's multi-image-to-3D, a minute or two
//   GET  /api/orgs/<org>/models/<id>                     its progress; the poll that sees Meshy finish copies the GLB
//                                                        into R2 and writes the product, so the widget can load it
//
// Every sample costs Meshy credits, so three things stand in front of one: the admin key (org.json keeps its
// SHA-256), the org's paid allowance (org.json `samples`), and a ceiling on samples a day across every org
// (MESHY_DAILY). Progress lives in R2 next to the model; the admin page's polling drives it, so there is no
// queue or workflow to keep alive.
import { b64, hex, sha256 } from "@rustybuns/util/bytes";
import { int, obj } from "@rustybuns/util/guard";
import { privateJson, readJson } from "@rustybuns/util/http";
import { Sample, SampleRequest, type Org, type Product } from "./api.ts";
import { meshyDayKey, productKey, SAMPLE_ID, sampleGlb, sampleKey } from "./layout.ts";
import { MESHY_BASE, MeshyError, sampleTask, startSample, type MeshyTask } from "./meshy.ts";
import type { Env } from "./worker.ts";

const GLB_MAX = 40 << 20;
const IMMUTABLE = "public, max-age=31536000, immutable";
const DayCount = obj({ n: int(0, 1e9) });

/** Whether the request carries one of the org's admin keys (`authorization: Bearer <key>`). */
export async function isAdmin(req: Request, org: Org): Promise<boolean> {
  const m = (req.headers.get("authorization") ?? "").match(/^Bearer (\S{8,200})$/);
  return !!m && (org.admins ?? []).includes(await sha256(m[1]!));
}

async function countSamples(env: Env, org: string): Promise<number> {
  let n = 0, cursor: string | undefined;
  do {
    const page = await env.BUCKET.list({ prefix: `orgs/${org}/models/`, cursor });
    n += page.objects.filter((o) => o.key.endsWith(".json")).length;
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return n;
}

async function readSample(env: Env, key: string): Promise<Sample | null> {
  const o = await env.BUCKET.get(key);
  return o ? readJson(new Response(await o.text()), Sample) : null;
}
const writeSample = (env: Env, org: string, s: Sample) =>
  env.BUCKET.put(sampleKey(org, s.id), JSON.stringify(s), { httpMetadata: { contentType: "application/json" } });

/** POST: start a sample. */
export async function startSampleRoute(req: Request, env: Env, org: string, settings: Org, h: Record<string, string>): Promise<Response> {
  const fail = (why: string, status: number) => privateJson({ error: why }, status, h);
  const body = await readJson(req, SampleRequest);
  if (!body) return fail("expected {name, photos: [1 to 4 photo keys]}", 400);
  for (const key of body.photos) {
    if (!key.startsWith(`orgs/${org}/photos/`)) return fail(`${key}: not one of this org's photos`, 400);
    if (!(await env.BUCKET.head(key))) return fail(`${key}: upload it first`, 400);
  }
  const allowance = settings.samples ?? 0;
  if ((await countSamples(env, org)) >= allowance) return fail(`this org has used its ${allowance} samples; more need a plan that includes them`, 402);
  if (!env.MESHY_API_KEY) return fail("samples are not switched on here (MESHY_API_KEY)", 503);

  // The day's ceiling across every org. A read then a write, so two at once can both get the last one: fine for a cap.
  const dayKey = meshyDayKey();
  const day = await env.BUCKET.get(dayKey);
  const used = day ? ((await readJson(new Response(await day.text()), DayCount))?.n ?? 0) : 0;
  if (used >= Number(env.MESHY_DAILY ?? 50)) return fail("today's samples are used up; try again tomorrow", 429);
  await env.BUCKET.put(dayKey, JSON.stringify({ n: used + 1 }));

  const images: string[] = [];
  for (const key of body.photos) {
    const o = await env.BUCKET.get(key);
    if (!o) return fail(`${key}: upload it first`, 400);
    const type = o.httpMetadata?.contentType ?? "image/jpeg";
    images.push(`data:${type};base64,${b64(new Uint8Array(await new Response(o.body).arrayBuffer()))}`);
  }
  let task: string;
  try {
    task = await startSample(env.MESHY_API_KEY, env.MESHY_API_BASE ?? MESHY_BASE, images);
  } catch (e) {
    return fail(e instanceof MeshyError ? e.message : "could not start the sample", 502);
  }
  const s: Sample = { id: hex(crypto.getRandomValues(new Uint8Array(12))), name: body.name, status: "generating", progress: 0, task, photos: body.photos, created: Date.now() };
  await writeSample(env, org, s);
  return privateJson(s satisfies Sample, 202, h);
}

/** GET: how a sample is doing. The poll that sees Meshy finish brings the model home. */
export async function sampleRoute(env: Env, org: string, id: string, h: Record<string, string>): Promise<Response> {
  const fail = (why: string, status: number) => privateJson({ error: why }, status, h);
  if (!SAMPLE_ID.test(id)) return fail("unknown sample", 404);
  const s = await readSample(env, sampleKey(org, id));
  if (!s) return fail("unknown sample", 404);
  if (s.status !== "generating") return privateJson(s, 200, h);
  if (!env.MESHY_API_KEY) return fail("samples are not switched on here (MESHY_API_KEY)", 503);

  let t: MeshyTask;
  try {
    t = await sampleTask(env.MESHY_API_KEY, env.MESHY_API_BASE ?? MESHY_BASE, s.task);
  } catch (e) {
    return fail(e instanceof MeshyError ? e.message : "could not ask Meshy", 502);
  }
  if (t.status === "FAILED" || t.status === "CANCELED") {
    Object.assign(s, { status: "failed", error: t.task_error?.message || `Meshy: ${t.status.toLowerCase()}` });
  } else if (t.status === "SUCCEEDED") {
    const url = t.model_urls?.glb;
    if (!url) {
      Object.assign(s, { status: "failed", error: "Meshy finished without a GLB" });
    } else {
      // Meshy's links expire: copy the model into the org's folder now.
      const r = await fetch(url);
      const bytes = r.ok ? await r.arrayBuffer() : null;
      if (!bytes || bytes.byteLength > GLB_MAX) return fail("could not fetch the finished model; asking again will retry", 502);
      const glb = sampleGlb(org, id);
      await env.BUCKET.put(glb, bytes, { httpMetadata: { contentType: "model/gltf-binary", cacheControl: IMMUTABLE } });
      const product: Product = { name: s.name, model: "custom", glb, colors: [] };
      await env.BUCKET.put(productKey(org, id), JSON.stringify(product), { httpMetadata: { contentType: "application/json" } });
      Object.assign(s, { status: "ready", progress: 100, glb, product: id });
    }
  } else {
    s.progress = Math.max(s.progress, t.progress);
  }
  await writeSample(env, org, s);
  return privateJson(s, 200, h);
}
