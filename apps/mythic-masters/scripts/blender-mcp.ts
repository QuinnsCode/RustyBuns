// A Blender MCP server with three named calls and no Python: `bun scripts/blender-mcp.ts [--local]` speaks MCP on
// stdio and forwards each call to a warm Blender (`warmBlender` in @rustybuns/cli/blender), on the builder Mac over
// ssh when BUILDER_HOST is set, else (or with --local) on this one. The Blender starts on the first call and stops
// when the client closes this server's stdin (the ssh, and the Blender on Bob, go with it).
//
//   blender_load   {beast} or {glb}         a beast's GLB (public/models/<id>.glb) or any GLB under this app, sent as bytes
//   blender_stats  {part?}                  triangles, faces and size per mesh, and per material (a beast's parts)
//   blender_render {view?, size?, yaw?, pitch?}   a PNG from front/back/left/right/top/three-quarter, or yaw and pitch degrees
//
// Add it to a claude run: `claude mcp add blender -- bun <repo>/apps/mythic-masters/scripts/blender-mcp.ts` (user
// scope, or a one-off `--mcp-config`). The calls are in docs/BLENDER-TOOLS.md.
import { realpathSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { warmBlender, type WarmBlender } from "@rustybuns/cli/blender";
import { arr, int, num, obj, oneOf, opt, raw, str, type Of } from "@rustybuns/util/guard";
import { help } from "../../../scripts/help.ts";

help(import.meta.path);
const APP = join(import.meta.dir, "..");
const local = process.argv.includes("--local") || !process.env.BUILDER_HOST;
const VIEWS = ["front", "back", "left", "right", "top", "three-quarter"] as const;

const TOOLS = [
  {
    name: "blender_load",
    description: "Load one model into the warm Blender (an empty scene first). `beast` is a Mythic Masters beast id (its public/models/<id>.glb); `glb` is a path under apps/mythic-masters. Answers the mesh names.",
    inputSchema: { type: "object", properties: { beast: { type: "string" }, glb: { type: "string" } } },
  },
  {
    name: "blender_stats",
    description: "Verts, faces, triangles and size of each loaded mesh, and faces and triangles per material (a beast's parts: skin, horn, eye...). `part` narrows it to one mesh or material.",
    inputSchema: { type: "object", properties: { part: { type: "string" } } },
  },
  {
    name: "blender_render",
    description: "A PNG of the loaded model, Workbench-shaded. `view` is front, back, left, right, top or three-quarter (default); or give `yaw` (degrees round from the front) and `pitch` (degrees above). `size` in pixels, 64-2048 (512).",
    inputSchema: { type: "object", properties: { view: { type: "string", enum: VIEWS }, yaw: { type: "number" }, pitch: { type: "number" }, size: { type: "number" } } },
  },
];

const Load = obj({ beast: opt(str(64, { re: /^[a-z0-9-]+$/ })), glb: opt(str(400)) });
const Stats = obj({ part: opt(str(200)) });
const Render = obj({ view: opt(oneOf(VIEWS)), yaw: opt(num(-360, 360)), pitch: opt(num(-90, 90)), size: opt(int(64, 2048)) });
const Rendered = obj({ png: str(50_000_000) });
const Loaded = obj({ meshes: arr(str(), 1000) });

let blender: Promise<WarmBlender> | null = null;
const warm = () => blender ??= warmBlender(local
  ? { cwd: APP, onLog: (l) => console.error(l) }
  : { host: process.env.BUILDER_HOST, onLog: (l) => console.error(l) });

type Content = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };
async function run(name: string, args: unknown): Promise<Content[]> {
  const b = await warm();
  if (name === "blender_load") {
    const a = Load(args ?? {});
    const path = a.beast ? `public/models/${a.beast}.glb` : a.glb;
    if (!path) throw new Error("give a beast id or a glb path");
    // inside the app as written, and again once links are followed
    const out = (p: string, root: string) => relative(root, p).startsWith("..");
    if (out(resolve(APP, path), APP)) throw new Error(`${path} is outside apps/mythic-masters`);
    const full = realpathSync(resolve(APP, path));
    if (out(full, realpathSync(APP))) throw new Error(`${path} is outside apps/mythic-masters`);
    const bytes = Buffer.from(await Bun.file(full).arrayBuffer()).toString("base64");
    const { meshes } = Loaded(await b.call("load", { glb: path, bytes }));
    return [{ type: "text", text: `loaded ${path} on ${b.info.blender}: ${meshes.join(", ")}` }];
  }
  if (name === "blender_stats") return [{ type: "text", text: JSON.stringify(await b.call("stats", { part: Stats(args ?? {}).part }), null, 1) }];
  if (name === "blender_render") {
    const a = Render(args ?? {});
    const view = a.yaw !== undefined || a.pitch !== undefined ? { yaw: a.yaw ?? 0, pitch: a.pitch ?? 0 } : a.view ?? "three-quarter";
    const { png } = Rendered(await b.call("render", { view, size: a.size ?? 512 }));
    return [{ type: "image", data: png, mimeType: "image/png" }];
  }
  throw new Error(`no tool ${name}`);
}

// MCP over stdio is JSON-RPC, one message a line. Only what a client needs: initialize, tools/list, tools/call, ping.
const Message = obj({ id: opt(int(-1e15, 1e15)), method: str(200), params: opt(obj({ name: opt(str(200)), arguments: opt(raw) })) });
type Message = Of<typeof Message>;
const send = (m: unknown) => process.stdout.write(JSON.stringify(m) + "\n");
const answer = (id: number | undefined, result: unknown) => { if (id !== undefined) send({ jsonrpc: "2.0", id, result }); };

async function handle(m: Message) {
  if (m.method === "initialize") return answer(m.id, { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "rustybuns-blender", version: "0.1.0" } });
  if (m.method === "tools/list") return answer(m.id, { tools: TOOLS });
  if (m.method === "ping") return answer(m.id, {});
  if (m.method === "tools/call") {
    try { return answer(m.id, { content: await run(m.params?.name ?? "", m.params?.arguments) }); }
    catch (e) { return answer(m.id, { content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }], isError: true }); }
  }
  if (m.id !== undefined) send({ jsonrpc: "2.0", id: m.id, error: { code: -32601, message: `no method ${m.method}` } });
}

// One call at a time, in order: the Blender behind it runs them one after another anyway.
let queue = Promise.resolve();
for await (const line of console) {
  if (!line.trim()) continue;
  const m = (() => { try { return Message(JSON.parse(line)); } catch { return null; } })();
  if (m) queue = queue.then(() => handle(m));
}
await queue;
await stop();
async function stop() { if (blender) await (await blender).close(); }
