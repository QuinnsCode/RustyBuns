// The whole note row plays at an instrument, in headless Chrome over CDP (scripts/chrome.ts): seated at the bass synth,
// H is A (nine above A's note) and P is D# (fifteen above), not "raise your hand" and "play the groove" as they are
// standing. One table: each key down shows its note held, each key up lets it go. Then Q holds the view still so the
// mouse is free for the pitch and mod wheels.
import { expect, setDefaultTimeout, test } from "bun:test";
import { load, openTab, until as pageUntil } from "../../../scripts/chrome.ts";
import { chrome, hasChrome, useBrowser, vite } from "./browser-kit.ts";

setDefaultTimeout(240_000); // a jam room in software GL on CI's runners
useBrowser("--autoplay-policy=no-user-gesture-required");

test.skipIf(!hasChrome)("seated at the bass, every note key plays its note, H and P too", async () => {
  const tab = await openTab(chrome.cdp, { w: 1280, h: 720 });
  try {
    await load(chrome.cdp, tab, `${vite.url}jam.html?room=seat-keys&studio=desert-gathering&quality=low`, 0);
    const page = <T>(expr: string) => tab.eval<T>(`(async () => (${expr}))()`);
    await pageUntil(tab, "!!window.qjam && !!window.qjam.state().me.wearing", "the room", 60_000);
    await page("qjam.start()");
    const sat = await page<unknown>(`(() => { const s = qjam.state().spots.find((x) => x.kind === "bass"); qjam.walkTo(s.at[0], s.at[1]); return qjam.sit(s.id); })()`);
    expect(sat).toEqual({ ok: true });
    const held = (code: string) => page<number[]>(`(() => { qjam.key(${JSON.stringify(code)}); const h = qjam.state().holding.map((n) => n.midi); qjam.key(${JSON.stringify(code)}, false); return h; })()`);
    const [a] = await held("KeyA");
    expect(a).toBeNumber();
    for (const [code, semi] of [["KeyH", 9], ["KeyP", 15], ["Quote", 17]] as const) expect(await held(code)).toEqual([a! + semi]);
    // H didn't put a hand up
    expect(await page<unknown>("qjam.state().grants.asked")).not.toBe("play");

    // Q holds the view and frees the mouse; a press at the top of the pitch wheel bends all the way up, and the room
    // doesn't drop to the menu while the mouse is out
    await page(`qjam.key("KeyQ")`);
    // the wheels show on the first frame drawn seated, which can be seconds behind on a runner's software GL
    await pageUntil(tab, `!!document.querySelector(".qo-wheel.pitch i").style.top`, "the wheels", 60_000);
    const at = await page<{ x: number; y: number }>(`(() => { const r = document.querySelector(".qo-wheel.pitch").getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + 1 }; })()`);
    await tab.call("Input.dispatchMouseEvent", { type: "mousePressed", ...at, button: "left", buttons: 1, clickCount: 1 });
    // the knob's top: 0 is all the way up, 41 the middle it springs back to
    await pageUntil(tab, `parseFloat(document.querySelector(".qo-wheel.pitch i").style.top) < 4`, "the bend", 20_000).catch(() => {});
    const wheel = await page<{ held: boolean; top: number; phase: string }>(`(async () => {
      return { held: qjam.state().viewHeld, top: parseFloat(document.querySelector(".qo-wheel.pitch i").style.top), phase: qjam.state().phase };
    })()`);
    await tab.call("Input.dispatchMouseEvent", { type: "mouseReleased", ...at, button: "left", buttons: 0, clickCount: 1 });
    expect(wheel).toMatchObject({ held: true, phase: "play" });
    expect(wheel.top).toBeLessThan(4);
    // Q again looks about; standing up lets the view go too
    expect(await page<boolean>("qjam.hold()")).toBe(false);
    expect(await page<boolean>(`(() => { qjam.hold(true); qjam.key("Space"); return qjam.state().viewHeld; })()`)).toBe(false);
  } finally { await tab.close(); }
});
