// Building an event in the studio builder (Qevent, #5915), in headless Chrome over CDP (scripts/chrome.ts): on
// /rooms.html make a party from the Desert Gathering, save a version, give a second performer their own scene, undo
// in one scene without touching the other's, put everyone out at once, bring the first version back, go live, and
// find it all still there after a reload. A second party going live takes the first off: only one room is live.
import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromePath, launchChrome, load, openTab, startVite, until as pageUntil } from "../../../scripts/chrome.ts";

setDefaultTimeout(240_000);
let chrome: Awaited<ReturnType<typeof launchChrome>>;
let vite: Awaited<ReturnType<typeof startVite>>;
// The linux-arm64 and Windows drop runners have no Chrome (#5553), so the check runs where one is, as the other Chrome tests do.
const hasChrome = !!chromePath();
beforeAll(async () => {
  if (!hasChrome) return;
  const app = join(import.meta.dir, "..");
  if (!existsSync(join(app, ".rustybuns/vite.ts"))) {
    const made = Bun.spawnSync(["bunx", "rustybuns", "boundary"], { cwd: app, stdout: "pipe", stderr: "pipe" });
    if (made.exitCode !== 0) throw new Error(`rustybuns boundary: ${made.stderr.toString()}`);
  }
  [chrome, vite] = await Promise.all([launchChrome(["--disable-audio-output"]), startVite(app)]);
});
afterAll(() => { chrome?.stop(); vite?.stop(); });

type Tab = Awaited<ReturnType<typeof openTab>>;
const until = (tab: Tab, ready: string) => pageUntil(tab, ready, ready, 30_000, 50);
type Party = { open: { id: string; scene: string; scenes: { id: string; performer: string; seats: number }[]; versions: { n: number; note: string }[] } | null; live: string | null; parties: string[] };

test.skipIf(!hasChrome)("make a party, a scene per performer with its own undo, everyone at once, bring a version back, go live, reload and it's all there", async () => {
  const tab = await openTab(chrome.cdp, { w: 1280, h: 800 });
  try {
    await load(chrome.cdp, tab, `${vite.url}rooms.html`, 0);
    await until(tab, "!!window.qrooms");
    const made = await tab.eval<{ n: number; ok: boolean[]; again: { ok: boolean; why: string }; p: Party }>(`(() => {
      localStorage.clear();
      qrooms.load("desert-gathering");
      const n = qrooms.state().def.spots.length, ok = [qrooms.party.make("Saturday night").ok, qrooms.party.save("as the ground came").ok];
      return { n, ok, again: qrooms.party.save("again"), p: qrooms.party.state() };
    })()`);
    expect(made.ok).toEqual([true, true]);
    expect(made.again).toEqual({ ok: false, why: "Nothing has changed since the last version" });
    expect(made.p.open!.scenes).toEqual([{ id: "s1", performer: "Opening act", seats: made.n }]);
    const n = made.n;
    expect(n).toBeGreaterThan(2);

    // the opening act takes a seat out; the headliner's scene starts from that, and takes another out, then undoes it
    const scenes = await tab.eval<{ two: Party; undone: number; one: number; oneUndone: number; oneRedone: number }>(`(() => {
      const spots = () => qrooms.state().def.spots;
      qrooms.edit({ t: "unspot", id: spots()[0].id });
      qrooms.party.addScene("Headliner");
      qrooms.edit({ t: "unspot", id: spots()[0].id });
      const two = qrooms.party.state();
      qrooms.undo();
      const undone = spots().length;
      qrooms.party.scene("s1");
      const one = spots().length;
      qrooms.undo();
      const oneUndone = spots().length;
      qrooms.redo();
      return { two, undone, one, oneUndone, oneRedone: spots().length };
    })()`);
    expect(scenes.two.open!.scene).toBe("headliner");
    expect(scenes.two.open!.scenes.map((s) => s.seats)).toEqual([n - 1, n - 2]);
    expect(scenes.undone).toBe(n - 1);
    expect([scenes.one, scenes.oneUndone, scenes.oneRedone]).toEqual([n - 1, n, n - 1]);

    // every setup out at once is a scene of its own; save, then bring the first version back
    const back = await tab.eval<{ all: Party; saved: boolean; restored: Party; seats: number }>(`(() => {
      qrooms.party.everyone();
      const all = qrooms.party.state(), saved = qrooms.party.save("both acts").ok;
      qrooms.party.restore(1);
      return { all, saved, restored: qrooms.party.state(), seats: qrooms.state().def.spots.length };
    })()`);
    expect(back.all.open!.scene).toBe("everyone");
    expect(back.all.open!.scenes.at(-1)!.seats).toBe(Math.min(16, 2 * n - 2));
    expect(back.saved).toBe(true);
    expect(back.restored.open!.scenes.map((s) => s.performer)).toEqual(["Opening act"]);
    expect(back.restored.open!.versions.map((v) => v.note)).toEqual(["as the ground came", "both acts"]);
    expect(back.seats).toBe(n);

    // live: the room /jam.html?studio=yours walks into is the live party's stage
    await tab.eval(`qrooms.party.live(true)`);
    await load(chrome.cdp, tab, `${vite.url}rooms.html`, 0);
    await until(tab, "!!window.qrooms");
    const after = await tab.eval<{ p: Party; seats: number; yours: number; panel: string }>(`({
      p: qrooms.party.state(), seats: qrooms.state().def.spots.length,
      yours: JSON.parse(localStorage.getItem("qollab-studio:built")).spots.length,
      panel: document.getElementById("party").innerText,
    })`);
    expect(after.p.live).toBe("saturday-night");
    expect(after.p.open!.versions.length).toBe(2);
    expect([after.seats, after.yours]).toEqual([n, n]);
    expect(after.panel).toContain("Bring back");

    // a second party: going live takes the first off; the room people walk into follows it
    const second = await tab.eval<{ p: Party; yours: string }>(`(() => {
      qrooms.party.open();
      qrooms.load("basement");
      qrooms.party.make("Sunday", Date.UTC(2026, 11, 6, 20));
      qrooms.party.live(true);
      return { p: qrooms.party.state(), yours: JSON.parse(localStorage.getItem("qollab-studio:built")).id };
    })()`);
    expect(second.p.parties).toEqual(["saturday-night", "sunday"]);
    expect(second.p.live).toBe("sunday");
    expect(second.yours).toBe("basement");
  } finally { await tab.close(); }
});
