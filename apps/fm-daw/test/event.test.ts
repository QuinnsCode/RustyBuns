// Open an Event Planner plan as The Event (#6020), in headless Chrome over CDP (scripts/chrome.ts): on /rooms.html stand
// two stacks in the scoring hall and aim one, Open as event (a party made from the room and put live), and the jam room
// its link opens plays from the same boxes the builder planned. The client walk-through's link plays a test set through
// them: walk up to the left stack and it is the loud one.
import { expect, setDefaultTimeout, test } from "bun:test";
import { load, openTab, until as pageUntil } from "../../../scripts/chrome.ts";
import { chrome, hasChrome, useBrowser, vite } from "./browser-kit.ts";

setDefaultTimeout(240_000); // the builder, then a jam room in software GL with its audio up
useBrowser("--autoplay-policy=no-user-gesture-required");

type Box = { at: number[]; yaw: number; pitch: number; maxSpl: number };
type Heard = { at: [number, number]; db?: number }[];

test.skipIf(!hasChrome)("plan two stacks, open it as the event: the jam room plays the same PA, and the walk-through plays it a test set", async () => {
  const tab = await openTab(chrome.cdp, { w: 1280, h: 720 });
  try {
    await load(chrome.cdp, tab, `${vite.url}rooms.html`, 0);
    await pageUntil(tab, "!!window.qrooms", "the builder", 30_000, 50);
    const planned = await tab.eval<{ ok: boolean[]; sources: Box[]; event: { ok: boolean; link: string | null }; walk: { link: string | null }; live: string | null }>(`(() => {
      localStorage.clear();
      qrooms.load("scoring-hall");
      const ok = [qrooms.edit({ t: "stack", at: [-11, -14] }).ok, qrooms.edit({ t: "stack", at: [11, -14] }).ok, qrooms.edit({ t: "aimStack", index: 1, yaw: -0.4 }).ok];
      const event = qrooms.event(), walk = qrooms.event(true);
      return { ok, sources: qrooms.pa().sources, event, walk, live: qrooms.party.state().live };
    })()`);
    expect(planned.ok).toEqual([true, true, true]);
    expect(planned.sources.length).toBeGreaterThanOrEqual(2);
    expect(planned.event.ok).toBe(true);
    expect(planned.live).not.toBeNull(); // a second Open as event keeps the same party live, not a new one
    const event = new URL(planned.event.link!), walk = new URL(planned.walk.link!);
    expect(event.searchParams.get("room")).toBe(walk.searchParams.get("room"));
    expect(walk.searchParams.get("walk")).toBe("1");

    // the event's room, with no storage of the builder's: the PA it plays from is the one planned
    const jam = async (url: string) => {
      await load(chrome.cdp, tab, `${url}&quality=low`, 0);
      await pageUntil(tab, "!!window.qjam && !!window.qjam.state().me.wearing", "the room", 60_000);
    };
    await tab.eval(`localStorage.clear()`);
    await jam(event.href);
    const there = await tab.eval<{ sources: Box[]; walk: boolean }>(`qjam.state().pa`);
    expect(there.sources).toEqual(planned.sources);
    expect(there.walk).toBe(false);

    // the walk-through: the test set on the planned PA, louder from the stack you walk up to
    await jam(walk.href);
    await tab.eval(`qjam.start()`);
    await pageUntil(tab, "qjam.state().pa.testSet", "the test set", 60_000);
    await tab.eval(`qjam.walkTo(-9, -11)`);
    await pageUntil(tab, "(qjam.state().pa.heard ?? []).some((h) => h.m !== undefined && h.m < 5)", "the left stack near", 30_000);
    const heard = await tab.eval<Heard>(`qjam.state().pa.heard`);
    const left = heard.find((h) => h.at[0] < 0)!, right = heard.find((h) => h.at[0] > 0)!;
    expect(left.db!).toBeGreaterThan(right.db! + 6);
  } finally { await tab.close(); }
});
