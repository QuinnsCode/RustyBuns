// One journey through the running app, the way two friends play it (#3663): two pages open the world in one room
// (the dev server, and scripts/party.ts standing in for the edge). One walks; the other sees it walk, as the beast it
// leads, at a real frame rate, on the same clock. It closes its tab and the other sees it go; it comes back and the
// other sees it again. The second lands beside the first, wherever the first has walked to. A contract one takes is the
// other's too; the server drops and they find each other again; at the contract's lair both fight the one creature there.
// CI's runner draws the open world in software at a frame a second, so there the pages play with `?draw=0` (nothing drawn,
// everything else the same) and the frame-time checks are left to a machine with a GPU (every dev machine and agent).
// MM_EDGE=workerd runs the same journey against workerd itself (scripts/edge.ts, `wrangler dev`) instead of the stand-in.
import { expect, setDefaultTimeout, test } from "bun:test";
import { chromePath, freePort, launchChrome, load, openTab, startVite } from "../../../scripts/chrome.ts";
import { serveEdge } from "../scripts/edge.ts";
import { serveParty } from "../scripts/party.ts";
import { Online } from "../src/net/online.ts";

setDefaultTimeout(420_000);
const CI = !!process.env.CI;

test.skipIf(!chromePath())("two friends walk one world: see each other, the same hour, leave and come back", async () => {
  const port = await freePort();
  const edge = async (): Promise<{ url: string; stop: () => unknown }> => process.env.MM_EDGE === "workerd" ? serveEdge(port) : serveParty(port);
  let party = await edge();
  /** Ask `get` until `ok` says yes, or fail after `ms`. */
  const until = async <T>(get: () => Promise<T>, ok: (v: T) => boolean, ms = 12_000) => {
    const end = Date.now() + ms;
    for (let v = await get(); !ok(v); v = await get()) { if (Date.now() > end) throw new Error(`still ${JSON.stringify(v)}`); await Bun.sleep(300); }
  };
  process.env.MM_PARTY = String(port);
  const vite = await startVite(new URL("..", import.meta.url).pathname);
  const chrome = await launchChrome();
  try {
    const open = async (lead: string) => { const t = await openTab(chrome.cdp, { w: 960, h: 600 }, false, true); await load(chrome.cdp, t, `${vite.url}/?world=1&a=${lead}&room=TOGETHER${CI ? "&draw=0&quality=low" : ""}`, 4000); return t; };
    const walk = (steps: number) => `(async () => { const w = mythicMasters.world, s = w.state(); for (let i = 0; i < ${steps}; i++) { w.teleport(s.x + 3 + i * 0.4, s.z - 6); await new Promise((r) => setTimeout(r, 200)); } return w.online(); })()`;
    const look = `(async () => { let n = 0; const t0 = performance.now(); await new Promise((r) => { const f = () => { n++; performance.now() - t0 < 2000 ? requestAnimationFrame(f) : r(); }; requestAnimationFrame(f); }); const w = mythicMasters.world; return { frameMs: 2000 / n, online: w.online(), hour: w.state().day.hour }; })()`;
    /** Walk to `short` metres from (x, z) at 7.5 m a second (a run is 5; the room believes up to 8), a pose every half
     *  second, in legs of at most 30 s (a page answers an eval within a minute). */
    const stride = async (t: { eval: <T>(js: string) => Promise<T> }, x: number, z: number, short: number) => {
      for (let left = Infinity; left > short + 1;) left = await t.eval<number>(`(async () => { const w = mythicMasters.world, s = w.state(); const dx = ${x} - s.x, dz = ${z} - s.z, d = Math.hypot(dx, dz), n = Math.min(60, Math.ceil((d - ${short}) / 3.75));
        for (let i = 1; i <= n; i++) { w.teleport(s.x + (dx * i * 3.75) / d, s.z + (dz * i * 3.75) / d); await new Promise((r) => setTimeout(r, 500)); }
        const e = w.state(); return Math.hypot(${x} - e.x, ${z} - e.z); })()`);
    };
    type Look = { frameMs: number; online: { status: string; friends: { lead: string; name: string }[] }; hour: number };

    // A walks 300 m off along the trail before B comes in: B's Start lands them beside A, not at their own save's spot.
    const a = await open("hodag");
    const away = await a.eval<{ x: number; z: number }>(`(async () => { const w = mythicMasters.world, s = w.state(); w.teleport(s.x + 300, s.z); await new Promise((r) => setTimeout(r, 500)); const t = w.state(); return { x: t.x, z: t.z }; })()`);
    const b = await open("squonk");
    await until(() => b.eval<{ x: number; z: number }>(`mythicMasters.world.state()`), (s) => Math.hypot(s.x - away.x, s.z - away.z) < 10);
    const [walked, seen] = await Promise.all([a.eval<{ status: string; sentBytes: number }>(walk(15)), b.eval<Look>(look)]);
    expect(walked.status).toBe("in");
    expect(seen.online.status).toBe("in");
    expect(seen.online.friends.map((f) => f.lead)).toEqual(["hodag"]);
    // 60 fps is 16.7 ms; a loaded dev machine or agent box runs it near 20. Past 50 a friend in view has made it choppy.
    if (!CI) expect(seen.frameMs).toBeLessThan(50);
    // Each is a figure with the Book on their own humming ground (#3774): B draws A's ground in the colour A's page wears,
    // with A's beast walking behind and a trail of prints where A walked (#3786), and B wears another colour (two in a
    // room never share one, world/hues.ts).
    type Ground = { id: string; colour: number; trail: number; team?: string[] };
    const [mine, theirs, own] = await Promise.all([a.eval<Ground>(`mythicMasters.world.state().bearer`), b.eval<Ground[]>(`mythicMasters.world.state().friends`), b.eval<Ground>(`mythicMasters.world.state().bearer`)]);
    expect(theirs.map((f) => ({ id: f.id, colour: f.colour, lead: f.team?.[0] }))).toEqual([{ id: mine.id, colour: mine.colour, lead: "hodag" }]);
    expect(own.colour).not.toBe(mine.colour);
    expect(theirs[0]!.trail).toBeGreaterThan(0);
    const clock = "mythicMasters.world.online().clock";
    const [aClock, bClock] = await Promise.all([a.eval<number>(clock), b.eval<number>(clock)]);
    expect(Math.abs(aClock - bClock)).toBeLessThan(1); // one world clock (seconds), so the same sun, weather and wilds on both pages
    console.log(`two pages, one room: ${seen.frameMs.toFixed(1)} ms a frame with a friend drawn, ${(walked.sentBytes / 3).toFixed(0)} B/s up while walking`);

    // A full party: four more walk round B (six in all, the room's limit), each with its line-up, and B still runs smoothly.
    const at = await b.eval<{ x: number; z: number }>(`mythicMasters.world.state()`);
    const bots = [0, 1, 2, 3].map((i) => new Online("TOGETHER", { base: party.url, guest: { uid: `party-bot-${i}-uid`, name: `Bot ${i + 1}` } }));
    const t0 = performance.now();
    const pace = setInterval(() => {
      const t = (performance.now() - t0) / 1000;
      bots.forEach((o, i) => { const a = t * 0.8 + i * 1.6; o.update(1, at.x + Math.cos(a) * (6 + i), at.z - 8 + Math.sin(a) * (6 + i), a + Math.PI / 2, "jackalope", performance.now(), ["squonk", "agropelter"]); });
    }, 50);
    try {
      await until(() => b.eval<Look>(look), (l) => l.online.friends.length === 5);
      const full = await b.eval<Look>(look);
      console.log(`a full party of six: ${full.frameMs.toFixed(1)} ms a frame with five friends and their line-ups drawn`);
      if (!CI) expect(full.frameMs).toBeLessThan(50);
    } finally {
      clearInterval(pace);
      for (const o of bots) o.close();
    }
    await until(() => b.eval<Look>(look), (l) => l.online.friends.length === 1);

    // A takes a contract and reads its first sign: B is on it too, in B's own journey.
    // Land beside the campfire 386 m from the board first, as fast travel does (a jump the room vouches for), 10 m off
    // so it does not rest us there and stop the walk.
    const board = "mythicMasters.world.teleport(19083, 2025); await new Promise((r) => setTimeout(r, 400));";
    await a.eval(`(async () => { ${board} mythicMasters.together.hunt("1.19074.1638", 1); })()`);
    await until(() => b.eval<number | null>(`mythicMasters.journey.state()?.hunts?.["1.19074.1638"] ?? null`), (s) => s === 1);

    // The server drops (a deploy, a blip): both walk on alone, then find each other again by themselves.
    await party.stop();
    await until(() => b.eval<string>(`mythicMasters.together.state().status`), (s) => s === "offline");
    party = await edge();
    await until(() => Promise.all([a.eval(walk(3)), b.eval<Look>(look)]).then(([, l]) => l.online.friends.length), (n) => n === 1, 30_000);

    await a.close();
    await Bun.sleep(1500);
    expect((await b.eval<Look>(look)).online.friends).toEqual([]);
    const back = await open("hodag");
    await back.eval(walk(5));
    expect((await b.eval<Look>(look)).online.friends.map((f) => f.lead)).toEqual(["hodag"]);
    // Back in, A lands by the board, picks a bush there and reads the next sign: B's bush is bare and B is a sign
    // further on too. (A bush is told only from beside it.)
    await back.eval(`(async () => { ${board} mythicMasters.together.pick("272,28"); mythicMasters.together.hunt("1.19074.1638", 2); })()`);
    await until(() => b.eval<{ picks: { id: string }[] }>(`mythicMasters.together.seen()`), (s) => s.picks.some((p) => p.id === "272,28"));
    await until(() => b.eval<number | null>(`mythicMasters.journey.state()?.hunts?.["1.19074.1638"] ?? null`), (s) => s === 2);

    // Both by the campfire 559 m from region 1's other board. A jumps straight onto the board's town door (no road takes you there
    // that fast, so the room stops vouching for A), walks in and reads the board: the contract goes nowhere (#3800). B runs over to A, who stands
    // still; once B is beside A the room trusts A again, and A's page tells the contract. B runs at 7 m/s by the clock, under
    // the room's RUN_MPS (8, party.ts): any faster and B is a jump too, and nobody vouches for anybody (a minute's run).
    const other = "1.20002.6206", stage = `mythicMasters.journey.state()?.hunts?.["${other}"] ?? null`;
    const settle = "await new Promise((r) => setTimeout(r, 600));";
    // No wild one jumps either of them on the way: a lost fight opens the Book and holds the page's poses back.
    await Promise.all([back.eval(`(async () => { mythicMasters.world.peace(true); mythicMasters.world.teleport(20185, 5674); ${settle} })()`), b.eval(`(async () => { mythicMasters.world.peace(true); mythicMasters.world.teleport(20165, 5674); ${settle} })()`)]);
    await back.eval(`(async () => { mythicMasters.world.teleport(20002, 6206); ${settle} mythicMasters.world.standInside(4.6, -7.9); ${settle} })()`);
    await until(() => back.eval<number | null>(stage), (s) => s === 0);
    await Bun.sleep(1000);
    expect(await b.eval<number | null>(stage)).toBeNull();
    await stride(b, 20002, 6206, 15);
    await until(() => b.eval<number | null>(stage), (s) => s === 0);

    // One fight at one den, joined together. Both land by the campfire 377 m from the first contract's lair, and each tells
    // the other it read the last sign, so the Rougarou waits there for both. They walk over at a pace the room believes;
    // A walks into it, and B hears who is fighting what, and where. B walks in too: the same creature at the same level, in
    // B's own fight. A's ends (worn down, so it is quick), and B hears how it went.
    const first = "1.19074.1638", lair = { x: 19426, z: 2391.2 }, fire = { x: 19490, z: 2763 };
    const ready = (dx: number) => `(async () => { mythicMasters.world.peace(true); mythicMasters.world.teleport(${fire.x + dx}, ${fire.z}); ${settle} mythicMasters.together.hunt("${first}", 3); })()`;
    await Promise.all([back.eval(ready(12)), b.eval(ready(-12))]);
    const lastSign = `(() => { const s = mythicMasters.world.state(); return { stage: mythicMasters.journey.state()?.hunts?.["${first}"] ?? null, x: Math.round(s.x), z: Math.round(s.z), r: s.region, room: mythicMasters.together.state()?.status }; })()`;
    type Sign = { stage: number | null };
    await Promise.all([until(() => back.eval<Sign>(lastSign), (s) => s.stage === 3), until(() => b.eval<Sign>(lastSign), (s) => s.stage === 3)]);
    // To 25 m short of the lair, then on with the wild ones awake.
    await Promise.all([stride(back, lair.x, lair.z, 25), stride(b, lair.x, lair.z, 25)]);
    type Trip = { kind: string; foe: { id: string; level: number } } | null;
    const into = `(async () => { const w = mythicMasters.world; w.peace(false); for (let i = 0; i < 10 && !mythicMasters.journey.trip(); i++) { const s = w.state(); w.teleport(s.x + (${lair.x} - s.x) / 2, s.z + (${lair.z} - s.z) / 2); await new Promise((r) => setTimeout(r, 400)); } return mythicMasters.journey.trip(); })()`;
    const aTrip = await back.eval<Trip>(into);
    expect(aTrip?.foe).toMatchObject({ id: "rougarou", level: 9, hunt: first });
    type Fight = { den: string; c: string; won?: boolean };
    const heard = "mythicMasters.together.state().fights";
    await until(() => b.eval<Fight[]>(heard), (fs) => fs.some((x) => x.den === `hunt:${first}` && x.c === "rougarou"));
    const bTrip = await b.eval<Trip>(into);
    expect(bTrip?.foe).toEqual(aTrip?.foe);
    // A fight report is believed only once it has lasted 3 s (party.ts FIGHT), by the fight's own clock: 4 s of ticks
    // (a CI runner's page ticks slower than the wall clock).
    await until(() => back.eval<number>(`mythicMasters.state()?.tick ?? 0`), (t) => t >= 4 * 60, 90_000);
    await back.eval(`mythicMasters.journey.wear(0.01, 0)`);
    const aFight = "(() => { const s = mythicMasters.state(); return s && { tick: s.tick, over: s.over, winner: s.winner, hp: s.fighters.map((f) => f.hp) }; })()";
    await until(() => Promise.all([b.eval<Fight[]>(heard), back.eval<unknown>(aFight)]), ([fs]) => fs.some((x) => x.c === "rougarou" && x.won === false), 60_000);
    expect([...b.noise, ...back.noise].filter((n) => !/favicon|api\/me|401/.test(n))).toEqual([]);
  } finally {
    chrome.stop(); vite.stop(); await party.stop();
  }
});
