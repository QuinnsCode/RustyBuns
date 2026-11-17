// Qollab Studio's jam room, two players in one sesh through the real World: one walks in, sits at the keys and
// plays a note; the other sees them sat there, hears the note, can't take their seat, and gets it once they stand.
import { expect, test } from "bun:test";
import { defaultAvatar } from "@rustybuns/util/avatar";
import { decodeServer } from "../src/project.ts";
import { camera, gone, newJam, onLive, press, release, sit, snapshot, stand, step, toggleView, walkTo, SEATED_EYE, type Jam } from "../src/studio/jam.ts";
import { LIVE_ROOM } from "../src/studio/rooms/live.ts";
import { fakePlatform, setup, type Sock } from "./world-kit.ts";

fakePlatform();

/** A page in the sesh: its jam, and its socket into the world. */
type Client = { jam: Jam; ws: Sock };
const still = { forward: 0, right: 0, turn: 0 };

test("one sits at the keys and plays, the other sees them seated and hears it", async () => {
  const { world, join, leave } = await setup({}, "mellow-jade-otter");
  const a: Client = { jam: newJam(LIVE_ROOM, defaultAvatar("ada")), ws: (await join()).ws };
  const b: Client = { jam: newJam(LIVE_ROOM, defaultAvatar("bo")), ws: (await join()).ws };
  // the page's two halves of the live line: what the jam says goes out, what comes in is read as the page reads it
  const send = (c: Client) => { for (const e of c.jam.out.splice(0)) world.webSocketMessage(c.ws, JSON.stringify({ t: "live", e })); };
  const hear = (c: Client) => {
    for (const raw of c.ws.sent.splice(0)) {
      const m = decodeServer(raw);
      if (m?.t === "live") onLive(c.jam, m.from, m.e);
      if (m?.t === "gone") gone(c.jam, m.from);
    }
  };
  const tick = (...cs: Client[]) => { for (const c of cs) step(c.jam, 0.1, still); for (const c of cs) send(c); for (const c of cs) hear(c); };

  // both walk in at the door, over the shoulder, and see each other there
  tick(a, b);
  expect(snapshot(a.jam)).toMatchObject({ view: "third", you: { spot: null } });
  expect(camera(a.jam).at[2]).toBeGreaterThan(a.jam.me.z);           // the camera is behind you
  expect(snapshot(b.jam).others).toEqual([expect.objectContaining({ x: 0.9, z: 2.1, spot: null })]);
  const ada = snapshot(b.jam).others[0].peer;
  expect(b.jam.others.get(ada)?.avatar).toEqual(defaultAvatar("ada")); // wearing what a wears

  // a seat only takes you from close by: a walks up to the keys and sits
  expect(sit(a.jam)).toEqual({ ok: false, why: "walk up to a spot to sit" });
  expect(walkTo(a.jam, -2.2, 1.6)).toBeGreaterThan(0);
  expect(snapshot(a.jam).near).toBe("keys");
  expect(sit(a.jam)).toEqual({ ok: true });
  expect(snapshot(a.jam)).toMatchObject({ view: "first", you: { spot: "keys", x: -2.2, z: 0.9 } });
  expect(camera(a.jam).at[1]).toBe(SEATED_EYE);
  toggleView(a.jam); expect(snapshot(a.jam).view).toBe("third");     // V, and back
  toggleView(a.jam);

  // A on the computer keyboard is the keys track's C
  expect(press(a.jam, "KeyA")).toEqual({ track: 6, midi: 60 });
  tick(a, b);
  expect(snapshot(b.jam).spots.find((s) => s.id === "keys")?.by).toBe(ada);
  expect(snapshot(b.jam).others).toEqual([expect.objectContaining({ peer: ada, spot: "keys", playing: true })]);
  expect(snapshot(b.jam).heard).toEqual([{ from: ada, track: 6, midi: 60 }]);

  // b can't take a's seat; once a stands (the note stops with it), b sits there
  walkTo(b.jam, -2.2, 1.6);
  expect(sit(b.jam, "keys")).toEqual({ ok: false, why: "someone is at the keys" });
  expect(stand(a.jam)).toEqual({ ok: true });
  expect(a.jam.out).toContainEqual({ t: "off", track: 6, midi: 60 });
  expect(release(a.jam, "KeyA")).toBeNull();                         // already let go
  tick(a, b);
  expect(snapshot(a.jam)).toMatchObject({ view: "third", you: { spot: null } });
  expect(sit(b.jam, "keys")).toEqual({ ok: true });
  tick(a, b);
  expect(snapshot(a.jam).spots.find((s) => s.id === "keys")?.by).toBe(snapshot(a.jam).others[0].peer);

  // a leaves the sesh: gone from b's room
  leave(a.ws);
  hear(b);
  expect(snapshot(b.jam).others).toEqual([]);
});

test("a body off the wire keeps what it can: a made-up avatar or spot is dropped, the body still goes", async () => {
  const { world, join } = await setup({}, "mellow-jade-otter");
  const a = (await join()).ws, b = (await join()).ws;
  world.webSocketMessage(a, JSON.stringify({ t: "live", e: { t: "body", at: [1, 0, 2], yaw: 0.5, spot: "Keys!!", avatar: { skin: "blue" } } }));
  expect(b.sent.at(-1)).toEqual({ t: "live", from: expect.any(Number), e: { t: "body", at: [1, 0, 2], yaw: 0.5 } });
});
