// "Prep a set in my studio, play the same set at an event" (#6551): two files added on /decks.html, then the Event
// Planner opens an event and its room's decks have them in the library, loads one and plays it (src/dj/crate.ts), in
// headless Chrome over CDP.
import { expect, setDefaultTimeout, test } from "bun:test";
import { load, openTab } from "../../../scripts/chrome.ts";
import { chrome, hasChrome, useBrowser, vite, waitFor } from "./browser-kit.ts";

setDefaultTimeout(240_000); // the planner and the event's room are 3D scenes, drawn in software on CI's runners
useBrowser("--autoplay-policy=no-user-gesture-required");

/** A second of a 220 Hz tone as a WAV file, made in the page and given to the library's Add music input. */
const ADD = `(() => {
  const wav = (name) => {
    const rate = 8000, n = rate, b = new DataView(new ArrayBuffer(44 + n * 2));
    const text = (at, s) => [...s].forEach((c, i) => b.setUint8(at + i, c.charCodeAt(0)));
    text(0, "RIFF"); b.setUint32(4, 36 + n * 2, true); text(8, "WAVEfmt "); b.setUint32(16, 16, true);
    b.setUint16(20, 1, true); b.setUint16(22, 1, true); b.setUint32(24, rate, true); b.setUint32(28, rate * 2, true);
    b.setUint16(32, 2, true); b.setUint16(34, 16, true); text(36, "data"); b.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) b.setInt16(44 + i * 2, Math.sin((i / rate) * 2 * Math.PI * 220) * 8000, true);
    return new File([b.buffer], name, { type: "audio/wav" });
  };
  const pick = document.querySelector(".dj-lib input[type=file][multiple]:not([webkitdirectory])"), d = new DataTransfer();
  d.items.add(wav("opener.wav")); d.items.add(wav("second.wav"));
  pick.files = d.files; pick.dispatchEvent(new Event("change"));
})()`;
const rows = (which: string) => `[...document.querySelectorAll(".dj-list li${which} span")].map((s) => s.textContent)`;

test.skipIf(!hasChrome)("a set added on the decks page is in the library at the event, and plays there", async () => {
  const tab = await openTab(chrome.cdp, { w: 1280, h: 800 });
  const page = <T>(expr: string) => tab.eval<T>(`(async () => (${expr}))()`);
  const until = (what: string, expr: string, ms = 60_000) => waitFor(tab, what, expr, ms, undefined, 100);
  try {
    // at home
    await load(chrome.cdp, tab, `${vite.url}decks.html`, 0);
    await tab.eval(`localStorage.setItem("qollab-studio:quality", "low")`);
    await until("the decks", "!!window.qdecks");
    await page("qdecks.start()");
    await until("the demo tracks on both decks", "qdecks.state().decks.every((d) => d.name)");
    await page(ADD);
    await until("both files read and kept", `document.querySelectorAll(".dj-list li .dj-forget").length === 2`);

    // the event
    await load(chrome.cdp, tab, `${vite.url}rooms.html`, 0);
    await until("the planner", "!!window.qrooms && !!qrooms.state()");
    const link = await page<string>("qrooms.event().link");
    const u = new URL(link);
    await load(chrome.cdp, tab, `${vite.url}${(u.pathname + u.search).slice(1)}`, 0);
    await until("the event's room", "!!window.qjam && !!document.getElementById('play')");
    await page("document.getElementById('play').click()");
    await until("in", `qjam.state().phase === "play"`);
    await page("document.getElementById('decks-open').click()");
    await until("the kept set in the library", `${rows(".waiting")}.length === 2`);
    expect(await page<string[]>(rows(".waiting"))).toEqual(["opener.wav", "second.wav"]);
    await page(`document.querySelector(".dj-list li.waiting button").click()`); // the first one's A
    await until("it on deck A", `(await qjam.booth()).decks[0].name === "opener.wav"`);
    await page(`qjam.booth({ press: { side: 0, key: "play" } })`);
    await until("it playing", `(await qjam.booth()).decks[0].playing === true`);
  } finally { await tab.close(); }
});
