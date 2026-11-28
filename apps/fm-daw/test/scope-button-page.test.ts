// The scope anywhere (#6551) in headless Chrome: its button on the jam room, seated at the keys, and on the desk. A note
// played draws a trace that isn't flat; closed again, nothing is left connected.
import { expect, setDefaultTimeout, test } from "bun:test";
import { load, openTab } from "../../../scripts/chrome.ts";
import { chrome, hasChrome, useBrowser, vite, waitFor } from "./browser-kit.ts";

setDefaultTimeout(120_000); // vite serves each page cold
useBrowser("--autoplay-policy=no-user-gesture-required");

type Scope = { open: boolean; taps: number; peak: number };
const pages = [
  { name: "the jam room's keys", path: "jam.html?start=keys&quality=low", ready: "!!window.qjam && !document.getElementById('door-room').hidden", start: "document.getElementById('play').click()", note: "qjam.play('KeyA', 1500)" },
  { name: "the desk", path: "desk", ready: "[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Start')", start: "[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Start').click()", note: "dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyA', key: 'a', bubbles: true }))" },
];

for (const p of pages) {
  test.skipIf(!hasChrome)(`the scope on ${p.name}: press it, play a note, a trace`, async () => {
    const tab = await openTab(chrome.cdp, { w: 1280, h: 720 });
    try {
      await load(chrome.cdp, tab, new URL(p.path, vite.url).href, 0);
      await waitFor(tab, p.name, `!!window.qscope && ${p.ready}`, 60_000);
      const state = () => tab.eval<Scope>("qscope.state()");
      await tab.eval(`(${p.start}, 1)`);
      await tab.eval("(document.getElementById('q-scope').click(), 1)");
      expect((await state()).open).toBe(true);
      // the page's sound may still be coming up, so the note is played again until the scope shows it
      // the trace is read while the note sounds, then the key is let go
      await waitFor(tab, "a trace", `new Promise((done) => { ${p.note}; setTimeout(() => { const heard = qscope.state().peak > 0.005; dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyA', key: 'a', bubbles: true })); done(heard); }, 150); })`, 30_000, undefined, 500);
      await tab.eval("(document.getElementById('q-scope').click(), 1)");
      expect(await state()).toEqual({ open: false, taps: 0, peak: 0 });
    } finally { await tab.close(); }
  });
}
