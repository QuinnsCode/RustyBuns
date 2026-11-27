// Q Builder in headless Chrome on /builder.html (#6021): the fuzz's board with the scope on the net its diodes to
// ground clip (R3 · D3 · D4 · R4). Swap those diodes for germanium and the wave clips lower and flatter; click a trace
// on the schematic and the scope moves to that net; remake and retest, and the remake plays the riff as your board does.
import { expect, setDefaultTimeout, test } from "bun:test";
import { load, openTab } from "../../../scripts/chrome.ts";
import { chrome, hasChrome, useBrowser, vite, waitFor } from "./browser-kit.ts";

setDefaultTimeout(120_000); // vite serves the page cold, then the riff runs through the fuzz a few times
useBrowser();

type Swing = { hi: number; lo: number; flat: number; top: number };
type State = {
  pedal: string; busy: boolean; why: string; probe: { key: string; label: string } | null; swing: Swing | null; retest: { same: boolean; louder: number } | null; files: string[];
  changes: string; board: { fits: boolean };
};

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

// #6423: change the circuit itself. A 100nF across the fuzz's clipping diodes (from their net to ground) rounds the
// squared wave there: the scope on that net shows less top end. Remake and retest, and the remake plays as your board;
// Build it no longer offers the stock board's Gerbers. Back to the stock circuit, and they're back.
test.skipIf(!hasChrome)("add a capacitor across the fuzz's clipping diodes: less top end on that net, the remake matches, the board needs a new layout", async () => {
  const tab = await openTab(chrome.cdp, { w: 1280, h: 860 });
  try {
    await load(chrome.cdp, tab, `${vite.url}/builder.html`, 0);
    const page = <T>(expr: string) => tab.eval<T>(`(async () => (${expr}))()`);
    const state = async () => { await page("qbuilder.idle()"); return page<State>("qbuilder.state()"); };
    await waitFor(tab, "Q Builder", "!!window.qbuilder && !!qbuilder.state().probe", 60_000);
    await page("(localStorage.clear(), qbuilder.pick('fuzz'), qbuilder.swap(null, null), qbuilder.unedit(null))");
    expect(await page<boolean>("qbuilder.probe('R3 · D3 · D4 · R4')")).toBe(true);
    const stock = await state();
    expect(stock.board.fits).toBe(true);

    // the card's own controls: a capacitor, 100n, from the scope's net (where From starts) to GND
    expect(await page<string>(`(() => {
      const card = [...document.querySelectorAll(".qb-card")].find((c) => c.textContent?.includes("Change the circuit"));
      const [kind, from, to] = card.querySelectorAll(".qb-add select"), val = card.querySelector(".qb-add input");
      kind.value = "cap"; val.value = "100n";
      to.value = [...to.options].find((o) => o.textContent === "GND").value;
      const start = from.selectedOptions[0].textContent;
      card.querySelector(".qb-add .icon-btn").click();
      return start + " → " + qbuilder.state().changes;
    })()`)).toBe("R3 · D3 · D4 · R4 → added C5 100nF from R3 · D3 · D4 · R4 to GND");
    const capped = await state();
    expect(capped.why).toBe("");
    expect(capped.probe!.label).toBe("R3 · D3 · D4 · R4 · C5"); // the scope stays on the net, now with C5 on it
    expect(capped.swing!.top).toBeLessThan(stock.swing!.top * 0.5); // the edges rounded off
    expect(capped.board.fits).toBe(false);
    expect(await page<boolean>("[...document.querySelectorAll('.qb-act')].find((b) => b.textContent === 'Gerbers').disabled")).toBe(true);

    const r = await page<State["retest"]>("qbuilder.retest()");
    expect(r!.same).toBe(true);
    expect((await state()).files).toEqual(["fuzz-yours.tsx", "fuzz-yours.circuit.json"]);

    // a value that isn't one is turned away; back to the stock circuit, and the stock board fits again
    expect(await page<string>("qbuilder.add('res', 'lots', 'OUT', 'GND')")).toContain("isn't a value");
    expect(await page<string>("qbuilder.unedit(null)")).toBe("");
    expect((await state()).board.fits).toBe(true);
  } finally { await tab.eval("window.qbuilder?.unedit(null)"); await tab.close(); }
});

// #6118: an effect pedal on the bench. Q Phase's LFO is off its board, on GATE: the scope there sweeps the full
// 0 to 4.5 V at a fast Rate and only part of the way at the slowest. A part swapped here is on Q Amp's pedal too, in
// a Q Amp tab already open, and back.
test.skipIf(!hasChrome)("Q Phase: the scope on GATE moves with the Rate knob, and a swap here is on Q Amp's phaser", async () => {
  const builder = await openTab(chrome.cdp, { w: 1280, h: 860 }), amp = await openTab(chrome.cdp, { w: 1280, h: 860 });
  try {
    await load(chrome.cdp, builder, `${vite.url}/builder.html`, 0);
    const page = <T>(expr: string) => builder.eval<T>(`(async () => (${expr}))()`);
    const state = async () => { await page("qbuilder.idle()"); return page<State>("qbuilder.state()"); };
    await waitFor(builder, "Q Builder", "!!window.qbuilder && !!qbuilder.state().probe", 60_000);
    await page("(localStorage.clear(), qbuilder.pick('phase'), qbuilder.swap(null, null))");
    expect(await page<boolean>("qbuilder.probe('GATE')")).toBe(true);

    await page("qbuilder.drive(10)");
    const fast = await state();
    expect(fast.why).toBe("");
    expect(fast.swing!.hi).toBeGreaterThan(4.4);
    expect(fast.swing!.lo).toBeLessThan(0.1);
    await page("qbuilder.drive(0)");
    expect((await state()).swing!.hi).toBeLessThan(3); // 0.05 Hz: under half a sweep in the riff's 4.7 s

    await load(chrome.cdp, amp, `${vite.url}/amp.html`, 0);
    await waitFor(amp, "Q Amp", "!!window.qamp", 60_000);
    // Q Amp saving its own store (a footswitch) as the swap is made doesn't undo the swap on either page (#6459)
    const [why] = await Promise.all([page<string>("qbuilder.swap('R1', '2.2')"), amp.eval("qamp.pedal('phase')")]);
    expect(why).toBe("");
    await waitFor(amp, "the swap on Q Amp", "qamp.state().swaps.R1 === '2.2'", 10_000);
    expect(await page<string | undefined>("qbuilder.state().swaps.R1")).toBe("2.2");
    expect(await amp.eval<number>("qamp.state().drive")).toBe(0);

    expect(await amp.eval<string[]>("qamp.swap('R1', null)")).toEqual([]);
    await waitFor(builder, "the stock part back on Q Builder", "!('R1' in qbuilder.state().swaps)", 10_000);
    expect((await state()).retest).toBeNull();
  } finally { await builder.close(); await amp.close(); }
});

// Build it: the fuzz's board drawn from its kit's Gerbers, top and bottom; Print fills a sheet with the schematic, the
// board and your parts; the Gerbers zip holds the layers. Q Phase, a pedal whose LFO the sim runs off its board, has a
// board too, with the LFO on it.
test.skipIf(!hasChrome)("Build it: the fuzz's board from its Gerbers, the print sheet with your parts, and the phaser's board", async () => {
  const tab = await openTab(chrome.cdp, { w: 1280, h: 860 });
  try {
    await load(chrome.cdp, tab, `${vite.url}/builder.html`, 0);
    const page = <T>(expr: string) => tab.eval<T>(`(async () => (${expr}))()`);
    type Board = { kit: string; side: string; made: boolean; size: number[] | null; holes: number };
    const board = async () => { await page("qbuilder.idle()"); return page<Board>("qbuilder.state().board"); };
    await waitFor(tab, "Q Builder", "!!window.qbuilder && !!qbuilder.state().probe", 60_000);
    await page("(localStorage.clear(), qbuilder.pick('fuzz'), qbuilder.swap(null, null))");

    const top = await board();
    expect(top).toMatchObject({ kit: "q-fuzz", side: "top", made: true, size: [58, 68] });
    expect(await page<number>("document.querySelectorAll('.qb-mock .pcb-holes circle').length")).toBe(top.holes);
    expect(await page<string | null>("qbuilder.side('bottom')")).toBe("bottom");

    expect(await page<string>("qbuilder.swap('D3', 'germanium')")).toBe("");
    expect(await page<string[]>("qbuilder.printSheet()")).toEqual(["Q Fuzz", "Schematic", "Circuit board", "Parts"]);
    expect(await page<string>("document.querySelector('.qb-print .yours')?.textContent ?? ''")).toContain("1N34A");
    const z = await page<{ name: string; files: string[] }>("qbuilder.gerbers()");
    expect(z.name).toBe("q-fuzz-gerbers.zip");
    expect(z.files).toEqual(expect.arrayContaining(["F_Cu.gbr", "B_Cu.gbr", "Edge_Cuts.gbr", "drill-L1-L2.drl"]));

    await page("qbuilder.pick('phase')");
    expect(await board()).toMatchObject({ kit: "q-phase", made: true, size: [58, 68] });
    expect(await page<string[]>("qbuilder.printSheet()")).toEqual(["Q Phase", "Schematic", "Circuit board", "Parts"]);
  } finally { await tab.close(); }
});
