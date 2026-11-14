// Required Notice: Copyright (c) 2026 Ryan Quinn (QNTBR) (https://qntbr.com). PolyForm Noncommercial 1.0.0, see ../LICENSE.
//
// The two Meshy calls a sample needs: start a multi-image-to-3D task, and ask how it's going. Bearer-key REST on
// https://api.meshy.ai/openapi/v1 (docs.meshy.ai/en/api/multi-image-to-3d). The tests and `bun run dev` point
// `base` at a stand-in (local-meshy.ts), so building this spends no credits.
import { num, obj, oneOf, opt, str, type Of } from "@rustybuns/util/guard";
import { readJson } from "@rustybuns/util/http";

export const MESHY_BASE = "https://api.meshy.ai/openapi/v1";

export const MeshyTask = obj({
  id: str(200),
  status: oneOf(["PENDING", "IN_PROGRESS", "SUCCEEDED", "FAILED", "CANCELED"] as const),
  progress: num(0, 100, 0),
  model_urls: opt(obj({ glb: opt(str(4000, { min: 0 })) })),
  task_error: opt(obj({ message: opt(str(2000, { min: 0 })) })),
});
export type MeshyTask = Of<typeof MeshyTask>;

/**
 * What a sample asks Meshy for: a textured, remeshed model light enough for a product page.
 * The Meshy Studio app's price table puts multi-image-to-3D at 5 to 40 credits a model; these options sit
 * in the middle. Check the current price before turning a real key on.
 */
export const SAMPLE_OPTIONS = { ai_model: "latest", should_texture: true, should_remesh: true, target_polycount: 30000, texture_resolution: "2k" };

export class MeshyError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

async function call<T>(key: string, url: string, body: unknown, guard: (v: unknown) => T): Promise<T> {
  let r: Response;
  try {
    r = await fetch(url, {
      method: body ? "POST" : "GET",
      headers: { authorization: `Bearer ${key}`, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new MeshyError(0, `could not reach Meshy: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!r.ok) throw new MeshyError(r.status, r.status === 402 ? "the Meshy account is out of credits" : `Meshy answered ${r.status}`);
  const v = await readJson(r, guard);
  if (v === null) throw new MeshyError(502, "Meshy sent something this app can't read");
  return v;
}

/** Start a model from up to four images (data: URIs). Returns Meshy's task id. */
export async function startSample(key: string, base: string, images: string[]): Promise<string> {
  const { result } = await call(key, `${base}/multi-image-to-3d`, { image_urls: images.slice(0, 4), ...SAMPLE_OPTIONS }, obj({ result: str(200) }));
  return result;
}

export const sampleTask = (key: string, base: string, id: string) => call(key, `${base}/multi-image-to-3d/${encodeURIComponent(id)}`, undefined, MeshyTask);
