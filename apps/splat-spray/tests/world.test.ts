// The world behind real sockets, hosted by Rusty Buns' in-process Durable Object: two players
// join, one presses start, both race to the thing, and the board names the faster one.
import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { serve, durableObject } from "@rustybuns/shell-bun";
import World, { CLOSE_REPLACED } from "../packages/desktop/world.ts";
import { MATCH, parseServerMsg, type View } from "../src/match/game.ts";

setDefaultTimeout(30_000);
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
  const s = { ws, view: null as View | null, closed: null as number | null, send: (m: object) => ws.send(JSON.stringify(m)) };
  ws.onmessage = (e) => { const m = parseServerMsg(JSON.parse(String(e.data))); if (m) s.view = m.view; };
  ws.onclose = (e) => { s.closed = e.code; };
  return s;
}
const until = async (f: () => unknown, ms = 15000) => { const end = Date.now() + ms; while (!f()) { if (Date.now() > end) throw new Error("timed out"); await Bun.sleep(15); } };

test("two players in a lobby: start, the countdown, the race, the round board", async () => {
  const ann = open("player-ann"), bo = open("player-bo");
  await until(() => ann.view?.players.length === 2 && bo.view?.players.length === 2);
  expect(ann.view!.phase).toBe("lobby");
  expect(ann.view!.you).not.toBe(bo.view!.you);
  expect(ann.view!.players.map((p) => p.name).sort()).toEqual(["player-ann", "player-bo"]);

  bo.send({ t: "start" });
  await until(() => ann.view!.phase === "countdown");
  expect(ann.view!.target).toBe(-1);                       // not told yet
  expect(ann.view!.layout).toBe(bo.view!.layout);          // but the same room for both
  await until(() => ann.view!.phase === "play" && bo.view!.phase === "play", MATCH.countdownSecs * 1000 + 5000);
  expect(ann.view!.target).toBe(bo.view!.target);
  expect(ann.view!.target).toBeGreaterThanOrEqual(0);

  await Bun.sleep(MATCH.minFindMs + 100);
  ann.send({ t: "pick", id: ann.view!.target, shots: 5 });
  await until(() => bo.view!.players.some((p) => p.ms > 0));      // Bo sees Ann's find, still racing
  expect(bo.view!.phase).toBe("play");
  bo.send({ t: "pick", id: bo.view!.target, shots: 8 });
  await until(() => ann.view!.phase === "results");
  const [first, second] = ann.view!.players;
  expect([first!.name, second!.name]).toEqual(["player-ann", "player-bo"]);
  expect([first!.got, second!.got]).toEqual([MATCH.points[0], MATCH.points[1]]);
  ann.ws.close(); bo.ws.close();
});

test("the same player again replaces their older socket and stays in the match", async () => {
  const one = open("player-solo");
  await until(() => one.view);
  const two = open("player-solo");
  await until(() => two.view && one.closed !== null);
  expect(one.closed).toBe(CLOSE_REPLACED);
  expect(two.view!.players.filter((p) => p.name === "player-solo").length).toBe(1);
  two.ws.close();
});

test("one person starting a race gets bots to race, and the round ends when they have found it", async () => {
  const solo = open("player-lonely");
  await until(() => solo.view);
  solo.send({ t: "start" });
  await until(() => solo.view!.phase === "countdown");
  expect(solo.view!.players.length).toBe(MATCH.botsTo);
  await until(() => solo.view!.phase === "play", MATCH.countdownSecs * 1000 + 5000);
  await Bun.sleep(MATCH.minFindMs + 100);
  solo.send({ t: "pick", id: solo.view!.target, shots: 4 });
  await until(() => solo.view!.phase === "results");
  expect(solo.view!.players.filter((p) => p.ms > 0).length).toBeGreaterThanOrEqual(1);
  solo.ws.close();
});

test("a right pick the instant the round opens still counts, at the minimum time", async () => {
  const a = open("player-quick");
  await until(() => a.view?.players.length === 1);
  a.send({ t: "start" });
  await until(() => a.view!.phase === "play", MATCH.countdownSecs * 1000 + 5000);
  a.send({ t: "pick", id: a.view!.target, shots: 1 });            // the page shows "Found" at once, so the world must agree
  await until(() => a.view!.players.some((p) => p.id === a.view!.you && p.ms >= MATCH.minFindMs));
  a.ws.close();
});
