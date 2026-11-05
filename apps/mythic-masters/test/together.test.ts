// One journey through the running app, the way two friends play it (#3663): two pages open the world in one room
// (the dev server, and scripts/party.ts standing in for the edge). One walks; the other sees it walk, as the beast it
// leads, at a real frame rate, on the same clock. It closes its tab and the other sees it go; it comes back and the
// other sees it again. The second lands beside the first, wherever the first has walked to. A contract one takes is the other's too; the server drops and they find each other again. Needs Chrome and a GPU-ish machine: CI's runner draws the open world in software and never
// answers, so there it is skipped (like terraviz-demo's live test); every dev machine and agent runs it.
import { expect, setDefaultTimeout, test } from "bun:test";
import { chromePath, freePort, launchChrome, load, openTab, startVite } from "../../../scripts/chrome.ts";
import { serveParty } from "../scripts/party.ts";

setDefaultTimeout(180_000);

test.skipIf(!chromePath() || !!process.env.CI)("two friends walk one world: see each other, the same hour, leave and come back", async () => {
  const port = await freePort();
  let party = serveParty(port);
  /** Ask `get` until `ok` says yes, or fail after `ms`. */
  const until = async <T>(get: () => Promise<T>, ok: (v: T) => boolean, ms = 12_000) => {
    const end = Date.now() + ms;
    for (let v = await get(); !ok(v); v = await get()) { if (Date.now() > end) throw new Error(`still ${JSON.stringify(v)}`); await Bun.sleep(300); }
  };
  process.env.MM_PARTY = String(port);
  const vite = await startVite(new URL("..", import.meta.url).pathname);
  const chrome = await launchChrome();
  try {
    const open = async (lead: string) => { const t = await openTab(chrome.cdp, { w: 960, h: 600 }, false, true); await load(chrome.cdp, t, `${vite.url}/?world=1&a=${lead}&room=TOGETHER`, 4000); return t; };
    const walk = (steps: number) => `(async () => { const w = mythicMasters.world, s = w.state(); for (let i = 0; i < ${steps}; i++) { w.teleport(s.x + 3 + i * 0.4, s.z - 6); await new Promise((r) => setTimeout(r, 200)); } return w.online(); })()`;
    const look = `(async () => { let n = 0; const t0 = performance.now(); await new Promise((r) => { const f = () => { n++; performance.now() - t0 < 2000 ? requestAnimationFrame(f) : r(); }; requestAnimationFrame(f); }); const w = mythicMasters.world; return { frameMs: 2000 / n, online: w.online(), hour: w.state().day.hour }; })()`;
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
    expect(seen.frameMs).toBeLessThan(50);
    const clock = "mythicMasters.world.online().clock";
    const [aClock, bClock] = await Promise.all([a.eval<number>(clock), b.eval<number>(clock)]);
    expect(Math.abs(aClock - bClock)).toBeLessThan(1); // one world clock (seconds), so the same sun, weather and wilds on both pages
    console.log(`two pages, one room: ${seen.frameMs.toFixed(1)} ms a frame with a friend drawn, ${(walked.sentBytes / 3).toFixed(0)} B/s up while walking`);

    // A takes a contract and reads its first sign: B is on it too, in B's own journey.
    await a.eval(`mythicMasters.together.hunt("1.20002.6206", 1)`);
    await until(() => b.eval<number | null>(`mythicMasters.journey.state()?.hunts?.["1.20002.6206"] ?? null`), (s) => s === 1);

    // The server drops (a deploy, a blip): both walk on alone, then find each other again by themselves.
    party.stop();
    await until(() => b.eval<string>(`mythicMasters.together.state().status`), (s) => s === "offline");
    party = serveParty(port);
    await until(() => Promise.all([a.eval(walk(3)), b.eval<Look>(look)]).then(([, l]) => l.online.friends.length), (n) => n === 1, 30_000);

    await a.close();
    await Bun.sleep(1500);
    expect((await b.eval<Look>(look)).online.friends).toEqual([]);
    const back = await open("hodag");
    await back.eval(walk(5));
    expect((await b.eval<Look>(look)).online.friends.map((f) => f.lead)).toEqual(["hodag"]);
    expect([...b.noise, ...back.noise].filter((n) => !/favicon|api\/me|401/.test(n))).toEqual([]);
  } finally {
    chrome.stop(); vite.stop(); party.stop();
  }
});
