// Q Amp in headless Chrome on /amp.html (#6168): the riff through Q Fuzz, the Scope screen put on the net its diodes to
// ground clip (D3 · D4). The audio thread sends that net's volts back with its meters, and over a whole pass of the riff
// they swing as far as the fuzz's board alone does when the riff is played through it the way Q Builder's bench plays it.
import { expect, setDefaultTimeout, test } from "bun:test";
import { load, openTab } from "../../../scripts/chrome.ts";
import { Circuit } from "@rustybuns/gear/circuit";
import { PEDALS } from "../src/circuit/amps.ts";
import { riff } from "../src/circuit/riff.ts";
import { chrome, hasChrome, useBrowser, vite, waitFor } from "./browser-kit.ts";

setDefaultTimeout(120_000); // vite serves the page cold, then a whole pass of the riff (about 5 s) plays in real time
useBrowser("--autoplay-policy=no-user-gesture-required");

const SR = 48000;
type Scope = { pedal: string; net: string; hi: number; lo: number; samples: number } | null;

/** The fuzz's board alone with the riff in, at twice the rate, as Q Builder's bench runs it: how far `node` swings. */
function benchSwing(node: string, drive: number): { hi: number; lo: number } {
  const fuzz = PEDALS.find((p) => p.id === "fuzz"), dry = riff(SR);
  if (!fuzz) throw new Error("no Q Fuzz");
  const c = new Circuit(fuzz.net(drive, {}), SR * 2);
  c.settle(0);
  let last = 0, hi = 0, lo = 0;
  for (const s of dry) {
    const x = s * 0.5;
    c.step((last + x) / 2); c.step(x);
    const v = c.volts(node);
    hi = Math.max(hi, v); lo = Math.min(lo, v);
    last = x;
  }
  return { hi, lo };
}

test.skipIf(!hasChrome)("scope the fuzz's clipper net while the riff plays: its swing comes back from the audio thread", async () => {
  const tab = await openTab(chrome.cdp, { w: 1280, h: 860 });
  try {
    await load(chrome.cdp, tab, `${vite.url}/amp.html`, 0);
    await waitFor(tab, "Q Amp", "!!window.qamp && !!qamp.state().amp", 60_000);
    const page = <T>(expr: string) => tab.eval<T>(`(async () => (${expr}))()`);
    await page("qamp.start()");
    await page("qamp.pedal('fuzz')");
    expect(await page<{ running: boolean; source: string; pedal: string }>("(({ running, source, pedal }) => ({ running, source, pedal }))(qamp.state())"))
      .toEqual({ running: true, source: "riff", pedal: "fuzz" });

    // The net both clipping diodes to ground sit on, by its node name in the fuzz's netlist.
    const net = PEDALS.find((p) => p.id === "fuzz")?.net(5, {}).parts.find((p) => p.kind === "D" && p.k === "gnd");
    if (!net || net.kind !== "D") throw new Error("no diode to ground on Q Fuzz");
    expect(await page<boolean>("qamp.scope('fuzz', 'no such net')")).toBe(false);
    expect(await page<boolean>(`qamp.scope('fuzz', ${JSON.stringify(net.a)})`)).toBe(true);

    await waitFor(tab, "a whole pass of the riff on the scope", `(qamp.state().scope?.samples ?? 0) > ${riff(SR).length + SR}`, 60_000);
    const got = await page<Scope>("qamp.state().scope");
    const want = benchSwing(net.a, (await page<number | null>("qamp.state().drive")) ?? 5);
    console.log(`  scope on Q Fuzz's clipper: ${got?.lo.toFixed(3)} to ${got?.hi.toFixed(3)} V, the bench ${want.lo.toFixed(3)} to ${want.hi.toFixed(3)} V`);
    expect(want.hi).toBeGreaterThan(0.3); // silicon clips at about half a volt
    expect(Math.abs((got?.hi ?? 0) - want.hi)).toBeLessThan(0.04 * want.hi);
    expect(Math.abs((got?.lo ?? 0) - want.lo)).toBeLessThan(0.04 * -want.lo);

    // Off again: the screen goes back to the output, and the audio thread stops sending.
    expect(await page<boolean>("qamp.scope(null)")).toBe(true);
    expect(await page<Scope>("qamp.state().scope")).toBeNull();
  } finally { await tab.close(); }
});
