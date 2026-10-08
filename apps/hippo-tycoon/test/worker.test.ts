// The online path with no cloud: the Worker's routing and identity rules in front
// of the same World class, hosted by Rusty Buns' in-process Durable Object.
import { afterAll, expect, test } from "bun:test";
import { serve, durableObject } from "@rustybuns/shell-bun";
import worker from "../src/worker.ts";
import { World } from "../src/room-do.ts";
import { PROTO_VERSION, type ServerMsg } from "../src/engine/wire.ts";

const env: any = { ASSETS: { fetch: async () => new Response("<h1>page</h1>") } };
env.WORLD = durableObject(World as never, env);
const shell = serve<any>({ hostname: "127.0.0.1", port: 0 });   // no token: the Worker is the front door here
shell.mount({ fetch: (req: Request, e: any) => worker.fetch(req, e) } as never, env);
afterAll(() => shell.stop());

const base = `ws://127.0.0.1:${shell.port}`;
function open(q: string, headers: Record<string, string> = {}) {
  const msgs: ServerMsg[] = [];
  const ws = new WebSocket(`${base}/ws?${q}`, { headers } as never);
  let closed: number | null = null;
  ws.onopen = () => ws.send(JSON.stringify({ t: "hello", v: PROTO_VERSION }));
  ws.onmessage = (e) => msgs.push(JSON.parse(String(e.data)));
  ws.onclose = (e) => { closed = e.code; };
  return { ws, msgs, get closed() { return closed; }, last: <T extends ServerMsg["t"]>(t: T) => msgs.filter((m) => m.t === t).at(-1) as Extract<ServerMsg, { t: T }> | undefined };
}
const until = async (f: () => unknown, ms = 3000) => { const end = Date.now() + ms; while (!f()) { if (Date.now() > end) throw new Error("timed out"); await Bun.sleep(15); } };
const status = async (q: string, headers: Record<string, string> = {}) =>
  (await fetch(`http://127.0.0.1:${shell.port}/ws?${q}`, { headers: { upgrade: "websocket", connection: "upgrade", "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==", "sec-websocket-version": "13", ...headers } })).status;

test("the page comes from assets; /ws needs a websocket, a room code and a player id", async () => {
  expect(await (await fetch(`http://127.0.0.1:${shell.port}/`)).text()).toBe("<h1>page</h1>");
  expect((await fetch(`http://127.0.0.1:${shell.port}/ws?room=ABCD&uid=player-0001`)).status).toBe(426);
  expect(await status("uid=player-0001")).toBe(400);                  // no room
  expect(await status("room=ab&uid=player-0001")).toBe(400);          // too short
  expect(await status("room=AB%20CD&uid=player-0001")).toBe(400);     // not a code
  expect(await status("room=ABCD")).toBe(400);                        // no uid
  expect(await status("room=ABCD&uid=short")).toBe(400);              // uid too short
  expect(await status("room=ABCD&uid=has%20space%20in%20it")).toBe(400);
});

test("two players in one room share it; another room is another world", async () => {
  const a = open("room=QRST&uid=player-aaaa&name=Ada"), b = open("room=qrst&uid=player-bbbb&name=Bo"), c = open("room=OTHER&uid=player-cccc&name=Cy");
  await until(() => a.last("hello") && b.last("hello") && c.last("hello"));
  expect([a.last("hello")!.you, b.last("hello")!.you, c.last("hello")!.you]).toEqual([0, 1, 0]);   // lowercase room codes fold to the same room
  expect(a.last("hello")!.room).toBe("QRST");
  await until(() => a.last("room")?.seats.filter((s) => s.h).length === 2);
  expect(a.last("room")!.seats.slice(0, 2).map((s) => s.n)).toEqual(["Ada", "Bo"]);
  expect(c.last("room")!.seats.filter((s) => s.h).length).toBe(1);
  for (const x of [a, b, c]) x.ws.close();
});

test("identity is the Worker's: client-sent identity headers are stripped, the name is cleaned", async () => {
  const sneaky = open("room=SNEK&uid=player-real1&name=%07Eve%0A", { "X-User-Id": "admin", "X-User-Name": "Root", "X-Room": "NOPE" });
  await until(() => sneaky.last("room"));
  expect(sneaky.last("room")!.seats[0]!.n).toBe("Eve");
  expect(sneaky.last("hello")!.room).toBe("SNEK");
  sneaky.ws.close();
});

test("a second tab of the same player takes over; the room fills at four", async () => {
  const one = open("room=FULL&uid=player-dup01&name=One");
  await until(() => one.last("hello"));
  const two = open("room=FULL&uid=player-dup01&name=One");
  await until(() => two.last("hello") && one.closed !== null);
  expect(one.closed).toBe(4001);
  const others = ["x", "y", "z"].map((n) => open(`room=FULL&uid=player-${n}${n}${n}${n}1&name=${n}`));
  await until(() => others.every((o) => o.last("hello")));
  const fifth = open("room=FULL&uid=player-fifth1&name=Five");
  await until(() => fifth.closed !== null);
  expect(fifth.closed).toBe(4003);
  for (const x of [two, ...others]) x.ws.close();
});
