// The desktop backend. Runs inside the RustyBuns Bun host next to the built UI.
// Everything the browser can't do lives here: real folders, file watching,
// native dialogs, writing fabrication files, and the Rust analysis.
//
//   GET  /api/status                  native available? current project?
//   GET  /api/fs/list?dir=            subfolders (in-app folder browser)
//   POST /api/fs/pick                 OS folder dialog when one exists
//   POST /api/project/open  {dir}     open a folder of *.circuit.tsx
//   POST /api/project/new   {dir}     create a starter project there, then open it
//   GET  /api/project/files           { path: contents } for RunFrame's fsMap
//   PUT  /api/project/file?path=      save one file
//   GET  /api/project/events          SSE: a file changed on disk
//   POST /api/analyze?min=&engine=    Circuit JSON in, analysis out (Rust, TS fallback)
//   POST /api/export?format=          write gerbers | bom | pnp | json into <project>/exports

import type { HostContext } from "@rustybuns/shell-bun";
import { existsSync, readdirSync, statSync, watch, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { analyzeNative, nativeAvailable } from "./native.ts";
import { analyze } from "../src/analysis/analyze.ts";
import { STARTER_CIRCUIT } from "./starter.ts";

const TEXT_EXT = /\.(tsx?|jsx?|json|kicad_mod|md)$/;
const SKIP_DIR = new Set(["node_modules", "dist", "exports", ".git", ".tscircuit"]);
const MAX_FILE = 2_000_000;
const MAX_FILES = 500;

let project: string | null = null;

const json = (v: unknown, status = 200) => Response.json(v, { status });
const bad = (msg: string, status = 400) => json({ error: msg }, status);

function recentFile(ctx: HostContext) { return join(ctx.dataDir, "recent.json"); }
async function recent(ctx: HostContext): Promise<string[]> {
  try { return await Bun.file(recentFile(ctx)).json(); } catch { return []; }
}
async function remember(ctx: HostContext, dir: string) {
  const list = [dir, ...(await recent(ctx)).filter((d) => d !== dir)].slice(0, 10);
  await Bun.write(recentFile(ctx), JSON.stringify(list));
}

/** Resolve a project-relative path and refuse anything that escapes the project. */
function inProject(rel: string): string | null {
  if (!project) return null;
  const p = resolve(project, rel);
  return p === project || p.startsWith(project + sep) ? p : null;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (out.length >= MAX_FILES) break;
    if (name.startsWith(".") || SKIP_DIR.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (TEXT_EXT.test(name) && st.size <= MAX_FILE) out.push(p);
  }
  return out;
}

function listing(dir: string) {
  const files = walk(dir).map((p) => relative(dir, p).split(sep).join("/")).sort();
  const boards = files.filter((f) => f.endsWith(".circuit.tsx"));
  const entry = boards.find((f) => f === "index.circuit.tsx") ?? boards[0] ?? files.find((f) => /\.tsx$/.test(f)) ?? null;
  return { dir, name: basename(dir), files, boards, entry };
}

async function openProject(ctx: HostContext, raw: unknown) {
  if (typeof raw !== "string" || !raw) return bad("dir required");
  const dir = resolve(raw.replace(/^~(?=$|\/)/, homedir()));
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return bad(`not a folder: ${dir}`, 404);
  project = dir;
  await remember(ctx, dir);
  return json(listing(dir));
}

/** OS folder dialog. Null when this platform has no dialog tool we can call. */
async function pickFolder(): Promise<string | null> {
  const cmd = process.platform === "darwin"
    ? ["osascript", "-e", 'POSIX path of (choose folder with prompt "Open tscircuit project")']
    : process.platform === "win32"
      ? ["powershell", "-NoProfile", "-Command", "Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.FolderBrowserDialog; if ($d.ShowDialog() -eq 'OK') { $d.SelectedPath }"]
      : Bun.which("zenity") ? ["zenity", "--file-selection", "--directory", "--title=Open tscircuit project"] : null;
  if (!cmd) return null;
  const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "ignore" });
  const out = (await new Response(p.stdout).text()).trim();
  await p.exited;
  return out ? out.replace(/\/$/, "") : "";
}

function events(): Response {
  if (!project) return bad("no project open");
  const dir = project;
  let close = () => {};
  const stream = new ReadableStream({
    start(c) {
      const enc = new TextEncoder();
      const send = (v: unknown) => { try { c.enqueue(enc.encode(`data: ${JSON.stringify(v)}\n\n`)); } catch {} };
      send({ type: "hello", dir });
      const w = watch(dir, { recursive: true }, (_ev, file) => {
        const f = String(file ?? "").split(sep).join("/");
        if (!f || f.split("/").some((part) => part.startsWith(".") || SKIP_DIR.has(part))) return;
        send({ type: "changed", path: f });
      });
      const ping = setInterval(() => send({ type: "ping" }), 15_000);
      close = () => { w.close(); clearInterval(ping); };
    },
    cancel() { close(); },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache" } });
}

async function runAnalysis(req: Request, url: URL) {
  const min = Number(url.searchParams.get("min") ?? 0.1);
  const want = url.searchParams.get("engine") ?? "auto";
  const text = await req.text();
  const t0 = performance.now();
  if (want !== "ts" && nativeAvailable) {
    const out = analyzeNative(text, min)!;
    const ms = performance.now() - t0;
    return new Response(`{"engine":"rust-native","ms":${ms.toFixed(2)},"result":${out}}`, { headers: { "content-type": "application/json" } });
  }
  if (want === "native") return bad("native library not available on this build", 501);
  let els: unknown;
  try { els = JSON.parse(text); } catch { return bad("bad json"); }
  if (!Array.isArray(els)) return bad("expected a Circuit JSON array");
  const result = analyze(els, min);
  return json({ engine: "ts-host", ms: +(performance.now() - t0).toFixed(2), result });
}

async function runExport(req: Request, url: URL) {
  if (!project) return bad("no project open");
  const format = url.searchParams.get("format") ?? "";
  const { circuitJson, board = "board" } = (await req.json()) as { circuitJson: any[]; board?: string };
  if (!Array.isArray(circuitJson)) return bad("circuitJson required");
  const stem = basename(board).replace(/\.circuit\.tsx$|\.tsx$/, "") || "board";
  const outDir = join(project, "exports", stem);
  const files: Record<string, string> = {};
  switch (format) {
    case "gerbers": {
      const { convertCircuitJsonToGerberFiles, convertCircuitJsonToExcellonDrillCommands, stringifyExcellonDrill } = await import("circuit-json-to-gerber");
      for (const [name, body] of Object.entries(await convertCircuitJsonToGerberFiles(circuitJson))) files[`gerbers/${name}`] = body;
      const plated = convertCircuitJsonToExcellonDrillCommands({ circuitJson, is_plated: true } as any);
      const unplated = convertCircuitJsonToExcellonDrillCommands({ circuitJson, is_plated: false } as any);
      files["gerbers/plated.drl"] = stringifyExcellonDrill(plated);
      files["gerbers/unplated.drl"] = stringifyExcellonDrill(unplated);
      break;
    }
    case "bom": {
      const { convertCircuitJsonToBomRows, convertBomRowsToCsv } = await import("circuit-json-to-bom-csv");
      files["bom.csv"] = convertBomRowsToCsv(await convertCircuitJsonToBomRows({ circuitJson } as any));
      break;
    }
    case "pnp": {
      const { convertCircuitJsonToPickAndPlaceCsv } = await import("circuit-json-to-pnp-csv");
      files["pick-and-place.csv"] = convertCircuitJsonToPickAndPlaceCsv(circuitJson);
      break;
    }
    case "json":
      files["circuit.json"] = JSON.stringify(circuitJson, null, 2);
      break;
    default:
      return bad("format must be gerbers | bom | pnp | json");
  }
  const written: string[] = [];
  for (const [rel, body] of Object.entries(files)) {
    const p = join(outDir, rel);
    mkdirSync(dirname(p), { recursive: true });
    await Bun.write(p, body);
    written.push(relative(project, p).split(sep).join("/"));
  }
  return json({ dir: outDir, written });
}

export default {
  async fetch(req: Request, ctx: HostContext): Promise<Response | null> {
    const url = new URL(req.url);
    const path = url.pathname;
    if (!path.startsWith("/api/")) return null;
    try {
      if (path === "/api/status") {
        return json({ native: nativeAvailable, platform: `${process.platform}-${process.arch}`, project: project && listing(project), recent: await recent(ctx), home: homedir() });
      }
      if (path === "/api/fs/list") {
        const dir = resolve((url.searchParams.get("dir") || homedir()).replace(/^~(?=$|\/)/, homedir()));
        const dirs = readdirSync(dir, { withFileTypes: true })
          .filter((d) => d.isDirectory() && !d.name.startsWith(".") && d.name !== "node_modules")
          .map((d) => d.name).sort();
        const hasBoards = readdirSync(dir).some((f) => f.endsWith(".circuit.tsx"));
        return json({ dir, parent: dirname(dir), dirs, hasBoards });
      }
      if (path === "/api/fs/pick" && req.method === "POST") {
        const dir = await pickFolder();
        return json({ supported: dir !== null, dir: dir || null });
      }
      if (path === "/api/project/open" && req.method === "POST") {
        return openProject(ctx, ((await req.json()) as any).dir);
      }
      if (path === "/api/project/new" && req.method === "POST") {
        const raw = String(((await req.json()) as any).dir ?? "");
        const dir = resolve(raw.replace(/^~(?=$|\/)/, homedir()));
        if (!raw) return bad("dir required");
        if (existsSync(join(dir, "index.circuit.tsx"))) return bad("index.circuit.tsx already exists there", 409);
        mkdirSync(dir, { recursive: true });
        await Bun.write(join(dir, "index.circuit.tsx"), STARTER_CIRCUIT);
        return openProject(ctx, dir);
      }
      if (path === "/api/project/files") {
        if (!project) return bad("no project open");
        const fsMap: Record<string, string> = {};
        for (const p of walk(project)) fsMap[relative(project, p).split(sep).join("/")] = await Bun.file(p).text();
        return json({ ...listing(project), fsMap });
      }
      if (path === "/api/project/file" && req.method === "PUT") {
        const p = inProject(url.searchParams.get("path") ?? "");
        if (!p || !TEXT_EXT.test(p)) return bad("bad path");
        await Bun.write(p, await req.text());
        return json({ ok: true });
      }
      if (path === "/api/project/events") return events();
      if (path === "/api/analyze" && req.method === "POST") return runAnalysis(req, url);
      if (path === "/api/export" && req.method === "POST") return runExport(req, url);
      return bad("no such route", 404);
    } catch (err) {
      ctx.reporter.escaped("host", err, { path });
      return bad(String((err as Error).message ?? err), 500);
    }
  },
};
