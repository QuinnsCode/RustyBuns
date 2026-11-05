// Walking the world together (#3663): two players in one party room through the page's own net module, the real Worker and
// the real Region Durable Object (scripts/party.ts runs them on Bun's sockets), then the wire and the door.
import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import worker from "../src/edge/worker.ts";
import { bestOffset, COAST_MS, DEN_M, denNear, MAX_PLAYERS, Ghost, BEHIND_MS, decodeServer, delta, parseDelta, parseEvent, plausible, quantise, WORLD_CYCLE, worldClock } from "../src/net/party.ts";
import { DEN } from "../src/world/world.ts";
import { DAY } from "../src/world/nature.ts";
import { Online } from "../src/net/online.ts";
import { serveParty } from "../scripts/party.ts";

setDefaultTimeout(20_000);
const party = serveParty();
afterAll(() => party.stop());

const until = async (ok: () => boolean, ms = 3000) => { const end = Date.now() + ms; while (!ok()) { if (Date.now() > end) throw new Error("timed out"); await Bun.sleep(10); } };
/** What each player heard from the party, as lines. */
const heard: string[] = [];
const join = (name: string, room = "WALK1", base = party.url) => new Online(room, {
  base, guest: { uid: `${name}-uid-0000`, name },
  onDen: (den, who, c) => heard.push(`${name}: ${who} at ${c} ${den}`),
  onHunt: (h, s, who) => heard.push(`${name}: ${who} hunt ${h} ${s}`),
  onFought: (f) => heard.push(`${name}: ${f.who} ${f.won ? "beat" : "lost to"} ${f.c}`),
  onLife: (k, id, _h, at) => heard.push(`${name}: ${k} ${id}${at === undefined ? "" : ` at ${at}`}`),
  onSeen: (s) => heard.push(`${name}: seen ${s.roost.map((r) => r.id).join()} busy ${s.busy.join()}`),
});
/** Walk a player a step east every SEND_MS-ish frame for `steps` frames. */
const walk = (o: Online, region: number, x0: number, steps: number, lead = "hodag") => { for (let i = 0; i < steps; i++) o.update(region, x0 + i, 1000, 0, lead, performance.now() + i * 250); };

describe("two friends in one region", () => {
  test("see each other walk with their lead beast; one leaves and comes back; another region is another room", async () => {
    const ada = join("Ada"), bo = join("Bo");
    ada.update(5, 1000, 1000, 0, "hodag", performance.now());
    bo.update(5, 1010, 1000, Math.PI, "jersey-devil", performance.now());
    await until(() => ada.status === "in" && bo.status === "in");
    walk(ada, 5, 1000, 4); walk(bo, 5, 1010, 4, "jersey-devil");
    await until(() => [...ada.ghosts.values()].some((g) => g.pose.l === "jersey-devil") && [...bo.ghosts.values()].some((g) => g.pose.l === "hodag"));
    const seen = [...bo.ghosts.values()][0]!;
    expect(seen.name).toBe("Ada");
    expect(seen.at(performance.now() + BEHIND_MS)?.x).toBeGreaterThan(999);
    // One clock for the room, so the wilds circling their dens, the sun and the weather are the same for both.
    const now = performance.now();
    expect(Math.abs(ada.clock(now)! - bo.clock(now)!)).toBeLessThan(0.1);
    // Ada flushes a flock and picks a bush beside Bo: his birds take off and his bush is bare too.
    ada.life("flush", "12,34", 1.5); ada.life("pick", "40,-2");
    await until(() => heard.includes("Bo: flush 12,34") && heard.includes("Bo: pick 40,-2"));
    // What she picked and flushed before he came goes to him in one message, with its time on the world clock.
    ada.seen({ picks: [{ id: "41,-2", at: 120 }], flown: [{ id: "13,34", at: 118, h: 0.5 }], roost: [{ id: "14,34", x: 1500, z: 1200 }], busy: ["5,5"] });
    await until(() => heard.includes("Bo: pick 41,-2 at 120") && heard.includes("Bo: flush 13,34 at 118") && heard.includes("Bo: seen 14,34 busy 5,5"));
    // Ada takes a contract and reads its first sign: Bo hears it and can follow the same signs.
    ada.hunt("1.20002.6206", 0); ada.hunt("1.20002.6206", 1);
    await until(() => heard.includes("Bo: Ada hunt 1.20002.6206 1"));
    // Ada walks into a wild hodag: Bo hears whose fight it is, so that den is quiet for him too. Her report of the fight
    // gets to Bo only when it fits the den she walked into: a fight longer than the time since is dropped.
    ada.met("120,48", "hodag", 7); // 25 km off: no such den near her, so nothing to hear and nothing to report against
    ada.met("5,5", "hodag", 7); // the den cell she stands by
    await until(() => heard.includes("Bo: Ada at hodag 5,5"));
    expect(heard.some((l) => l.includes("120,48"))).toBe(false);
    ada.fought("hodag", 7, true, false, 90);
    await Bun.sleep(1100);
    ada.fought("hodag", 7, true, false, 3);
    await until(() => heard.includes("Bo: Ada beat hodag"));
    // Her line-up's next beast fights the same den: believed again, once that fight has had time to happen.
    ada.fought("hodag", 7, false, false, 3);
    await Bun.sleep(1100);
    ada.fought("hodag", 7, false, false, 3);
    await until(() => heard.includes("Bo: Ada lost to hodag"));
    expect(heard.filter((l) => l.startsWith("Bo: Ada beat") || l.startsWith("Bo: Ada lost"))).toHaveLength(2);

    // Ada closes the tab: Bo sees her go. She comes back and walks on, and Bo sees her again.
    ada.close();
    await until(() => bo.ghosts.size === 0);
    const again = join("Ada");
    again.update(5, 1003, 1000, 0, "hodag", performance.now());
    await until(() => again.status === "in");
    walk(again, 5, 1003, 2);
    await until(() => bo.ghosts.size === 1 && again.ghosts.size === 1 && [...bo.ghosts.values()][0]!.pose.x === 10040); // her last step, 1004 m

    // Bo walks on into region 6: still the party's one room, so Ada knows where he went, and the clock carries on. Alone
    // in region 5 now, Ada sends nothing while she walks, so the room can sleep.
    const before = bo.clock(performance.now())!;
    bo.update(6, 2000, 1000, 0, "jersey-devil", performance.now() + 10_000);
    await until(() => [...again.ghosts.values()][0]?.pose.r === 6);
    expect(again.where()).toEqual([{ name: "Bo", region: 6 }]);
    expect(party.rooms().map((r) => r.name).filter((n) => n.startsWith("WALK1"))).toEqual(["WALK1:party"]);
    const sent = again.sentBytes;
    walk(again, 5, 1010, 6);
    expect(again.sentBytes).toBe(sent);
    const later = bo.clock(performance.now())!;
    expect((later - before + WORLD_CYCLE) % WORLD_CYCLE).toBeLessThan(5);
    again.close(); bo.close();
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
  ["the wild den you stand by", "5,5", true],
  ["a wild den 25 km off", "120,48", false],
  ["a lair three signs from its board in your region", "hunt:5.1300.900", true],
  ["a lair in another region", "hunt:4.1300.900", false],
  ["your region's arena", "mythic:5", true],
  ["another region's keeper", "keeper:6:2", false],
  ["a trail section's wild one here", "trail:5:3:1", true],
  ["something else", "house:5", false],
])("a den a player could walk into: %s", (_, den, ok) => {
  expect(DEN_M).toBe(DEN);
  expect(denNear(den, { r: 5, x: 10000, z: 10000 })).toBe(ok); // standing at (1000 m, 1000 m) in region 5
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
