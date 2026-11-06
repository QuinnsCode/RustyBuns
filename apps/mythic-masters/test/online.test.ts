// Walking the world together (#3663): two players in one party room through the page's own net module, the real Worker and
// the real Region Durable Object (scripts/party.ts runs them on Bun's sockets), then the wire and the door.
import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import worker from "../src/edge/worker.ts";
import { bestOffset, COAST_MS, MAX_PLAYERS, step, Ghost, BEHIND_MS, decodeServer, delta, parseDelta, parseEvent, plausible, quantise, WORLD_CYCLE, worldClock } from "../src/net/party.ts";
import { DAY } from "../src/world/nature.ts";
import { Online } from "../src/net/online.ts";
import { serveParty } from "../scripts/party.ts";
import { DEAD_MS, Region } from "../src/edge/region.ts";
import type { RoomSocket } from "@rustybuns/util/room";

setDefaultTimeout(20_000);
const party = serveParty();
afterAll(() => party.stop());

const until = async (ok: () => boolean, ms = 3000) => { const end = Date.now() + ms; while (!ok()) { if (Date.now() > end) throw new Error("timed out"); await Bun.sleep(10); } };
/** What each player heard from the party, as lines. */
const heard: string[] = [];
/** A save far enough along that region 5's trail (where these walks are) is open. */
const OPENED = [1, 2, 3, 4, 5, 6];
const join = (name: string, room = "WALK1", base = party.url, more: Pick<NonNullable<ConstructorParameters<typeof Online>[1]>, "onCompany" | "opened" | "posed"> = {}) => new Online(room, {
  opened: () => OPENED, ...more, base, guest: { uid: `${name}-uid-0000`, name },
  onDen: (den, who, c) => heard.push(`${name}: ${who} at ${c} ${den}`),
  onHunt: (h, s, who) => heard.push(`${name}: ${who} hunt ${h} ${s}`),
  onFought: (f) => heard.push(`${name}: ${f.who} ${f.won ? "beat" : "lost to"} ${f.c}`),
  onLife: (k, id, _h, at) => heard.push(`${name}: ${k} ${id}${at === undefined ? "" : ` at ${at}`}`),
  onSeen: (s) => heard.push(`${name}: seen ${s.roost.map((r) => r.id).join()} busy ${s.busy.join()}`),
});
/** Walk a player a step east every SEND_MS-ish frame for `steps` frames, along the row of region 5's first keeper's stone. */
const walk = (o: Online, region: number, x0: number, steps: number, lead = "hodag") => { for (let i = 0; i < steps; i++) o.update(region, x0 + i, 5600, 0, lead, performance.now() + i * 250); };

describe("two friends in one region", () => {
  test("see each other walk with their lead beast; one leaves and comes back; another region is another room", async () => {
    const ada = join("Ada"), bo = join("Bo");
    ada.update(5, 13800, 5600, 0, "hodag", performance.now()); // by the first stone of region 5's trail
    bo.update(5, 13810, 5600, Math.PI, "jersey-devil", performance.now());
    await until(() => ada.status === "in" && bo.status === "in");
    walk(ada, 5, 13800, 4); walk(bo, 5, 13810, 4, "jersey-devil");
    await until(() => [...ada.ghosts.values()].some((g) => g.pose.l === "jersey-devil") && [...bo.ghosts.values()].some((g) => g.pose.l === "hodag"));
    const seen = [...bo.ghosts.values()][0]!;
    expect(seen.name).toBe("Ada");
    expect(seen.at(performance.now() + BEHIND_MS)?.x).toBeGreaterThan(13799);
    // One clock for the room, so the wilds circling their dens, the sun and the weather are the same for both.
    const now = performance.now();
    expect(Math.abs(ada.clock(now)! - bo.clock(now)!)).toBeLessThan(0.1);
    // Ada flushes a flock and picks a bush beside Bo: his birds take off and his bush is bare too. A bush 1.5 km off
    // is not hers to pick, so his stays.
    ada.life("pick", "40,-2"); ada.life("flush", "125,50", 1.5); ada.life("pick", "197,80");
    await until(() => heard.includes("Bo: flush 125,50") && heard.includes("Bo: pick 197,80"));
    expect(heard).not.toContain("Bo: pick 40,-2");
    // What she picked and flushed before he came goes to him in one message, with its time on the world clock.
    // At its full size: 30 of each kind and 12 busy dens, about 4 KB, through the room's frame limit in one piece.
    const cells = (n: number, y: number) => Array.from({ length: n }, (_, i) => `${100 + i},${y}`);
    ada.seen({
      picks: [{ id: "41,-2", at: 120 }, ...cells(29, -3).map((id) => ({ id, at: 119.5 }))],
      flown: [{ id: "13,34", at: 118, h: 0.5 }, ...cells(29, 35).map((id) => ({ id, at: 117.5, h: -1.25 }))],
      roost: [{ id: "14,34", x: 1500, z: 1200 }, ...cells(29, 36).map((id) => ({ id, x: 12345.6, z: 23456.7 }))],
      busy: ["5,5", ...cells(11, 7)],
    });
    await until(() => heard.includes("Bo: pick 41,-2 at 120") && heard.includes("Bo: flush 13,34 at 118") && heard.some((l) => l.startsWith("Bo: seen 14,34,") && l.includes("128,36") && l.includes("busy 5,5,")));
    // Ada takes a contract and reads its first sign: Bo hears it and can follow the same signs.
    ada.hunt("1.20002.6206", 0); // a board in another region, 20 km off: nothing to tell
    ada.hunt("5.13900.5600", 0); ada.hunt("5.13900.5600", 1); // the board beside her
    await until(() => heard.includes("Bo: Ada hunt 5.13900.5600 1"));
    expect(heard.some((l) => l.includes("1.20002.6206"))).toBe(false);
    // Ada walks up to the first stone of her region's trail: Bo hears whose fight it is, so that den is quiet for him too.
    // Her report of the fight gets to Bo only when it fits the den she walked into: a fight longer than the time since is
    // dropped, and so is a den the world's seed doesn't put that creature in.
    ada.met("120,48", "hodag", 7); // 25 km off: no such den near her, so nothing to hear and nothing to report against
    ada.met("keeper:5:0", "jersey-devil", 99); // her region's stone, but not its keeper
    await Bun.sleep(1100); // the room's rate limit, after the catch-up above
    ada.met("keeper:5:0", "loveland-frogman", 34); // its keeper, at its level
    await until(() => heard.includes("Bo: Ada at loveland-frogman keeper:5:0"));
    expect(heard.some((l) => l.includes("120,48") || l.includes("jersey-devil"))).toBe(false);
    ada.fought("loveland-frogman", 34, true, false, 90);
    await Bun.sleep(1100);
    ada.fought("loveland-frogman", 34, true, false, 3);
    await until(() => heard.includes("Bo: Ada beat loveland-frogman"));
    // Her line-up's next beast fights the same den: believed again, once that fight has had time to happen.
    ada.fought("loveland-frogman", 34, false, false, 3);
    await Bun.sleep(1100);
    ada.fought("loveland-frogman", 34, false, false, 3);
    await until(() => heard.includes("Bo: Ada lost to loveland-frogman"));
    // A lie about the stone forgets the real fight before it: another report of that one is no longer believed.
    ada.met("keeper:5:0", "jersey-devil", 99);
    await Bun.sleep(1100);
    ada.fought("loveland-frogman", 34, true, false, 3);
    await Bun.sleep(300);
    expect(heard.filter((l) => l.startsWith("Bo: Ada beat") || l.startsWith("Bo: Ada lost"))).toHaveLength(2);
    // She jumps 3 km off and back, faster than anyone walks (a page saying it is somewhere it isn't). Bo still sees where
    // she is, but the room no longer vouches for where she stands: her stone and her contract go nowhere until she is
    // somewhere the game sends you, like beside a campfire, and then her contract is told again.
    await Bun.sleep(250); ada.update(5, 16800, 5600, 0, "hodag", performance.now());
    await until(() => [...bo.ghosts.values()][0]?.pose.x === 168000);
    await Bun.sleep(250); ada.update(5, 13800, 5550, 0, "hodag", performance.now()); // 50 m from the stone, not beside Bo
    ada.met("keeper:5:0", "loveland-frogman", 34); ada.hunt("5.13900.5600", 2); ada.life("pick", "197,79");
    await Bun.sleep(1100); ada.update(5, 13422, 5527, 0, "hodag", performance.now()); // the campfire 386 m off
    ada.hunt("5.13900.5600", 3);
    await until(() => heard.includes("Bo: Ada hunt 5.13900.5600 3"));
    expect(heard.filter((l) => l.includes("keeper:5:0"))).toHaveLength(1);
    expect(heard).not.toContain("Bo: Ada hunt 5.13900.5600 2");
    expect(heard).not.toContain("Bo: pick 197,79"); // nor the bush she picked while doubted

    // Ada closes the tab: Bo sees her go. She comes back and walks on, and Bo sees her again.
    ada.close();
    await until(() => bo.ghosts.size === 0);
    const again = join("Ada");
    again.update(5, 13803, 5600, 0, "hodag", performance.now());
    await until(() => again.status === "in");
    walk(again, 5, 13803, 2);
    await until(() => bo.ghosts.size === 1 && again.ghosts.size === 1 && [...bo.ghosts.values()][0]!.pose.x === 138040); // her last step, 13804 m

    // Bo walks on into region 6: still the party's one room, so Ada knows where he went, and the clock carries on. Alone
    // in region 5 now, Ada sends nothing while she walks, so the room can sleep.
    const before = bo.clock(performance.now())!;
    bo.update(6, 2000, 1000, 0, "jersey-devil", performance.now() + 10_000);
    await until(() => [...again.ghosts.values()][0]?.pose.r === 6);
    expect(again.where()).toEqual([{ name: "Bo", region: 6 }]);
    expect(party.rooms().map((r) => r.name).filter((n) => n.startsWith("WALK1"))).toEqual(["WALK1:party"]);
    const sent = again.sentBytes;
    walk(again, 5, 13810, 6);
    expect(again.sentBytes).toBe(sent);
    const later = bo.clock(performance.now())!;
    expect((later - before + WORLD_CYCLE) % WORLD_CYCLE).toBeLessThan(5);
    // Bo goes; alone in the room, Ada fast travels to a campfire: that one pose still goes out, so the room knows she
    // got there the game's way when a friend turns up.
    bo.close();
    await until(() => again.ghosts.size === 0);
    again.update(5, 13422, 5527, 0, "hodag", performance.now() + 2_000); // (walk() runs the page clock ahead)
    expect(again.sentBytes).toBeGreaterThan(sent);
    again.close();
  });

  test("hops too small to flag one by one, a second tab, and a contract taken meanwhile that reaches a friend after a campfire", async () => {
    const from = heard.length, since = () => heard.slice(from);
    // Cy's page tells the contracts she is on whenever company turns up or the room trusts her again (main.ts's shareHunts).
    const on = new Map<string, number>();
    let cy: Online;
    const asCy = () => (cy = join("Cy", "HOP1", party.url, { onCompany: () => { for (const [h, s] of on) cy.hunt(h, s); } }));
    asCy(); const di = join("Di", "HOP1");
    cy!.update(5, 14600, 5550, 0, "hodag", performance.now()); // 800 m east of region 5's first stone
    di.update(5, 13810, 5600, 0, "jersey-devil", performance.now());
    await until(() => cy.status === "in" && di.status === "in");
    const cyAt = () => [...di.ghosts.values()][0]?.pose.x;
    // 21 hops of 38 m, a fifth of a second apart (190 m/s, seven times a run): each is inside the 40 m slack on its own.
    for (let i = 1; i <= 21; i++) { await Bun.sleep(210); cy!.update(5, 14600 - (800 * i) / 21, 5550, 0, "hodag", performance.now()); }
    await until(() => cyAt() === 138000); // 50 m from the stone, not beside Di
    on.set("5.13900.5600", 0);
    cy!.met("keeper:5:0", "loveland-frogman", 34); cy!.hunt("5.13900.5600", 0);
    await Bun.sleep(300);
    expect(since()).toEqual([]); // Di sees where she is, but the room vouches for neither the stone nor the contract
    // A second tab while the first is still open: the room's doubt carries over to it.
    asCy();
    cy!.update(5, 13801, 5550, 0, "hodag", performance.now());
    await until(() => cy.status === "in" && cyAt() === 138010);
    cy!.met("keeper:5:0", "loveland-frogman", 34);
    await Bun.sleep(300);
    expect(since()).toEqual([]);
    // She walks to the campfire 380 m off, a place the game sends you: trusted again, and her page tells the contract.
    await Bun.sleep(250); cy!.update(5, 13422, 5527, 0, "hodag", performance.now());
    await until(() => since().includes("Di: Cy hunt 5.13900.5600 0"));
    expect(since().some((l) => l.includes("keeper:5:0"))).toBe(false);
    cy!.close(); di.close();
  });

  test("a jump to a campfire in a region the save hasn't opened stays doubted, until the save opens it", async () => {
    const from = heard.length, since = () => heard.slice(from);
    let opened = [1, 4];
    const on = new Map<string, number>();
    let ed: Online;
    ed = join("Ed", "SHUT1", party.url, { opened: () => opened, onCompany: () => { for (const [h, s] of on) ed.hunt(h, s); } });
    const fay = join("Fay", "SHUT1");
    ed.update(4, 2000, 1000, 0, "hodag", performance.now());
    fay.update(5, 13810, 5600, 0, "jersey-devil", performance.now());
    await until(() => ed.status === "in" && fay.status === "in");
    ed.update(4, 2001, 1000, 0, "hodag", performance.now());
    await until(() => [...fay.ghosts.values()][0]?.pose.x === 20010);
    // Ed's page jumps to region 5's campfire, a landing spot, but in a region his save has not opened: still doubted.
    await Bun.sleep(250); ed.update(5, 13422, 5527, 0, "hodag", performance.now());
    await until(() => [...fay.ghosts.values()][0]?.pose.x === 134220);
    on.set("5.13900.5600", 0); ed.hunt("5.13900.5600", 0);
    await Bun.sleep(300);
    expect(since()).toEqual([]);
    // Back home, then his save opens region 5 (an arena won next door): the same jump now lands trusted, and the
    // contract is told.
    await Bun.sleep(250); ed.update(4, 2000, 1000, 0, "hodag", performance.now());
    opened = [1, 4, 5];
    await Bun.sleep(250); ed.update(5, 13422, 5527, 0, "hodag", performance.now());
    await until(() => since().includes("Fay: Ed hunt 5.13900.5600 0"));
    ed.close(); fay.close();
  });

  test("a page that joins already standing in a region its save hasn't opened starts doubted; an honest start is trusted", async () => {
    const from = heard.length, since = () => heard.slice(from);
    // Gus's save opened regions 1 and 4, yet his first pose stands at region 5's board: nothing to measure it from, but
    // not a region he claims. Hal's save opened region 5, and he starts 900 m off, mid-walk, away from any campfire.
    const gus = join("Gus", "FIRST1", party.url, { opened: () => [1, 4] }), hal = join("Hal", "FIRST1");
    gus.update(5, 13900, 5600, 0, "hodag", performance.now());
    hal.update(5, 13000, 5600, 0, "squonk", performance.now());
    await until(() => gus.status === "in" && hal.status === "in" && gus.ghosts.size === 1 && hal.ghosts.size === 1);
    gus.hunt("5.13900.5600", 0); hal.hunt("5.13900.5600", 0);
    await until(() => since().includes("Gus: Hal hunt 5.13900.5600 0"));
    await Bun.sleep(200);
    expect(since().filter((l) => l.startsWith("Hal:"))).toEqual([]); // Gus's contract went nowhere
    gus.close(); hal.close();
  });

  test("a friend walking up to one the room doubts brings them back: the den and contract they were refused reach the party, then the fight", async () => {
    const from = heard.length, since = () => heard.slice(from);
    const on = new Map<string, number>();
    const ed: Online = join("Ed", "BACK1", party.url, { onCompany: () => { for (const [h, s] of on) ed.hunt(h, s); } }), fi = join("Fi", "BACK1");
    ed.update(5, 14600, 5550, 0, "hodag", performance.now());
    fi.update(5, 13800, 5650, 0, "jersey-devil", performance.now()); // 100 m north of where Ed is going
    await until(() => ed.status === "in" && fi.status === "in");
    await Bun.sleep(250); ed.update(5, 14600, 5550, 0, "hodag", performance.now());
    await until(() => [...fi.ghosts.values()][0]?.pose.x === 146000);
    await Bun.sleep(250); ed.update(5, 13800, 5550, 0, "hodag", performance.now()); // 800 m at once: the room stops vouching for him
    await until(() => [...fi.ghosts.values()][0]?.pose.x === 138000);
    on.set("5.13900.5600", 0);
    ed.met("keeper:5:0", "loveland-frogman", 34); ed.hunt("5.13900.5600", 0);
    await Bun.sleep(300);
    expect(since()).toEqual([]);
    // Ed stands still at the stone; Fi walks over at a jog. Once she is beside him the room trusts him again: his page
    // tells the stone (so Fi hears it now) and the contract.
    for (const z of [5635, 5620, 5605, 5590, 5580]) { await Bun.sleep(700); fi.update(5, 13800, z, 0, "jersey-devil", performance.now()); }
    await until(() => since().includes("Fi: Ed hunt 5.13900.5600 0"));
    expect(since()).toContain("Fi: Ed at loveland-frogman keeper:5:0");
    // His fight there, timed from when he walked in, is believed.
    ed.fought("loveland-frogman", 34, true, false, 4);
    await until(() => since().includes("Fi: Ed beat loveland-frogman"));
    ed.close(); fi.close();
  });

  test("a contract taken in the same frame as a jump is checked where the jump landed, not where it started", async () => {
    const from = heard.length, since = () => heard.slice(from);
    // Ivy stands by region 1's campfire, Jo beside her. In one frame Ivy lands on the sighting board 559 m off (no road
    // takes you there that fast) and takes its contract, before that frame's pose goes out (#3800).
    let at = { region: 1, x: 20175, z: 5674 };
    const ivy = join("Ivy", "JUMP1", party.url, { posed: () => ({ ...at, yaw: 0, lead: "hodag", follow: [] }) }), jo = join("Jo", "JUMP1");
    ivy.update(1, at.x, at.z, 0, "hodag", performance.now());
    jo.update(1, 20180, 5674, 0, "squonk", performance.now());
    await until(() => ivy.status === "in" && jo.status === "in" && ivy.ghosts.size === 1 && jo.ghosts.size === 1);
    // the room has her at the campfire first, to measure the jump from
    ivy.update(1, 20176, 5674, 0, "hodag", performance.now());
    await until(() => [...jo.ghosts.values()][0]?.pose.x === 201760);
    await Bun.sleep(250);
    at = { region: 1, x: 20002, z: 6206 };
    ivy.hunt("1.20002.6206", 0);
    await until(() => [...jo.ghosts.values()][0]?.pose.x === 200020); // Jo sees her land: the jump reached the room first
    await Bun.sleep(300);
    expect(since().filter((l) => l.includes("hunt"))).toEqual([]); // and the room doubted it, so the contract went nowhere
    ivy.close(); jo.close();
  });

  test(`a full room (${MAX_PLAYERS}) turns the next one away and keeps everyone else in`, async () => {
    const six = Array.from({ length: MAX_PLAYERS }, (_, i) => join(`p${i}`, "FULL1"));
    six.forEach((o, i) => o.update(3, 100 + i, 100, 0, "hodag", performance.now()));
    await until(() => six.every((o) => o.status === "in"));
    const late = join("late", "FULL1");
    late.update(3, 100, 100, 0, "hodag", performance.now());
    await until(() => late.status === "full", 6000);
    expect(six.every((o) => o.status === "in")).toBe(true);
    for (const o of [...six, late]) o.close();
  });
});

test("a page that vanished without closing is swept once it stops pinging, and its seat is free again", async () => {
  // The hibernation API's last-ping time, by hand: workerd answers "ping" itself and remembers when.
  const socks: RoomSocket[] = [], pinged = new Map<RoomSocket, number>();
  const ctx = { acceptWebSocket: (ws: RoomSocket) => { socks.push(ws); }, getWebSockets: () => socks.filter((s) => s.readyState !== 3), getWebSocketAutoResponseTimestamp: (ws: RoomSocket) => new Date(pinged.get(ws) ?? Date.now()) };
  const room = new Region(ctx, {});
  const join = (i: number) => room.fetch(new Request("https://mm.example/ws", { headers: { Upgrade: "websocket", "X-User-Id": `walker-${i}-uid`, "X-User-Name": `W${i}` } }));
  for (let i = 0; i < MAX_PLAYERS; i++) await join(i);
  expect(socks).toHaveLength(MAX_PLAYERS);
  await join(99); // full: refused, never accepted
  expect(socks).toHaveLength(MAX_PLAYERS);
  pinged.set(socks[0]!, Date.now() - DEAD_MS - 1000); // the first page's last ping, long ago: its laptop lid shut
  await join(99);
  expect(socks).toHaveLength(MAX_PLAYERS + 1); // swept, and the seat went to the one waiting
  expect(socks[0]!.readyState).toBe(3);
});

test("live, every join carries an eqosys token: a guest is told to sign in, and stops trying", async () => {
  const live = serveParty(0, { guests: false });
  const o = join("Cy", "LIVE1", live.url);
  o.update(5, 100, 100, 0, "hodag", performance.now());
  await until(() => o.status === "signin");
  o.close(); live.stop();
});

test("of several clock samples the one read soonest wins: a busy page only ever reads one late", () => {
  // the world clock read 1000 at page time 0; a stalled page handled the next at 3200 when it said 4000 (true: 4000 at 3000)
  expect(bestOffset([{ age: 1000, at: 0 }, { age: 4000, at: 3200 }, { age: 6000, at: 5000 }])).toBe(1000);
});

test("the world clock wraps on a whole number of days, small enough for a shader's float32 time", () => {
  expect(WORLD_CYCLE % DAY).toBe(0);
  const a_year_on = worldClock(365 * 86_400_000, 0, 0);
  expect(a_year_on).toBeLessThan(WORLD_CYCLE);
  expect(Math.fround(a_year_on + 1 / 60) - Math.fround(a_year_on)).toBeCloseTo(1 / 60, 3); // a frame still moves the sway
});

test.each([
  ["a run, a pose every fifth of a second", 5, 200, 30, false, 0],
  ["a run after a minute alone (the page sends nothing then)", 1500, 60_000, 1, false, 0],
  ["a 3 s network stall, then its 15 poses of a run in one burst", 5.2, 0, 15, false, 3000],
  ["3 km in a fifth of a second", 3000, 200, 1, true, 0],
  ["39 m hops all at once: the slack is spent once", 39, 0, 2, true, 0],
  ["after a 3 s stall, 39 m hops all at once: the bank and the slack are spent once", 39, 0, 4, true, 3000],
])("faster than anyone walks: %s", (_, m, ms, n, fast, stall) => {
  // From a first pose (nothing to measure from, so never a jump), n hops of m metres, ms apart, the first after `stall`.
  let { a, jumped } = step(undefined, { x: 138000, z: 56000 }, 0);
  for (let i = 1; i <= n && !jumped; i++) ({ a, jumped } = step(a, { x: 138000 + i * m * 10, z: 56000 }, stall + i * ms));
  expect(jumped).toBe(fast);
});

describe("the wire", () => {
  test("a pose goes out as whole decimetres and only the fields that changed", () => {
    const a = quantise(5, 1234.56, 789.01, Math.PI / 2, "hodag");
    expect(a).toEqual({ r: 5, x: 12346, z: 7890, y: 64, l: "hodag", f: "", m: 0 });
    expect(delta(a, quantise(5, 1234.6, 789.0, Math.PI / 2, "hodag"))).toBeNull(); // under a decimetre: nothing to send
    expect(delta(a, quantise(5, 1240, 789.01, Math.PI / 2, "hodag"))).toEqual({ x: 12400 });
    expect(JSON.stringify(delta(a, quantise(5, 1240, 790, 0, "hodag"))).length).toBeLessThan(30);
  });

  test.each([
    ["off the map", { x: -5 }],
    ["a creature id that isn't one", { l: "<img>" }],
    ["nothing", {}],
    ["not an object", "x=1"],
  ])("a delta with %s is refused", (_, raw) => { expect(parseDelta(raw)).toBeNull(); });
  test.each([
    ["a den", { e: "den", den: "hunt:1.20002.6206", c: "hodag", lv: 7 }, true],
    ["a den that isn't one", { e: "den", den: "<b>", c: "hodag", lv: 7 }, false],
    ["what a newcomer should see", { e: "seen", picks: [{ id: "40,-2", at: 120 }], flown: [{ id: "12,34", at: 118, h: 0.5 }], roost: [], busy: ["5,5"] }, true],
    ["a clock question", { e: "time" }, true],
    ["a sign past the lair", { e: "hunt", h: "1.20002.6206", s: 4 }, false],
    ["a fight with no result", { e: "fought", c: "hodag", lv: 7, s: 30 }, false],
  ])("an event: %s", (_, raw, ok) => { expect(parseEvent(raw) !== null).toBe(ok); });

  test.each([
    ["believed: the den was walked into long enough ago", { c: "hodag", lv: 7, at: 0, n: 0 }, 30, 31_000, true],
    ["another creature", { c: "squonk", lv: 7, at: 0, n: 0 }, 30, 31_000, false],
    ["another level", { c: "hodag", lv: 30, at: 0, n: 0 }, 30, 31_000, false],
    ["past the line-up", { c: "hodag", lv: 7, at: 0, n: 6 }, 30, 31_000, false],
    ["no den walked into", null, 30, 31_000, false],
    ["longer than the time since", { c: "hodag", lv: 7, at: 0, n: 0 }, 60, 31_000, false],
    ["over in a blink", { c: "hodag", lv: 7, at: 0, n: 0 }, 1, 31_000, false],
    ["an hour later", { c: "hodag", lv: 7, at: 0, n: 0 }, 30, 3_600_000, false],
  ])("a fight report is %s", (_, met, secs, now, ok) => {
    expect(plausible(met, { e: "fought", c: "hodag", lv: 7, won: true, bound: false, s: secs }, now)).toBe(ok);
  });
  test("a den told again after a reconnect is backdated 3 minutes at most", () => {
    expect(parseEvent({ e: "den", den: "5,5", c: "hodag", lv: 7, ago: 90_000 })).toMatchObject({ ago: 90_000 });
    expect(parseEvent({ e: "den", den: "5,5", c: "hodag", lv: 7, ago: 10 * 60_000 })).toMatchObject({ ago: 180_000 });
  });
  test("a field the wire doesn't know is never relayed", () => { expect(parseDelta({ x: 1, hp: 9 })).toEqual({ x: 1 }); });

  test("a room message with a bad pose is dropped, a good one read", () => {
    expect(decodeServer({ t: "p", id: "ab12", d: { x: 1e9 } })).toBeNull();
    expect(decodeServer({ t: "all", you: "ab12", age: 0, players: [{ id: "cd34", name: "Bo", p: {} }] })?.t).toBe("all");
  });

  test("a friend is drawn smoothly between updates, stands where they stopped, and coasts a moment when an update is late", () => {
    const g = new Ghost("ab12", "Bo");
    g.hear({ r: 5, x: 10000, z: 5000, y: 0, l: "hodag", f: "squonk,agropelter", m: 1 }, 0);
    g.hear({ x: 10020, m: 0 }, 200); // two metres in 200 ms, and that message stops them there
    expect(g.at(100 + BEHIND_MS)!.x).toBeCloseTo(1001, 5);
    expect(g.at(200 + BEHIND_MS + 5000)!.x).toBe(1002);
    const late = new Ghost("cd34", "Cy");
    late.hear({ r: 5, x: 10000, z: 5000, y: 0, l: "hodag", f: "", m: 1 }, 0);
    late.hear({ x: 10020 }, 200); // still moving, and the next update is late: on the way they went, 300 ms at most
    expect(late.at(200 + BEHIND_MS + 100)!.x).toBeCloseTo(1003, 5);
    expect(late.at(200 + BEHIND_MS + 5000)!.x).toBeCloseTo(1002 + (2 / 200) * COAST_MS, 5);
    expect(g.at(200 + BEHIND_MS)!.follow).toEqual(["squonk", "agropelter"]); // their line-up, drawn behind them
  });
});

describe("the door", () => {
  const env = { GUESTS: "1", ASSETS: { fetch: async () => new Response("page") }, REGION: { idFromName: (n: string) => n, get: () => ({ fetch: async (r: Request) => new Response(r.headers.get("X-User-Id")) }) } };
  const ws = (q: string, headers: Record<string, string> = {}) => worker.fetch(new Request(`https://mm.example/ws?${q}`, { headers: { Upgrade: "websocket", ...headers } }), env);
  test("serves the page, vouches its own identity, and refuses a bad code, player id or origin", async () => {
    expect(await (await worker.fetch(new Request("https://mm.example/"), env)).text()).toBe("page");
    expect(await (await ws("room=walk1&uid=abcdefgh1234", { "X-User-Id": "someone-else" })).text()).toBe("abcdefgh1234");
    for (const q of ["room=a&uid=abcdefgh1234", "room=WALK1&uid=x"]) expect((await ws(q)).status).toBe(400);
    expect((await ws("room=WALK1&uid=abcdefgh1234", { Origin: "https://evil.example" })).status).toBe(403);

  });
});
