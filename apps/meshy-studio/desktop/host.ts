// The desktop backend. It owns the Meshy key, the workspace and every Meshy call;
// the browser UI only ever talks to these routes.
//
//   GET  /api/status                      key present? (never any of the key), open workspace, recent, settings
//   POST /api/key {key}                   check it with Meshy (free balance call), then save it
//   DELETE /api/key                       forget it
//   GET  /api/balance                     credits left
//   POST /api/settings {maxQueued?, confirmSends?, batchCap?}   queue limit and spend guards
//   GET  /api/fs/list?dir=  POST /api/fs/pick      choose a workspace folder
//   POST /api/workspace/open {dir}  POST /api/workspace/close
//   GET  /api/jobs                        every card, the folders and presets
//   POST /api/jobs/{send,texture,op,retry}             spend credits: each checks the spend guards first
//   POST /api/jobs/{cancel,drop-op,edit,edit-many,move,combine,split}   card changes (free)
//   POST /api/concepts {kind, params, folder, name, references?, credits}   Text/Image to Image
//   POST /api/concepts/cancel {id}
//   POST /api/create/text {folder, name, prompt}   a Text to 3D card (writes <name>.prompt.txt)
//   GET  /api/animations?search=&category=   Meshy's animation library (free)
//   GET  /api/usage?...                   billed tasks (Studio and Enterprise plans)
//   POST /api/presets {presets}           save the preset editor
//   POST /api/sync {dir, engine} | {off}  also copy finished models into a game engine's folder
//   POST /api/blender {keys?}             open finished models in Blender
//   POST /api/folders {name}              new organizing folder in 000
//   POST /api/upload?folder=&name=        an image dropped on the window
//   POST /api/reveal {stage}              open a stage folder in Finder / Explorer
//   GET  /img/<key>                       a card's image

import type { HostContext } from "@rustybuns/shell-bun";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { Meshy, MeshyError } from "../engine/meshy.ts";
import { IMAGE_EXT } from "../engine/labels.ts";
import { findBlender, openInBlender } from "../engine/blender.ts";
import { INBOX, PROMPT_EXT, RAW, READY, SENT, Workspace, type Engine } from "../engine/workspace.ts";
import { estimateConcept, type OpKind } from "../engine/ops.ts";

const OP_KINDS: OpKind[] = ["retexture", "refine", "remesh", "resize", "uv-unwrap", "convert", "rig", "motion", "animate"];

let ws: Workspace | null = null;
let keyCache: string | null | undefined;

const json = (v: unknown, status = 200) => Response.json(v, { status });
const bad = (msg: string, status = 400) => json({ error: msg }, status);
const expand = (p: string) => resolve(p.replace(/^~(?=$|\/)/, homedir()));
const body = async (req: Request) => (await req.json().catch(() => ({}))) as any;

/** Test hook. */
export function _reset() { ws?.stop(); ws = null; keyCache = undefined; }

// The key lives in the app's data dir, readable by this user only. Never in the workspace.
const keyFile = (ctx: HostContext) => join(ctx.dataDir, "meshy-key");
function readKey(ctx: HostContext): string | null {
  if (process.env.MESHY_API_KEY) return process.env.MESHY_API_KEY;
  if (keyCache === undefined) keyCache = existsSync(keyFile(ctx)) ? readFileSync(keyFile(ctx), "utf8").trim() || null : null;
  return keyCache ?? null;
}

export interface Settings {
  maxQueued: number;
  /** Show the cost and ask before anything is sent. */
  confirmSends: boolean;
  /** Refuse any one send over this many credits. 0 = no limit. */
  batchCap: number;
}
const DEFAULTS: Settings = { maxQueued: 10, confirmSends: true, batchCap: 300 };
async function settings(ctx: HostContext): Promise<Settings> {
  try { return { ...DEFAULTS, ...(await Bun.file(join(ctx.dataDir, "settings.json")).json()) }; } catch { return { ...DEFAULTS }; }
}

/** The spend guards, checked here and not only in the UI: the batch limit, then the real balance. */
async function guard(ctx: HostContext, credits: number, confirmed?: number): Promise<string | null> {
  if (!credits) return null;
  if (confirmed !== undefined && credits > confirmed) return `This batch now costs about ${credits} credits, more than the ${confirmed} you confirmed. Check it again.`;
  const { batchCap } = await settings(ctx);
  if (batchCap > 0 && credits > batchCap) return `About ${credits} credits is over your ${batchCap}-credit batch limit (Settings). Send fewer, or raise the limit.`;
  const key = readKey(ctx);
  if (!key) return null; // the batch pauses on its own and asks for a key
  const { balance } = await new Meshy(key).balance();
  if (credits > balance) return `About ${credits} credits needed, but the account has ${balance}.`;
  return null;
}
async function recent(ctx: HostContext): Promise<string[]> {
  try { return await Bun.file(join(ctx.dataDir, "recent.json")).json(); } catch { return []; }
}
async function remember(ctx: HostContext, dir: string) {
  const list = [dir, ...(await recent(ctx)).filter((d) => d !== dir)].slice(0, 10);
  await Bun.write(join(ctx.dataDir, "recent.json"), JSON.stringify(list));
}

async function pickFolder(prompt = "Pick a workspace folder for Meshy batches"): Promise<string | null> {
  prompt = prompt.replace(/["\\]/g, "").slice(0, 120);
  const cmd = process.platform === "darwin"
    ? ["osascript", "-e", `POSIX path of (choose folder with prompt "${prompt}")`]
    : process.platform === "win32"
      ? ["powershell", "-NoProfile", "-Command", "Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.FolderBrowserDialog; if ($d.ShowDialog() -eq 'OK') { $d.SelectedPath }"]
      : Bun.which("zenity") ? ["zenity", "--file-selection", "--directory", `--title=${prompt}`] : null;
  if (!cmd) return null;
  const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "ignore" });
  const out = (await new Response(p.stdout).text()).trim();
  await p.exited;
  return out ? out.replace(/\/$/, "") : "";
}

function reveal(path: string) {
  const cmd = process.platform === "darwin" ? ["open", path] : process.platform === "win32" ? ["explorer", path] : ["xdg-open", path];
  Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" });
}

/** A folder name under 000: plain segments, nothing hidden, no climbing out. */
function cleanFolder(f: string): string | null {
  const parts = f.split("/").filter(Boolean);
  if (parts.some((p) => p === "." || p === ".." || p.startsWith(".") || /[\\:*?"<>|]/.test(p))) return null;
  if (parts[0] === SENT) return null;
  return parts.join("/");
}

const TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg" };

export default {
  async fetch(req: Request, ctx: HostContext): Promise<Response | null> {
    const url = new URL(req.url);
    const path = url.pathname;
    try {
      if (path.startsWith("/img/")) {
        const j = ws?.jobs.get(decodeURIComponent(path.slice(5)));
        if (!j) return bad("not found", 404);
        const view = Number(url.searchParams.get("view") ?? 0);
        const p = ws!.inputPaths(j)[view] ?? "";
        if (j.source === "text") return bad("not an image", 404);
        if (!existsSync(p)) return bad("not found", 404);
        return new Response(Bun.file(p), { headers: { "content-type": TYPES[p.split(".").pop()!.toLowerCase()] ?? "application/octet-stream", "cache-control": "no-cache" } });
      }
      if (!path.startsWith("/api/")) return null;

      if (path === "/api/status") {
        const key = readKey(ctx);
        return json({
          hasKey: !!key, keyFromEnv: !!process.env.MESHY_API_KEY, blender: !!findBlender(),
          workspace: ws && { dir: ws.dir, name: basename(ws.dir) },
          recent: await recent(ctx), home: homedir(), settings: await settings(ctx),
        });
      }
      if (path === "/api/key" && req.method === "POST") {
        const key = String((await body(req)).key ?? "").trim();
        if (!key) return bad("paste a key first");
        let balance: number;
        try { balance = (await new Meshy(key).balance()).balance; }
        catch (e) { return bad(e instanceof MeshyError ? e.friendly : String(e), e instanceof MeshyError && e.status === 401 ? 401 : 502); }
        await Bun.write(keyFile(ctx), key);
        try { chmodSync(keyFile(ctx), 0o600); } catch {}
        keyCache = key;
        return json({ balance });
      }
      if (path === "/api/key" && req.method === "DELETE") {
        if (existsSync(keyFile(ctx))) unlinkSync(keyFile(ctx));
        keyCache = null;
        return json({ ok: true });
      }
      if (path === "/api/balance") {
        const key = readKey(ctx);
        if (!key) return bad("no API key", 401);
        try { return json(await new Meshy(key).balance()); }
        catch (e) { return bad(e instanceof MeshyError ? e.friendly : String(e), 502); }
      }
      if (path === "/api/settings" && req.method === "POST") {
        const b = await body(req);
        const next = await settings(ctx);
        if (b.maxQueued !== undefined) {
          const n = Math.round(Number(b.maxQueued));
          if (!(n >= 1 && n <= 100)) return bad("queue limit is 1 to 100");
          next.maxQueued = n;
        }
        if (b.confirmSends !== undefined) next.confirmSends = !!b.confirmSends;
        if (b.batchCap !== undefined) {
          const n = Math.round(Number(b.batchCap));
          if (!(n >= 0)) return bad("batch limit is 0 (none) or more credits");
          next.batchCap = n;
        }
        await Bun.write(join(ctx.dataDir, "settings.json"), JSON.stringify(next));
        if (ws) ws.maxQueued = next.maxQueued;
        return json(next);
      }

      if (path === "/api/fs/list") {
        const dir = expand(url.searchParams.get("dir") || homedir());
        const entries = readdirSync(dir, { withFileTypes: true });
        return json({
          dir, parent: dirname(dir),
          dirs: entries.filter((d) => d.isDirectory() && !d.name.startsWith(".")).map((d) => d.name).sort(),
          isWorkspace: entries.some((d) => d.name === INBOX),
        });
      }
      if (path === "/api/fs/pick" && req.method === "POST") {
        const dir = await pickFolder((await body(req)).prompt || undefined);
        return json({ supported: dir !== null, dir: dir || null });
      }
      if (path === "/api/workspace/open" && req.method === "POST") {
        const raw = String((await body(req)).dir ?? "");
        if (!raw) return bad("dir required");
        const dir = expand(raw);
        if (!existsSync(dir) || !statSync(dir).isDirectory()) return bad(`not a folder: ${dir}`, 404);
        ws?.stop();
        ws = new Workspace(dir, () => readKey(ctx), (await settings(ctx)).maxQueued);
        await ws.open();
        ws.start();
        await remember(ctx, ws.dir);
        return json({ dir: ws.dir, name: basename(ws.dir) });
      }
      if (path === "/api/workspace/close" && req.method === "POST") { ws?.stop(); ws = null; return json({ ok: true }); }

      if (path === "/api/animations") {
        const key = readKey(ctx);
        if (!key) return bad("no API key", 401);
        try { return json(await new Meshy(key).library({ search: url.searchParams.get("search") ?? undefined, category: url.searchParams.get("category") ?? undefined })); }
        catch (e) { return bad(e instanceof MeshyError ? e.friendly : String(e), 502); }
      }
      if (path === "/api/usage") {
        const key = readKey(ctx);
        if (!key) return bad("no API key", 401);
        const q = Object.fromEntries(url.searchParams);
        try { return json(await new Meshy(key).usage({ ...q, page_num: q.page_num ? Number(q.page_num) : undefined, page_size: q.page_size ? Number(q.page_size) : undefined })); }
        catch (e) {
          if (e instanceof MeshyError && e.status === 403) return bad("Usage history comes with Meshy's Studio and Enterprise plans.", 403);
          return bad(e instanceof MeshyError ? e.friendly : String(e), 502);
        }
      }
      if (!ws) return bad("no workspace open", 409);
      if (path === "/api/jobs") {
        await ws.scan();
        return json(ws.summary());
      }
      if (path.startsWith("/api/jobs/") && req.method === "POST") {
        const b = await body(req);
        const act = path.slice("/api/jobs/".length);
        try {
          const keys = Array.isArray(b.keys) ? b.keys.map(String) : undefined;
          const confirmed = b.credits === undefined ? undefined : Number(b.credits);
          if (act === "send") {
            const stop = await guard(ctx, ws.estimate(keys, { draft: !!b.draft }).credits, confirmed);
            if (stop) return bad(stop, 402);
            await ws.send(keys, { draft: !!b.draft });
          } else if (act === "texture") {
            const stop = await guard(ctx, ws.estimateTexture(keys).credits, confirmed);
            if (stop) return bad(stop, 402);
            await ws.textureModels(keys);
          } else if (act === "op") {
            const kind = String(b.kind) as OpKind;
            if (!OP_KINDS.includes(kind)) return bad("unknown step");
            const ops: { kind: OpKind; params: any }[] = [{ kind, params: b.params ?? {} }, ...(Array.isArray(b.then) ? b.then : [])];
            for (const o of ops) if (!OP_KINDS.includes(o.kind)) return bad("unknown step");
            const total = ops.reduce((n, o) => n + ws!.estimateOp(keys ?? [], o.kind, o.params).credits, 0);
            const stop = await guard(ctx, total, confirmed);
            if (stop) return bad(stop, 402);
            const skipped: string[] = [];
            for (const o of ops) skipped.push(...await ws.addOp(keys ?? [], o.kind, o.params));
            ws.tick();
            return json({ ...ws.summary(), skipped });
          } else if (act === "retry") {
            const j = ws.get(String(b.key));
            const stop = await guard(ctx, ws.retryCost(j), confirmed);
            if (stop) return bad(stop, 402);
            await ws.retry(j.key);
          }
          else if (act === "cancel") await ws.cancel(String(b.key), b.op ? String(b.op) : undefined);
          else if (act === "drop-op") await ws.dropOp(String(b.key), String(b.op));
          else if (act === "edit") await ws.edit(String(b.key), b.patch ?? {});
          else if (act === "edit-many") return json({ ...ws.summary(), skipped: await ws.editMany(keys ?? [], b.patch ?? {}) });
          else if (act === "combine") await ws.combine(keys ?? []);
          else if (act === "prompt") await ws.setPrompt(String(b.key), String(b.prompt ?? ""));
          else if (act === "split") await ws.split(String(b.key));
          else if (act === "move") {
            const f = cleanFolder(String(b.folder ?? ""));
            if (f === null) return bad("bad folder");
            await ws.move(String(b.key), f);
          } else return bad("no such action", 404);
        } catch (e) {
          return bad(e instanceof MeshyError ? e.friendly : String((e as Error).message ?? e));
        }
        if (act === "send" || act === "texture" || act === "retry") ws.tick();
        return json(ws.summary());
      }
      if (path === "/api/concepts" && req.method === "POST") {
        const b = await body(req);
        const kind = b.kind === "image-to-image" ? "image-to-image" : "text-to-image";
        const folder = cleanFolder(String(b.folder ?? ""));
        if (folder === null) return bad("bad folder");
        try {
          const stop = await guard(ctx, estimateConcept(kind, b.params?.ai_model), b.credits === undefined ? undefined : Number(b.credits));
          if (stop) return bad(stop, 402);
          await ws.addConcept(kind, b.params ?? {}, { folder, name: String(b.name ?? ""), references: Array.isArray(b.references) ? b.references.map(String) : undefined });
        } catch (e) { return bad(e instanceof MeshyError ? e.friendly : (e as Error).message); }
        ws.tick();
        return json(ws.summary());
      }
      if (path === "/api/concepts/cancel" && req.method === "POST") {
        try { await ws.cancelConcept(String((await body(req)).id)); } catch (e) { return bad((e as Error).message); }
        return json(ws.summary());
      }
      if (path === "/api/create/text" && req.method === "POST") {
        const b = await body(req);
        const folder = cleanFolder(String(b.folder ?? ""));
        const name = String(b.name ?? "").trim();
        const prompt = String(b.prompt ?? "").trim();
        if (folder === null || !/^[^/\\:*?"<>|.][^/\\:*?"<>|]*$/.test(name)) return bad("give it a file name");
        if (!prompt) return bad("write a prompt");
        if (prompt.length > 800) return bad("Text to 3D prompts are 800 characters at most");
        const file = ws.path(INBOX, folder, `${name}.prompt.txt`);
        if (existsSync(file)) return bad(`${name}.prompt.txt already exists there`);
        mkdirSync(dirname(file), { recursive: true });
        await Bun.write(file, prompt + "\n");
        await ws.scan();
        return json(ws.summary());
      }
      if (path === "/api/presets" && req.method === "POST") {
        try { await ws.setPresets((await body(req)).presets); } catch (e) { return bad((e as Error).message); }
        return json(ws.summary());
      }
      if (path === "/api/sync" && req.method === "POST") {
        const b = await body(req);
        if (b.off) await ws.setSync(null);
        else {
          const engine = String(b.engine ?? "folder") as Engine;
          if (!["unity", "unreal", "blender", "folder"].includes(engine)) return bad("unknown engine");
          const dir = String(b.dir ?? "");
          if (!dir) return bad("pick a folder");
          try { await ws.setSync({ dir: expand(dir), engine }); } catch (e) { return bad((e as Error).message); }
        }
        return json(ws.summary());
      }
      if (path === "/api/blender" && req.method === "POST") {
        const keys: string[] | undefined = (await body(req)).keys;
        const files = [...ws.jobs.values()].filter((j) => j.state === "done" && j.ready && (!keys || keys.includes(j.key)))
          .flatMap((j) => [j.ready!, ...(j.readyExtras ?? [])].map((f) => ws!.path(READY, f)));
        if (!files.length) return bad("no finished models to open");
        if (!openInBlender(files)) return bad("Blender wasn't found. Install it, or set BLENDER_PATH.", 404);
        return json({ opened: files.length });
      }
      if (path === "/api/folders" && req.method === "POST") {
        const f = cleanFolder(String((await body(req)).name ?? ""));
        if (!f) return bad("give the folder a name");
        mkdirSync(ws.path(INBOX, f), { recursive: true });
        return json(ws.summary());
      }
      if (path === "/api/upload" && req.method === "POST") {
        const f = cleanFolder(url.searchParams.get("folder") ?? "");
        const name = basename(url.searchParams.get("name") ?? "");
        if (f === null || !(IMAGE_EXT.test(name) || PROMPT_EXT.test(name)) || name.startsWith(".")) return bad("only .png and .jpg images, or .prompt.txt prompts");
        mkdirSync(ws.path(INBOX, f), { recursive: true });
        await Bun.write(ws.path(INBOX, f, name), await req.arrayBuffer());
        await ws.scan();
        return json(ws.summary());
      }
      if (path === "/api/reveal" && req.method === "POST") {
        const stage = String((await body(req)).stage ?? "");
        const sub = { inbox: INBOX, sent: join(INBOX, SENT), raw: RAW, ready: READY, root: "" }[stage];
        if (sub === undefined) return bad("unknown stage");
        reveal(ws.path(sub));
        return json({ ok: true });
      }
      return bad("no such route", 404);
    } catch (err) {
      ctx.reporter.escaped("host", err, { path });
      return bad(String((err as Error).message ?? err), 500);
    }
  },
};
