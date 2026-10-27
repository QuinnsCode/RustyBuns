import { describe, expect, test } from "bun:test";
import worker, { World } from "../src/edge/worker.ts";
import { MAX_RIDERS, parsePose, Room } from "../src/net/room.ts";

const pose = (x = 0) => ({ skin: "fingerboard" as const, n: [x, 0, 0, 0, 0, 0, 0, 0, 0, 0.4] as never });

describe("a room", () => {
  test("holds four riders; the fifth is turned away, a returning one is not", () => {
    const room = new Room();
    for (let i = 0; i < MAX_RIDERS; i++) expect(room.join(`r${i}`, `R${i}`)).toBe(true);
    expect(room.join("r5", "late")).toBe(false);
    expect(room.join("r0", "R0")).toBe(true);
    room.leave("r1");
    expect(room.join("r5", "late")).toBe(true);
  });

  test("each rider sees the others, never themselves, and only once they have posed", () => {
    const room = new Room();
    room.join("a", "A"); room.join("b", "B"); room.join("c", "C");
    room.pose("a", pose(1)); room.pose("b", pose(2));
    expect(room.view("a").riders.map((r) => r.id)).toEqual(["b"]);
    expect(room.view("c").riders.map((r) => r.id).sort()).toEqual(["a", "b"]);
  });

  test("a bad pose is refused and a wild one is clamped", () => {
    expect(parsePose({ skin: "tank", n: [] })).toBeNull();
    expect(parsePose({ skin: "roadster", n: [1, 2, 3, NaN, 0, 0, 0, 0, 0, 0] })).toBeNull();
    expect(parsePose({ skin: "roadster", n: [1e9, 0, 0, 0, 0, 0, 0, 0, 0, 0] })!.n[0]).toBe(5000);
  });
});

describe("the worker", () => {
  let named = "";
  const env = { ASSETS: { fetch: async () => new Response("page") }, WORLD: { idFromName: (n: string) => (named = n), get: () => ({ fetch: async (r: Request) => new Response(r.headers.get("X-User-Id")) }) } };
  const ws = (q: string, headers: Record<string, string> = {}) => worker.fetch(new Request(`https://stp.example/ws?${q}`, { headers: { Upgrade: "websocket", ...headers } }), env as never);

  test("serves the page, vouches its own identity and checks the door", async () => {
    expect(await (await worker.fetch(new Request("https://stp.example/"), env as never)).text()).toBe("page");
    const ok = await ws("room=abcd&level=el-capitan&uid=abcdefgh1234", { "X-User-Id": "someone-else" });
    expect(await ok.text()).toBe("abcdefgh1234");
    expect((await ws("room=ab&level=el-capitan&uid=abcdefgh1234")).status).toBe(400);
    expect((await ws("room=ABCD&level=../x&uid=abcdefgh1234")).status).toBe(400);
    expect((await ws("room=ABCD&level=el-capitan&uid=abcdefgh1234", { Origin: "https://evil.example" })).status).toBe(403);
  });

  test("real-height and squashed riders are in different rooms, so nobody is drawn buried or floating", async () => {
    const room = async (q: string) => { await ws(`room=ABCD&level=el-capitan&uid=abcdefgh1234${q}`); return named; };
    const plain = await room(""), real = await room("&real=1");
    expect(real).not.toBe(plain);
    expect(await room("")).toBe(plain);
  });
});

test("the world exports its Durable Object", () => { expect(typeof World).toBe("function"); });

import { bump } from "../src/net/bump.ts";
describe("running into another board", () => {
  const me = () => ({ x: 0, y: 0, z: 0, vx: 0, vz: 3, yaw: 0, speed: 3, air: false, grind: -1 });
  const other = (z: number, y = 0) => ({ pose: { skin: "fingerboard" as const, n: [0, y, z, 0, 0, 0, 0, 0, 0, 0] as never } });
  test("head on: pushed out and bounced back", () => {
    const s = me();
    expect(bump(s, [other(2)])).toBe(true);
    expect(s.z).toBeLessThan(0);
    expect(s.speed).toBeLessThan(0);
  });
  test("a board far off, or on another level of the park, is no obstacle", () => {
    const s = me();
    expect(bump(s, [other(10), other(1, 5)])).toBe(false);
    expect(s.z).toBe(0);
  });
});
