// The app as it runs online, in this process: the Worker (src/edge/worker.ts) and its RegionRoom Durable Objects
// on Rusty Buns' in-process host, real WebSockets on a free port, and a stand-in eqosys (a fresh signing key, its
// JWKS served on the same port) so a test or a bot signs players in without the real one. It counts what Cloudflare
// would bill the rooms for: socket messages in, the time their handlers ran (a hibernating room is billed for nothing
// else), and every reach for storage.
import { durableObject, installCloudflareGlobals, serve } from "@rustybuns/shell-bun";
import { json } from "@rustybuns/util/http";
import { jwksOf, newKey, sign } from "@rustybuns/util/token";
import worker, { RegionRoom } from "../src/edge/worker.ts";
import type { RoomCtx, RoomSocket } from "@rustybuns/util/room";
import { APP } from "../src/net/wire.ts";
import { together, type TogetherOpts } from "../src/net/together.ts";

export interface Billed {
  /** Socket messages that reached a room, their bytes, and how long each handler ran (ms). */
  messages: number;
  bytesIn: number;
  handlerMs: number[];
  /** Reaches for a room's storage: none, by design. */
  storage: number;
  /** Rooms (Durable Objects) made. */
  rooms: number;
}

export async function local() {
  installCloudflareGlobals();
  const key = { EQOSYS_SIGNING_KEY: await newKey() };
  const billed: Billed = { messages: 0, bytesIn: 0, handlerMs: [], storage: 0, rooms: 0 };
  class Counted extends RegionRoom {
    constructor(ctx: RoomCtx, env: unknown) {
      billed.rooms++;
      super(new Proxy(ctx, { get(t, k) { if (k === "storage") billed.storage++; const v: unknown = Reflect.get(t, k); return typeof v === "function" ? v.bind(t) : v; } }), env);
    }
    override webSocketMessage(ws: RoomSocket, raw: string | ArrayBuffer) {
      billed.messages++; billed.bytesIn += typeof raw === "string" ? raw.length : raw.byteLength;
      const t0 = performance.now();
      super.webSocketMessage(ws, raw);
      billed.handlerMs.push(performance.now() - t0);
    }
  }
  const shell = serve<unknown>({ hostname: "127.0.0.1", port: 0 });
  const origin = `http://127.0.0.1:${shell.port}`;
  const env = { ASSETS: { fetch: async () => new Response("the page") }, EQOSYS_URL: origin, REGION: null as unknown };
  env.REGION = durableObject(Counted as never, env);
  shell.mount({
    fetch: async (req: Request) => new URL(req.url).pathname === "/.well-known/jwks.json" ? json(await jwksOf(key)) : worker.fetch(req, env as never),
  } as never, {});

  /** A token the stand-in eqosys signed for `name` (for another app with `app`). */
  const tokenFor = async (name: string, app = APP) =>
    (await sign(key, origin, { app, user: { id: `u-${name.toLowerCase()}`, email: `${name.toLowerCase()}@example.com`, name }, source: app, access: [] }))!;
  const walkUrl = (q: Record<string, string>) => `ws://127.0.0.1:${shell.port}/walk?${new URLSearchParams(q)}`;

  /** A walker as a page runs one (src/net/together.ts): `at` is where it stands, moved by the caller. */
  async function walker(name: string, party: string, at: { x: number; z: number; yaw: number; region: number }, lead = "hodag", more: Partial<TogetherOpts> = {}) {
    const token = await tokenFor(name);
    const calmed: string[] = [];
    const t = together({
      url: (r) => walkUrl({ party, region: String(r), token, lead }),
      me: () => at, lead: () => lead,
      onCalm: (den) => calmed.push(den),
      ...more,
    });
    return { t, at, calmed, name };
  }
  return { origin, port: shell.port, billed, tokenFor, walkUrl, walker, stop: () => shell.stop() };
}

/** Waits until `f` is true, ticking `walkers` (as each page's frame would) every 10 ms. */
export async function until(f: () => unknown, walkers: { t: { tick(): void } }[] = [], ms = 10_000) {
  const end = Date.now() + ms;
  while (!f()) {
    if (Date.now() > end) throw new Error("timed out");
    for (const w of walkers) w.t.tick();
    await Bun.sleep(10);
  }
}
