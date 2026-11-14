// Required Notice: Copyright (c) 2026 Ryan Quinn (QNTBR) (https://qntbr.com). PolyForm Noncommercial 1.0.0, see ../../LICENSE.
//
// One file up to the org's folder: ask the Worker where (a signed PUT, or "you already have it"), then PUT it.
// The widget saves designs with it; the admin page sends product photos with it, carrying its admin key.
import { readJson } from "@rustybuns/util/http";
import { SignReply, type SignRequest } from "../api.ts";

/** The error a QView3D route sent (`{error}`), or the status line. */
export async function problem(res: Response): Promise<string> {
  const body = await res.text().catch(() => "");
  try { const e: unknown = JSON.parse(body); if (e && typeof e === "object" && "error" in e && typeof e.error === "string") return e.error; } catch { /* not JSON */ }
  return `${res.status} ${res.statusText}`.trim();
}

/** `base` is `<api>/api/orgs/<org>`. Returns the file's key. */
export async function upload(base: string, kind: SignRequest["kind"], blob: Blob, sha256: string, headers: Record<string, string> = {}): Promise<string> {
  const req: SignRequest = { kind, type: blob.type, size: blob.size, sha256 };
  const res = await fetch(`${base}/uploads`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(req) });
  const s = res.ok ? await readJson(res, SignReply) : null;
  if (!s) throw new Error(await problem(res));
  if (!s.exists && s.put) {
    const up = await fetch(s.put.url, { method: "PUT", headers: s.put.headers, body: blob });
    if (!up.ok) throw new Error(await problem(up));
  }
  return s.key;
}
