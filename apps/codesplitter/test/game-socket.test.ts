import { expect, test } from "bun:test";
import { GameRoom, vec } from "../src/game-do.ts";

// A socket stand-in: what the room sends is what the other player would see.
const sock = (user: string, id: string) => {
  let att: unknown = { id, user, ready: false, alive: true, score: 0, wave: 0, seen: Date.now() };
  const sent: any[] = [];
  return { sent, send: (s: string) => sent.push(JSON.parse(s)), serializeAttachment: (a: unknown) => (att = a), deserializeAttachment: () => att };
};

test("a player's position and bop reach the others only as numbers", async () => {
  const a = sock("ana", "a"), b = sock("bo", "b");
  const room = new GameRoom({ getWebSockets: () => [a, b], storage: { get: async () => undefined, put: async () => {} } }, {});
  const say = (m: unknown) => room.webSocketMessage(a, JSON.stringify(m));

  await say({ t: "pos", p: [1, 2, 3], yaw: 0.5, room: "src", swing: true });
  await say({ t: "pos", p: { x: "<img onerror=x>" }, yaw: "<b>", room: { a: 1 } });
  await say({ t: "pos", p: [1, 2, "<i>"], yaw: 0 });
  await say({ t: "pos", p: [1, 2, 3], yaw: "<b>", room: "x".repeat(600) });
  expect(b.sent).toEqual([
    { t: "pos", id: "a", user: "ana", p: [1, 2, 3], yaw: 0.5, room: "src", swing: true },
    { t: "pos", id: "a", user: "ana", p: [1, 2, 3], yaw: 0, room: "", swing: false },
  ]);

  b.sent.length = 0;
  await say({ t: "hit", target: "b", dir: ["<b>", 1] });
  await say({ t: "hit", target: "b", dir: [0, 1] });
  expect(b.sent).toEqual([{ t: "bopped", by: "ana", dir: [0, 1] }]);
});

test("vec takes only finite numbers of the right length", () => {
  for (const [v, n, ok] of [[[1, 2], 2, true], [[1], 2, false], [[1, NaN], 2, false], [[1, null], 2, false], ["12", 2, false]] as const)
    expect(vec(v, n) !== undefined).toBe(ok);
});
