// Q Builder in headless Chrome on /builder.html (#6021): the fuzz's board with the scope on the net its diodes to
// ground clip (R3 · D3 · D4 · R4). Swap those diodes for germanium and the wave clips lower and flatter; click a trace
// on the schematic and the scope moves to that net; remake and retest, and the remake plays the riff as your board does.
import { expect, setDefaultTimeout, test } from "bun:test";
import { load, openTab } from "../../../scripts/chrome.ts";
import { chrome, hasChrome, useBrowser, vite, waitFor } from "./browser-kit.ts";

setDefaultTimeout(120_000); // vite serves the page cold, then the riff runs through the fuzz a few times
useBrowser();

type Swing = { hi: number; lo: number; flat: number };
type State = { pedal: string; busy: boolean; why: string; probe: { key: string; label: string } | null; swing: Swing | null; retest: { same: boolean; louder: number } | null; files: string[] };

test.skipIf(!hasChrome)("scope the fuzz's clipper net, swap its diodes, see the clipping change, remake and retest", async () => {
  const tab = await openTab(chrome.cdp, { w: 1280, h: 860 });
  try {
    await load(chrome.cdp, tab, `${vite.url}/builder.html`, 0);
    const page = <T>(expr: string) => tab.eval<T>(`(async () => (${expr}))()`);
    const state = async () => { await page("qbuilder.idle()"); return page<State>("qbuilder.state()"); };
    await waitFor(tab, "Q Builder", "!!window.qbuilder && !!qbuilder.state().probe", 60_000);
    await page("(localStorage.clear(), qbuilder.pick('fuzz'), qbuilder.swap(null, null))");

    expect(await page<boolean>("qbuilder.probe('R3 · D3 · D4 · R4')")).toBe(true);
    const stock = await state();
    expect(stock.why).toBe("");
    expect(stock.swing!.hi).toBeGreaterThan(0.4); // silicon: about 0.5 V
    expect(stock.swing!.hi).toBeLessThan(0.6);

    expect(await page<string>("qbuilder.swap('D3', 'germanium')")).toBe("");
    const germ = await state();
    expect(germ.swing!.hi).toBeLessThan(stock.swing!.hi * 0.7); // about 0.26 V
    expect(germ.swing!.flat).toBeGreaterThan(stock.swing!.flat); // and more of the time sat on it

    // a click on a trace on the schematic moves the scope there: the output
    const out = await page<string>(`(() => {
      const t = [...document.querySelectorAll(".board-art .sch-trace")].find((g) => qbuilder.state().nets.find((n) => n.label === "OUT")?.key === g.dataset.subcircuitConnectivityMapKey);
      t?.querySelector("path")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      return qbuilder.state().probe.label;
    })()`);
    expect(out).toBe("OUT");
    expect(await page("document.querySelectorAll('.board-art .probed').length")).toBeGreaterThan(0);

    const r = await page<State["retest"]>("qbuilder.retest()");
    expect(r!.same).toBe(true);
    expect((await state()).files).toEqual(["fuzz-yours.tsx", "fuzz-yours.circuit.json"]);
  } finally { await tab.close(); }
});
