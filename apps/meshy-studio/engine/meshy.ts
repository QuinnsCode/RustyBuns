// The Meshy calls the app makes. Bearer-key REST on https://api.meshy.ai/openapi/v1
// (Text to 3D lives on /v2). MESHY_API_BASE points it elsewhere (the tests run a fake Meshy).

export const MESHY_BASE = "https://api.meshy.ai/openapi/v1";

/** Every task endpoint the app uses, by its path. All of them create, get and delete the same way. */
export type Kind =
  | "image-to-3d" | "multi-image-to-3d" | "text-to-3d"
  | "retexture" | "remesh" | "resize" | "convert" | "uv-unwrap"
  | "rigging" | "animations" | "text-to-motion"
  | "text-to-image" | "image-to-image";

export type TaskStatus = "PENDING" | "IN_PROGRESS" | "SUCCEEDED" | "FAILED" | "CANCELED";

export interface Task {
  id: string;
  type?: string;
  status: TaskStatus;
  progress: number;
  /** glb, fbx, obj, usdz, mtl, stl, 3mf, blend, pre_remeshed_glb: whichever were made. */
  model_urls?: Record<string, string | undefined>;
  thumbnail_url?: string;
  thumbnail_urls?: Record<string, string>;
  alpha_thumbnail_url?: string;
  /** base_color, metallic, normal, roughness, emission: whichever were made. */
  texture_urls?: Record<string, string>[];
  /** Text to Image and Image to Image. */
  image_urls?: string[];
  /** Rigging, Animation, Text to Motion. */
  result?: Record<string, unknown> | null;
  task_error?: { message?: string };
  consumed_credits?: number;
  expires_at?: number;
}

export interface LibraryAction { action_id: number; name: string; key: string; category: string; sub_category?: string; preview_url?: string }
export interface UsageRecord { task_id: string; endpoint: string; status: string; created_at: number; finished_at: number | null; consumed_credits: number; api_key_name?: string; api_key_suffix?: string }

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

  private async call<T>(method: string, url: string, body?: unknown): Promise<T> {
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
    return (text ? JSON.parse(text) : undefined) as T;
  }

  balance() { return this.call<{ balance: number }>("GET", `${this.base}/balance`); }
  async create(body: object, kind: Kind = "image-to-3d"): Promise<string> { return (await this.call<{ result: string }>("POST", this.url(kind), body)).result; }
  get(id: string, kind: Kind = "image-to-3d") { return this.call<Task>("GET", `${this.url(kind)}/${encodeURIComponent(id)}`); }
  /** Only refunds a task still PENDING; Meshy answers 409 once it runs. */
  cancel(id: string, kind: Kind = "image-to-3d") { return this.call<void>("DELETE", `${this.url(kind)}/${encodeURIComponent(id)}`); }
  /** The animation library (free). */
  library(q: { search?: string; category?: string } = {}) {
    const p = new URLSearchParams(Object.entries(q).filter(([, v]) => v) as [string, string][]);
    return this.call<LibraryAction[]>("GET", `${this.base}/animations/library${p.size ? `?${p}` : ""}`);
  }
  /** Billed tasks (Studio and Enterprise teams only; others get 403). */
  usage(q: { page_num?: number; page_size?: number; start_time?: string; end_time?: string; endpoints?: string; status?: string } = {}) {
    const p = new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => [k, String(v)]));
    return this.call<UsageRecord[]>("GET", `${this.base}/usage/tasks${p.size ? `?${p}` : ""}`);
  }
}

/** Signed asset URLs need no key; they expire, so download as soon as a task succeeds. */
export async function download(url: string): Promise<Uint8Array> {
  const r = await fetch(url, { signal: AbortSignal.timeout(300_000) });
  if (!r.ok) throw new Error(`download failed: ${r.status} ${r.statusText}`);
  return new Uint8Array(await r.arrayBuffer());
}
