// Thin client for desktop/host.ts. The Meshy key never reaches this side.
import type { Concept, Engine, Job, Op, Overrides, Sync } from "../engine/workspace.ts";
import type { MeshyOptions, ModelId, Origin, Preset, Size, TextureModel } from "../engine/presets.ts";
import type { ConceptParams, OpKind, OpParams } from "../engine/ops.ts";
import type { LibraryAction, UsageRecord } from "../engine/meshy.ts";

export type { Concept, ConceptParams, Engine, Job, LibraryAction, MeshyOptions, ModelId, Op, OpKind, OpParams, Origin, Overrides, Preset, Size, Sync, UsageRecord };
export interface Settings { maxQueued: number; confirmSends: boolean; batchCap: number }
export type Card = Job & {
  sizeText: string; presetLabel: string; draftEstimate: number; textureEstimate: number;
  /** The preset's options with this card's overrides. */
  options: MeshyOptions; model: ModelId;
  /** Unsent cards: what each model would cost here, and what Meshy would refuse. */
  modelCosts?: Record<ModelId, { full: number; draft: number; problems: string[] }>;
  /** Unsent cards: what texturing adds, in the same job or as a Retexture step with each model. */
  textureCosts?: Record<"same" | TextureModel, number>;
  problems: string[]; canTexture: boolean;
};
export type EditPatch = Partial<Pick<Job, "prefix" | "size" | "origin" | "outName" | "texturePrompt" | "draft">> & {
  overrides?: Overrides; clear?: (keyof MeshyOptions)[]; model?: ModelId | "preset";
  /** Texture as a Retexture step with this model; null textures in the same job. */
  textureModel?: TextureModel | null;
};

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
  sync: Sync | null; spent: number; concepts: Concept[];
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
  send: (keys: string[], credits: number, draft = false) => act("send", { keys, credits, draft }),
  texture: (keys: string[], credits: number) => act("texture", { keys, credits }),
  savePresets: (presets: Preset[]) => call<Summary>("/api/presets", { json: { presets } }),
  resume: () => act("send", { keys: [] }),
  retry: (key: string, credits?: number) => act("retry", { key, credits }),
  cancel: (key: string) => act("cancel", { key }),
  edit: (key: string, patch: EditPatch) => act("edit", { key, patch }),
  editMany: (keys: string[], patch: EditPatch) => call<Summary & { skipped: string[] }>("/api/jobs/edit-many", { json: { keys, patch } }),
  /** A step (and any that follow it, e.g. motion then animate) on these cards. */
  op: <K extends OpKind>(keys: string[], kind: K, params: OpParams[K], credits: number, then: { kind: OpKind; params: unknown }[] = []) =>
    call<Summary & { skipped: string[] }>("/api/jobs/op", { json: { keys, kind, params, credits, then } }),
  cancelOp: (key: string, op: string) => act("cancel", { key, op }),
  dropOp: (key: string, op: string) => act("drop-op", { key, op }),
  combine: (keys: string[]) => act("combine", { keys }),
  split: (key: string) => act("split", { key }),
  setPrompt: (key: string, prompt: string) => act("prompt", { key, prompt }),
  concept: (kind: Concept["kind"], params: ConceptParams, opts: { folder: string; name: string; references?: string[] }, credits: number) =>
    call<Summary>("/api/concepts", { json: { kind, params, ...opts, credits } }),
  cancelConcept: (id: string) => call<Summary>("/api/concepts/cancel", { json: { id } }),
  createText: (folder: string, name: string, prompt: string) => call<Summary>("/api/create/text", { json: { folder, name, prompt } }),
  animations: (q: { search?: string; category?: string } = {}) => call<LibraryAction[]>(`/api/animations?${new URLSearchParams(Object.entries(q).filter(([, v]) => v) as [string, string][])}`),
  usage: (q: Record<string, string> = {}) => call<UsageRecord[]>(`/api/usage?${new URLSearchParams(q)}`),
  move: (key: string, folder: string) => act("move", { key, folder }),
  newFolder: (name: string) => call<Summary>("/api/folders", { json: { name } }),
  upload: (folder: string, file: File) =>
    call<Summary>(`/api/upload?folder=${encodeURIComponent(folder)}&name=${encodeURIComponent(file.name)}`, { method: "POST", body: file }),
  sync: (dir: string, engine: Engine) => call<Summary>("/api/sync", { json: { dir, engine } }),
  syncOff: () => call<Summary>("/api/sync", { json: { off: true } }),
  blender: (keys?: string[]) => call<{ opened: number }>("/api/blender", { json: { keys } }),
  reveal: (stage: "inbox" | "sent" | "raw" | "ready" | "root") => call<{ ok: true }>("/api/reveal", { json: { stage } }),
};

export const imageUrl = (key: string, v: number, view = 0) => `/img/${encodeURIComponent(key)}?v=${v}${view ? `&view=${view}` : ""}`;
