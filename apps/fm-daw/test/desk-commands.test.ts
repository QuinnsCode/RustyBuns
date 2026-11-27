// The desk's toolbar actions as commands (src/ui/desk-tools.ts), in headless Chrome over CDP: an agent picks the hat,
// sets the grid to quarters, quantizes and sees the off-beat hats move onto the beat, undoes and gets them back; the
// toolbar's own Quantize button does the same thing; a wrong track is answered, not thrown.
import { expect, setDefaultTimeout, test } from "bun:test";
import { load, openTab } from "../../../scripts/chrome.ts";
import { chrome, hasChrome, useBrowser, vite, waitFor } from "./browser-kit.ts";

setDefaultTimeout(30_000);
useBrowser();

interface Note { s: number; l: number; m: number; v: number }
interface State { selected: number; grid: string; tracks: { name: string; mute: boolean }[]; notes: Note[] }

test.skipIf(!hasChrome)("quantize, undo and mute through the desk's commands and its toolbar", async () => {
  const tab = await openTab(chrome.cdp, { w: 1440, h: 900 });
  try {
    await load(chrome.cdp, tab, `${vite.url}desk`, 0);
    const page = <T>(expr: string) => tab.eval<T>(`(async () => (${expr}))()`);
    const run = <T>(name: string, args: object = {}) => page<T>(`window.__commands.run(${JSON.stringify(name)}, ${JSON.stringify(args)})`);
    const state = () => run<State>("desk_state");
    await waitFor(tab, "the desk's commands", `!!window.__commands?.list().some((c) => c.name === "desk_state") && fmdaw.state().tracks.length > 0`);

    const hat = (await state()).tracks.findIndex((t) => t.name === "Hat");
    expect(await run("desk_select", { track: hat })).toMatchObject({ ok: true, selected: "Hat" });
    const before = (await state()).notes;
    expect(before.some((n) => n.s % 1 !== 0)).toBe(true); // the groove's hats are on the 8ths

    await run("desk_grid", { grid: "1/4" });
    await run("desk_strength", { strength: 100 });
    expect(await run("desk_quantize")).toMatchObject({ ok: true });
    const snapped = (await state()).notes;
    expect(snapped.every((n) => n.s % 1 === 0)).toBe(true);
    expect(snapped).not.toEqual(before);

    await run("desk_undo");
    expect((await state()).notes).toEqual(before);

    // the toolbar's Quantize button is the same function
    await page(`[...document.querySelectorAll(".toolbar button")].find((b) => b.textContent === "Quantize").click()`);
    await waitFor(tab, "the button's quantize", `fmdaw.desk().state().notes.every((n) => n.s % 1 === 0)`);
    expect((await state()).notes).toEqual(snapped);

    expect(await run("desk_mute", { track: hat })).toMatchObject({ ok: true, mute: true });
    expect((await state()).tracks[hat].mute).toBe(true);
    expect(await run("desk_mute", { track: 99 })).toMatchObject({ ok: false });
  } finally { await tab.close(); }
});
