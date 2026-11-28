// `bun run dev`: the page and its relay in one Bun server, so an agent on this machine connects the way it would to
// the deployed one (http://localhost:4799/r/<room>, the Connect box's lines). Bun bundles index.html itself. Rooms,
// their saved worlds and Agent Galaxy live in memory for as long as the server runs, and each room's Artifacts repo
// in a temp folder that goes with it (needs `git`). `--port 4799` (or `--port 0`).
// Sign-in tokens are checked against EQOSYS_URL's keys (a local eqosys, or a test's), else the live eqosys's.
import { onPortOrFree, portArg } from "@rustybuns/util/ports";
import { json, parseJson } from "@rustybuns/util/http";
import { TokenBucket } from "@rustybuns/util/limits";
import type { ServerWebSocket } from "bun";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gitHttp, LocalArtifacts } from "../../../packages/shell-bun/src/bindings/artifacts.ts";
import about from "../about.html";
import index from "../index.html";
import { Galaxy, type FromGalaxy, type Hub, joined, left, memoryKv, walked, type Walker } from "../src/galaxy.ts";
import { fromPage, linksFor, Relay } from "../src/relay.ts";
import { fileBucket, filesHttp } from "../src/files.ts";
import { KEEP_AFTER_MS, Saved } from "../src/saved.ts";
import { pictureBucket, pictureHttp, type Pictures, withCard } from "../src/share.ts";
import { ROOM } from "../src/tools.ts";
import { EQOSYS, whoSent } from "../src/who.ts";

const port = portArg(process.argv[process.argv.indexOf("--port") + 1], "agentWorld");
/** A socket is a room's page, or a player walking the galaxy (the same limits as the Durable Object's). */
type Tag = { room: string; walker?: Walker; bucket?: TokenBucket };

const repoDir = mkdtempSync(join(tmpdir(), "agentworld-artifacts-"));
process.once("exit", () => rmSync(repoDir, { recursive: true, force: true }));
for (const s of ["SIGINT", "SIGTERM"] as const) process.once(s, () => process.exit(0));
const artifacts = new LocalArtifacts(repoDir, "agentworld");
const git = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: (req) => gitHttp(req, [artifacts]) });
artifacts.remoteBase = `http://127.0.0.1:${git.port}`;
const rooms = new Map<string, { relay: Relay; saved: Saved; pages: ServerWebSocket<Tag>[]; pictures: Pictures; uploads: ReturnType<typeof pictureBucket>; files: ReturnType<typeof fileBucket> }>();
const roomFor = (id: string) => {
  let r = rooms.get(id);
  if (!r) {
    const pages: ServerWebSocket<Tag>[] = [];
    let picture: Uint8Array<ArrayBuffer> | undefined;
    const pictures: Pictures = { get: async () => picture, put: async (bytes) => { picture = bytes; } };
    // The Durable Object's alarm: one timer at a time.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const later = () => { timer ??= setTimeout(() => { timer = undefined; void saved.keep().catch((e: unknown) => console.warn(`keeping ${id}: ${e}`)); }, KEEP_AFTER_MS); };
    const saved: Saved = new Saved(memoryKv(), { repos: artifacts, later });
    r = { pages, pictures, uploads: pictureBucket(), files: fileBucket(), saved, relay: new Relay(() => { const p = pages.at(-1); return p ? (frame) => p.send(frame) : null; }) };
    rooms.set(id, r);
  }
  return r;
};

/** The bundled page (at /__page) with its link preview, as the Worker serves the built one. */
const card = async (req: Request, srv: { url: URL }) =>
  withCard(await fetch(new URL("/__page", srv.url)), new URL(req.url), async (room) => (await rooms.get(room)?.pictures.get()) !== undefined);

const galaxy = new Galaxy(memoryKv(), (req) => whoSent(req, process.env.EQOSYS_URL || EQOSYS));
const walkers = new Set<ServerWebSocket<Tag>>();
const hub: Hub<ServerWebSocket<Tag>> = {
  list: () => [...walkers].flatMap((s) => (s.data.walker ? [{ s, p: s.data.walker }] : [])),
  save: (s, p) => { s.data.walker = p; },
  send: (s, m: FromGalaxy) => s.send(JSON.stringify(m)),
};
/** A room's own doors: its picture, its saved world, the agents' tools. The Galaxy asks the first two for a plot. */
const roomHttp = (req: Request, room: string, rest: string) => {
  const r = roomFor(room);
  if (rest === "/picture") return pictureHttp(req, r.pictures, r.uploads);
  if (rest === "/world") return r.saved.http(req);
  if (rest === "/made") return r.saved.http(req, true);
  if (rest === "/files" || rest.startsWith("/files/")) return filesHttp(req, artifacts, r.files, room, rest);
  return r.relay.http(req, rest, linksFor(new URL(req.url).origin, room));
};

const { server, moved } = onPortOrFree(port, (p) => Bun.serve<Tag>({
  port: p,
  // This Mac only: the room link is the key, so other machines on the same Wi-Fi shouldn't get a door at all.
  hostname: "127.0.0.1",
  routes: { "/about": about, "/__page": index, "/": card, "/r/:room": card, "/og.jpg": () => new Response(Bun.file(new URL("../public/og.jpg", import.meta.url))) },
  async fetch(req, srv) {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/.well-known/")) return json({ error: "no sign-in: the room's link is its key" }, 404);
    if (url.pathname === "/api/galaxy" || url.pathname.startsWith("/api/galaxy/") || url.pathname === "/api/me/world") {
      const rest = url.pathname === "/api/me/world" ? "/me/world" : url.pathname.slice("/api/galaxy".length);
      if (rest === "/socket") {
        const w = await galaxy.seat(req);
        if (w instanceof Response) return w;
        return srv.upgrade(req, { data: { room: "", walker: w, bucket: new TokenBucket(12, 24, Date.now()) } }) ? undefined : json({ error: "this is the galaxy's socket" }, 426);
      }
      return galaxy.http(req, rest, (room, path) => roomHttp(new Request(`${url.origin}/api/r/${room}${path}`), room, path));
    }
    const m = url.pathname.match(/^\/api\/r\/([^/]+)(\/.*)?$/);
    if (!m || !ROOM.test(m[1]!)) return json({ error: "not a room: /api/r/<room>/tools" }, 404);
    const [, room, rest = ""] = m;
    if (rest === "/socket" && !fromPage(req)) return json({ error: "only this site's page may hold the room" }, 403);
    if (rest === "/socket") return srv.upgrade(req, { data: { room: room! } }) ? undefined : json({ error: "this is the page's socket" }, 426);
    return roomHttp(req, room!, rest);
  },
  websocket: {
    open(ws) {
      const w = ws.data.walker;
      if (!w) { roomFor(ws.data.room).pages.push(ws); return; }
      // One socket per player: another tab of the same room takes the character over.
      for (const o of walkers) if (o.data.walker?.id === w.id) { walkers.delete(o); o.close(4001, "replaced"); }
      walkers.add(ws);
      joined(hub, ws, w);
    },
    message(ws, raw) {
      if (typeof raw !== "string") return;
      if (!ws.data.walker) { roomFor(ws.data.room).relay.heard(parseJson(raw)); return; }
      if (raw.length <= 256 && ws.data.bucket?.take(Date.now())) walked(hub, ws, parseJson(raw));
    },
    close(ws) {
      const w = ws.data.walker;
      if (!w) { const r = roomFor(ws.data.room); r.pages.splice(r.pages.indexOf(ws), 1); return; }
      if (walkers.delete(ws)) left(hub, ws, w);
    },
  },
  development: true,
}));

console.log(`Agent World: http://127.0.0.1:${server.port}${moved ? ` (${port} was taken)` : ""}`);
