// Walking the open world together (#3663), through the running Worker and its rooms: two friends in one region see
// each other walk, share the world's clock and a den one of them walked into, one leaves and comes back without losing
// it, and crossing into another region parts them. Then who is turned away at the door.
import { afterAll, expect, setDefaultTimeout, test } from "bun:test";
import { CLOSE_FULL, MAX_PARTY, SEND_MS } from "../src/net/wire.ts";
import { local, until } from "./app-kit.ts";

setDefaultTimeout(30_000);
const app = await local();
afterAll(() => app.stop());

test("two friends walk one region together, and a den one walks into is quiet for both", async () => {
  const ada = await app.walker("Ada", "WOODS1", { x: 3000, z: 2000, yaw: 0, region: 1 }, "hodag");
  const bo = await app.walker("Bo", "WOODS1", { x: 3010, z: 2000, yaw: Math.PI, region: 1 }, "squonk");
  const both = [ada, bo];
  await until(() => ada.t.friends().length && bo.t.friends().length, both);
  expect(bo.t.friends()[0]).toMatchObject({ name: "Ada", lead: "hodag" });
  expect(ada.t.friends()[0]).toMatchObject({ name: "Bo", lead: "squonk", x: 3010, z: 2000 });

  // Ada walks east for a second; Bo sees her get there, smoothly, never ahead of where she was.
  const seen: number[] = [], sent = ada.t.state().sent, t0 = performance.now();
  for (let i = 0; i < 100; i++) { ada.at.x += 0.1; ada.t.tick(); bo.t.tick(); seen.push(bo.t.friends()[0]!.x); await Bun.sleep(10); }
  const walked = performance.now() - t0;
  await until(() => Math.abs(bo.t.friends()[0]!.x - ada.at.x) < 0.05, both);
  expect(seen.every((x, i) => i === 0 || x >= seen[i - 1]! - 1e-9)).toBe(true);
  expect(Math.max(...seen)).toBeLessThanOrEqual(ada.at.x + 1e-6);
  // A hundred steps went out as a handful of poses: one a beat while she walked, and one more to say she stopped.
  expect(ada.t.state().sent - sent).toBeLessThanOrEqual(Math.ceil(walked / SEND_MS) + 2);

  // One world: the same clock, and the den Ada walks into goes quiet for Bo.
  expect(Math.abs(ada.t.clock()! - bo.t.clock()!)).toBeLessThan(0.5);
  ada.t.calm("12,7");
  await until(() => bo.calmed.includes("12,7"), both);

  // Bo drops out; Ada walks on alone. Bo comes back and the den is still quiet.
  bo.t.close();
  await until(() => !ada.t.friends().length, both.slice(0, 1));
  const back = await app.walker("Bo", "WOODS1", bo.at, "squonk");
  await until(() => ada.t.friends().length && back.t.friends().length, [ada, back]);
  expect(back.calmed).toContain("12,7");

  // Ada crosses into the next region: another room, so they part.
  ada.at.region = 2;
  await until(() => !back.t.friends().length && ada.t.state().region === 2 && ada.t.state().open, [ada, back]);
  ada.t.close(); back.t.close();
  // Nothing went to storage: the room keeps everything in memory, and a save is the player's own page.
  expect(app.billed.storage).toBe(0);
});

test("the door: a token for another app, a bad code, and one past a full party", async () => {
  const knock = async (q: Record<string, string>) => (await fetch(app.walkUrl(q).replace(/^ws/, "http"), {
    headers: { upgrade: "websocket", connection: "upgrade", "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==", "sec-websocket-version": "13" },
  })).status;
  expect(await knock({ party: "WOODS2", region: "1", token: await app.tokenFor("Eve", "park-hide-seek") })).toBe(401);
  expect(await knock({ party: "no!", region: "1", token: await app.tokenFor("Eve") })).toBe(400);

  const six = await Promise.all(Array.from({ length: MAX_PARTY }, (_, i) => app.walker(`W${i}`, "WOODS2", { x: 100 + i, z: 100, yaw: 0, region: 1 })));
  await until(() => six.every((w) => w.t.friends().length === MAX_PARTY - 1), six);
  // The seventh is shut out without a seat (Cloudflare carries CLOSE_FULL; the in-process host says 1000), and the six stay six.
  const heard: string[] = [];
  await new Promise<void>(async (done) => {
    const ws = new WebSocket(app.walkUrl({ party: "WOODS2", region: "1", token: await app.tokenFor("Seventh") }));
    ws.onmessage = (e) => heard.push(String(e.data));
    ws.onclose = (e) => { expect([CLOSE_FULL, 1000]).toContain(e.code); done(); };
  });
  expect(heard).toEqual([]);
  await Bun.sleep(50);
  expect(six.map((w) => w.t.state().walkers.length)).toEqual(six.map(() => MAX_PARTY));
  for (const w of six) w.t.close();
});
