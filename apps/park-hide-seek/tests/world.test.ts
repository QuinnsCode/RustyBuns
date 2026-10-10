// The world behind real sockets, hosted by Rusty Buns' in-process Durable Object.
import { afterAll, expect, test } from "bun:test";
import { serve, durableObject } from "@rustybuns/shell-bun";
import World, { CLOSE_REPLACED } from "../packages/desktop/world.ts";

const env: any = {};
env.WORLD = durableObject(World as never, env);
const shell = serve<any>({ hostname: "127.0.0.1", port: 0 });
// Stands in for the edge Worker: vouches the uid from the query.
shell.mount({
  fetch: (req: Request, e: any) => {
    const uid = new URL(req.url).searchParams.get("uid")!;
    const headers = new Headers(req.headers);
    headers.set("X-User-Id", uid); headers.set("X-User-Name", uid);
    return e.WORLD.get(e.WORLD.idFromName("ROOM")).fetch(new Request(req, { headers }));
  },
} as never, env);
afterAll(() => shell.stop());

function open(uid: string) {
  const ws = new WebSocket(`ws://127.0.0.1:${shell.port}/ws?uid=${uid}`);
  const s = { ws, views: 0, closed: null as number | null };
  ws.onmessage = () => { s.views++; };
  ws.onclose = (e) => { s.closed = e.code; };
  return s;
}
const until = async (f: () => unknown, ms = 10000) => { const end = Date.now() + ms; while (!f()) { if (Date.now() > end) throw new Error("timed out"); await Bun.sleep(15); } };

test("the same player again replaces their older socket and stays in the game", async () => {
  const one = open("player-one");
  await until(() => one.views > 0);
  const two = open("player-one");
  await until(() => two.views > 0 && one.closed !== null);
  expect(one.closed).toBe(CLOSE_REPLACED);
  const seen = two.views;
  const other = open("player-two");                 // a join moves the game: the replacement still gets views
  await until(() => other.views > 0 && two.views > seen);
  expect(two.closed).toBeNull();
  two.ws.close(); other.ws.close();
}, 30_000);
