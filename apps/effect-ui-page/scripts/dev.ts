// `bun run dev`: the page and its relay in one Bun server, so an agent on this machine connects the way it would to
// the deployed one (http://localhost:4799/r/<room>, the Connect box's lines). Bun bundles index.html itself. Rooms
// live in memory for as long as the server runs. `--port 4799` (or `--port 0` for any free one).
import { onPortOrFree, portArg } from "@rustybuns/util/ports";
import { json, parseJson } from "@rustybuns/util/http";
import type { ServerWebSocket } from "bun";
import index from "../index.html";
import { fromPage, linksFor, Relay } from "../src/relay.ts";
import { pictureBucket, pictureHttp, type Pictures, withCard } from "../src/share.ts";
import { ROOM } from "../src/tools.ts";

const port = portArg(process.argv[process.argv.indexOf("--port") + 1], "agentPage");
type Tag = { room: string };
const rooms = new Map<string, { relay: Relay; pages: ServerWebSocket<Tag>[]; pictures: Pictures; uploads: ReturnType<typeof pictureBucket> }>();
const roomFor = (id: string) => {
  let r = rooms.get(id);
  if (!r) {
    const pages: ServerWebSocket<Tag>[] = [];
    let picture: Uint8Array<ArrayBuffer> | undefined;
    const pictures: Pictures = { get: async () => picture, put: async (bytes) => { picture = bytes; } };
    r = { pages, pictures, uploads: pictureBucket(), relay: new Relay(() => { const p = pages.at(-1); return p ? (frame) => p.send(frame) : null; }) };
    rooms.set(id, r);
  }
  return r;
};

/** The bundled page (at /__page) with its link preview, as the Worker serves the built one. */
const card = async (req: Request, srv: { url: URL }) =>
  withCard(await fetch(new URL("/__page", srv.url)), new URL(req.url), async (room) => (await rooms.get(room)?.pictures.get()) !== undefined);

const { server, moved } = onPortOrFree(port, (p) => Bun.serve<Tag>({
  port: p,
  // This Mac only: the room link is the key, so other machines on the same Wi-Fi shouldn't get a door at all.
  hostname: "127.0.0.1",
  routes: { "/__page": index, "/": card, "/r/:room": card, "/og.jpg": () => new Response(Bun.file(new URL("../public/og.jpg", import.meta.url))) },
  async fetch(req, srv) {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/.well-known/")) return json({ error: "no sign-in: the room's link is its key" }, 404);
    const m = url.pathname.match(/^\/api\/r\/([^/]+)(\/.*)?$/);
    if (!m || !ROOM.test(m[1]!)) return json({ error: "not a room: /api/r/<room>/tools" }, 404);
    const [, room, rest = ""] = m;
    if (rest === "/socket" && !fromPage(req)) return json({ error: "only this site's page may hold the room" }, 403);
    if (rest === "/socket") return srv.upgrade(req, { data: { room: room! } }) ? undefined : json({ error: "this is the page's socket" }, 426);
    if (rest === "/picture") { const r = roomFor(room!); return pictureHttp(req, r.pictures, r.uploads); }
    return roomFor(room!).relay.http(req, rest, linksFor(url.origin, room!));
  },
  websocket: {
    open(ws) { roomFor(ws.data.room).pages.push(ws); },
    message(ws, raw) { if (typeof raw === "string") roomFor(ws.data.room).relay.heard(parseJson(raw)); },
    close(ws) { const r = roomFor(ws.data.room); r.pages.splice(r.pages.indexOf(ws), 1); },
  },
  development: true,
}));

console.log(`Agent Page: http://127.0.0.1:${server.port}${moved ? ` (${port} was taken)` : ""}`);
