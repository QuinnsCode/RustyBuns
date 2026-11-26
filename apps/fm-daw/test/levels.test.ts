// What you hear in a jam room (src/studio/levels.ts), in headless Chrome over CDP (scripts/chrome.ts): a DJ plays a set
// on the PA and a singer's mic is in. MUSIC down on its big slider in the menu takes the music bus and their video down and
// leaves the crowd bus and the mic alone; at 0 the music is silent. CROWD down takes the mic; the slider beside one
// person takes their set and mic down for you alone. The two are still set after a reload.
import { expect, setDefaultTimeout, test } from "bun:test";
import { load, openTab, until as pageUntil } from "../../../scripts/chrome.ts";
import { chrome, hasChrome, useBrowser, vite } from "./browser-kit.ts";

// the room is a 3D scene, drawn in software on CI's runners: a case takes most of a minute there
setDefaultTimeout(240_000); // a jam room with a DJ set and a mic in software GL, its audio measured
useBrowser("--autoplay-policy=no-user-gesture-required");

interface Heard { music: number; crowd: number; buses: { music: number; crowd: number } | null; people: Record<string, number>; pa: Record<string, number>; calls: Record<string, number>; tubes: Record<string, number> }

test.skipIf(!hasChrome)("music against the crowd, and one person's level, from the menu's sliders", async () => {
  const tab = await openTab(chrome.cdp, { w: 1280, h: 720 });
  try {
    const url = `${vite.url}jam.html?room=levels&studio=desert-gathering&quality=low`;
    await load(chrome.cdp, tab, url, 0);
    const page = <T>(expr: string) => tab.eval<T>(`(async () => (${expr}))()`);
    const until = (what: string, expr: string) => pageUntil(tab, expr, what, 60_000);
    await until("the room", "!!window.qjam && !!window.qjam.state().me.wearing");
    await page("qjam.start()");
    await until("the speakers", "qjam.state().audio");
    // a DJ on the PA (peer 7) and a singer at the mic (peer 8)
    await page(`(() => {
      const avatar = qjam.state().me.avatar;
      for (const [p, name] of [[7, "Dee"], [8, "Sol"]]) { qjam.live(p, { t: "body", at: [p - 6, 0, 2], yaw: 0, seat: null }); qjam.live(p, { t: "wear", avatar, name }); }
      qjam.live(7, { t: "pa", on: true, name: "Set" });
      qjam.live(8, { t: "guitar", track: -1, mic: true });
      // the mic on its call, as heard "now" (a loop late it comes in the audio thread's slices, with the band)
      qjam.listen("now");
    })()`);
    const heard = () => page<Heard>("qjam.levels()");
    const full = await heard();
    expect(full.buses).toEqual({ music: 1, crowd: 1 });
    expect(full.pa["7"]).toBe(1);
    expect(full.calls["8"]).toBe(1);

    // the menu's MUSIC slider, as a hand moves it
    const slide = (sel: string, v: number) => page(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); el.value = "${v}"; el.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`);
    await slide("#level-music", 0.25);
    await until("the music bus down", "qjam.levels().buses.music < 0.3");
    const down = await heard();
    expect(down.music).toBe(0.25);
    expect(down.buses?.crowd).toBe(1);
    expect(down.calls["8"]).toBe(1); // a mic is crowd
    expect(down.tubes["7"]).toBeCloseTo(full.tubes["7"] * 0.25, 2);
    // at 0 the music is silent, the crowd still there
    await slide("#level-music", 0);
    await until("the music bus silent", "qjam.levels().buses.music < 0.001");
    expect((await heard()).tubes["7"]).toBe(0);

    // CROWD down takes the mic
    await slide("#level-crowd", 0.5);
    await until("the crowd bus down", "qjam.levels().buses.crowd < 0.55");
    expect((await heard()).calls["8"]).toBe(0.5);

    // the slider beside Dee's name: their set, for you alone; Sol's stays
    await slide('#people input[data-peer="7"]', 0.4);
    const dee = await heard();
    expect(dee.people).toEqual({ 7: 0.4, 8: 1 });
    expect(dee.pa["7"]).toBe(0.4);
    await slide('#people input[data-peer="8"]', 0.5);
    expect((await heard()).calls["8"]).toBe(0.25);

    // MUSIC and CROWD are kept in this browser
    await load(chrome.cdp, tab, url, 0);
    await until("the room again", "!!window.qjam");
    expect(await page<number[]>(`[qjam.levels().music, qjam.levels().crowd, +document.getElementById("level-crowd").value]`)).toEqual([0, 0.5, 0.5]);
  } finally { await tab.close(); }
});
