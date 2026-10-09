// A workspace is a folder with four stages and a ledger:
//
//   000_to_be_meshyd/               drop images here (subfolders are kept all the way through)
//   000_to_be_meshyd/already done/  images move here once Meshy has them
//   001_has_been_meshyd/            the raw .glb from Meshy, untouched (plus any extra formats)
//   002_ready/                      the scaled, origin-fixed copy
//   meshy-jobs.json                 one row per image: the ledger
//   meshy-presets.json              the presets, editable and shareable
//
// Beside an image, <stem>.txt holds a texture prompt and <stem>.texture.png a texture
// reference image.
//
// Each image has two tracks. The shape (Image to 3D) runs first; a draft is sent
// without texture, and its Texture track (Retexture) can run later, only on the
// models worth keeping. The ledger is written before any file moves, so quitting
// mid-batch loses nothing and never sends an image twice.

import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { describeSize, IMAGE_EXT, parseLabel, TEXTURE_REF } from "./labels.ts";
import { download, Meshy, MeshyError, type Kind, type Task } from "./meshy.ts";
import {
  checkPreset, createBody, estimateCredits, estimateRetexture, presetFor, retextureBody, STARTER_PRESETS,
  type CardInput, type Origin, type Preset, type Size,
} from "./presets.ts";
import { fitGlb } from "./fit.ts";

export const INBOX = "000_to_be_meshyd";
export const SENT = "already done";
export const RAW = "001_has_been_meshyd";
export const READY = "002_ready";
export const LEDGER = "meshy-jobs.json";
export const PRESETS = "meshy-presets.json";
export const CONFIG = "meshy-studio.json";

/** Where finished models also go, so the game engine picks them up. */
export type Engine = "unity" | "unreal" | "blender" | "folder";
export interface Sync { dir: string; engine: Engine }

export type JobState = "new" | "queued" | "running" | "downloaded" | "done" | "failed";

/** The Texture step on a finished draft. */
export interface TextureTrack {
  state: "queued" | "running" | "done" | "failed";
  taskId?: string;
  meshyStatus?: Task["status"];
  progress: number;
  estimate: number;
  credits?: number;
  error?: string;
}

export interface Job {
  /** Path under 000 when the image was found, "/"-separated. Stable id. */
  key: string;
  folder: string;
  file: string;
  /** Where the image sits now: in 000, or in 000/already done. */
  where: "inbox" | "sent";
  prefix: string;
  outName: string;
  size: Size;
  origin: Origin;
  texturePrompt?: string;
  /** A <stem>.texture.png sits beside the image. */
  textureImage?: boolean;
  /** Shape only; texture later. */
  draft?: boolean;
  /** Whether the model in 001 has Meshy's texture on it. */
  textured?: boolean;
  state: JobState;
  taskId?: string;
  meshyStatus?: Task["status"];
  progress: number;
  thumbnail?: string;
  error?: string;
  estimate: number;
  credits?: number;
  texture?: TextureTrack;
  /** Paths under 001 and 002 once written. */
  raw?: string;
  ready?: string;
  /** Extra files from Meshy in 001: other formats, texture maps, the pre-remesh model. */
  extras?: string[];
  createdAt: number;
  updatedAt: number;
}

export interface Pause { reason: string; until?: number }

const mime = (f: string) => /\.png$/i.test(f) ? "image/png" : "image/jpeg";
const dataUri = async (path: string) => `data:${mime(path)};base64,${Buffer.from(await Bun.file(path).bytes()).toString("base64")}`;
const textureRefFor = (imagePath: string) => ["png", "jpg", "jpeg"].map((e) => imagePath.replace(IMAGE_EXT, `.texture.${e}`)).find(existsSync);

export class Workspace {
  readonly dir: string;
  jobs = new Map<string, Job>();
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
      for (const j of Object.values(l.jobs ?? {}) as Job[]) this.jobs.set(j.key, j);
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
    await Bun.write(tmp, JSON.stringify({ version: 1, jobs: Object.fromEntries(this.jobs) }, null, 2));
    renameSync(tmp, this.path(LEDGER));
  }

  private touch(j: Job, patch: Partial<Job>) { Object.assign(j, patch, { updatedAt: Date.now() }); }
  private card(j: Job): CardInput { return { texturePrompt: j.texturePrompt, textureImage: j.textureImage ? "yes" : undefined, draft: j.draft }; }
  private reprice(j: Job) { j.estimate = estimateCredits(this.preset(j).options, this.card(j)); }

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

  /** Find images in 000 the ledger doesn't know, and forget unsent jobs whose image is gone. */
  async scan() {
    let changed = false;
    const seen = new Set<string>();
    for (const folder of this.folders()) {
      for (const name of readdirSync(this.path(INBOX, folder))) {
        if (!IMAGE_EXT.test(name) || TEXTURE_REF.test(name) || name.startsWith(".")) continue;
        const key = folder ? `${folder}/${name}` : name;
        seen.add(key);
        const old = this.jobs.get(key);
        // An image dropped again after its job finished is a new job.
        if (old && !(old.where === "sent" && (old.state === "done" || old.state === "failed"))) {
          // Sidecars can be added or removed until it's sent.
          if (old.state === "new" && old.where === "inbox") changed = (await this.readSidecars(old)) || changed;
          continue;
        }
        this.jobs.set(key, await this.newJob(folder, name));
        changed = true;
      }
    }
    for (const j of this.jobs.values()) {
      if (j.where === "inbox" && (j.state === "new" || j.state === "queued") && !seen.has(j.key)) { this.jobs.delete(j.key); changed = true; }
    }
    if (changed) await this.save();
  }

  /** <stem>.txt is a texture prompt, <stem>.texture.png a texture reference image. True if either changed. */
  private async readSidecars(j: Job): Promise<boolean> {
    const img = this.imagePath(j);
    const txt = img.replace(IMAGE_EXT, ".txt");
    const prompt = existsSync(txt) ? (await Bun.file(txt).text()).trim() || undefined : undefined;
    const ref = !!textureRefFor(img) || undefined;
    if (prompt === j.texturePrompt && ref === j.textureImage) return false;
    j.texturePrompt = prompt;
    j.textureImage = ref;
    this.reprice(j);
    return true;
  }

  private async newJob(folder: string, file: string): Promise<Job> {
    const label = parseLabel(file, this.presets);
    const now = Date.now();
    const j: Job = {
      key: folder ? `${folder}/${file}` : file, folder, file, where: "inbox",
      prefix: label.preset.prefix, outName: label.outName, size: label.size, origin: label.origin,
      draft: label.draft || undefined, state: "new", progress: 0, estimate: 0, createdAt: now, updatedAt: now,
    };
    await this.readSidecars(j);
    this.reprice(j);
    return j;
  }

  preset(j: Job) { return this.presets.find((p) => p.prefix === j.prefix) ?? presetFor("", this.presets); }
  imagePath(j: Job) { return j.where === "inbox" ? this.path(INBOX, j.folder, j.file) : this.path(INBOX, SENT, j.folder, j.file); }

  get(key: string): Job {
    const j = this.jobs.get(key);
    if (!j) throw new Error(`no such job: ${key}`);
    return j;
  }

  /** Change a card. Before sending: anything. After the model is down: size, origin and name re-fit for free. */
  async edit(key: string, patch: { prefix?: string; size?: Size; origin?: Origin; outName?: string; texturePrompt?: string; draft?: boolean }) {
    const j = this.get(key);
    const unsent = j.state === "new" || (j.state === "failed" && !j.taskId);
    if (!unsent && (patch.prefix !== undefined || patch.texturePrompt !== undefined || patch.draft !== undefined)) throw new Error("already sent to Meshy; only size, origin and name can change now");
    if (!unsent && patch.size && "auto" in patch.size) throw new Error("Meshy's size guess is made when the image is sent; pick meters now");
    if (patch.outName !== undefined && !/^[^/\\:*?"<>|]+$/.test(patch.outName)) throw new Error("that name has characters a file can't have");
    if (patch.prefix !== undefined && !this.presets.some((p) => p.prefix === patch.prefix)) throw new Error(`no preset with prefix "${patch.prefix}"`);
    if (patch.draft === false) patch.draft = undefined;
    this.touch(j, patch);
    if (unsent) this.reprice(j);
    if (j.raw && (patch.size || patch.origin || patch.outName)) await this.fit(j);
    await this.save();
  }

  /** Move an unsent image to another organizing folder. */
  async move(key: string, folder: string) {
    const j = this.get(key);
    if (j.state !== "new" && j.state !== "failed") throw new Error("only unsent images can move");
    if (!this.folders().includes(folder)) throw new Error(`no such folder: ${folder}`);
    const nk = folder ? `${folder}/${j.file}` : j.file;
    if (nk === key) return;
    if (this.jobs.has(nk)) throw new Error(`${folder || "the top folder"} already has ${j.file}`);
    const from = this.imagePath(j);
    const sides = [from.replace(IMAGE_EXT, ".txt"), textureRefFor(from)].filter((p): p is string => !!p && existsSync(p));
    j.folder = folder;
    const to = this.imagePath(j);
    mkdirSync(dirname(to), { recursive: true });
    renameSync(from, to);
    for (const s of sides) renameSync(s, join(dirname(to), basename(s)));
    this.jobs.delete(key);
    this.touch(j, { key: nk });
    this.jobs.set(nk, j);
    await this.save();
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

  /** Finished models still without texture, which the Texture step can take. */
  canTexture(j: Job) { return j.state === "done" && !j.textured && !!j.taskId && (!j.texture || j.texture.state === "failed"); }

  /** Queue the Texture step (Retexture) on finished drafts: the given ones, or all of them. */
  async textureModels(keys?: string[]) {
    this.pause = null;
    for (const j of this.jobs.values()) {
      if (!this.canTexture(j) || (keys && !keys.includes(j.key))) continue;
      this.touch(j, { texture: { state: "queued", progress: 0, estimate: estimateRetexture(this.preset(j).retexture) } });
    }
    await this.save();
  }

  /** Retry from the last good step: re-fit if the model is already down, else send again. */
  async retry(key: string) {
    const j = this.get(key);
    if (j.texture?.state === "failed") {
      this.touch(j, { texture: { state: "queued", progress: 0, estimate: j.texture.estimate } });
      await this.save();
      return;
    }
    if (j.state !== "failed") return;
    if (j.raw && existsSync(this.path(RAW, j.raw))) { await this.fit(j); await this.save(); return; }
    this.touch(j, { state: "queued", taskId: undefined, meshyStatus: undefined, progress: 0, error: undefined, thumbnail: undefined });
    await this.save();
  }

  /** Unqueue, or cancel at Meshy while PENDING (refunded). A cancelled shape's image goes back to 000. */
  async cancel(key: string) {
    const j = this.get(key);
    const t = j.texture;
    if (t && (t.state === "queued" || t.state === "running")) {
      if (t.state === "running") await this.cancelAt("retexture", t.taskId!);
      this.touch(j, { texture: undefined });
      await this.save();
      return;
    }
    if (j.state === "queued") { this.touch(j, { state: "new" }); await this.save(); return; }
    if (j.state !== "running" || !j.taskId) throw new Error("nothing to cancel");
    await this.cancelAt("image-to-3d", j.taskId);
    this.restore(j);
    this.touch(j, { state: "new", taskId: undefined, meshyStatus: undefined, progress: 0, thumbnail: undefined });
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
    const from = this.imagePath(j);
    j.where = "inbox";
    if (existsSync(from)) { mkdirSync(dirname(this.imagePath(j)), { recursive: true }); renameSync(from, this.imagePath(j)); }
  }

  private client() {
    const k = this.key();
    if (!k) throw new MeshyError(401, "no API key");
    return new Meshy(k);
  }

  /** Tasks Meshy is holding for us: shapes and textures share the account's queue limit. */
  private busyAtMeshy() { return [...this.jobs.values()].filter((j) => j.state === "running" || j.texture?.state === "running").length; }

  /** One pass of the work loop: poll running tasks, submit queued ones under the limit. */
  async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.scan();
      const all = [...this.jobs.values()];
      const running = all.filter((j) => j.state === "running");
      const texturing = all.filter((j) => j.texture?.state === "running");
      const queued = all.filter((j) => j.state === "queued");
      const toTexture = all.filter((j) => j.texture?.state === "queued");
      if (!running.length && !texturing.length && !queued.length && !toTexture.length) return;
      const meshy = this.client();
      for (const j of running) await this.poll(meshy, j);
      for (const j of texturing) await this.pollTexture(meshy, j);
      if (this.pause?.until && this.pause.until <= Date.now()) this.pause = null;
      let slots = this.maxQueued - this.busyAtMeshy();
      for (const j of queued) {
        if (slots <= 0 || this.pause) break;
        if (await this.submit(meshy, j)) slots--;
      }
      for (const j of toTexture) {
        if (slots <= 0 || this.pause) break;
        if (await this.submitTexture(meshy, j)) slots--;
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

  private async submit(meshy: Meshy, j: Job): Promise<boolean> {
    const img = this.imagePath(j);
    try {
      const ref = textureRefFor(img);
      const card = { ...this.card(j), textureImage: ref ? await dataUri(ref) : undefined };
      const taskId = await meshy.create(createBody(await dataUri(img), this.preset(j), card));
      // The task id is on disk before the image moves: a crash here never re-buys it.
      this.touch(j, { state: "running", taskId, meshyStatus: "PENDING", progress: 0 });
      await this.save();
      if (j.where === "inbox") {
        const to = this.path(INBOX, SENT, j.folder, j.file);
        const sides = [img.replace(IMAGE_EXT, ".txt"), ref].filter((p): p is string => !!p && existsSync(p));
        mkdirSync(dirname(to), { recursive: true });
        renameSync(img, to);
        for (const s of sides) renameSync(s, join(dirname(to), basename(s)));
        j.where = "sent";
        await this.save();
      }
      return true;
    } catch (e) {
      if (this.onMeshyError(e)) return false;
      this.touch(j, { state: "failed", error: e instanceof MeshyError ? e.friendly : String((e as Error).message ?? e) });
      await this.save();
      return false;
    }
  }

  /** Style for the Texture step: the card's prompt, else its texture image, else the concept image itself. */
  private async submitTexture(meshy: Meshy, j: Job): Promise<boolean> {
    const t = j.texture!;
    try {
      const img = this.imagePath(j);
      const ref = textureRefFor(img);
      const style = j.texturePrompt ? { prompt: j.texturePrompt } : { imageDataUri: await dataUri(ref ?? img) };
      const p = this.preset(j);
      const taskId = await meshy.create(retextureBody(j.taskId!, p.retexture, style, p.formats), "retexture");
      this.touch(j, { texture: { ...t, state: "running", taskId, meshyStatus: "PENDING", progress: 0 } });
      await this.save();
      return true;
    } catch (e) {
      if (this.onMeshyError(e)) return false;
      this.touch(j, { texture: { ...t, state: "failed", error: e instanceof MeshyError ? e.friendly : String((e as Error).message ?? e) } });
      await this.save();
      return false;
    }
  }

  private async poll(meshy: Meshy, j: Job) {
    let t: Task;
    try { t = await meshy.get(j.taskId!); }
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
        this.touch(j, { state: "downloaded", textured: !j.draft && this.preset(j).options.should_texture !== false });
        await this.save();
        await this.fit(j);
      } catch (e) {
        this.touch(j, { state: "failed", error: (e as Error).message });
      }
    } else if (`${j.meshyStatus}/${j.progress}/${j.thumbnail}` === before) return;
    await this.save();
  }

  private async pollTexture(meshy: Meshy, j: Job) {
    const tex = j.texture!;
    let t: Task;
    try { t = await meshy.get(tex.taskId!, "retexture"); }
    catch (e) {
      if (this.onMeshyError(e)) return;
      if (e instanceof MeshyError && e.status === 404) { this.touch(j, { texture: { ...tex, state: "failed", error: "Meshy no longer has this task." } }); await this.save(); }
      return;
    }
    const before = `${tex.meshyStatus}/${tex.progress}`;
    const next: TextureTrack = { ...tex, meshyStatus: t.status, progress: t.progress ?? tex.progress, credits: t.consumed_credits ?? tex.credits };
    this.touch(j, { texture: next, thumbnail: t.thumbnail_url ?? j.thumbnail });
    if (t.status === "FAILED" || t.status === "CANCELED") {
      this.touch(j, { texture: { ...next, state: "failed", error: t.task_error?.message || `Meshy marked it ${t.status.toLowerCase()}.` } });
    } else if (t.status === "SUCCEEDED") {
      try {
        await this.saveModels(j, t);
        this.touch(j, { textured: true, texture: { ...next, state: "done", progress: 100 } });
        await this.save();
        await this.fit(j);
      } catch (e) {
        this.touch(j, { texture: { ...next, state: "failed", error: (e as Error).message } });
      }
    } else if (`${next.meshyStatus}/${next.progress}` === before) return;
    await this.save();
  }

  /**
   * A succeeded task's files into 001: the .glb (always), the preset's extra formats, the
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
    const want = (this.preset(j).formats ?? []).filter((f) => f !== "glb");
    const files: [string, string | undefined][] = want.map((f) => [`${base}.${f}`, t.model_urls?.[f]]);
    if (want.includes("obj")) files.push([`${base}.mtl`, t.model_urls?.mtl]);
    files.push([`${base}.pre_remesh.glb`, t.model_urls?.pre_remeshed_glb]);
    if (want.some((f) => f !== "stl" && f !== "3mf")) {
      for (const [map, url] of Object.entries(t.texture_urls?.[0] ?? {})) files.push([`${base}.textures/${map}.png`, url]);
    }
    for (const [rel, url] of files) {
      if (!url) continue;
      try { await Bun.write(this.path(RAW, rel), await download(url)); extras.add(rel); }
      catch (e) { console.error(`[meshy-studio] extra file ${rel}`, e); }
    }
    j.extras = extras.size ? [...extras].sort() : undefined;
  }

  /** <folder>/<outName>.glb, with _2, _3 when another job already owns that name. */
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
      this.copyOut(j);
    } catch (e) {
      this.touch(j, { state: "failed", error: `Scaling failed: ${(e as Error).message}` });
    }
  }

  /** A finished model, copied to the engine folder too. A copy that fails never fails the job. */
  private copyOut(j: Job) {
    if (!this.sync || !j.ready) return;
    try {
      const to = join(this.sync.dir, j.ready);
      mkdirSync(dirname(to), { recursive: true });
      copyFileSync(this.path(READY, j.ready), to);
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
    for (const j of this.jobs.values()) if (j.state === "done") this.copyOut(j);
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
      const bad = checkPreset(p).filter((m) => !m.includes("only appl"));
      if (bad.length) throw new Error(`${p.label}: ${bad[0]}`);
    }
    this.presets = list;
    await Bun.write(this.path(PRESETS), JSON.stringify(list, null, 2) + "\n");
    for (const j of this.jobs.values()) {
      if (j.state !== "new" && !(j.state === "failed" && !j.taskId)) continue;
      if (!prefixes.includes(j.prefix)) j.prefix = "";
      this.reprice(j);
    }
    await this.save();
  }

  /** Credits a send of these unsent cards would cost (all new cards when no keys), optionally as drafts. */
  estimate(keys?: string[], opts: { draft?: boolean } = {}) {
    const js = [...this.jobs.values()].filter((j) => j.state === "new" && (!keys || keys.includes(j.key)));
    const cost = (j: Job) => opts.draft ? estimateCredits(this.preset(j).options, { ...this.card(j), draft: true }) : j.estimate;
    return { count: js.length, credits: js.reduce((n, j) => n + cost(j), 0) };
  }

  /** Credits the Texture step on these finished drafts would cost. */
  estimateTexture(keys?: string[]) {
    const js = [...this.jobs.values()].filter((j) => this.canTexture(j) && (!keys || keys.includes(j.key)));
    return { count: js.length, credits: js.reduce((n, j) => n + estimateRetexture(this.preset(j).retexture), 0) };
  }

  summary() {
    const jobs = [...this.jobs.values()].sort((a, b) => a.folder.localeCompare(b.folder) || a.file.localeCompare(b.file));
    return {
      dir: this.dir, name: basename(this.dir), version: this.version, pause: this.pause, maxQueued: this.maxQueued,
      folders: this.folders(), presets: this.presets, sync: this.sync,
      spent: jobs.reduce((n, j) => n + (j.credits ?? 0) + (j.texture?.credits ?? 0), 0),
      jobs: jobs.map((j) => ({
        ...j, sizeText: describeSize(j.size), presetLabel: this.preset(j).label,
        draftEstimate: estimateCredits(this.preset(j).options, { ...this.card(j), draft: true }),
        textureEstimate: estimateRetexture(this.preset(j).retexture),
      })),
    };
  }
}
