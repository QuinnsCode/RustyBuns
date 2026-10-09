// Thin client for desktop/host.ts. The Meshy key never reaches this side.
import type { Engine, Job, Sync } from "../engine/workspace.ts";
import type { Origin, Preset, Size } from "../engine/presets.ts";

export type { Engine, Job, Origin, Preset, Size, Sync };
export interface Settings { maxQueued: number; confirmSends: boolean; batchCap: number }
export type Card = Job & { sizeText: string; presetLabel: string };

export interface Status {
  /** Whether a key is saved. Nothing of the key itself ever comes back. */
  hasKey: boolean; keyFromEnv: boolean; blender: boolean;
  workspace: { dir: string; name: string } | null;
  recent: string[]; home: string; settings: Settings;
}
export interface Summary {
  dir: string; name: string; version: number; maxQueued: number;
  pause: { reason: string; until?: number } | null;
  folders: string[]; presets: Preset[]; jobs: Card[];
  sync: Sync | null; spent: number;
}

async function call<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const r = await fetch(path, json === undefined ? rest : { ...rest, method: rest.method ?? "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(json) });
  const body = await r.json().catch(() => ({ error: `${r.status} ${r.statusText}` }));
  if (!r.ok) throw new Error(body.error ?? String(r.status));
  return body as T;
}

const act = (name: string, json: object) => call<Summary>(`/api/jobs/${name}`, { json });

export const api = {
  status: () => call<Status>("/api/status"),
  setKey: (key: string) => call<{ balance: number }>("/api/key", { json: { key } }),
  forgetKey: () => call<{ ok: true }>("/api/key", { method: "DELETE" }),
  balance: () => call<{ balance: number }>("/api/balance"),
  settings: (patch: Partial<Settings>) => call<Settings>("/api/settings", { json: patch }),
  list: (dir?: string) => call<{ dir: string; parent: string; dirs: string[]; isWorkspace: boolean }>(`/api/fs/list?dir=${encodeURIComponent(dir ?? "")}`),
  pick: (prompt?: string) => call<{ supported: boolean; dir: string | null }>("/api/fs/pick", { json: { prompt } }),
  open: (dir: string) => call<{ dir: string; name: string }>("/api/workspace/open", { json: { dir } }),
  close: () => call<{ ok: true }>("/api/workspace/close", { method: "POST" }),
  jobs: () => call<Summary>("/api/jobs"),
  /** `credits` is what the person confirmed; the host refuses if the batch now costs more. */
  send: (keys: string[], credits: number) => act("send", { keys, credits }),
  resume: () => act("send", { keys: [] }),
  retry: (key: string) => act("retry", { key }),
  cancel: (key: string) => act("cancel", { key }),
  edit: (key: string, patch: Partial<Pick<Job, "prefix" | "size" | "origin" | "outName" | "texturePrompt">>) => act("edit", { key, patch }),
  move: (key: string, folder: string) => act("move", { key, folder }),
  newFolder: (name: string) => call<Summary>("/api/folders", { json: { name } }),
  upload: (folder: string, file: File) =>
    call<Summary>(`/api/upload?folder=${encodeURIComponent(folder)}&name=${encodeURIComponent(file.name)}`, { method: "POST", body: file }),
  sync: (dir: string, engine: Engine) => call<Summary>("/api/sync", { json: { dir, engine } }),
  syncOff: () => call<Summary>("/api/sync", { json: { off: true } }),
  blender: (keys?: string[]) => call<{ opened: number }>("/api/blender", { json: { keys } }),
  reveal: (stage: "inbox" | "sent" | "raw" | "ready" | "root") => call<{ ok: true }>("/api/reveal", { json: { stage } }),
};

export const imageUrl = (key: string, v: number) => `/img/${encodeURIComponent(key)}?v=${v}`;
