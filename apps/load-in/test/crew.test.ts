// A crew of two in the bigger bar, through the room's own Durable Object (edge/world.ts) on stand-in sockets: the 70 kg
// cooler is too heavy for one, so Ada takes an end and waits, Bea takes the other, they can only walk it the same way,
// and when Bea sets it down it lands in both their worlds. A wedge one of them has is the other's only to watch. In the
// garage they share a power run: one takes it out of the case to the wall, the other walks the far end to the speaker.
// With a crew, band night's 65 kg trunk waits on the dock for two; gear left in the way in and cables left loose are
// the mess on every page, and a friend at the case halves the time a tangled cable takes to work free.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { RoomMintGate } from "@rustybuns/util/limits";
import type { RoomSocket } from "@rustybuns/util/room";
import { seatDoor } from "@rustybuns/util/seats";
import { BIGGER_BAR } from "../src/venues/bigger-bar.ts";
import { BAND_NIGHT } from "../src/venues/band-night.ts";
import { newWorld, pickUp, putDown, snapshot, walkTo, type Level, type World } from "../src/sim.ts";
import { UNTANGLE_S, bowl, cableState, dropEnd, grabEnd, newCables, plug, settle, takeCable, takeRoll, walkWith, type Cables } from "../src/cables/cables.ts";
import { setDial } from "../src/assists.ts";
import { World as Room } from "../src/edge/world.ts";
import { Crew, readServer } from "../src/crew/room.ts";
import { hear, outbox, poseOf, synced, type Synced } from "../src/crew/sync.ts";
import { APP } from "../src/eqosys.ts";
import { hear as heard } from "../src/audio/hear.ts";

class Sock implements RoomSocket {
  readyState = 1;
  inbox: string[] = [];
  private att: unknown;
  send(m: string) { this.inbox.push(m); }
  close() { this.readyState = 3; }
  serializeAttachment(v: unknown) { this.att = v; }
  deserializeAttachment() { return this.att; }
}
class FakePair { 0 = new Sock(); 1 = new Sock(); }
let real: unknown;
beforeAll(() => { real = Reflect.get(globalThis, "WebSocketPair"); Reflect.set(globalThis, "WebSocketPair", FakePair); });
afterAll(() => { Reflect.set(globalThis, "WebSocketPair", real); });

interface Page { name: string; w: World; c: Cables; s: Synced; ws: Sock; on: Set<string> }

/** A crew room on stand-in sockets, a page per friend who joins, and `pump`: one round of the wire, where each page
 * sends its cable ends, grabs, drops and pose, and the room sends each its view. */
function crewRoom(level: Level) {
  const socks: RoomSocket[] = [];
  const room = new Room({ acceptWebSocket: (s) => { socks.push(s); }, getWebSockets: () => socks }, {});
  const gate = new RoomMintGate();
  const join = async (name: string, uid: string): Promise<Page> => {
    const req = new Request(`https://load-in.example/ws?room=CREW1&level=${level.name}&uid=${uid}&name=${name}`, { headers: { Upgrade: "websocket", Origin: "https://load-in.example" } });
    const seat = await seatDoor(req, { door: { app: APP, eqosys: "https://eqosys.example", fallbackName: "Roadie" }, room: /^[A-Z0-9]{4,12}$/, gate });
    if (seat instanceof Response) throw new Error(`refused ${seat.status}`);
    await room.fetch(seat.request);
    const w = newWorld(level);
    return { name, w, c: newCables(w), s: synced(), ws: socks.at(-1) as Sock, on: new Set() };
  };
  const pump = (...pages: Page[]) => {
    for (const p of pages) for (const m of [...outbox(p.w, p.s, p.c, p.on), poseOf(p.w)]) room.webSocketMessage(p.ws, JSON.stringify(m));
    room.flush();
    for (const p of pages) for (const raw of p.ws.inbox.splice(0)) { const m = readServer(JSON.parse(raw)); if (m) hear(p.w, p.s, m, p.c, p.on); }
  };
  return { join, pump };
}

test("two carry the cooler together, walk it out the same way, and it lands where it was set down for both", async () => {
  setDial("sim");
  const { join, pump } = crewRoom(BIGGER_BAR);
  const cooler = (w: World) => snapshot(w).items.find((i) => i.key === "cooler")!;

  const ada = await join("Ada", "guest-ada-0001");
  // In by the left wall (straight from the door runs into the stage gear). Alone, the cooler is what it always was.
  const byTheWall = (p: Page, x: number, z: number) => { walkTo(p.w, -3.3, 14.5); walkTo(p.w, x, 14.5); walkTo(p.w, x, z); };
  byTheWall(ada, -3.3, 1.2);
  expect(pickUp(ada.w, "cooler")).toEqual({ ok: false, why: "back-bar drinks cooler is 70 kg, too heavy to lift alone" });

  const bea = await join("Bea", "guest-bea-0001");
  pump(ada, bea);
  expect(snapshot(ada.w).crew.map((m) => m.name)).toEqual(["Bea"]);
  // With a crew here, Ada takes one end and waits; she can't walk off with it.
  expect(pickUp(ada.w, "cooler")).toEqual({ ok: true });
  expect(snapshot(ada.w).together).toBe("waiting for a second pair of hands");
  walkTo(ada.w, 0, 8, 5);
  expect(Math.hypot(ada.w.you.x + 3.4, ada.w.you.z - 0.5)).toBeLessThan(1.7);
  walkTo(ada.w, -3.0, 1.3);
  pump(ada, bea);

  // Bea takes the other end: it comes up between them.
  byTheWall(bea, -2.5, 0.9);
  expect(pickUp(bea.w, "cooler")).toEqual({ ok: true });
  pump(bea, ada); pump(ada, bea);
  expect([snapshot(ada.w).together, snapshot(bea.w).together]).toEqual(["Bea", "Ada"]);
  expect(cooler(ada.w).y).toBeGreaterThan(0);

  // Ada heads off while Bea stands still: the cooler won't let her get away.
  const apart = () => Math.hypot(ada.w.you.x - bea.w.you.x, ada.w.you.z - bea.w.you.z);
  const span = apart();
  walkTo(ada.w, -3.0, 6, 3);
  expect(apart()).toBeLessThan(span + 0.2);

  // Both walk it across the room, a step at a time each, and Bea sets it down.
  for (let k = 0; k < 40; k++) {
    walkTo(ada.w, ada.w.you.x + 0.6, ada.w.you.z + 0.1, 0.1);
    walkTo(bea.w, bea.w.you.x + 0.6, bea.w.you.z + 0.1, 0.1);
    pump(ada, bea);
  }
  expect(bea.w.you.x).toBeGreaterThan(-1.5);
  expect(putDown(bea.w)).toEqual({ ok: true });
  pump(bea, ada); pump(ada, bea);
  expect(ada.w.held).toBeNull();
  const landed = cooler(bea.w);
  expect(cooler(ada.w)).toEqual(landed);
  expect(landed.x).toBeGreaterThan(-2.5);

  // A wedge is light: whoever has it has it.
  // Round by the right wall to the front of the stage gear.
  for (const [p, x] of [[ada, 1.2], [bea, 2.0]] as const) { walkTo(p.w, 3.3, 3); walkTo(p.w, 3.3, 14); walkTo(p.w, x, 14); }
  expect(pickUp(ada.w, "wedge-1")).toEqual({ ok: true });
  pump(ada, bea);
  expect(pickUp(bea.w, "wedge-1")).toEqual({ ok: false, why: "Ada has the 12\" floor monitor" });
});

test("two run one power cable: Ada takes it to the wall, Bea walks the far end to the speaker, and both see it patched", async () => {
  setDial("sim");
  const { join, pump } = crewRoom(newWorld().level);
  const ada = await join("Ada", "guest-ada-0002"), bea = await join("Bea", "guest-bea-0002");
  const run = (p: Page, key = "power-10") => cableState(p.w, p.c).cables.find((r) => r.key === key)!;
  // Each walks ten steps, the wire between every step, so the friend's end follows their hand. (Ten, not more: the room
  // drops a socket's frames past a burst of 80, and the test sends them all in a moment.)
  const walk = (p: Page, x: number, z: number, ...all: Page[]) => {
    for (let k = 0; k < 10 && Math.hypot(p.w.you.x - x, p.w.you.z - z) > 0.05; k++) {
      walkWith(p.w, p.c, p.w.you.x + (x - p.w.you.x) / (10 - k), p.w.you.z + (z - p.w.you.z) / (10 - k));
      for (const o of all) if (o !== p) settle(o.w, o.c, 0.05);
      pump(...all);
    }
  };

  // Both by the case: Ada takes the power cable out, and on Bea's page it comes out in Ada's hand.
  walk(ada, -1.6, 3.2, ada, bea); walk(bea, -1.2, 3.4, ada, bea);
  expect(takeCable(ada.w, ada.c, "power")).toEqual({ ok: true });
  pump(ada, bea);
  expect(run(bea)).toMatchObject({ coiled: false, a: "Ada's hand", b: "case" });

  // Bea takes the instrument cable: on Ada's page it is in Bea's hand, and Ada can't take it from her.
  expect(takeCable(bea.w, bea.c, "instrument")).toEqual({ ok: true });
  pump(bea, ada);
  expect(run(ada, "inst-6").a).toBe("Bea's hand");
  expect(grabEnd(ada.w, ada.c, "inst-6", "a")).toEqual({ ok: false, why: "Bea has that end" });

  // Ada plugs hers into the wall.
  walk(ada, -2.2, 0.6, ada, bea);
  expect(plug(ada.w, ada.c, "outlet", "power-out-1")).toEqual({ ok: true });
  pump(ada, bea);
  expect(run(bea).a).toBe("outlet power-out-1");

  // Bea puts the instrument cable down, and both reach for power's far end in the case at once: Ada's word is in first,
  // so Bea's is taken back.
  expect(dropEnd(bea.c)).toEqual({ ok: true });
  walk(ada, -1.6, 3.0, ada, bea);
  expect(grabEnd(ada.w, ada.c, "power-10", "b")).toEqual({ ok: true });
  expect(grabEnd(bea.w, bea.c, "power-10", "b")).toEqual({ ok: true });
  pump(ada, bea); pump(ada, bea);
  expect([run(ada).b, run(bea).b]).toEqual(["hand", "Ada's hand"]);

  // Ada hands it over: she lets go, Bea picks it up and walks it in to the speaker.
  expect(dropEnd(ada.c)).toEqual({ ok: true });
  pump(ada, bea); pump(ada, bea);
  expect(run(bea).b).toBe("loose");
  expect(grabEnd(bea.w, bea.c, "power-10", "b")).toEqual({ ok: true });
  walk(bea, 2.0, 1.9, ada, bea);
  expect(plug(bea.w, bea.c, "top", "xlr-in").ok).toBe(false);
  expect(plug(bea.w, bea.c, "top", "power-in")).toEqual({ ok: true });
  pump(ada, bea); pump(ada, bea);

  // Plugged in at both ends, on both pages: the same patch, and the same hazard across the way in.
  for (const p of [ada, bea]) settle(p.w, p.c, 3);
  expect([run(ada), run(bea)].map((r) => [r.a, r.b])).toEqual([["outlet power-out-1", "top power-in"], ["outlet power-out-1", "top power-in"]]);
  expect(cableState(ada.w, ada.c).fed).toEqual(cableState(bea.w, bea.c).fed);
  const power = (p: Page) => cableState(p.w, p.c).hazards.filter((h) => h.cable === "power-10").map((h) => h.walkway);
  expect([power(ada), power(bea)]).toEqual([["the way in"], ["the way in"]]);
});

test("Ada bowls a power roll from the wall: Bea's page sees it roll out paying cable, and it lies in the same place on both", async () => {
  setDial("sim");
  const { join, pump } = crewRoom(newWorld().level);
  const ada = await join("Ada", "guest-ada-0006"), bea = await join("Bea", "guest-bea-0006");
  const roll = (p: Page) => cableState(p.w, p.c).cables.find((r) => r.key === "power-10")!.roll!;
  // Both tick and hear the wire together, a twentieth of a second at a time.
  const tick = (seconds: number) => { for (let t = 0; t < seconds; t += 0.05) { settle(ada.w, ada.c, 0.05); settle(bea.w, bea.c, 0.05); pump(ada, bea); } };

  // Ada lifts the roll out of the case, carries it to the wall and plugs its end in: on Bea's page it is in Ada's arms.
  walkTo(ada.w, -1.6, 3.2);
  expect(takeRoll(ada.w, ada.c, "power")).toEqual({ ok: true });
  walkWith(ada.w, ada.c, -2.2, 0.6);
  expect(plug(ada.w, ada.c, "outlet", "power-out-1")).toEqual({ ok: true });
  tick(0.5);
  expect(roll(bea).state).toBe("held");

  // She bowls it toward the speaker. On Bea's page it rolls too, away from where it left Ada's hands, paying out cord.
  ada.w.you.yaw = Math.atan2(-(1.4 - ada.w.you.x), -(2.2 - ada.w.you.z));
  expect(bowl(ada.w, ada.c, 0.5)).toEqual({ ok: true });
  const from = { x: roll(ada).x, z: roll(ada).z };
  tick(0.3);
  expect(roll(bea).state).toBe("rolling");
  tick(0.5);
  expect(Math.hypot(roll(bea).x - from.x, roll(bea).z - from.z)).toBeGreaterThan(0.5);
  expect(roll(bea).leftM).toBeLessThan(10);

  // Once it stops it lies in the same place on both pages, with the same cord left on it.
  tick(6);
  const [a, b] = [roll(ada), roll(bea)];
  expect([a.state, b.state]).toEqual(["down", "down"]);
  expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeLessThan(0.05);
  expect(b.leftM).toBeCloseTo(a.leftM, 1);
  expect(Math.hypot(a.x - from.x, a.z - from.z)).toBeGreaterThan(1.5);
});

test("one switches the speaker on and the whole crew hears it, each from where they stand", async () => {
  setDial("cozy");
  const { join, pump } = crewRoom(newWorld().level);
  const ada = await join("Ada", "guest-ada-0003"), bea = await join("Bea", "guest-bea-0003");
  const level = (p: Page) => heard(p.w, p.on).speakers.find((sp) => sp.key === "top")!;

  // Ada stands in front of the powered top in the garage and switches it on. Bea is still out by the truck.
  walkTo(ada.w, 2.0, 5.0);
  pump(ada, bea);
  expect(level(bea).fed).toBe(false);
  ada.on.add("top");
  pump(ada, bea);
  expect([...bea.on]).toEqual(["top"]);
  expect(level(bea).fed).toBe(true);
  // The same speaker: loud for Ada in front of it, quieter for Bea 7 m back, and quiet and dull behind the box.
  const far = level(bea);
  expect(far.db!).toBeLessThan(level(ada).db! - 4);
  walkTo(bea.w, 0, 6); walkTo(bea.w, 1.0, 1.5);
  expect(level(bea).db!).toBeLessThan(far.db! - 4);
  expect(level(bea).offAxis).toBeGreaterThan(far.offAxis + 10);

  // Bea switches it off: it goes quiet on Ada's page too.
  bea.on.delete("top");
  pump(bea, ada);
  expect(level(ada).fed).toBe(false);
});

test("with a crew the band's 65 kg trunk waits on the dock: two carry it in, and left in the way in it is the mess on both pages", async () => {
  setDial("sim");
  // Alone the band night has no trunk: it is the crew's load.
  expect(newWorld(BAND_NIGHT).items.some((i) => i.key === "trunk")).toBe(false);
  const { join, pump } = crewRoom(BAND_NIGHT);
  const ada = await join("Ada", "guest-ada-0004"), bea = await join("Bea", "guest-bea-0004");
  pump(ada, bea);
  const trunk = (p: Page) => p.w.items.find((i) => i.key === "trunk");
  const left = (p: Page) => cableState(p.w, p.c).mess.map((m) => `${m.what} ${m.where}`);
  expect([trunk(ada)?.gear, trunk(bea)?.gear]).toEqual(["trunk-case", "trunk-case"]);

  // One at each end of it on the dock, beside the truck.
  walkTo(ada.w, -2.4, 12.7);
  for (const [x, z] of [[-1.8, 12.4], [-1.8, 14.9], [-2.4, 14.9]]) walkTo(bea.w, x!, z!);
  const lift = () => {
    expect(pickUp(ada.w, "trunk")).toEqual({ ok: true });
    pump(ada, bea);
    expect(pickUp(bea.w, "trunk")).toEqual({ ok: true });
    pump(bea, ada); pump(ada, bea);
    expect([snapshot(ada.w).together, snapshot(bea.w).together]).toEqual(["Bea", "Ada"]);
  };
  lift();
  // In through the door, and down in the way in: the mess, on both pages.
  for (let k = 0; k < 12; k++) {
    for (const p of [ada, bea]) walkTo(p.w, p.w.you.x * 0.75, p.w.you.z - 0.3, 0.5);
    pump(ada, bea);
  }
  expect(putDown(ada.w)).toEqual({ ok: true });
  pump(ada, bea); pump(bea, ada);
  expect([left(ada), left(bea)]).toEqual([["hardware trunk in the way in"], ["hardware trunk in the way in"]]);
  expect(trunk(bea)).toEqual(trunk(ada)!);

  // Up again and over to the left wall: the way in is clear for both.
  lift();
  for (let k = 0; k < 6; k++) {
    for (const p of [ada, bea]) walkTo(p.w, p.w.you.x - 0.45, p.w.you.z - 0.15, 0.8);
    pump(ada, bea);
  }
  expect(putDown(bea.w)).toEqual({ ok: true });
  pump(bea, ada); pump(ada, bea);
  expect(trunk(ada)!.x).toBeLessThan(-3);
  expect([left(ada), left(bea)]).toEqual([[], []]);
});

test("a friend at the case works a tangled cable free with you in half the time, and a cable left loose is the mess for both", async () => {
  setDial("sim");
  const { join, pump } = crewRoom(newWorld().level);
  const ada = await join("Ada", "guest-ada-0005"), bea = await join("Bea", "guest-bea-0005");
  // Last night every cable went into the case coiled wrong: four twists each.
  for (const p of [ada, bea]) for (const r of p.c.runs) r.twists = 4;
  walkTo(ada.w, -1.6, 3.2); walkTo(bea.w, -1.2, 3.6);
  pump(ada, bea);
  const took = (p: Page, kind: "power" | "instrument") => { const t0 = p.w.t; expect(takeCable(p.w, p.c, kind)).toEqual({ ok: true }); return p.w.t - t0; };
  expect(took(ada, "power")).toBeCloseTo(2 * UNTANGLE_S, 5);

  // Ada walks it out and lets go: it lies loose, on both pages.
  pump(ada, bea);
  walkWith(ada.w, ada.c, -0.2, 5);
  expect(dropEnd(ada.c)).toEqual({ ok: true });
  pump(ada, bea); pump(ada, bea);
  const loose = { key: "power-10", what: "power cable power-10", where: "left loose" };
  expect([cableState(ada.w, ada.c).mess, cableState(bea.w, bea.c).mess]).toEqual([[loose], [loose]]);

  // Ada is off by the way in now, so Bea works the next one free alone: the whole four twists.
  expect(took(bea, "instrument")).toBeCloseTo(4 * UNTANGLE_S, 5);
});

test("a crew member making up cables and switches can't push the room's view past what the others read", () => {
  const crew = new Crew();
  crew.join("ada", "Ada"); crew.join("mal", "Mallory");
  for (let i = 0; i < 600; i++) {
    crew.end("mal", { t: "end", key: `cable-${i}`, end: "a", to: { at: "case" } });
    crew.throw("mal", { t: "switch", key: `switch-${i}`, on: true });
  }
  expect(readServer(JSON.parse(JSON.stringify(crew.view("ada"))))?.t).toBe("view");
  // what is already there still moves
  expect(crew.end("ada", { t: "end", key: "cable-0", end: "b", to: { at: "hand" } })).toEqual({ ok: true });
});
