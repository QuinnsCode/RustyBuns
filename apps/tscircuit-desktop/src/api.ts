// Thin client for desktop/host.ts. Every call goes to the local Bun host.
import type { Analysis } from "./analysis/analyze.ts";

export interface Listing { dir: string; name: string; files: string[]; boards: string[]; entry: string | null }
export interface Status { native: boolean; platform: string; project: Listing | null; recent: string[]; home: string }
export interface Timed { engine: string; ms: number; result: Analysis }

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, init);
  const body = await r.json().catch(() => ({ error: `${r.status} ${r.statusText}` }));
  if (!r.ok) throw new Error(body.error ?? `${r.status}`);
  return body as T;
}
const post = (body: unknown): RequestInit => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export const api = {
  status: () => call<Status>("/api/status"),
  list: (dir?: string) => call<{ dir: string; parent: string; dirs: string[]; hasBoards: boolean }>(`/api/fs/list?dir=${encodeURIComponent(dir ?? "")}`),
  pick: () => call<{ supported: boolean; dir: string | null }>("/api/fs/pick", { method: "POST" }),
  open: (dir: string) => call<Listing>("/api/project/open", post({ dir })),
  create: (dir: string) => call<Listing>("/api/project/new", post({ dir })),
  files: () => call<Listing & { fsMap: Record<string, string> }>("/api/project/files"),
  save: (path: string, text: string) => call<{ ok: true }>(`/api/project/file?path=${encodeURIComponent(path)}`, { method: "PUT", body: text }),
  analyze: (circuitJson: string, min: number, engine: "auto" | "ts" = "auto") =>
    call<Timed>(`/api/analyze?min=${min}&engine=${engine}`, { method: "POST", body: circuitJson }),
  export: (format: string, circuitJson: unknown[], board: string) =>
    call<{ dir: string; written: string[] }>(`/api/export?format=${format}`, post({ circuitJson, board })),
};
