// Walking the world together (#3663): two players in one room through the page's own net module, the real Worker and
// the real Region Durable Object (scripts/party.ts runs them on Bun's sockets), then the wire and the door.
import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import worker from "../src/edge/worker.ts";
import { MAX_PLAYERS, Ghost, BEHIND_MS, COAST_MS, decodeServer, delta, parseDelta, quantise } from "../src/net/party.ts";
import { Online } from "../src/net/online.ts";
import { serveParty } from "../scripts/party.ts";

setDefaultTimeout(20_000);
const party = serveParty();
afterAll(() => party.stop());

const until = async (ok: () => boolean, ms = 3000) => { const end = Date.now() + ms; while (!ok()) { if (Date.now() > end) throw new Error("timed out"); await Bun.sleep(10); } };
const join = (name: string, room = "WALK1") => new Online(room, { base: party.url, guest: { uid: `${name}-uid-0000`, name } });
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

    // Ada closes the tab: Bo sees her go. She comes back and walks on, and Bo sees her again.
    ada.close();
    await until(() => bo.ghosts.size === 0);
    const again = join("Ada");
    again.update(5, 1003, 1000, 0, "hodag", performance.now());
    await until(() => again.status === "in");
    walk(again, 5, 1003, 2);
    await until(() => bo.ghosts.size === 1 && again.ghosts.size === 1 && [...bo.ghosts.values()][0]!.pose.x === 10040); // her last step, 1004 m

    // Bo walks into region 6: a different room, so neither sees the other there.
    bo.update(6, 2000, 1000, 0, "jersey-devil", performance.now() + 10_000);
    await until(() => party.rooms().some((r) => r.name === "WALK1:6" && r.open === 1));
    await until(() => again.ghosts.size === 0);
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

describe("the wire", () => {
  test("a pose goes out as whole decimetres and only the fields that changed", () => {
    const a = quantise(5, 1234.56, 789.01, Math.PI / 2, "hodag");
    expect(a).toEqual({ r: 5, x: 12346, z: 7890, y: 64, l: "hodag" });
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
  test("a field the wire doesn't know is never relayed", () => { expect(parseDelta({ x: 1, hp: 9 })).toEqual({ x: 1 }); });

  test("a room message with a bad pose is dropped, a good one read", () => {
    expect(decodeServer({ t: "p", id: "ab12", d: { x: 1e9 } })).toBeNull();
    expect(decodeServer({ t: "all", you: "ab12", players: [{ id: "cd34", name: "Bo", p: {} }] })?.t).toBe("all");
  });

  test("a friend is drawn smoothly between updates and coasts only a moment past the last", () => {
    const g = new Ghost("ab12", "Bo");
    g.hear({ r: 5, x: 10000, z: 5000, y: 0, l: "hodag" }, 0);
    g.hear({ x: 10020 }, 200); // two metres in 200 ms
    expect(g.at(100 + BEHIND_MS)!.x).toBeCloseTo(1001, 5);
    const coast = g.at(200 + BEHIND_MS + 5000)!.x;
    expect(coast).toBeCloseTo(1002 + (2 / 200) * COAST_MS, 5);
  });
});

describe("the door", () => {
  const env = { ASSETS: { fetch: async () => new Response("page") }, REGION: { idFromName: (n: string) => n, get: () => ({ fetch: async (r: Request) => new Response(r.headers.get("X-User-Id")) }) } };
  const ws = (q: string, headers: Record<string, string> = {}) => worker.fetch(new Request(`https://mm.example/ws?${q}`, { headers: { Upgrade: "websocket", ...headers } }), env);
  test("serves the page, vouches its own identity, and refuses a bad code, region or origin", async () => {
    expect(await (await worker.fetch(new Request("https://mm.example/"), env)).text()).toBe("page");
    expect(await (await ws("room=walk1&region=5&uid=abcdefgh1234", { "X-User-Id": "someone-else" })).text()).toBe("abcdefgh1234");
    for (const q of ["room=a&region=5&uid=abcdefgh1234", "room=WALK1&region=99&uid=abcdefgh1234", "room=WALK1&region=5&uid=x"]) expect((await ws(q)).status).toBe(400);
    expect((await ws("room=WALK1&region=5&uid=abcdefgh1234", { Origin: "https://evil.example" })).status).toBe(403);
  });
});
