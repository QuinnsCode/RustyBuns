// The few Meshy calls the app makes. Bearer-key REST on https://api.meshy.ai/openapi/v1.
// MESHY_API_BASE points it elsewhere (the tests run a fake Meshy).

export const MESHY_BASE = "https://api.meshy.ai/openapi/v1";

export type Kind = "image-to-3d" | "retexture";
export type TaskStatus = "PENDING" | "IN_PROGRESS" | "SUCCEEDED" | "FAILED" | "CANCELED";

export interface Task {
  id: string;
  status: TaskStatus;
  progress: number;
  /** glb, fbx, obj, usdz, mtl, stl, 3mf, pre_remeshed_glb: whichever were made. */
  model_urls?: Record<string, string | undefined>;
  thumbnail_url?: string;
  /** base_color, metallic, normal, roughness, emission: whichever were made. */
  texture_urls?: Record<string, string>[];
  task_error?: { message?: string };
  consumed_credits?: number;
  expires_at?: number;
}

export class MeshyError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
  /** What a person should read on the card. */
  get friendly(): string {
    if (this.status === 401) return "Meshy rejected the API key.";
    if (this.status === 402) return "Out of Meshy credits.";
    if (this.status === 429) return "Meshy is rate limiting; retrying shortly.";
    return this.message;
  }
}

export class Meshy {
  constructor(private key: string, private base = process.env.MESHY_API_BASE || MESHY_BASE) {}

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    let r: Response;
    try {
      r = await fetch(this.base + path, {
        method,
        headers: { authorization: `Bearer ${this.key}`, ...(body ? { "content-type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(120_000),
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

  balance() { return this.call<{ balance: number }>("GET", "/balance"); }
  /** Image to 3D by default; "retexture" textures a finished model. Both work the same way. */
  async create(body: object, kind: Kind = "image-to-3d"): Promise<string> { return (await this.call<{ result: string }>("POST", `/${kind}`, body)).result; }
  get(id: string, kind: Kind = "image-to-3d") { return this.call<Task>("GET", `/${kind}/${encodeURIComponent(id)}`); }
  /** Only refunds a job still PENDING; Meshy answers 409 once it runs. */
  cancel(id: string, kind: Kind = "image-to-3d") { return this.call<void>("DELETE", `/${kind}/${encodeURIComponent(id)}`); }
}

/** Signed asset URLs need no key; they expire, so download as soon as a job succeeds. */
export async function download(url: string): Promise<Uint8Array> {
  const r = await fetch(url, { signal: AbortSignal.timeout(300_000) });
  if (!r.ok) throw new Error(`download failed: ${r.status} ${r.statusText}`);
  return new Uint8Array(await r.arrayBuffer());
}
