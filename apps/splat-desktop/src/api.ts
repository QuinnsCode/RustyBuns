// Thin client for desktop/host.ts.
export interface Scene { path: string; name: string; bytes: number; modified: number }
export type Vec3 = [number, number, number];
export interface SceneInfo { format: string; splats: number | null; shDegree: number | null; bounds: { min: Vec3; max: Vec3 } | null; note?: string }
export interface Status { library: { dir: string; name: string } | null; recent: string[]; home: string; platform: string }

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, init);
  const body = await r.json().catch(() => ({ error: `${r.status} ${r.statusText}` }));
  if (!r.ok) throw new Error(body.error ?? String(r.status));
  return body as T;
}

export const api = {
  status: () => call<Status>("/api/status"),
  list: (dir?: string) => call<{ dir: string; parent: string; dirs: string[]; scenes: number }>(`/api/fs/list?dir=${encodeURIComponent(dir ?? "")}`),
  pick: () => call<{ supported: boolean; dir: string | null }>("/api/fs/pick", { method: "POST" }),
  open: (dir: string) => call<{ dir: string; name: string }>("/api/library/open", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ dir }) }),
  info: (path: string) => call<SceneInfo>(`/api/library/info?path=${encodeURIComponent(path)}`),
  scenes: () => call<{ dir: string; name: string; scenes: Scene[] }>("/api/library/scenes"),
};

/** URL the host serves a library file at. Each path segment encoded, so any file name works. */
export const fileUrl = (path: string) => "/files/" + path.split("/").map(encodeURIComponent).join("/");

export const formatBytes = (n: number) =>
  n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`;
