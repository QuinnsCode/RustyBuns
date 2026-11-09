// A two-player online round: the world behind real sockets, two pages played the way a person plays them
// (their own body moves at once, everyone else is drawn smoothed from the views, ~50 ms of network each way).
import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { serve, durableObject } from "@rustybuns/shell-bun";
import World from "../packages/desktop/world.ts";
import { HUNT, circleAt, dropOk, isServerMsg, type Msg, type View } from "../src/hunt/game.ts";
import { resolve, step, wrap, type Body } from "../src/hunt/sim.ts";
import { loadZoneData, zoneById, type Zone } from "../src/zones/zone.ts";

setDefaultTimeout(60_000);
const ZONE = "el-capitan", LAG = 50;

const env: Record<string, unknown> = {};
env.WORLD = durableObject(World as never, env);
const shell = serve<Record<string, unknown>>({ hostname: "127.0.0.1", port: 0 });
shell.mount({
  fetch: (req: Request, e: { WORLD: { get(id: unknown): { fetch(r: Request): Promise<Response> }; idFromName(n: string): unknown } }) => {
    const url = new URL(req.url), uid = url.searchParams.get("uid")!;
    const headers = new Headers(req.headers);
    headers.set("X-User-Id", uid); headers.set("X-User-Name", uid);
    return e.WORLD.get(e.WORLD.idFromName(url.searchParams.get("room")!)).fetch(new Request(req, { headers }));
  },
} as never, env);

const saved = { ...HUNT };
beforeAll(async () => { await loadZoneData(ZONE); HUNT.dropSecs = 1; HUNT.hideSecs = 1; });
afterAll(() => { Object.assign(HUNT, saved); shell.stop(); });

/** One player's page: the latest view (after the network's delay) and a send that takes as long to arrive. */
function page(room: string, uid: string) {
  const ws = new WebSocket(`ws://127.0.0.1:${shell.port}/ws?uid=${uid}&room=${room}`);
  const p = { view: null as View | null, send: (m: Msg) => void setTimeout(() => ws.readyState === 1 && ws.send(JSON.stringify(m)), LAG), close: () => ws.close() };
  ws.onmessage = (e) => { const m: unknown = JSON.parse(String(e.data)); if (isServerMsg(m)) setTimeout(() => { p.view = m.view; }, LAG); };
  return p;
}
const until = async (f: () => unknown, ms = 15000) => { const end = Date.now() + ms; while (!f()) { if (Date.now() > end) throw new Error("timed out"); await Bun.sleep(10); } };

/** A flat, open spot well away from the cabin. */
function openSpot(z: Zone): [number, number] {
  for (let r = 50; r < z.R * 0.9; r += 2) for (let a = 0; a < 6.28; a += 0.3) {
    const x = z.station.x + Math.cos(a) * r, y = z.station.y + Math.sin(a) * r;
    if (dropOk(z, x, y) && z.slope(x, y) < 0.1 && z.near(x, y, 12).every((q) => Math.hypot(q.x - x, q.y - y) > 8 + q.r)) return [x, y];
  }
  throw new Error("no open spot");
}

async function round(room: string) {
  const a = page(room, `${room}-a`), b = page(room, `${room}-b`);
  await until(() => a.view && b.view?.players.length === 2);
  const h = a.view!.hostId === a.view!.me ? a : b;
  h.send({ t: "settings", zone: ZONE, tod: "day", live: false });
  await until(() => h.view?.zonePick === ZONE && h.view.tod === "day" && !h.view.live);
  h.send({ t: "start" });
  await until(() => a.view?.round && b.view?.round);
  const ranger = a.view!.round!.rangers.includes(a.view!.me) ? a : b, camper = ranger === a ? b : a;
  return { ranger, camper, z: zoneById(ZONE), done: () => { a.close(); b.close(); } };
}

/** The page's own body, moved the way main.ts moves it, reported every 50 ms. */
function body(v: View): Body { const y = v.round!.you!; return { x: y.x, y: y.y, yaw: y.yaw, stamina: 1, crouch: false, run: false }; }
const pos = (b: Body): Msg => ({ t: "pos", x: b.x, y: b.y, yaw: b.yaw, pitch: 0, crouch: false, prone: false, climb: false, run: b.run, light: false });

test("a ranger who runs into a camper on screen tags them, even with the camper running across", async () => {
  const { ranger, camper, z, done } = await round("tag");
  const [x, y] = openSpot(z);
  camper.send({ t: "drop", x, y });
  await until(() => ranger.view?.phase === "hunt" && camper.view?.phase === "hunt");
  const rb = body(ranger.view!), cb = body(camper.view!);
  // The camper as the ranger's screen draws them: eased toward each view (world3d's remotes).
  let drawn: { x: number; y: number } | null = null, touched = 0, last = performance.now(), sent = 0, across = 0;
  while (camper.view?.round?.you?.caughtAt == null) {
    await Bun.sleep(16);
    const t = performance.now(), dt = Math.min(0.05, (t - last) / 1000);
    last = t;
    const seen = ranger.view!.round!.others.find((o) => o.role === "camper");
    if (seen) drawn = drawn ? { x: drawn.x + (seen.x - drawn.x) * Math.min(1, dt * 10), y: drawn.y + (seen.y - drawn.y) * Math.min(1, dt * 10) } : { x: seen.x, y: seen.y };
    if (!drawn) throw new Error("the ranger never saw the camper");
    const gap = Math.hypot(drawn.x - rb.x, drawn.y - rb.y);
    // The ranger runs straight at the camper on their screen; once close, the camper breaks sideways.
    rb.yaw = Math.atan2(drawn.x - rb.x, drawn.y - rb.y);
    step(z, rb, "ranger", { fwd: 1, right: 0, run: true, crouch: false }, dt);
    if (gap < 6 && !across) across = wrap(rb.yaw + Math.PI / 2);
    if (across) { cb.yaw = across; step(z, cb, "camper", { fwd: 1, right: 0, run: true, crouch: false }, dt); }
    if (t - sent > 50) { sent = t; ranger.send(pos(rb)); camper.send(pos(cb)); }
    // Bodies 0.35 m round each: on the ranger's screen they've bumped into the camper.
    if (gap < 0.7) touched ||= t;
    if (touched && t - touched > 400) break;
    if (ranger.view!.phase !== "hunt") break;
  }
  const caught = camper.view?.round?.you?.caughtAt ?? null;
  done();
  expect(caught).not.toBeNull();
});

test("a camper outside the closing circle gets a countdown, is safe back inside, and is out when it runs down", async () => {
  Object.assign(HUNT, { shrinkFrom: 0, shrinkTo: 1, finalRadius: 0.15 });
  const { camper, z, done } = await round("circle");
  Object.assign(HUNT, { shrinkFrom: saved.shrinkFrom, shrinkTo: saved.shrinkTo, finalRadius: saved.finalRadius });
  const [x, y] = openSpot(z);
  camper.send({ t: "drop", x, y });
  await until(() => camper.view?.phase === "hunt" && camper.view.round?.circle);
  // The circle closes in a second; until the camper is well inside it, nobody is counted out.
  HUNT.outsideSecs = 600;
  await Bun.sleep(1200);
  const cb = body(camper.view!), you = () => camper.view!.round!.you!;
  const k = circleAt(camper.view!.round!.circle!, camper.view!.now);
  const fromMiddle = () => Math.hypot(cb.x - k.x, cb.y - k.y);
  /**
   * Away from (+1) or toward (-1) the circle's middle until `stop`, a report every 50 ms. Quicker than a person
   * runs (the middle can be a long way off), but inside what the host accepts from one report to the next.
   * Each step is the host's own move (straight on, then pushed out of whatever it walked into), so the body here
   * stays where the host has it; held by a trunk or boulder, the next step goes half sideways round it.
   */
  const walk = async (dir: 1 | -1, stop: () => boolean) => {
    const end = Date.now() + 40_000;
    let side = 0;
    while (!stop()) {
      if (Date.now() > end) throw new Error("walk timed out");
      await Bun.sleep(50);
      const before = fromMiddle(), d = before || 1;
      const ux = (dir * (cb.x - k.x)) / d, uy = (dir * (cb.y - k.y)) / d, s = 0.8 / Math.hypot(1, side);
      cb.x += (ux - side * uy) * s; cb.y += (uy + side * ux) * s;
      resolve(z, cb);
      side = Math.abs(fromMiddle() - before) < 0.2 ? 1 : 0;
      cb.yaw = Math.atan2(ux, uy);
      camper.send(pos(cb));
    }
  };
  await walk(-1, () => fromMiddle() < k.r - 3);
  await until(() => you().outsideAt == null);
  HUNT.outsideSecs = saved.outsideSecs;
  await walk(1, () => you().outsideAt != null);
  await Bun.sleep(2000);
  expect(you().caughtAt).toBeNull();
  await walk(-1, () => you().outsideAt == null);   // back in: the countdown is off
  await walk(1, () => you().outsideAt != null);
  const out = you().outsideAt!;
  await until(() => you().caughtAt != null, (HUNT.outsideSecs + 2) * 1000);
  expect(you().caughtAt! - out).toBeGreaterThanOrEqual(HUNT.outsideSecs * 1000);
  expect(you().caughtBy).toBeNull();
  expect(camper.view!.log.some((l) => l.includes("left the search area"))).toBe(true);
  done();
});
