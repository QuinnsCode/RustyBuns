// A workspace is a folder with four stages and a ledger:
//
//   000_to_be_meshyd/               drop work here (subfolders are kept all the way through)
//   000_to_be_meshyd/already done/  inputs move here once Meshy has them
//   001_has_been_meshyd/            what Meshy made, untouched: models, formats, rigs, animations
//   002_ready/                      the scaled, origin-fixed models (plus rigged and animated ones)
//   meshy-jobs.json                 one row per card: the ledger
//   meshy-presets.json              the presets, editable and shareable
//
// A card comes from one of three sources in 000:
//   oak.png                         Image to 3D
//   oak__front.png, oak__back.png   Multi-Image to 3D (1 to 4 views; __1, __2 … work too)
//   oak.prompt.txt                  Text to 3D (preview, then refine for the texture)
// Beside it, <stem>.txt is a texture prompt and <stem>.texture.png a texture reference image.
//
// After the shape, a card can run steps (engine/ops.ts): texture, remesh, resize, UV unwrap,
// convert, rig, motion, animate. They run in order, each using the previous result.
// The ledger is written before any file moves, so quitting mid-batch loses nothing and
// never sends anything twice.

import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { describeSize, IMAGE_EXT, parseLabel, TEXTURE_REF } from "./labels.ts";
import { download, Meshy, MeshyError, type Kind, type Task } from "./meshy.ts";
import {
  checkOptions, checkPreset, createBody, estimateCredits, estimateRetexture, isWarning, mergeOptions, MODEL_CHOICES, modelOf, modelPatch, modelsFor,
  multiBody, presetFor, retextureBody, STARTER_PRESETS, textPreviewBody, textRefineBody,
  type CardInput, type MeshyOptions, type ModelId, type Origin, type Preset, type RetextureOptions, type Size, type Source,
} from "./presets.ts";
import {
  ACCEPTS, checkConcept, checkOp, texturedAfter, conceptBody, estimateConcept, estimateOp, MAKES_MODEL, OP_KIND, OP_LABEL, opBody,
  type ConceptParams, type OpKind, type OpParams,
} from "./ops.ts";
import { fitGlb } from "./fit.ts";

export const INBOX = "000_to_be_meshyd";
export const SENT = "already done";
export const RAW = "001_has_been_meshyd";
export const READY = "002_ready";
export const LEDGER = "meshy-jobs.json";
export const PRESETS = "meshy-presets.json";
export const CONFIG = "meshy-studio.json";
export const PROMPT_EXT = /\.prompt\.txt$/i;
/** oak__front.png, oak__2.png: views of one object. */
const VIEW = /^(.+)__(front|back|left|right|side|top|\d+)$/i;
const VIEW_ORDER = ["front", "back", "left", "right", "side", "top"];
const MAX_VIEWS = 4;

/** Where finished models also go, so the game engine picks them up. */
export type Engine = "unity" | "unreal" | "blender" | "folder";
export interface Sync { dir: string; engine: Engine }

export type JobState = "new" | "queued" | "running" | "downloaded" | "done" | "failed";
export type StepState = "queued" | "running" | "done" | "failed";

/** One Meshy task after the shape. */
export interface Op {
  id: string;
  kind: OpKind;
  params: OpParams[OpKind];
  label: string;
  state: StepState;
  taskId?: string;
  meshyStatus?: Task["status"];
  progress: number;
  estimate: number;
  credits?: number;
  error?: string;
  /** Files it wrote under 001. */
  files?: string[];
  createdAt: number;
}

/** A per-card option value; null means "Meshy's default" (not sent), an absent key means "the preset's". */
export type Overrides = Partial<Record<keyof MeshyOptions, unknown>>;

export interface Job {
  /** Path under 000 when found, "/"-separated (a multi-image card ends in __views). Stable id. */
  key: string;
  folder: string;
  /** The image (the front view for multi), or the .prompt.txt for text. */
  file: string;
  /** Where the inputs sit now: in 000, or in 000/already done. */
  where: "inbox" | "sent";
  source: Source;
  /** Multi-image: the other views, same folder. */
  views?: string[];
  /** Text to 3D: the prompt. */
  prompt?: string;
  /** The image came from a Meshy Text/Image to Image task: send that id instead of uploading. */
  inputTaskId?: string;
  prefix: string;
  outName: string;
  size: Size;
  origin: Origin;
  overrides?: Overrides;
  texturePrompt?: string;
  /** A <stem>.texture.png sits beside an input. */
  textureImage?: boolean;
  /** Shape only; texture later. */
  draft?: boolean;
  /** Whether the model in 001 has a texture on it. */
  textured?: boolean;
  state: JobState;
  taskId?: string;
  meshyStatus?: Task["status"];
  progress: number;
  thumbnail?: string;
  error?: string;
  estimate: number;
  credits?: number;
  ops?: Op[];
  /** The task that made the current model: the next step's input. */
  modelTask?: { kind: Kind; id: string };
  rigTaskId?: string;
  /** Paths under 001 and 002 once written. */
  raw?: string;
  ready?: string;
  /** Other files from Meshy in 001: formats, texture maps, rigs, clips. */
  extras?: string[];
  /** Other files in 002 (rigged and animated models), copied to the engine folder too. */
  readyExtras?: string[];
  createdAt: number;
  updatedAt: number;
}

/** A Text to Image or Image to Image task: its images land in 000 as new cards. */
export interface Concept {
  id: string;
  kind: "text-to-image" | "image-to-image";
  params: ConceptParams;
  /** Image to Image: the cards whose images are the references. */
  references?: string[];
  folder: string;
  name: string;
  state: StepState;
  taskId?: string;
  meshyStatus?: Task["status"];
  progress: number;
  estimate: number;
  credits?: number;
  error?: string;
  files?: string[];
  createdAt: number;
}

export interface Pause { reason: string; until?: number }

const mime = (f: string) => /\.png$/i.test(f) ? "image/png" : /\.jpe?g$/i.test(f) ? "image/jpeg" : "application/octet-stream";
const dataUri = async (path: string) => `data:${mime(path)};base64,${Buffer.from(await Bun.file(path).bytes()).toString("base64")}`;
const stemOf = (file: string) => file.replace(PROMPT_EXT, "").replace(IMAGE_EXT, "");
const viewRank = (f: string) => { const v = (VIEW.exec(stemOf(f))?.[2] ?? "").toLowerCase(); const i = VIEW_ORDER.indexOf(v); return i >= 0 ? i : 10 + Number(v || 99); };
let seq = 0;
const newId = () => `${Date.now().toString(36)}${(seq++).toString(36)}`;

export class Workspace {
  readonly dir: string;
  jobs = new Map<string, Job>();
  concepts: Concept[] = [];
  /** Images Meshy made (path under 000 -> task id), for input_task_id. */
  origins: Record<string, string> = {};
  presets: Preset[] = STARTER_PRESETS;
  pause: Pause | null = null;
  sync: Sync | null = null;
  /** Bumped on every change; the UI polls it. */
  version = 0;
  private busy = false;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(dir: string, private key: () => string | null, public maxQueued = 10) {
    this.dir = resolve(dir);
  }

  path(...parts: string[]) { return join(this.dir, ...parts); }

  async open() {
    for (const d of [INBOX, join(INBOX, SENT), RAW, READY]) mkdirSync(this.path(d), { recursive: true });
    const pf = Bun.file(this.path(PRESETS));
    if (await pf.exists()) {
      const list = await pf.json().catch(() => null);
      if (Array.isArray(list) && list.length) this.presets = list;
    } else {
      await Bun.write(pf, JSON.stringify(STARTER_PRESETS, null, 2) + "\n");
    }
    const cf = Bun.file(this.path(CONFIG));
    if (await cf.exists()) this.sync = (await cf.json().catch(() => ({}))).sync ?? null;
    const lf = Bun.file(this.path(LEDGER));
    if (await lf.exists()) {
      const l = await lf.json();
      for (const j of Object.values(l.jobs ?? {}) as (Job & { texture?: Op & { state: StepState } })[]) {
        j.source ??= "image";
        // Ledgers from before steps kept one texture track.
        if (j.texture) {
          j.ops = [{ ...j.texture, id: newId(), kind: "retexture", params: {}, label: OP_LABEL.retexture, createdAt: j.updatedAt }];
          delete j.texture;
        }
        if (j.taskId && !j.modelTask && j.state === "done") j.modelTask = { kind: this.shapeKind(j), id: j.taskId };
        this.jobs.set(j.key, j);
      }
      this.concepts = l.concepts ?? [];
      this.origins = l.origins ?? {};
      // Unsent cards follow today's rules (models an endpoint dropped, prices that changed).
      for (const j of this.jobs.values()) if (this.unsent(j)) { this.fitModel(j); this.reprice(j); }
    }
    await this.scan();
  }

  /** Re-check the work loop every few seconds. Tests call tick() themselves instead. */
  start(everyMs = 3000) {
    this.stop();
    this.timer = setInterval(() => { this.tick().catch((e) => console.error("[meshy-studio] tick", e)); }, everyMs);
  }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = undefined; }

  private async save() {
    this.version++;
    const tmp = this.path(LEDGER + ".tmp");
    await Bun.write(tmp, JSON.stringify({ version: 2, jobs: Object.fromEntries(this.jobs), concepts: this.concepts, origins: this.origins }, null, 2));
    renameSync(tmp, this.path(LEDGER));
  }

  private touch(j: Job, patch: Partial<Job>) { Object.assign(j, patch, { updatedAt: Date.now() }); }
  private shapeKind(j: Job): Kind { return j.source === "multi" ? "multi-image-to-3d" : j.source === "text" ? "text-to-3d" : "image-to-3d"; }

  /** The card's preset with its overrides applied. */
  spec(j: Job): Preset {
    const p = this.preset(j);
    return { ...p, options: mergeOptions(p.options, j.overrides), size: j.size, origin: j.origin };
  }
  private card(j: Job): CardInput { return { texturePrompt: j.texturePrompt, textureImage: j.textureImage ? "yes" : undefined, draft: j.draft }; }
  private price(j: Job, options: MeshyOptions, draft = j.draft) {
    return estimateCredits(options, { ...this.card(j), draft }, j.source, this.preset(j).retexture);
  }
  private reprice(j: Job) { j.estimate = this.price(j, this.spec(j).options); }

  /** Subfolders of 000 (organizing folders), "/"-separated, "" first. */
  folders(): string[] {
    const out = [""];
    const walk = (rel: string) => {
      let names: string[] = [];
      try { names = readdirSync(this.path(INBOX, rel)); } catch { return; }
      for (const n of names.sort()) {
        if (n.startsWith(".") || (rel === "" && n === SENT)) continue;
        const r = rel ? `${rel}/${n}` : n;
        if (statSync(this.path(INBOX, r)).isDirectory()) { out.push(r); walk(r); }
      }
    };
    walk("");
    return out;
  }

  /** Find new work in 000, regroup views, and forget unsent cards whose inputs are gone. */
  async scan() {
    let changed = false;
    const seen = new Set<string>();
    const fresh = (old: Job | undefined) => !old || (old.where === "sent" && (old.state === "done" || old.state === "failed"));
    for (const folder of this.folders()) {
      const rel = (n: string) => folder ? `${folder}/${n}` : n;
      const groups = new Map<string, string[]>();
      const singles: [string, Source][] = [];
      for (const name of readdirSync(this.path(INBOX, folder))) {
        if (name.startsWith(".")) continue;
        if (PROMPT_EXT.test(name)) { singles.push([name, "text"]); continue; }
        if (!IMAGE_EXT.test(name) || TEXTURE_REF.test(name)) continue;
        const m = VIEW.exec(stemOf(name));
        if (m) groups.set(m[1]!, [...(groups.get(m[1]!) ?? []), name]);
        else singles.push([name, "image"]);
      }
      for (const [name, source] of singles) {
        const key = rel(name);
        seen.add(key);
        const old = this.jobs.get(key);
        if (!fresh(old)) { if (old!.state === "new" && old!.where === "inbox") changed = (await this.readSidecars(old!)) || changed; continue; }
        this.jobs.set(key, await this.newJob(folder, name, source));
        changed = true;
      }
      for (const [base, files] of groups) {
        files.sort((a, b) => viewRank(a) - viewRank(b) || a.localeCompare(b));
        const key = rel(`${base}__views`);
        seen.add(key);
        const old = this.jobs.get(key);
        if (!fresh(old)) {
          if (old!.state === "new" && old!.where === "inbox" && [old!.file, ...(old!.views ?? [])].join() !== files.join()) {
            this.touch(old!, { file: files[0]!, views: files.slice(1) });
            await this.readSidecars(old!);
            this.reprice(old!);
            changed = true;
          } else if (old!.state === "new" && old!.where === "inbox") changed = (await this.readSidecars(old!)) || changed;
          continue;
        }
        const j = await this.newJob(folder, files[0]!, "multi", base);
        j.key = key;
        j.views = files.slice(1);
        const taskIds = new Set(files.map((f) => this.origins[rel(f)]));
        if (taskIds.size === 1 && [...taskIds][0]) j.inputTaskId = [...taskIds][0];
        this.jobs.set(key, j);
        changed = true;
      }
    }
    for (const j of this.jobs.values()) {
      if (j.where === "inbox" && (j.state === "new" || j.state === "queued") && !seen.has(j.key)) { this.jobs.delete(j.key); changed = true; }
    }
    if (changed) await this.save();
  }

  /** Every input file of a card (image, views or prompt), where it sits now. */
  inputPaths(j: Job) { return [j.file, ...(j.views ?? [])].map((f) => this.at(j, f)); }
  private at(j: Job, file: string) { return j.where === "inbox" ? this.path(INBOX, j.folder, file) : this.path(INBOX, SENT, j.folder, file); }
  imagePath(j: Job) { return this.at(j, j.file); }
  /** Texture reference images beside the inputs. */
  private textureRefs(j: Job): string[] {
    return this.inputPaths(j).map((p) => ["png", "jpg", "jpeg"].map((e) => join(dirname(p), `${stemOf(basename(p))}.texture.${e}`)).find(existsSync)).filter((p): p is string => !!p);
  }
  /** Sidecars that travel with the inputs: .txt texture prompt, .texture.png references. */
  private sidecars(j: Job): string[] {
    const base = j.source === "multi" ? j.key.split("/").pop()!.replace(/__views$/, "") : stemOf(j.file);
    const txt = j.source === "text" ? [] : [join(dirname(this.imagePath(j)), `${base}.txt`)];
    return [...txt, ...this.textureRefs(j)].filter(existsSync);
  }

  /** The texture prompt (.txt), texture images (.texture.png) and, for text, the prompt itself. True if any changed. */
  private async readSidecars(j: Job): Promise<boolean> {
    const img = this.imagePath(j);
    const base = j.source === "multi" ? j.key.split("/").pop()!.replace(/__views$/, "") : stemOf(j.file);
    const txt = join(dirname(img), `${base}.txt`);
    const texturePrompt = j.source !== "text" && existsSync(txt) ? (await Bun.file(txt).text()).trim() || undefined : j.source === "text" ? j.texturePrompt : undefined;
    const textureImage = this.textureRefs(j).length > 0 || undefined;
    const prompt = j.source === "text" && existsSync(img) ? (await Bun.file(img).text()).trim() : j.prompt;
    if (texturePrompt === j.texturePrompt && textureImage === j.textureImage && prompt === j.prompt) return false;
    Object.assign(j, { texturePrompt, textureImage, prompt });
    this.reprice(j);
    return true;
  }

  private async newJob(folder: string, file: string, source: Source, base = stemOf(file)): Promise<Job> {
    const label = parseLabel(base, this.presets);
    const now = Date.now();
    const key = folder ? `${folder}/${file}` : file;
    const j: Job = {
      key, folder, file, where: "inbox", source,
      prefix: label.preset.prefix, outName: label.outName, size: label.size, origin: label.origin,
      draft: label.draft || undefined, state: "new", progress: 0, estimate: 0, createdAt: now, updatedAt: now,
      ...(source === "image" && this.origins[key] ? { inputTaskId: this.origins[key] } : {}),
    };
    this.fitModel(j);
    await this.readSidecars(j);
    this.reprice(j);
    return j;
  }

  /**
   * A card whose preset model its endpoint doesn't offer (smart topology or low poly on a
   * multi-image card) uses meshy-6-lite instead: the same price, and nothing fails at Meshy.
   */
  private fitModel(j: Job) {
    const o = mergeOptions(this.preset(j).options, j.overrides);
    if (modelsFor(j.source).includes(modelOf(o))) return;
    j.overrides = { ...j.overrides, ...modelPatch(o, "meshy-6-lite") };
  }

  preset(j: Job) { return this.presets.find((p) => p.prefix === j.prefix) ?? presetFor("", this.presets); }

  get(key: string): Job {
    const j = this.jobs.get(key);
    if (!j) throw new Error(`no such card: ${key}`);
    return j;
  }
  private unsent(j: Job) { return j.state === "new" || (j.state === "failed" && !j.taskId); }

  /** Change a card. Before sending: anything. After the model is down: size, origin and name re-fit for free. */
  async edit(key: string, patch: {
    prefix?: string; size?: Size; origin?: Origin; outName?: string; texturePrompt?: string; draft?: boolean;
    /** Values to set (null = Meshy's default), on top of the preset. */
    overrides?: Overrides;
    /** Override keys to drop, back to the preset's value. */
    clear?: (keyof MeshyOptions)[];
    /** Shortcut: one of MODEL_CHOICES. */
    model?: ModelId | "preset";
  }) {
    const j = this.get(key);
    const unsent = this.unsent(j);
    const shapeOnly = ["prefix", "texturePrompt", "draft", "overrides", "clear", "model"] as const;
    if (!unsent && shapeOnly.some((k) => patch[k] !== undefined) && !(j.source === "text" && patch.texturePrompt !== undefined && Object.keys(patch).length === 1)) {
      throw new Error("already sent to Meshy; only size, origin and name can change now");
    }
    if (!unsent && patch.size && "auto" in patch.size) throw new Error("Meshy's size guess is made when it's sent; pick meters now");
    if (patch.outName !== undefined && !/^[^/\\:*?"<>|]+$/.test(patch.outName)) throw new Error("that name has characters a file can't have");
    if (patch.prefix !== undefined && !this.presets.some((p) => p.prefix === patch.prefix)) throw new Error(`no preset with prefix "${patch.prefix}"`);
    const { overrides, clear, model, ...rest } = patch;
    if (rest.draft === false) rest.draft = undefined;
    let next: Overrides = { ...j.overrides };
    if (model === "preset") for (const k of ["model_type", "ai_model"] as const) delete next[k];
    else if (model) {
      if (!modelsFor(j.source).includes(model)) throw new Error(`${model} isn't available for ${j.source === "multi" ? "multi-image" : j.source} cards`);
      next = { ...next, ...modelPatch(mergeOptions(this.preset(j).options, next), model) };
    }
    if (overrides) next = { ...next, ...overrides };
    for (const k of clear ?? []) delete next[k];
    const problems = checkOptions(mergeOptions(this.preset(j).options, next), j.source).filter((m) => !isWarning(m));
    if ((overrides || model) && problems.length) throw new Error(problems[0]);
    this.touch(j, { ...rest, overrides: Object.keys(next).length ? next : undefined });
    if (unsent) { this.fitModel(j); this.reprice(j); }
    if (j.raw && (patch.size || patch.origin || patch.outName)) await this.fit(j);
    await this.save();
  }

  /** Rewrite a Text to 3D card's prompt (its .prompt.txt) before it's sent. */
  async setPrompt(key: string, prompt: string) {
    const j = this.get(key);
    if (j.source !== "text" || !this.unsent(j) || j.where !== "inbox") throw new Error("only an unsent Text to 3D card's prompt can change");
    prompt = prompt.trim();
    if (!prompt || prompt.length > 800) throw new Error("Text to 3D prompts are 1 to 800 characters");
    await Bun.write(this.imagePath(j), prompt + "\n");
    this.touch(j, { prompt });
    await this.save();
  }

  /** The same change on several cards. Cards it doesn't apply to are reported, not failed silently. */
  async editMany(keys: string[], patch: Parameters<Workspace["edit"]>[1]) {
    const skipped: string[] = [];
    for (const k of keys) {
      try { await this.edit(k, patch); } catch (e) { skipped.push(`${this.jobs.get(k)?.outName ?? k}: ${(e as Error).message}`); }
    }
    return skipped;
  }

  /** Move an unsent card's inputs to another organizing folder. */
  async move(key: string, folder: string) {
    const j = this.get(key);
    if (!this.unsent(j)) throw new Error("only unsent cards can move");
    if (!this.folders().includes(folder)) throw new Error(`no such folder: ${folder}`);
    const nk = folder ? `${folder}/${basename(j.key)}` : basename(j.key);
    if (nk === key) return;
    if (this.jobs.has(nk)) throw new Error(`${folder || "the top folder"} already has ${basename(j.key)}`);
    const files = [...this.inputPaths(j), ...this.sidecars(j)];
    const to = this.path(INBOX, folder);
    mkdirSync(to, { recursive: true });
    for (const f of files) renameSync(f, join(to, basename(f)));
    this.jobs.delete(key);
    this.touch(j, { key: nk, folder });
    this.jobs.set(nk, j);
    await this.save();
  }

  /** Several image cards in one folder become one Multi-Image to 3D card (files renamed <base>__1 …). */
  async combine(keys: string[]) {
    const js = keys.map((k) => this.get(k));
    if (js.length < 2 || js.length > MAX_VIEWS) throw new Error(`combine 2 to ${MAX_VIEWS} images (Multi-Image to 3D takes up to ${MAX_VIEWS} views)`);
    if (js.some((j) => j.source !== "image" || !this.unsent(j) || j.where !== "inbox")) throw new Error("only unsent single-image cards can be combined");
    if (new Set(js.map((j) => j.folder)).size > 1) throw new Error("put the views in the same folder first");
    const base = stemOf(js[0]!.file);
    const dir = this.path(INBOX, js[0]!.folder);
    js.forEach((j, i) => {
      const ext = extname(j.file);
      const stem = `${base}__${i + 1}`;
      for (const ref of this.textureRefs(j)) renameSync(ref, join(dir, `${stem}.texture${extname(ref)}`));
      const txt = join(dir, `${stemOf(j.file)}.txt`);
      if (i > 0 && existsSync(txt)) rmSync(txt);
      renameSync(this.imagePath(j), join(dir, `${stem}${ext}`));
      this.jobs.delete(j.key);
    });
    await this.save();
    await this.scan();
    return (js[0]!.folder ? `${js[0]!.folder}/` : "") + `${base}__views`;
  }

  /** A multi-image card back into separate image cards (<base>-1.png …). */
  async split(key: string) {
    const j = this.get(key);
    if (j.source !== "multi" || !this.unsent(j) || j.where !== "inbox") throw new Error("only unsent multi-image cards can be split");
    for (const p of this.inputPaths(j)) {
      const m = VIEW.exec(stemOf(basename(p)))!;
      renameSync(p, join(dirname(p), `${m[1]}-${m[2]}${extname(p)}`));
    }
    this.jobs.delete(key);
    await this.save();
    await this.scan();
  }

  /** Queue new cards (all of them, or the given keys); `draft` sends them without texture. Also lifts a pause. */
  async send(keys?: string[], opts: { draft?: boolean } = {}) {
    this.pause = null;
    for (const j of this.jobs.values()) {
      if (j.state !== "new" || (keys && !keys.includes(j.key))) continue;
      if (opts.draft) { j.draft = true; this.reprice(j); }
      this.touch(j, { state: "queued", error: undefined });
    }
    await this.save();
  }

  /** Finished drafts without a texture, and no texture step waiting. */
  canTexture(j: Job) {
    return j.state === "done" && !j.textured && !!j.modelTask && !(j.ops ?? []).some((o) => (o.kind === "retexture" || o.kind === "refine") && o.state !== "done" && o.state !== "failed");
  }
  private textureOp(j: Job): { kind: "retexture" | "refine"; params: OpParams["retexture"] & OpParams["refine"] } {
    return j.source === "text" && j.modelTask?.kind === "text-to-3d" ? { kind: "refine", params: {} } : { kind: "retexture", params: {} };
  }

  /** Queue the texture step on finished drafts: the given ones, or all of them. */
  async textureModels(keys?: string[]) {
    for (const j of this.jobs.values()) {
      if (!this.canTexture(j) || (keys && !keys.includes(j.key))) continue;
      const t = this.textureOp(j);
      this.addOpTo(j, t.kind, t.params);
    }
    this.pause = null;
    await this.save();
  }

  private addOpTo<K extends OpKind>(j: Job, kind: K, params: OpParams[K]) {
    const merged = kind === "retexture" ? { ...params, options: { ...this.preset(j).retexture, ...(params as OpParams["retexture"]).options } } : params;
    const op: Op = {
      id: newId(), kind, params: merged, state: "queued", progress: 0, createdAt: Date.now(),
      label: kind === "animate" ? (params as OpParams["animate"]).label || OP_LABEL.animate : OP_LABEL[kind],
      estimate: estimateOp(kind, merged as OpParams[K]),
    };
    this.touch(j, { ops: [...(j.ops ?? []), op] });
    return op;
  }

  /** Why a step can't be added to this card, or null. */
  opProblem(j: Job, kind: OpKind, params: OpParams[OpKind]): string | null {
    if (j.state !== "done") return "The card needs a finished model first.";
    const p = checkOp(kind, params);
    if (p.length) return p[0]!;
    const planned = (k: OpKind) => (j.ops ?? []).some((o) => o.kind === k && o.state !== "failed");
    if (kind === "refine" && !(j.source === "text" && j.taskId)) return "Refine is for Text to 3D cards.";
    if (kind === "animate" && !j.rigTaskId && !planned("rig")) return "Rig the character first.";
    if (kind === "rig" && !texturedAfter(j)) return "Meshy rigs textured models: texture it first.";
    if (kind === "animate" && (params as OpParams["animate"]).fromMotion && (j.ops ?? []).at(-1)?.kind !== "motion") return "Add a Text to motion step right before.";
    return null;
  }

  /** Add steps to finished cards (each in order after the card's other steps). */
  async addOp<K extends OpKind>(keys: string[], kind: K, params: OpParams[K]) {
    const skipped: string[] = [];
    for (const k of keys) {
      const j = this.get(k);
      const why = this.opProblem(j, kind, params);
      if (why) { skipped.push(`${j.outName}: ${why}`); continue; }
      this.addOpTo(j, kind, params);
    }
    this.pause = null;
    await this.save();
    return skipped;
  }

  /** Credits these steps would cost on these cards. */
  estimateOp(keys: string[], kind: OpKind, params: OpParams[OpKind]) {
    const js = keys.map((k) => this.get(k)).filter((j) => !this.opProblem(j, kind, params));
    const merged = (j: Job) => kind === "retexture" ? { ...params, options: { ...this.preset(j).retexture, ...(params as OpParams["retexture"]).options } } : params;
    return { count: js.length, credits: js.reduce((n, j) => n + estimateOp(kind, merged(j) as never), 0) };
  }

  /** Retry from the last good step: a failed step, a failed scale (free), or the whole send. */
  async retry(key: string) {
    const j = this.get(key);
    const op = (j.ops ?? []).find((o) => o.state === "failed");
    if (op) {
      Object.assign(op, { state: "queued", taskId: undefined, meshyStatus: undefined, progress: 0, error: undefined });
      this.touch(j, {});
      await this.save();
      return;
    }
    if (j.state !== "failed") return;
    if (j.raw && existsSync(this.path(RAW, j.raw))) { await this.fit(j); await this.save(); return; }
    this.touch(j, { state: "queued", taskId: undefined, meshyStatus: undefined, progress: 0, error: undefined, thumbnail: undefined });
    await this.save();
  }
  /** What a retry would cost. */
  retryCost(j: Job) {
    const op = (j.ops ?? []).find((o) => o.state === "failed");
    if (op) return op.estimate;
    return j.raw ? 0 : j.estimate;
  }

  /** Unqueue, or cancel at Meshy while PENDING (refunded): the newest waiting step first, else the shape. */
  async cancel(key: string, opId?: string) {
    const j = this.get(key);
    const ops = j.ops ?? [];
    const op = opId ? ops.find((o) => o.id === opId) : [...ops].reverse().find((o) => o.state === "queued" || o.state === "running");
    if (op && (op.state === "queued" || op.state === "running")) {
      if (op.state === "running") await this.cancelAt(OP_KIND[op.kind], op.taskId!);
      // Steps after it would have used its result.
      const i = ops.indexOf(op);
      this.touch(j, { ops: ops.filter((o, n) => n < i || o.state === "done") });
      await this.save();
      return;
    }
    if (opId) throw new Error("that step isn't waiting");
    if (j.state === "queued") { this.touch(j, { state: "new" }); await this.save(); return; }
    if (j.state !== "running" || !j.taskId) throw new Error("nothing to cancel");
    await this.cancelAt(this.shapeKind(j), j.taskId);
    this.restore(j);
    this.touch(j, { state: "new", taskId: undefined, meshyStatus: undefined, progress: 0, thumbnail: undefined });
    await this.save();
  }

  /** Drop a step that's finished or failed from the list (its files stay). */
  async dropOp(key: string, opId: string) {
    const j = this.get(key);
    const op = (j.ops ?? []).find((o) => o.id === opId);
    if (!op) return;
    if (op.state === "queued" || op.state === "running") return this.cancel(key, opId);
    this.touch(j, { ops: j.ops!.filter((o) => o !== op) });
    await this.save();
  }

  private async cancelAt(kind: Kind, id: string) {
    try { await this.client().cancel(id, kind); }
    catch (e) {
      if (e instanceof MeshyError && e.status === 409) throw new Error("Meshy has started this one, so it can't be cancelled.");
      throw e;
    }
  }

  private restore(j: Job) {
    if (j.where !== "sent") return;
    const moving = [...this.inputPaths(j), ...this.sidecars(j)];
    j.where = "inbox";
    mkdirSync(this.path(INBOX, j.folder), { recursive: true });
    for (const f of moving) if (existsSync(f)) renameSync(f, this.path(INBOX, j.folder, basename(f)));
  }

  private client() {
    const k = this.key();
    if (!k) throw new MeshyError(401, "no API key");
    return new Meshy(k);
  }

  // Concept images ---------------------------------------------------------------

  async addConcept(kind: Concept["kind"], params: ConceptParams, opts: { folder?: string; name: string; references?: string[] }) {
    const refs = opts.references ?? [];
    const problems = checkConcept(kind, params, refs.length);
    if (problems.length) throw new Error(problems[0]);
    for (const r of refs) this.get(r);
    if (!/^[^/\\:*?"<>|.][^/\\:*?"<>|]*$/.test(opts.name)) throw new Error("give the image a file name");
    const folder = opts.folder ?? "";
    if (!this.folders().includes(folder)) throw new Error(`no such folder: ${folder}`);
    const c: Concept = { id: newId(), kind, params, references: refs.length ? refs : undefined, folder, name: opts.name, state: "queued", progress: 0, estimate: estimateConcept(kind, params.ai_model), createdAt: Date.now() };
    this.concepts.push(c);
    this.pause = null;
    await this.save();
    return c;
  }

  async cancelConcept(id: string) {
    const c = this.concepts.find((x) => x.id === id);
    if (!c) return;
    if (c.state === "running") await this.cancelAt(c.kind, c.taskId!);
    this.concepts = this.concepts.filter((x) => x !== c);
    await this.save();
  }

  // The work loop ---------------------------------------------------------------

  /** Tasks Meshy is holding for us: shapes, steps and concepts share the account's queue limit. */
  private busyAtMeshy() {
    let n = this.concepts.filter((c) => c.state === "running").length;
    for (const j of this.jobs.values()) n += (j.state === "running" ? 1 : 0) + (j.ops ?? []).filter((o) => o.state === "running").length;
    return n;
  }
  /** A card's next step, if every step before it is done. */
  private nextOp(j: Job): Op | undefined {
    if (j.state !== "done") return undefined;
    for (const o of j.ops ?? []) {
      if (o.state === "done") continue;
      return o.state === "queued" ? o : undefined;
    }
    return undefined;
  }

  /** One pass of the work loop: poll running tasks, submit queued ones under the limit. */
  async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.scan();
      const all = [...this.jobs.values()];
      const running = all.filter((j) => j.state === "running");
      const runningOps = all.flatMap((j) => (j.ops ?? []).filter((o) => o.state === "running").map((o) => [j, o] as const));
      const runningConcepts = this.concepts.filter((c) => c.state === "running");
      const queued = all.filter((j) => j.state === "queued");
      const queuedConcepts = this.concepts.filter((c) => c.state === "queued");
      if (!running.length && !runningOps.length && !runningConcepts.length && !queued.length && !queuedConcepts.length && !all.some((j) => this.nextOp(j))) return;
      const meshy = this.client();
      for (const j of running) await this.poll(meshy, j);
      for (const [j, o] of runningOps) await this.pollOp(meshy, j, o);
      for (const c of runningConcepts) await this.pollConcept(meshy, c);
      if (this.pause?.until && this.pause.until <= Date.now()) this.pause = null;
      let slots = this.maxQueued - this.busyAtMeshy();
      for (const c of queuedConcepts) {
        if (slots <= 0 || this.pause) break;
        if (await this.submitConcept(meshy, c)) slots--;
      }
      for (const j of queued) {
        if (slots <= 0 || this.pause) break;
        if (await this.submit(meshy, j)) slots--;
      }
      for (const j of [...this.jobs.values()]) {
        const o = this.nextOp(j);
        if (!o || slots <= 0 || this.pause) continue;
        if (await this.submitOp(meshy, j, o)) slots--;
      }
    } catch (e) {
      this.onMeshyError(e);
    } finally {
      this.busy = false;
    }
  }

  private onMeshyError(e: unknown): boolean {
    if (!(e instanceof MeshyError)) return false;
    if (e.status === 429) this.pause = { reason: e.friendly, until: Date.now() + 10_000 };
    else if (e.status === 401 || e.status === 402) this.pause = { reason: e.friendly + " The batch is paused; press Send to resume." };
    else return false;
    this.version++;
    return true;
  }
  private message(e: unknown) { return e instanceof MeshyError ? e.friendly : String((e as Error).message ?? e); }

  private async submit(meshy: Meshy, j: Job): Promise<boolean> {
    try {
      const spec = this.spec(j);
      const refs = this.textureRefs(j);
      const card: CardInput = { ...this.card(j), textureImage: undefined, textureImages: refs.length ? await Promise.all(refs.map(dataUri)) : undefined };
      let body: object;
      if (j.source === "text") {
        if (!j.prompt) throw new Error("The .prompt.txt is empty.");
        body = textPreviewBody(j.prompt, spec);
      } else if (j.source === "multi") {
        const files = this.inputPaths(j);
        if (files.length > MAX_VIEWS) throw new Error(`Multi-Image to 3D takes 1 to ${MAX_VIEWS} views; this has ${files.length}.`);
        body = multiBody(j.inputTaskId ? { input_task_id: j.inputTaskId } : await Promise.all(files.map(dataUri)), spec, card);
      } else {
        body = createBody(j.inputTaskId ? { input_task_id: j.inputTaskId } : await dataUri(this.imagePath(j)), spec, card);
      }
      const taskId = await meshy.create(body, this.shapeKind(j));
      // The task id is on disk before the inputs move: a crash here never re-buys it.
      this.touch(j, { state: "running", taskId, meshyStatus: "PENDING", progress: 0 });
      await this.save();
      if (j.where === "inbox") {
        const moving = [...this.inputPaths(j), ...this.sidecars(j)];
        const to = this.path(INBOX, SENT, j.folder);
        mkdirSync(to, { recursive: true });
        for (const f of moving) renameSync(f, join(to, basename(f)));
        j.where = "sent";
        await this.save();
      }
      return true;
    } catch (e) {
      if (this.onMeshyError(e)) return false;
      this.touch(j, { state: "failed", error: this.message(e) });
      await this.save();
      return false;
    }
  }

  private async poll(meshy: Meshy, j: Job) {
    let t: Task;
    try { t = await meshy.get(j.taskId!, this.shapeKind(j)); }
    catch (e) {
      if (this.onMeshyError(e)) return;
      if (e instanceof MeshyError && e.status === 404) { this.touch(j, { state: "failed", error: "Meshy no longer has this task." }); await this.save(); }
      return;
    }
    const before = `${j.meshyStatus}/${j.progress}/${j.thumbnail}`;
    this.touch(j, { meshyStatus: t.status, progress: t.progress ?? j.progress, thumbnail: t.thumbnail_url ?? j.thumbnail, credits: t.consumed_credits ?? j.credits });
    if (t.status === "FAILED" || t.status === "CANCELED") {
      this.touch(j, { state: "failed", error: t.task_error?.message || `Meshy marked it ${t.status.toLowerCase()}.` });
    } else if (t.status === "SUCCEEDED") {
      try {
        await this.saveModels(j, t);
        const textured = j.source !== "text" && !j.draft && this.spec(j).options.should_texture !== false;
        this.touch(j, { state: "downloaded", textured, modelTask: { kind: this.shapeKind(j), id: j.taskId! } });
        // Text to 3D makes the shape first; the texture is its refine step.
        if (j.source === "text" && !j.draft) this.addOpTo(j, "refine", {});
        await this.save();
        await this.fit(j);
      } catch (e) {
        this.touch(j, { state: "failed", error: (e as Error).message });
      }
    } else if (`${j.meshyStatus}/${j.progress}/${j.thumbnail}` === before) return;
    await this.save();
  }

  /** A step's input: the previous model's task id when this endpoint takes it, else the model file itself. */
  private async modelInput(j: Job, kind: OpKind): Promise<Record<string, string>> {
    const accepts = ACCEPTS[kind];
    if (j.modelTask && (!accepts || accepts.includes(j.modelTask.kind))) return { input_task_id: j.modelTask.id };
    if (!j.raw) throw new Error("No model file to send.");
    const bytes = await Bun.file(this.path(RAW, j.raw)).bytes();
    return { model_url: `data:application/octet-stream;base64,${Buffer.from(bytes).toString("base64")}` };
  }

  private async submitOp(meshy: Meshy, j: Job, op: Op): Promise<boolean> {
    try {
      const spec = this.spec(j);
      const fmts = spec.formats ?? [];
      let body: object;
      switch (op.kind) {
        case "retexture": {
          const p = op.params as OpParams["retexture"];
          const ref = this.textureRefs(j)[0];
          const prompt = p.style === "prompt" ? p.prompt : j.texturePrompt ?? (j.source === "text" ? j.prompt : undefined);
          const style = prompt && p.style !== "image" ? { prompt } : { imageDataUri: await dataUri(ref ?? this.imagePath(j)) };
          const input = await this.modelInput(j, "retexture");
          body = retextureBody(input.input_task_id ?? { model_url: input.model_url! }, p.options as RetextureOptions, style, fmts);
          break;
        }
        case "refine": {
          const ref = this.textureRefs(j)[0];
          const p = op.params as OpParams["refine"];
          body = textRefineBody(j.taskId!, { ...spec, retexture: { ...spec.retexture, ...p.options } }, { texturePrompt: j.texturePrompt, textureImage: ref ? await dataUri(ref) : undefined });
          break;
        }
        case "rig": {
          const p = op.params as OpParams["rig"];
          const h = p.height_meters ?? ("height" in j.size ? j.size.height : undefined);
          body = { ...(await this.modelInput(j, "rig")), ...opBody("rig", { height_meters: h }) };
          break;
        }
        case "motion": body = opBody("motion", op.params as OpParams["motion"]); break;
        case "animate": {
          const p = op.params as OpParams["animate"];
          if (!j.rigTaskId) throw new Error("Rig the character first.");
          const prev = j.ops![j.ops!.indexOf(op) - 1];
          if (p.fromMotion && !(prev?.kind === "motion" && prev.taskId)) throw new Error("The text-to-motion step before this one is missing.");
          body = { rig_task_id: j.rigTaskId, ...(p.fromMotion ? { motion_task_id: prev!.taskId } : {}), ...opBody("animate", p) };
          break;
        }
        default: body = { ...(await this.modelInput(j, op.kind)), ...opBody(op.kind, op.params as never) };
      }
      const taskId = await meshy.create(body, OP_KIND[op.kind]);
      Object.assign(op, { state: "running", taskId, meshyStatus: "PENDING", progress: 0 });
      this.touch(j, {});
      await this.save();
      return true;
    } catch (e) {
      if (this.onMeshyError(e)) return false;
      Object.assign(op, { state: "failed", error: this.message(e) });
      this.touch(j, {});
      await this.save();
      return false;
    }
  }

  private async pollOp(meshy: Meshy, j: Job, op: Op) {
    let t: Task;
    try { t = await meshy.get(op.taskId!, OP_KIND[op.kind]); }
    catch (e) {
      if (this.onMeshyError(e)) return;
      if (e instanceof MeshyError && e.status === 404) { Object.assign(op, { state: "failed", error: "Meshy no longer has this task." }); this.touch(j, {}); await this.save(); }
      return;
    }
    const before = `${op.meshyStatus}/${op.progress}`;
    Object.assign(op, { meshyStatus: t.status, progress: t.progress ?? op.progress, credits: t.consumed_credits ?? op.credits });
    if (t.thumbnail_url && MAKES_MODEL.includes(op.kind)) j.thumbnail = t.thumbnail_url;
    if (t.status === "FAILED" || t.status === "CANCELED") {
      Object.assign(op, { state: "failed", error: t.task_error?.message || `Meshy marked it ${t.status.toLowerCase()}.` });
    } else if (t.status === "SUCCEEDED") {
      try {
        await this.saveOpResult(j, op, t);
        Object.assign(op, { state: "done", progress: 100 });
      } catch (e) {
        Object.assign(op, { state: "failed", error: (e as Error).message });
      }
    } else if (`${op.meshyStatus}/${op.progress}` === before) return;
    this.touch(j, {});
    await this.save();
  }

  private base(j: Job) { return (j.raw ?? this.outPath(j, RAW)).replace(/\.glb$/, ""); }

  /** Write a step's files and move the card's model forward. */
  private async saveOpResult(j: Job, op: Op, t: Task) {
    const base = this.base(j);
    const files: string[] = [];
    const get = async (rel: string, url: unknown) => {
      if (typeof url !== "string" || !url) return;
      await Bun.write(this.path(RAW, rel), await download(url));
      files.push(rel);
    };
    const toReady = (ready: string) => {
      mkdirSync(dirname(this.path(READY, ready)), { recursive: true });
      copyFileSync(this.path(RAW, ready), this.path(READY, ready));
      j.readyExtras = [...new Set([...(j.readyExtras ?? []), ready])].sort();
      this.copyOut(j, ready);
    };
    if (MAKES_MODEL.includes(op.kind)) {
      await this.saveModels(j, t);
      j.modelTask = { kind: OP_KIND[op.kind], id: op.taskId! };
      if (op.kind === "retexture" || op.kind === "refine") j.textured = true;
      if (op.kind === "uv-unwrap") j.textured = false;
      // Meshy resized it: keep its size and origin in 002.
      if (op.kind === "resize") j.size = { auto: true };
      await this.fit(j);
    } else if (op.kind === "convert") {
      for (const [fmt, url] of Object.entries(t.model_urls ?? {})) await get(`${base}.${fmt === "glb" ? "converted.glb" : fmt}`, url);
    } else if (op.kind === "rig") {
      const r = (t.result ?? {}) as Record<string, unknown>;
      await get(`${base}.rigged.glb`, r.rigged_character_glb_url);
      await get(`${base}.rigged.fbx`, r.rigged_character_fbx_url);
      const anims = (r.basic_animations ?? {}) as Record<string, unknown>;
      for (const [k, url] of Object.entries(anims)) {
        const m = /^(\w+?)_(armature_glb|glb|fbx)_url$/.exec(k);
        if (m) await get(`${base}.${m[1]}${m[2] === "armature_glb" ? ".armature.glb" : `.${m[2]}`}`, url);
      }
      j.rigTaskId = op.taskId;
      for (const f of files.filter((f) => f.endsWith(".glb") && !f.endsWith(".armature.glb"))) toReady(f);
    } else if (op.kind === "motion") {
      const r = (t.result ?? {}) as Record<string, unknown>;
      await get(`${base}.motion-${op.id}.${r.motion_format === "bvh" ? "bvh" : "fbx"}`, r.motion_url);
    } else if (op.kind === "animate") {
      const r = (t.result ?? {}) as Record<string, unknown>;
      const slug = op.label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || op.id;
      await get(`${base}.anim-${slug}.glb`, r.animation_glb_url);
      await get(`${base}.anim-${slug}.fbx`, r.animation_fbx_url);
      await get(`${base}.anim-${slug}.usdz`, r.processed_usdz_url);
      await get(`${base}.anim-${slug}.armature.fbx`, r.processed_armature_fbx_url);
      await get(`${base}.anim-${slug}.fps.fbx`, r.processed_animation_fps_fbx_url);
      for (const f of files.filter((f) => f.endsWith(".glb"))) toReady(f);
    }
    if (files.length) j.extras = [...new Set([...(j.extras ?? []), ...files])].sort();
    op.files = files.length ? files : undefined;
  }

  private async submitConcept(meshy: Meshy, c: Concept): Promise<boolean> {
    try {
      const refs = await Promise.all((c.references ?? []).map((k) => dataUri(this.imagePath(this.get(k)))));
      const taskId = await meshy.create(conceptBody(c.kind, c.params, refs), c.kind);
      Object.assign(c, { state: "running", taskId, meshyStatus: "PENDING", progress: 0 });
      await this.save();
      return true;
    } catch (e) {
      if (this.onMeshyError(e)) return false;
      Object.assign(c, { state: "failed", error: this.message(e) });
      await this.save();
      return false;
    }
  }

  private async pollConcept(meshy: Meshy, c: Concept) {
    let t: Task;
    try { t = await meshy.get(c.taskId!, c.kind); }
    catch (e) {
      if (this.onMeshyError(e)) return;
      if (e instanceof MeshyError && e.status === 404) { Object.assign(c, { state: "failed", error: "Meshy no longer has this task." }); await this.save(); }
      return;
    }
    const before = `${c.meshyStatus}/${c.progress}`;
    Object.assign(c, { meshyStatus: t.status, progress: t.progress ?? c.progress, credits: t.consumed_credits ?? c.credits });
    if (t.status === "FAILED" || t.status === "CANCELED") {
      Object.assign(c, { state: "failed", error: t.task_error?.message || `Meshy marked it ${t.status.toLowerCase()}.` });
    } else if (t.status === "SUCCEEDED") {
      try {
        const urls = t.image_urls ?? [];
        if (!urls.length) throw new Error("Meshy finished without an image.");
        const dir = this.path(INBOX, c.folder);
        mkdirSync(dir, { recursive: true });
        let name = c.name;
        for (let n = 2; [`${name}.png`, `${name}__1.png`].some((f) => existsSync(join(dir, f)) || existsSync(this.path(INBOX, SENT, c.folder, f))); n++) name = `${c.name}_${n}`;
        // Several views of one subject become one multi-image card.
        const files = urls.length === 1 ? [`${name}.png`] : urls.map((_, i) => `${name}__${i + 1}.png`);
        for (let i = 0; i < urls.length; i++) {
          await Bun.write(join(dir, files[i]!), await download(urls[i]!));
          this.origins[c.folder ? `${c.folder}/${files[i]}` : files[i]!] = c.taskId!;
        }
        Object.assign(c, { state: "done", progress: 100, files });
        await this.save();
        await this.scan();
      } catch (e) {
        Object.assign(c, { state: "failed", error: (e as Error).message });
      }
    } else if (`${c.meshyStatus}/${c.progress}` === before) return;
    await this.save();
  }

  /**
   * A succeeded task's model files into 001: the .glb (always), the preset's extra formats, the
   * pre-remesh model, and the texture maps when a non-glb format wants them beside it.
   * Meshy's links expire, so this runs as soon as the task succeeds.
   */
  private async saveModels(j: Job, t: Task) {
    const glb = t.model_urls?.glb;
    if (!glb) throw new Error("Meshy finished without a .glb.");
    const raw = j.raw ?? this.outPath(j, RAW);
    try { await Bun.write(this.path(RAW, raw), await download(glb)); }
    catch (e) { throw new Error(`Download failed: ${(e as Error).message}`); }
    j.raw = raw;
    const base = raw.replace(/\.glb$/, "");
    const extras = new Set(j.extras ?? []);
    // Every other format Meshy made: only ever the ones asked for (the preset's, or a step's).
    const other = Object.entries(t.model_urls ?? {}).filter(([f, u]) => u && f !== "glb" && f !== "pre_remeshed_glb");
    const files: [string, string | undefined][] = other.map(([f, u]) => [`${base}.${f}`, u]);
    files.push([`${base}.pre_remesh.glb`, t.model_urls?.pre_remeshed_glb]);
    if (other.some(([f]) => f !== "stl" && f !== "3mf")) {
      for (const [map, url] of Object.entries(t.texture_urls?.[0] ?? {})) files.push([`${base}.textures/${map}.png`, url]);
    }
    for (const [view, url] of Object.entries(t.thumbnail_urls ?? {})) files.push([`${base}.views/${view}.png`, url]);
    if (t.alpha_thumbnail_url) files.push([`${base}.alpha.png`, t.alpha_thumbnail_url]);
    for (const [rel, url] of files) {
      if (!url) continue;
      try { await Bun.write(this.path(RAW, rel), await download(url)); extras.add(rel); }
      catch (e) { console.error(`[meshy-studio] extra file ${rel}`, e); }
    }
    j.extras = extras.size ? [...extras].sort() : undefined;
  }

  /** <folder>/<outName>.glb, with _2, _3 when another card already owns that name. */
  private outPath(j: Job, stage: typeof RAW | typeof READY): string {
    const field = stage === RAW ? "raw" : "ready";
    const taken = new Set([...this.jobs.values()].filter((o) => o !== j).map((o) => o[field]));
    const base = j.folder ? `${j.folder}/${j.outName}` : j.outName;
    for (let n = 1; ; n++) {
      const p = `${base}${n === 1 ? "" : `_${n}`}.glb`;
      if (!taken.has(p)) return p;
    }
  }

  /** 001 -> 002: scale and set the origin (Meshy's own size guess is kept as it came). Free, so it reruns whenever the card changes. */
  private async fit(j: Job) {
    try {
      const raw = await Bun.file(this.path(RAW, j.raw!)).bytes();
      const out = "auto" in j.size ? raw : (await fitGlb(raw, j.size, j.origin)).glb;
      const ready = this.outPath(j, READY);
      if (j.ready && j.ready !== ready) {
        rmSync(this.path(READY, j.ready), { force: true });
        if (this.sync) rmSync(join(this.sync.dir, j.ready), { force: true });
      }
      await Bun.write(this.path(READY, ready), out);
      this.touch(j, { state: "done", ready, error: undefined });
      this.copyOut(j, ready);
    } catch (e) {
      this.touch(j, { state: "failed", error: `Scaling failed: ${(e as Error).message}` });
    }
  }

  /** A file in 002, copied to the engine folder too. A copy that fails never fails the card. */
  private copyOut(_j: Job, rel: string) {
    if (!this.sync) return;
    try {
      const to = join(this.sync.dir, rel);
      mkdirSync(dirname(to), { recursive: true });
      copyFileSync(this.path(READY, rel), to);
    } catch (e) {
      console.error("[meshy-studio] copy to engine folder", e);
    }
  }

  /** Send finished models to a game engine's folder as well (null to stop). Copies what's done already. */
  async setSync(sync: Sync | null) {
    if (sync) {
      sync = { ...sync, dir: resolve(sync.dir) };
      if (sync.dir === this.dir || sync.dir.startsWith(this.dir + "/")) throw new Error("pick a folder outside this workspace");
      mkdirSync(sync.dir, { recursive: true });
    }
    this.sync = sync;
    await Bun.write(this.path(CONFIG), JSON.stringify({ sync }, null, 2) + "\n");
    for (const j of this.jobs.values()) {
      if (j.state !== "done") continue;
      for (const f of [j.ready, ...(j.readyExtras ?? [])]) if (f) this.copyOut(j, f);
    }
    this.version++;
  }

  /** Replace the presets (the editor saves through here). Unsent cards whose preset went away fall back to Default. */
  async setPresets(list: Preset[]) {
    if (!Array.isArray(list) || !list.length) throw new Error("keep at least one preset");
    const prefixes = list.map((p) => p.prefix);
    if (!prefixes.includes("")) throw new Error("keep the Default preset (empty prefix): it catches every unlabelled image");
    const dupe = prefixes.find((p, i) => prefixes.indexOf(p) !== i);
    if (dupe !== undefined) throw new Error(`two presets use the prefix "${dupe}"`);
    for (const p of list) {
      if (!p.label?.trim()) throw new Error("every preset needs a name");
      const bad = checkPreset(p).filter((m) => !isWarning(m));
      if (bad.length) throw new Error(`${p.label}: ${bad[0]}`);
    }
    this.presets = list;
    await Bun.write(this.path(PRESETS), JSON.stringify(list, null, 2) + "\n");
    for (const j of this.jobs.values()) {
      if (!this.unsent(j)) continue;
      if (!prefixes.includes(j.prefix)) j.prefix = "";
      this.reprice(j);
    }
    await this.save();
  }

  /** Credits a send of these unsent cards would cost (all new cards when no keys), optionally as drafts. */
  estimate(keys?: string[], opts: { draft?: boolean } = {}) {
    const js = [...this.jobs.values()].filter((j) => j.state === "new" && (!keys || keys.includes(j.key)));
    const cost = (j: Job) => opts.draft ? this.price(j, this.spec(j).options, true) : j.estimate;
    return { count: js.length, credits: js.reduce((n, j) => n + cost(j), 0) };
  }

  /** Credits the texture step on these finished drafts would cost. */
  estimateTexture(keys?: string[]) {
    const js = [...this.jobs.values()].filter((j) => this.canTexture(j) && (!keys || keys.includes(j.key)));
    return { count: js.length, credits: js.reduce((n, j) => n + estimateRetexture(this.preset(j).retexture), 0) };
  }

  /** What each model would cost on this card, textured and as a draft. */
  private modelCosts(j: Job) {
    const base = this.spec(j).options;
    return Object.fromEntries(modelsFor(j.source).map((id) => {
      const o = mergeOptions(base, modelPatch(base, id));
      return [id, { full: this.price(j, o, false), draft: this.price(j, o, true), problems: checkOptions(o, j.source).filter((m) => !isWarning(m)) }];
    })) as Record<ModelId, { full: number; draft: number; problems: string[] }>;
  }

  summary() {
    const jobs = [...this.jobs.values()].sort((a, b) => a.folder.localeCompare(b.folder) || a.key.localeCompare(b.key));
    return {
      dir: this.dir, name: basename(this.dir), version: this.version, pause: this.pause, maxQueued: this.maxQueued,
      folders: this.folders(), presets: this.presets, sync: this.sync,
      concepts: this.concepts,
      spent: jobs.reduce((n, j) => n + (j.credits ?? 0) + (j.ops ?? []).reduce((m, o) => m + (o.credits ?? 0), 0), 0)
        + this.concepts.reduce((n, c) => n + (c.credits ?? 0), 0),
      jobs: jobs.map((j) => {
        const spec = this.spec(j);
        return {
          ...j, sizeText: describeSize(j.size), presetLabel: this.preset(j).label,
          options: spec.options, model: (MODEL_CHOICES.find((c) => c.id === modelOf(spec.options)) ?? MODEL_CHOICES[0]).id,
          modelCosts: this.unsent(j) ? this.modelCosts(j) : undefined,
          draftEstimate: this.price(j, spec.options, true),
          textureEstimate: estimateRetexture(this.preset(j).retexture),
          problems: this.unsent(j) ? checkOptions(spec.options, j.source) : [],
          canTexture: this.canTexture(j),
        };
      }),
    };
  }
}
