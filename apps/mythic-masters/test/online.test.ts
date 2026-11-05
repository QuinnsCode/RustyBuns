// Walking the world together (#3663): two players in one room through the page's own net module, the real Worker and
// the real Region Durable Object (scripts/party.ts runs them on Bun's sockets), then the wire and the door.
import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import worker from "../src/edge/worker.ts";
import { MAX_PLAYERS, Ghost, BEHIND_MS, decodeServer, delta, parseDelta, parseEvent, plausible, quantise } from "../src/net/party.ts";
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
    // Ada takes a contract and reads its first sign: Bo hears it and can follow the same signs.
    ada.hunt("1.20002.6206", 0); ada.hunt("1.20002.6206", 1);
    await until(() => heard.includes("Bo: Ada hunt 1.20002.6206 1"));
    // Ada walks into a wild hodag: Bo hears whose fight it is, so that den is quiet for him too. Her report of the fight
    // gets to Bo only when it fits the den she walked into: a fight longer than the time since is dropped.
    ada.met("120,48", "hodag");
    await until(() => heard.includes("Bo: Ada at hodag 120,48"));
    ada.fought("hodag", 7, true, false, 90);
    await Bun.sleep(1100);
    ada.fought("hodag", 7, true, false, 3);
    await until(() => heard.includes("Bo: Ada beat hodag"));
    expect(heard.filter((l) => l === "Bo: Ada beat hodag")).toHaveLength(1);

    // Ada closes the tab: Bo sees her go. She comes back and walks on, and Bo sees her again.
    ada.close();
    await until(() => bo.ghosts.size === 0);
    const again = join("Ada");
    again.update(5, 1003, 1000, 0, "hodag", performance.now());
    await until(() => again.status === "in");
    walk(again, 5, 1003, 2);
    await until(() => bo.ghosts.size === 1 && again.ghosts.size === 1 && [...bo.ghosts.values()][0]!.pose.x === 10040); // her last step, 1004 m

    // Bo walks into region 6: a different room, so neither sees the other there, and the world's clock carries on.
    const before = bo.clock(performance.now())!;
    bo.update(6, 2000, 1000, 0, "jersey-devil", performance.now() + 10_000);
    await until(() => party.rooms().some((r) => r.name === "WALK1:6" && r.open === 1) && bo.status === "in");
    await until(() => again.ghosts.size === 0);
    expect(bo.clock(performance.now())! - before).toBeGreaterThan(0);
    expect(bo.clock(performance.now())! - before).toBeLessThan(5);
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

describe("the wire", () => {
  test("a pose goes out as whole decimetres and only the fields that changed", () => {
    const a = quantise(5, 1234.56, 789.01, Math.PI / 2, "hodag");
    expect(a).toEqual({ r: 5, x: 12346, z: 7890, y: 64, l: "hodag", f: "" });
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
    ["a den", { e: "den", den: "hunt:1.20002.6206", c: "hodag" }, true],
    ["a den that isn't one", { e: "den", den: "<b>", c: "hodag" }, false],
    ["a sign past the lair", { e: "hunt", h: "1.20002.6206", s: 4 }, false],
    ["a fight with no result", { e: "fought", c: "hodag", lv: 7, s: 30 }, false],
  ])("an event: %s", (_, raw, ok) => { expect(parseEvent(raw) !== null).toBe(ok); });

  test.each([
    ["believed: the den was walked into long enough ago", { c: "hodag", at: 0 }, 30, 31_000, true],
    ["another creature", { c: "squonk", at: 0 }, 30, 31_000, false],
    ["no den walked into", null, 30, 31_000, false],
    ["longer than the time since", { c: "hodag", at: 0 }, 60, 31_000, false],
    ["over in a blink", { c: "hodag", at: 0 }, 1, 31_000, false],
    ["an hour later", { c: "hodag", at: 0 }, 30, 3_600_000, false],
  ])("a fight report is %s", (_, met, secs, now, ok) => {
    expect(plausible(met, { e: "fought", c: "hodag", lv: 7, won: true, bound: false, s: secs }, now)).toBe(ok);
  });
  test("a field the wire doesn't know is never relayed", () => { expect(parseDelta({ x: 1, hp: 9 })).toEqual({ x: 1 }); });

  test("a room message with a bad pose is dropped, a good one read", () => {
    expect(decodeServer({ t: "p", id: "ab12", d: { x: 1e9 } })).toBeNull();
    expect(decodeServer({ t: "all", you: "ab12", age: 0, players: [{ id: "cd34", name: "Bo", p: {} }] })?.t).toBe("all");
  });

  test("a friend is drawn smoothly between updates and stands where they stopped", () => {
    const g = new Ghost("ab12", "Bo");
    g.hear({ r: 5, x: 10000, z: 5000, y: 0, l: "hodag", f: "squonk,agropelter" }, 0);
    g.hear({ x: 10020 }, 200); // two metres in 200 ms, then nothing: they stopped there
    expect(g.at(100 + BEHIND_MS)!.x).toBeCloseTo(1001, 5);
    expect(g.at(200 + BEHIND_MS + 5000)!.x).toBe(1002);
    expect(g.at(200 + BEHIND_MS)!.follow).toEqual(["squonk", "agropelter"]); // their line-up, drawn behind them
  });
});

describe("the door", () => {
  const env = { GUESTS: "1", ASSETS: { fetch: async () => new Response("page") }, REGION: { idFromName: (n: string) => n, get: () => ({ fetch: async (r: Request) => new Response(r.headers.get("X-User-Id")) }) } };
  const ws = (q: string, headers: Record<string, string> = {}) => worker.fetch(new Request(`https://mm.example/ws?${q}`, { headers: { Upgrade: "websocket", ...headers } }), env);
  test("serves the page, vouches its own identity, and refuses a bad code, region or origin", async () => {
    expect(await (await worker.fetch(new Request("https://mm.example/"), env)).text()).toBe("page");
    expect(await (await ws("room=walk1&region=5&uid=abcdefgh1234", { "X-User-Id": "someone-else" })).text()).toBe("abcdefgh1234");
    for (const q of ["room=a&region=5&uid=abcdefgh1234", "room=WALK1&region=99&uid=abcdefgh1234", "room=WALK1&region=5&uid=x"]) expect((await ws(q)).status).toBe(400);
    expect((await ws("room=WALK1&region=5&uid=abcdefgh1234", { Origin: "https://evil.example" })).status).toBe(403);

  });
});
