// An agent in a Qollab Studio jam room from the CLI: an MCP server on stdio that joins a sesh as its own player,
// with an avatar and a name, and serves the same studio_* tools as the jam page's WebMCP (src/studio/agent.ts):
// look around, sit at a spot, play notes, ask to play, make an instrument. It follows the sesh's floor like a person.
//
//   bun apps/fm-daw/scripts/studio-mcp.ts --sesh https://<fm-daw host>/sesh/<name> [--name Bot] [--code <code>]
//
// In an MCP client's config: { "command": "bun", "args": ["apps/fm-daw/scripts/studio-mcp.ts", "--sesh", "..."] }.
// Local: `bun run dev` in apps/fm-daw, then --sesh http://localhost:5173/sesh/<name>.
import { parseArgs } from "node:util";
import { check } from "@rustybuns/util/guard";
import { mulberry32 } from "@rustybuns/util";
import { randomAvatar } from "@rustybuns/util/avatar";
import { help } from "../../../scripts/help.ts";
import { seshFromPath } from "../src/sesh.ts";
import { remotePlayer, studioTools } from "../src/studio/agent.ts";
import { mcpAnswer, Rpc } from "../src/studio/mcp.ts";
import { ROOMS, LIVE_ROOM } from "../src/studio/rooms/index.ts";

help(import.meta.path);
const { values } = parseArgs({ options: { sesh: { type: "string" }, name: { type: "string", default: "Bot" }, code: { type: "string" }, studio: { type: "string" } } });
const page = values.sesh ? new URL(values.sesh) : null;
const room = page && seshFromPath(page.pathname);
if (!page || !room) { console.error("--sesh https://<host>/sesh/<name> is the sesh to join (--help)"); process.exit(1); }

const ws = new URL(`${page.protocol === "https:" ? "wss" : "ws"}://${page.host}/ws`);
ws.searchParams.set("room", room);
if (values.code) ws.searchParams.set("code", values.code);
const sock = new WebSocket(ws.href);
const outbox: string[] = [];
const seat = remotePlayer({
  base: ROOMS[values.studio ?? ""] ?? LIVE_ROOM, name: values.name.slice(0, 40), avatar: randomAvatar(mulberry32(Date.now() >>> 0)),
  send: (m) => { const s = JSON.stringify(m); if (sock.readyState === WebSocket.OPEN) sock.send(s); else outbox.push(s); },
});
sock.addEventListener("open", () => { for (const s of outbox.splice(0)) sock.send(s); });
sock.addEventListener("message", (e) => { if (typeof e.data === "string") seat.hear(e.data); });
sock.addEventListener("close", (e) => { console.error(`the sesh closed the socket (${e.code} ${e.reason})`); process.exit(e.code === 1000 ? 0 : 1); });

const tools = studioTools(seat.player);
// one call at a time, in order: a play answers when its last note ends
let queue = Promise.resolve();
for await (const line of console) {
  if (!line.trim()) continue;
  const m = (() => { try { return check(Rpc, JSON.parse(line)); } catch { return null; } })();
  if (m) queue = queue.then(async () => { const r = await mcpAnswer(tools, m); if (r) process.stdout.write(JSON.stringify(r) + "\n"); });
}
await queue;
sock.close(1000);
