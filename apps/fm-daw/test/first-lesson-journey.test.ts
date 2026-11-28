// The front door's "First lesson" (#6551): it opens the gear room with lesson one already on, and cabling the guitar
// ticks its steps, in headless Chrome over CDP.
import { expect, setDefaultTimeout, test } from "bun:test";
import { load, openTab } from "../../../scripts/chrome.ts";
import { chrome, hasChrome, useBrowser, vite, waitFor } from "./browser-kit.ts";

setDefaultTimeout(240_000); // the gear room is a 3D scene, drawn in software on CI's runners
useBrowser();

type Now = { lesson: { id: string; steps: { done: boolean }[] } | null; marker: number[] | null };

test.skipIf(!hasChrome)("First lesson on the door starts lesson one in the gear room", async () => {
  const tab = await openTab(chrome.cdp, { w: 1280, h: 800 });
  const page = <T>(expr: string) => tab.eval<T>(`(async () => (${expr}))()`);
  const until = (what: string, expr: string) => waitFor(tab, what, expr, 60_000, undefined, 100);
  try {
    await load(chrome.cdp, tab, `${vite.url}door.html`, 0);
    await tab.eval(`localStorage.setItem("qollab-studio:quality", "low")`);
    await until("the door", "!!window.qdoor");
    await page(`document.querySelector('.lane a[data-start="learn"]').click()`);
    await until("the gear room with its card", `!!window.qstudio && !!document.querySelector("#lesson li.next") && !!qstudio.lesson().marker`);
    const start = await page<Now>("qstudio.lesson()");
    expect(start.lesson).toMatchObject({ id: "guitar" });
    expect(start.lesson!.steps.map((s) => s.done)).toEqual([false, false, false, false]);
    // the first step as a player does it: the guitar into a pedal
    await page(`qstudio.lead("guitar", "out") && qstudio.plug("drive", "in")`);
    await until("the first step ticked", `qstudio.lesson().lesson.steps[0].done && !!document.querySelector("#lesson li.done")`);
  } finally { await tab.close(); }
});
