// The desktop backend: real folders and big files for SuperSplat.
//
//   GET  /api/status                   current library, recent folders
//   GET  /api/fs/list?dir=             subfolders (in-app folder browser)
//   POST /api/fs/pick                  OS folder dialog when one exists
//   POST /api/library/open  {dir}      open a folder as the scene library
//   GET  /api/library/scenes           splat files in it, with sizes
//   GET  /api/library/events           SSE: files changed on disk
//   GET  /api/library/info?path=       splat count, detail level, bounds (desktop/sceneInfo.ts)
//   GET  /files/<path>                 a scene file, with byte ranges (splats run to GBs)

import type { HostContext } from "@rustybuns/shell-bun";
import { existsSync, readdirSync, statSync, watch } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { readSceneInfo } from "./sceneInfo.ts";

export const SCENE_EXT = new Set([".ply", ".spz", ".sog", ".splat", ".ksplat", ".lcc", ".ssproj"]);
const SKIP_DIR = new Set(["node_modules", ".git", ".vendor"]);
const MAX_SCENES = 2000;

let library: string | null = null;

const json = (v: unknown, status = 200) => Response.json(v, { status });
const bad = (msg: string, status = 400) => json({ error: msg }, status);
const expand = (p: string) => resolve(p.replace(/^~(?=$|\/)/, homedir()));

/** Test hook: forget the open library. */
export function _reset() { library = null; }

async function recent(ctx: HostContext): Promise<string[]> {
  try { return await Bun.file(join(ctx.dataDir, "recent.json")).json(); } catch { return []; }
}
async function remember(ctx: HostContext, dir: string) {
  const list = [dir, ...(await recent(ctx)).filter((d) => d !== dir)].slice(0, 10);
  await Bun.write(join(ctx.dataDir, "recent.json"), JSON.stringify(list));
}

function inLibrary(rel: string): string | null {
  if (!library) return null;
  const p = resolve(library, rel);
  return p.startsWith(library + sep) ? p : null;
}

export interface Scene { path: string; name: string; bytes: number; modified: number }

function scan(dir: string, out: Scene[] = []): Scene[] {
  let names: string[] = [];
  try { names = readdirSync(dir); } catch { return out; }
  for (const name of names.sort()) {
    if (out.length >= MAX_SCENES) break;
    if (name.startsWith(".") || SKIP_DIR.has(name)) continue;
    const p = join(dir, name);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) scan(p, out);
    else if (SCENE_EXT.has(extname(name).toLowerCase())) {
      out.push({ path: relative(library!, p).split(sep).join("/"), name, bytes: st.size, modified: st.mtimeMs });
    }
  }
  return out;
}

async function pickFolder(): Promise<string | null> {
  const cmd = process.platform === "darwin"
    ? ["osascript", "-e", 'POSIX path of (choose folder with prompt "Open a folder of splat scenes")']
    : process.platform === "win32"
      ? ["powershell", "-NoProfile", "-Command", "Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.FolderBrowserDialog; if ($d.ShowDialog() -eq 'OK') { $d.SelectedPath }"]
      : Bun.which("zenity") ? ["zenity", "--file-selection", "--directory", "--title=Open a folder of splat scenes"] : null;
  if (!cmd) return null;
  const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "ignore" });
  const out = (await new Response(p.stdout).text()).trim();
  await p.exited;
  return out ? out.replace(/\/$/, "") : "";
}

const TYPES: Record<string, string> = { ".ply": "application/octet-stream", ".spz": "application/octet-stream", ".splat": "application/octet-stream", ".ksplat": "application/octet-stream", ".sog": "application/octet-stream", ".lcc": "application/json", ".ssproj": "application/octet-stream" };

/** A file with single-range support, which viewers use to stream large scenes. */
export function serveFile(req: Request, path: string): Response {
  const file = Bun.file(path);
  const size = file.size;
  const type = TYPES[extname(path).toLowerCase()] ?? "application/octet-stream";
  const base = { "accept-ranges": "bytes", "content-type": type, "cache-control": "no-cache" };
  const range = req.headers.get("range");
  if (!range) return new Response(req.method === "HEAD" ? null : file, { headers: { ...base, "content-length": String(size) } });
  const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (!m || (m[1] === "" && m[2] === "")) return new Response(null, { status: 416, headers: { ...base, "content-range": `bytes */${size}` } });
  let start: number, end: number;
  if (m[1] === "") { start = Math.max(0, size - Number(m[2])); end = size - 1; }
  else { start = Number(m[1]); end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1); }
  if (start > end || start >= size) return new Response(null, { status: 416, headers: { ...base, "content-range": `bytes */${size}` } });
  return new Response(req.method === "HEAD" ? null : file.slice(start, end + 1), {
    status: 206,
    headers: { ...base, "content-range": `bytes ${start}-${end}/${size}`, "content-length": String(end - start + 1) },
  });
}

function events(): Response {
  if (!library) return bad("no library open");
  const dir = library;
  let close = () => {};
  const stream = new ReadableStream({
    start(c) {
      const enc = new TextEncoder();
      const send = (v: unknown) => { try { c.enqueue(enc.encode(`data: ${JSON.stringify(v)}\n\n`)); } catch {} };
      send({ type: "hello", dir });
      const w = watch(dir, { recursive: true }, (_ev, file) => {
        const f = String(file ?? "").split(sep).join("/");
        if (!f || f.split("/").some((part) => part.startsWith(".") || SKIP_DIR.has(part))) return;
        if (!SCENE_EXT.has(extname(f).toLowerCase())) return;
        send({ type: "changed", path: f });
      });
      const ping = setInterval(() => send({ type: "ping" }), 15_000);
      close = () => { w.close(); clearInterval(ping); };
    },
    cancel() { close(); },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache" } });
}

export default {
  async fetch(req: Request, ctx: HostContext): Promise<Response | null> {
    const url = new URL(req.url);
    const path = url.pathname;
    try {
      if (path.startsWith("/files/")) {
        const p = inLibrary(decodeURIComponent(path.slice("/files/".length)));
        if (!p || !SCENE_EXT.has(extname(p).toLowerCase()) || !existsSync(p) || !statSync(p).isFile()) return bad("not found", 404);
        return serveFile(req, p);
      }
      if (!path.startsWith("/api/")) return null;
      if (path === "/api/status") {
        return json({ library: library && { dir: library, name: basename(library) }, recent: await recent(ctx), home: homedir(), platform: `${process.platform}-${process.arch}` });
      }
      if (path === "/api/fs/list") {
        const dir = expand(url.searchParams.get("dir") || homedir());
        const entries = readdirSync(dir, { withFileTypes: true });
        return json({
          dir, parent: dirname(dir),
          dirs: entries.filter((d) => d.isDirectory() && !d.name.startsWith(".") && !SKIP_DIR.has(d.name)).map((d) => d.name).sort(),
          scenes: entries.filter((d) => d.isFile() && SCENE_EXT.has(extname(d.name).toLowerCase())).length,
        });
      }
      if (path === "/api/fs/pick" && req.method === "POST") {
        const dir = await pickFolder();
        return json({ supported: dir !== null, dir: dir || null });
      }
      if (path === "/api/library/open" && req.method === "POST") {
        const raw = String(((await req.json()) as any).dir ?? "");
        if (!raw) return bad("dir required");
        const dir = expand(raw);
        if (!existsSync(dir) || !statSync(dir).isDirectory()) return bad(`not a folder: ${dir}`, 404);
        library = dir;
        await remember(ctx, dir);
        return json({ dir, name: basename(dir) });
      }
      if (path === "/api/library/scenes") {
        if (!library) return bad("no library open");
        return json({ dir: library, name: basename(library), scenes: scan(library) });
      }
      if (path === "/api/library/info") {
        const p = inLibrary(url.searchParams.get("path") ?? "");
        if (!p || !SCENE_EXT.has(extname(p).toLowerCase()) || !existsSync(p)) return bad("not found", 404);
        return json(await readSceneInfo(p));
      }
      if (path === "/api/library/events") return events();
      return bad("no such route", 404);
    } catch (err) {
      ctx.reporter.escaped("host", err, { path });
      return bad(String((err as Error).message ?? err), 500);
    }
  },
};
