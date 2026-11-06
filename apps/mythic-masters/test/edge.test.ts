// Walking together under workerd itself (#3706), not the Bun stand-in: `wrangler dev` runs the Worker and its Region
// (scripts/edge.ts). What only the runtime shows: the Worker module starts at all, a signed-in join goes through the
// live door (a token checked against eqosys's JWKS), a refused join's close code reaches the page through a real
// upgrade, the room closes a replaced tab and a silent page, "ping" is answered without waking the room, a page that stops pinging is swept, and a room that hibernated wakes
// with everyone where they were and the den they walked into.
import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { jwksOf, newKey, sign } from "@rustybuns/util/token";
import { APP } from "../src/account.ts";
import { Online } from "../src/net/online.ts";
import { decodeServer, type ServerMsg } from "../src/net/party.ts";
import { serveEdge, wranglerPath, type Edge } from "../scripts/edge.ts";

setDefaultTimeout(90_000);
const edges: Edge[] = [];
const stops: (() => unknown)[] = [];
afterAll(async () => { for (const s of stops) s(); for (const e of edges) await e.stop(); });

const until = async (what: string, ok: () => boolean, ms = 8000) => {
  const end = Date.now() + ms;
  while (!ok()) { if (Date.now() > end) throw new Error(`timed out: ${what}`); await Bun.sleep(25); }
};

/** One page's socket, speaking the wire by hand: what it heard, its pongs, how it closed. */
function seat(base: string, query: string, ping = true) {
  const ws = new WebSocket(`${base}/ws?${query}`);
  const s = { ws, got: [] as ServerMsg[], pongs: 0, closed: null as number | null, send: (v: object) => ws.send(JSON.stringify(v)) };
  ws.onmessage = (e) => {
    const text = String(e.data);
    if (text === "pong") { s.pongs++; return; }
    const m = decodeServer(JSON.parse(text) as unknown);
    if (m) s.got.push(m);
  };
  ws.onclose = (e) => { s.closed = e.code; };
  if (ping) { const t = setInterval(() => { if (ws.readyState === 1) ws.send("ping"); }, 1000); ws.addEventListener("close", () => clearInterval(t)); stops.push(() => clearInterval(t)); }
  return s;
}
type Seat = ReturnType<typeof seat>;
/** The room closed this socket. Under wrangler dev the close frame arrives but the connection is never torn down, so
 *  Bun's client sits in CLOSING with no close event (Chrome gives up after 2 s and reports the room's code, clean). */
const told = (s: Seat) => s.closed !== null || s.ws.readyState === WebSocket.CLOSING;
const heard = (s: Seat, t: ServerMsg["t"]) => s.got.filter((m) => m.t === t);
/** Long enough quiet for workerd to evict a Durable Object whose sockets are all hibernatable. */
const QUIET_MS = 15_000;
/** Each time a Region was built, how many open seats it found. */
const wakes = (e: Edge) => [...e.log().matchAll(/region up with (\d+) seats/g)].map((m) => Number(m[1]));

// CI installs wrangler with the lockfile, so there a missing one fails the run instead of skipping it quietly.
describe.skipIf(!wranglerPath() && !process.env.CI)("under workerd", () => {
  test("the live door: signed-in friends walk together, a full room and a second tab are told, a silent page is swept, a hibernated room wakes with its seats", async () => {
    // A local eqosys: its JWKS, and tokens it signs for this game.
    const key = await newKey();
    const eqosys = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: async (r) => new URL(r.url).pathname === "/.well-known/jwks.json" ? Response.json(await jwksOf({ EQOSYS_SIGNING_KEY: key })) : new Response("no", { status: 404 }) });
    stops.push(() => eqosys.stop(true));
    const iss = `http://127.0.0.1:${eqosys.port}`;
    const token = async (id: string, name: string, k = key) => (await sign({ EQOSYS_SIGNING_KEY: k }, iss, { user: { id, email: `${id}@example.com`, name }, app: APP, source: "eqosys", access: [] }))!;
    const DEAD = 4000;
    const edge = await serveEdge(0, { guests: false, eqosys: iss, deadMs: DEAD });
    edges.push(edge);
    const room = (q: string, ping = true) => seat(edge.url, `room=WALK2&${q}`, ping);

    // No token, or one eqosys didn't sign: told to sign in, through the upgrade, as the page's close code.
    const anon = room("uid=guest-uid-0000"), forged = room(`token=${await token("eve", "Eve", await newKey())}`);
    await until("sign-in closes", () => anon.closed !== null && forged.closed !== null);
    expect([anon.closed, forged.closed]).toEqual([4401, 4401]);

    // Ada and Bo, signed in: each sees the other by the name eqosys gave them, and her steps.
    let ada = room(`token=${await token("ada", "Ada Lovelace")}`);
    await until("Ada in", () => heard(ada, "all").length === 1);
    const bo = room(`token=${await token("bo", "Bo Diddley")}`);
    await until("Bo in", () => heard(bo, "all").length === 1 && heard(ada, "hi").length === 1);
    expect(heard(ada, "hi")).toMatchObject([{ name: "Bo Diddley" }]);
    // Ada opens the world in a second tab: the first is told it was replaced, and Bo sees no one leave.
    const tab2 = room(`token=${await token("ada", "Ada Lovelace")}`);
    await until("first tab replaced", () => told(ada));
    await until("tab 2 in", () => heard(tab2, "all").length === 1);
    expect(told(tab2)).toBe(false);
    ada = tab2;
    ada.send({ r: 5, x: 138000, z: 56000, y: 0, l: "hodag", f: "", m: 1 }); // by region 5's first stone
    await until("Bo sees her step", () => heard(bo, "p").length > 0);
    expect(heard(bo, "p").at(-1)).toMatchObject({ d: { r: 5, x: 138000, l: "hodag" } });
    expect(heard(bo, "bye")).toEqual([]);
    // She walks up to her region's first stone: Bo hears the den is hers.
    ada.send({ e: "den", den: "keeper:5:0", c: "loveland-frogman", lv: 34, ago: 0, n: 0 });
    await until("Bo hears the den", () => heard(bo, "den").length === 1);

    // Four more fill the room to six; a seventh is told it is full.
    const more = await Promise.all([1, 2, 3, 4].map(async (i) => room(`token=${await token(`p${i}`, `Player ${i}`)}`)));
    await until("six in", () => more.every((m) => heard(m, "all").length === 1));
    const seventh = room(`token=${await token("p7", "Player 7")}`);
    await until("seventh refused", () => seventh.closed !== null);
    expect(seventh.closed).toBe(4003);
    for (const m of more) m.ws.close();
    await until("they leave", () => heard(bo, "bye").length === 4);

    // A page that never pings (a laptop lid shut) is closed DEAD_MS on, at the room's next event, and the party told.
    const lid = room(`token=${await token("cy", "Cy")}`, false);
    await until("Cy in", () => heard(lid, "all").length === 1);
    await Bun.sleep(DEAD + 500);
    bo.send({ r: 5, x: 10050, z: 10000, y: 0, l: "squonk", f: "", m: 1 });
    await until("Cy swept", () => told(lid));
    await until("Ada hears Cy go", () => heard(ada, "bye").length === 5);

    // Quiet but for pings, which the runtime answers itself: the room hibernates. It comes back with both seats, Ada's
    // pose and the den she walked into, so her fight report is still believed.
    const pongs = bo.pongs, built = wakes(edge).length;
    await Bun.sleep(QUIET_MS); // pings can't show it: they never wake the room, so it logs only at Dee's join
    const dee = room(`token=${await token("dee", "Dee")}`);
    await until("Dee in", () => heard(dee, "all").length === 1);
    expect(wakes(edge).length).toBeGreaterThan(built);
    expect(wakes(edge).at(-1)).toBe(2); // Ada and Bo, rebuilt from their sockets
    expect(bo.pongs).toBeGreaterThan(pongs + 5);
    expect(heard(dee, "all")[0]).toMatchObject({ players: expect.arrayContaining([expect.objectContaining({ name: "Ada Lovelace", p: expect.objectContaining({ x: 138000, l: "hodag" }) })]) });
    ada.send({ e: "fought", c: "loveland-frogman", lv: 34, won: true, bound: true, s: 3 });
    await until("Bo hears her fight", () => heard(bo, "fought").length === 1);
    expect(heard(bo, "fought")[0]).toMatchObject({ c: "loveland-frogman", won: true, bound: true });
  });

  test("the guest door: two pages' own net code walk together under workerd", async () => {
    const edge = await serveEdge(0, { guests: true });
    edges.push(edge);
    const page = (name: string) => new Online("GUEST2", { base: edge.url, guest: { uid: `${name}-uid-0000`, name } });
    const ada = page("Ada"), bo = page("Bo");
    stops.push(() => ada.close(), () => bo.close());
    const t0 = performance.now();
    ada.update(5, 1000, 1000, 0, "hodag", t0); bo.update(5, 1010, 1000, 0, "squonk", t0);
    await until("both in", () => ada.status === "in" && bo.status === "in");
    for (let i = 1; i <= 6; i++) { ada.update(5, 1000 + i, 1000, 0, "hodag", performance.now()); bo.update(5, 1010 + i, 1000, 0, "squonk", performance.now()); await Bun.sleep(220); }
    await until("each sees the other", () => [...ada.ghosts.values()].some((g) => g.pose.l === "squonk") && [...bo.ghosts.values()].some((g) => g.pose.l === "hodag" && (g.pose.x ?? 0) > 10000));
    expect([...bo.ghosts.values()].map((g) => g.name)).toEqual(["Ada"]);
  });
});
