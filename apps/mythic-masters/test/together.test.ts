// One journey through the running app, the way two friends play it (#3663): two pages open the world in one room
// (the dev server, and scripts/party.ts standing in for the edge). One walks; the other sees it walk, as the beast it
// leads, at a real frame rate, on the same clock. It closes its tab and the other sees it go; it comes back and the
// other sees it again. Needs Chrome, like the other journeys in the repo; skipped without it.
import { expect, setDefaultTimeout, test } from "bun:test";
import { chromePath, freePort, launchChrome, load, openTab, startVite } from "../../../scripts/chrome.ts";
import { serveParty } from "../scripts/party.ts";

setDefaultTimeout(180_000);

test.skipIf(!chromePath())("two friends walk one world: see each other, the same hour, leave and come back", async () => {
  const port = await freePort(), party = serveParty(port);
  process.env.MM_PARTY = String(port);
  const vite = await startVite(new URL("..", import.meta.url).pathname);
  const chrome = await launchChrome();
  try {
    const open = async (lead: string) => { const t = await openTab(chrome.cdp, { w: 960, h: 600 }, false, true); await load(chrome.cdp, t, `${vite.url}/?world=1&a=${lead}&room=TOGETHER`, 4000); return t; };
    const walk = (steps: number) => `(async () => { const w = mythicMasters.world, s = w.state(); for (let i = 0; i < ${steps}; i++) { w.teleport(s.x + 3 + i * 0.4, s.z - 6); await new Promise((r) => setTimeout(r, 200)); } return w.online(); })()`;
    const look = `(async () => { let n = 0; const t0 = performance.now(); await new Promise((r) => { const f = () => { n++; performance.now() - t0 < 2000 ? requestAnimationFrame(f) : r(); }; requestAnimationFrame(f); }); const w = mythicMasters.world; return { frameMs: 2000 / n, online: w.online(), hour: w.state().day.hour }; })()`;
    type Look = { frameMs: number; online: { status: string; friends: { lead: string; name: string }[] }; hour: number };

    const a = await open("hodag"), b = await open("squonk");
    const [walked, seen] = await Promise.all([a.eval<{ status: string; sentBytes: number }>(walk(15)), b.eval<Look>(look)]);
    expect(walked.status).toBe("in");
    expect(seen.online.status).toBe("in");
    expect(seen.online.friends.map((f) => f.lead)).toEqual(["hodag"]);
    const aHour = (await a.eval<Look>(look)).hour;
    expect(Math.abs(aHour - seen.hour)).toBeLessThan(0.1); // one world clock: the same hour on both pages
    console.log(`two pages, one room: ${seen.frameMs.toFixed(1)} ms a frame with a friend drawn, ${(walked.sentBytes / 3).toFixed(0)} B/s up while walking`);

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
