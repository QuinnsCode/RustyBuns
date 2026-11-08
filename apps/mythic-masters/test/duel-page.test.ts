// Fighting a friend, through the running app: two players (two Chrome profiles, each with a line-up) open one duel's
// link, each picks from their own line-up, and both go straight into the arena. One holds forward and the fight is the
// same fight on both pages (the room compares their hashes; a page that drifts is told). The pause menu doesn't stop
// it. Needs Chrome; skipped in CI like the walk-together journey (together.test.ts).
import { expect, setDefaultTimeout, test } from "bun:test";
import { chromePath, freePort, launchChrome, load, openTab, startVite } from "../../../scripts/chrome.ts";
import { serveParty } from "../scripts/party.ts";

setDefaultTimeout(120_000);

type Duel = { status: string; seats: { you: 0 | 1; names: (string | null)[] } | null; round: number | null; on: boolean; mine: 0 | 1; tick: number | null; over: boolean | null; sum: number | null; screen: string | null };

test.skipIf(!chromePath() || !!process.env.CI)("two friends open one duel, pick from their line-ups and fight the same fight", async () => {
  const port = await freePort(), party = serveParty(port);
  process.env.MM_PARTY = String(port);
  const vite = await startVite(new URL("..", import.meta.url).pathname);
  const chrome = await launchChrome(), site = vite.url.replace(/\/$/, "");
  const until = async <T>(get: () => Promise<T>, ok: (v: T) => boolean, ms = 15_000) => {
    const end = Date.now() + ms;
    for (let v = await get(); !ok(v); v = await get()) { if (Date.now() > end) throw new Error(`still ${JSON.stringify(v)}`); await Bun.sleep(200); }
  };
  try {
    // Each player has a journey (the world makes one from ?a=), then opens the challenge's link.
    const player = async (lead: string) => {
      const t = await openTab(chrome.cdp, { w: 960, h: 600 }, false, true);
      await load(chrome.cdp, t, `${site}/?world=1&a=${lead}`, 3000);
      await load(chrome.cdp, t, `${site}/?duel=TESTDUEL`, 2500);
      return t;
    };
    const a = await player("hodag"), b = await player("squonk");
    const duel = (t: typeof a) => t.eval<Duel>("mythicMasters.duel()");
    await until(() => duel(b), (d) => d.status === "in" && d.seats?.names.every((n) => n !== null) === true);
    expect([(await duel(a)).seats?.you, (await duel(b)).seats?.you]).toEqual([0, 1]);

    expect(await a.eval<boolean>("mythicMasters.duelPick(0)")).toBe(true);
    expect(await b.eval<boolean>("mythicMasters.duelPick(0)")).toBe(true);
    await until(() => Promise.all([duel(a), duel(b)]), ([x, y]) => x.on && y.on && (x.tick ?? 0) > 120 && (y.tick ?? 0) > 120);
    // Seat 1 sees the fight from its own side: its fighter is the squonk.
    const [fa, fb] = await Promise.all([a.eval<{ fighters: { id: string }[] }>("mythicMasters.state()"), b.eval<{ fighters: { id: string }[] }>("mythicMasters.state()")]);
    expect(fa.fighters.map((f) => f.id)).toEqual(["hodag", "squonk"]);
    expect(fb.fighters.map((f) => f.id)).toEqual(["hodag", "squonk"]);
    expect((await duel(b)).mine).toBe(1);

    // A walks in; B opens the pause menu, which only stops B's hands: the fight goes on for both.
    await a.eval(`mythicMasters.hold(["KeyW"])`);
    expect(await b.eval<boolean>(`mythicMasters.settings(true)`)).toBe(true);
    const before = (await duel(b)).tick ?? 0;
    await Bun.sleep(1500);
    const [da, db] = await Promise.all([duel(a), duel(b)]);
    expect(db.tick ?? 0).toBeGreaterThan(before + 30);
    // Lockstep: never more than a few frames apart, never told they drifted.
    expect(Math.abs((da.tick ?? 0) - (db.tick ?? 0))).toBeLessThan(30);
    expect(da.screen).toBeNull();
    expect(db.screen).toBeNull();
    console.log(`duel: A at tick ${da.tick}, B at ${db.tick}`);

    // B leaves: A's fight is off, said plainly.
    await b.eval(`mythicMasters.duelLeave()`);
    await until(() => duel(a), (d) => d.screen === "No contest");
  } finally {
    chrome.stop(); vite.stop(); party.stop();
  }
});
