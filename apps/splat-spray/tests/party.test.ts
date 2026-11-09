// Playing with friends: Qollab's party hands every page its code as the room and the host seat 0 (apps/eqosys/src/qollab/party.ts).
// Here two friends land in that room on the real World behind sockets, the host's page waits for both and starts the mission
// itself, and the race is the two of them, no bots. The party side against a live eqosys is apps/eqosys/scripts/live-check-splat-spray.ts.
import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { serve, durableObject } from "@rustybuns/shell-bun";
import World from "../packages/desktop/world.ts";
import { parseServerMsg, type View } from "../src/match/game.ts";
import { partyCode, partyReady, type Arrival } from "../src/party.ts";

setDefaultTimeout(30_000);
const env: Record<string, unknown> = {};
env.WORLD = durableObject(World as never, env as never);
const shell = serve<never>({ hostname: "127.0.0.1", port: 0 });
// Stands in for the edge Worker: vouches the uid from the query, and the room is the one asked for.
shell.mount({
  fetch: (req: Request, e: { WORLD: { idFromName(n: string): unknown; get(id: unknown): { fetch(r: Request): Promise<Response> } } }) => {
    const q = new URL(req.url).searchParams;
    const headers = new Headers(req.headers);
    headers.set("X-User-Id", q.get("uid")!); headers.set("X-User-Name", q.get("uid")!);
    return e.WORLD.get(e.WORLD.idFromName(q.get("room")!)).fetch(new Request(req, { headers }));
  },
} as never, env as never);
afterAll(() => shell.stop());

/** A page that came in from the party: its socket, and the page's rule for starting the mission (main.ts onView). */
function arrive(uid: string, a: Arrival) {
  let pending: Arrival | null = a;
  const ws = new WebSocket(`ws://127.0.0.1:${shell.port}/ws?${new URLSearchParams({ uid, room: a.room })}`);
  const s = { view: null as View | null, starts: 0 };
  ws.onmessage = (e) => {
    const m = parseServerMsg(JSON.parse(String(e.data)));
    if (!m) return;
    s.view = m.view;
    if (partyReady(pending, m.view)) { pending = null; s.starts++; ws.send(JSON.stringify({ t: "start" })); }
  };
  return { ws, get: () => s };
}
const until = async (f: () => boolean) => { const end = Date.now() + 10_000; while (!f()) { if (Date.now() > end) throw new Error("timed out"); await Bun.sleep(20); } };

test("a party's link names a room, and both friends race there once the host's page sees them both", async () => {
  for (const [search, code] of [["?party=bcdfgh", "BCDFGH"], ["?party=no", null], ["?room=PIKA", null]] as const) expect(partyCode(search)).toBe(code);

  const room = "BCDFGH";
  const host = arrive("ada", { room, host: true, expect: 2 });
  await until(() => host.get().view?.phase === "lobby");
  await Bun.sleep(300);
  // Alone in the safehouse, the host's page waits for the friend instead of starting a race against bots.
  expect(host.get().view?.phase).toBe("lobby");
  expect(host.get().starts).toBe(0);

  const bo = arrive("bo", { room, host: false, expect: 2 });
  await until(() => bo.get().view?.phase === "countdown" && host.get().view?.phase === "countdown");
  expect(host.get().starts).toBe(1);
  expect(bo.get().starts).toBe(0);
  expect(bo.get().view!.players.map((p) => p.name).sort()).toEqual(["ada", "bo"]);
  host.ws.close(); bo.ws.close();
});
