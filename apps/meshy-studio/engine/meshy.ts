// The Meshy calls the app makes. Bearer-key REST on https://api.meshy.ai/openapi/v1
// (Text to 3D lives on /v2). MESHY_API_BASE points it elsewhere (the tests run a fake Meshy).
import { arr, Bad, nul, num, obj, oneOf, opt, raw, rec, str, type Guard, type Of } from "@rustybuns/util/guard";

export const MESHY_BASE = "https://api.meshy.ai/openapi/v1";

/** Every task endpoint the app uses, by its path. All of them create, get and delete the same way. */
export type Kind =
  | "image-to-3d" | "multi-image-to-3d" | "text-to-3d"
  | "retexture" | "remesh" | "resize" | "convert" | "uv-unwrap"
  | "rigging" | "animations" | "text-to-motion"
  | "text-to-image" | "image-to-image";

export const TASK_STATUSES = ["PENDING", "IN_PROGRESS", "SUCCEEDED", "FAILED", "CANCELED"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

const link = str(Infinity, { min: 0 });
const urls = rec(opt(link));
/** A task as Meshy answers it. Each model's `result` holds that model's own URLs, read where they are used. */
export const Task = obj({
  id: str(200),
  type: opt(str(100, { min: 0 })),
  status: oneOf(TASK_STATUSES),
  progress: num(0, 100, 0),
  /** glb, fbx, obj, usdz, mtl, stl, 3mf, blend, pre_remeshed_glb: whichever were made. */
  model_urls: opt(urls),
  thumbnail_url: opt(link),
  thumbnail_urls: opt(rec(link)),
  alpha_thumbnail_url: opt(link),
  /** base_color, metallic, normal, roughness, emission: whichever were made. */
  texture_urls: opt(arr(rec(link), 100)),
  /** Text to Image and Image to Image. */
  image_urls: opt(arr(link, 100)),
  /** Rigging, Animation, Text to Motion. */
  result: opt(rec(raw)),
  task_error: opt(obj({ message: opt(str(Infinity, { min: 0 })) })),
  consumed_credits: opt(num(-Infinity, Infinity)),
  expires_at: opt(num(-Infinity, Infinity)),
});
export type Task = Of<typeof Task>;

const text = str(Infinity, { min: 0 }), int0 = num(-Infinity, Infinity);
const LibraryAction = obj({ action_id: int0, name: text, key: text, category: text, sub_category: opt(text), preview_url: opt(text) });
export type LibraryAction = Of<typeof LibraryAction>;
const UsageRecord = obj({
  task_id: text, endpoint: text, status: text, created_at: int0, finished_at: nul(int0), consumed_credits: int0,
  api_key_name: opt(text), api_key_suffix: opt(text),
});
export type UsageRecord = Of<typeof UsageRecord>;

export class MeshyError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
  /** What a person should read on the card. */
  get friendly(): string {
    if (this.status === 401) return "Meshy rejected the API key.";
    if (this.status === 402) return "Out of Meshy credits.";
    if (this.status === 429) return "Meshy is rate limiting; retrying shortly.";
    if (this.status === 422) return `Meshy couldn't use this model: ${this.message}`;
    return this.message;
  }
}

export class Meshy {
  constructor(private key: string, private base = process.env.MESHY_API_BASE || MESHY_BASE) {}

  private url(kind: Kind) {
    return kind === "text-to-3d" ? this.base.replace(/\/v1$/, "/v2") + "/text-to-3d" : `${this.base}/${kind}`;
  }

  private async call<T>(method: string, url: string, body: unknown, guard: Guard<T>): Promise<T> {
    let r: Response;
    try {
      r = await fetch(url, {
        method,
        headers: { authorization: `Bearer ${this.key}`, ...(body ? { "content-type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(180_000),
      });
    } catch (err) {
      throw new MeshyError(0, `Could not reach Meshy: ${(err as Error).message}`);
    }
    const text = await r.text();
    if (!r.ok) {
      let msg = text;
      try { msg = JSON.parse(text).message ?? text; } catch {}
      throw new MeshyError(r.status, msg || `${r.status} ${r.statusText}`);
    }
    const data: unknown = text ? JSON.parse(text) : undefined; // an empty reply (a delete) is undefined
    try { return guard(data); } catch (e) {
      if (e instanceof Bad) throw new MeshyError(502, `Meshy sent something this app can't read: ${e.message}`);
      throw e;
    }
  }

  balance() { return this.call("GET", `${this.base}/balance`, undefined, obj({ balance: num(-Infinity, Infinity) })); }
  async create(body: object, kind: Kind = "image-to-3d"): Promise<string> { return (await this.call("POST", this.url(kind), body, obj({ result: str() }))).result; }
  get(id: string, kind: Kind = "image-to-3d") { return this.call("GET", `${this.url(kind)}/${encodeURIComponent(id)}`, undefined, Task); }
  /** Only refunds a task still PENDING; Meshy answers 409 once it runs. */
  cancel(id: string, kind: Kind = "image-to-3d") { return this.call("DELETE", `${this.url(kind)}/${encodeURIComponent(id)}`, undefined, () => undefined); }
  /** The animation library (free). */
  library(q: { search?: string; category?: string } = {}) {
    const p = new URLSearchParams(Object.entries(q).filter(([, v]) => v) as [string, string][]);
    return this.call("GET", `${this.base}/animations/library${p.size ? `?${p}` : ""}`, undefined, arr(LibraryAction, Infinity));
  }
  /** Billed tasks (Studio and Enterprise teams only; others get 403). */
  usage(q: { page_num?: number; page_size?: number; start_time?: string; end_time?: string; endpoints?: string; status?: string } = {}) {
    const p = new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => [k, String(v)]));
    return this.call("GET", `${this.base}/usage/tasks${p.size ? `?${p}` : ""}`, undefined, arr(UsageRecord, Infinity));
  }
}

/** Signed asset URLs need no key; they expire, so download as soon as a task succeeds. */
export async function download(url: string): Promise<Uint8Array> {
  const r = await fetch(url, { signal: AbortSignal.timeout(300_000) });
  if (!r.ok) throw new Error(`download failed: ${r.status} ${r.statusText}`);
  return new Uint8Array(await r.arrayBuffer());
}
