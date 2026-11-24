// Your character as a dialog over the jam room (#5819), in headless Chrome over CDP (scripts/chrome.ts): the top bar's
// Character door opens the picker over the room, a new hair and Save close it, and the figure in the room wears the new
// hair with no page load; Cancel leaves the look as it was. On a laptop and at phone width, where it fills the screen.
import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromePath, launchChrome, load, openTab, startVite } from "../../../scripts/chrome.ts";

// the room is a 3D scene, drawn in software on CI's runners: a case takes most of a minute there
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

test.skipIf(!hasChrome).each([["a laptop", 1280, 720], ["a phone", 390, 844]] as const)("on %s: Character opens over the room, new hair and Save put it on you there", async (_, w, h) => {
  const tab = await openTab(chrome.cdp, { w, h });
  try {
    await load(chrome.cdp, tab, `${vite.url}jam.html?room=look-dialog&studio=desert-gathering&quality=low`, 0);
    const page = <T>(expr: string) => tab.eval<T>(`(async () => (${expr}))()`);
    const until = async (what: string, expr: string) => {
      for (const end = Date.now() + 60_000; Date.now() < end; await Bun.sleep(100)) if (await page<boolean>(expr)) return;
      throw new Error(`waited for ${what}`);
    };
    await until("the room", "!!window.qjam && !!window.qjam.state().me.wearing");
    // a mark on this page: a page load would lose it
    await page("(window.__same = true)");
    const before = await page<{ hair: string }>("qjam.state().me.avatar");

    // the Character door opens the dialog over the room, with the picker in it
    await page(`document.querySelector('#qs-way a[data-to="character"]').click()`);
    await until("the picker", "typeof qjam.state().character === 'object' && qjam.state().character !== null");
    const box = await page<{ w: number; h: number; open: boolean }>(`(() => { const d = document.getElementById("character"), r = d.getBoundingClientRect(); return { w: r.width, h: r.height, open: d.open }; })()`);
    expect(box.open).toBe(true);
    if (w < 640) { expect(box.w).toBe(w); expect(box.h).toBe(h); } else expect(box.w).toBeLessThan(w);

    // Cancel: closed, and the look as it was
    await page(`document.querySelector('#character [data-part="hair"]:not([aria-pressed="true"])').click()`);
    await page(`document.querySelector('#character [data-do="cancel"]').click()`);
    expect(await page<boolean>(`document.getElementById("character").open`)).toBe(false);
    expect((await page<{ hair: string }>("qjam.state().me.avatar")).hair).toBe(before.hair);

    // again: the Hair tab, another hair, Save
    await page(`document.querySelector('#qs-way a[data-to="character"]').click()`);
    await until("the picker again", "typeof qjam.state().character === 'object' && qjam.state().character !== null");
    await page(`document.querySelector('#character .ch-tab[data-value="hair"]').click()`);
    const hair = await page<string>(`(() => { const b = document.querySelector('#character [data-part="hair"]:not([aria-pressed="true"])'); b.click(); return b.dataset.value; })()`);
    expect(hair).not.toBe(before.hair);
    await page(`document.querySelector('#character [data-do="save"]').click()`);
    await until("the dialog to close", `!document.getElementById("character").open`);

    // the figure in the room wears it, on the same page
    await until("the new hair on the room's figure", `qjam.state().me.wearing?.hair === ${JSON.stringify(hair)}`);
    expect(await page<boolean>("window.__same === true")).toBe(true);
    expect(await page<number>("document.documentElement.scrollWidth")).toBe(w);
  } finally { await tab.close(); }
});
