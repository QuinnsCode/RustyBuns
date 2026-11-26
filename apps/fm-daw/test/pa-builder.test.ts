// Planning a sound system in the studio builder (#5863), in headless Chrome over CDP (scripts/chrome.ts): on
// /rooms.html start from the Desert Gathering, clear its stacks and place two, aim one off at the edge of the ground and
// watch the coverage map drop on the floor it left, put the rig on the small generator and read why it fails, then take
// the gear list and the plan drawing away. Out of doors, set the night's air and ground and stand a bank in front of a stack.
import { expect, setDefaultTimeout, test } from "bun:test";
import { load, openTab, until as pageUntil } from "../../../scripts/chrome.ts";
import { chrome, hasChrome, useBrowser, vite } from "./browser-kit.ts";

setDefaultTimeout(240_000); // vite serves cold, then redraws a room's coverage map in software GL
useBrowser();

type Tab = Awaited<ReturnType<typeof openTab>>;
const until = (tab: Tab, ready: string) => pageUntil(tab, ready, ready, 30_000, 50);

type Pa = { stacks: { at: [number, number]; yaw: number }[]; coverage: { mean: number; even: number } | null; power: { ok: boolean; why: string[]; generator: string; racks: number } | null };

test.skipIf(!hasChrome)("place two stacks, aim one away and see the floor go quiet there, overload the generator and read why, take the gear list away", async () => {
  const tab = await openTab(chrome.cdp, { w: 1280, h: 720 });
  try {
    await load(chrome.cdp, tab, `${vite.url}rooms.html`, 0);
    await until(tab, "!!window.qrooms");
    // two stacks at the front corners of the floor, each facing its middle
    const placed = await tab.eval<{ ok: boolean[]; pa: Pa }>(`(() => {
      qrooms.load("desert-gathering");
      const ok = [];
      while (qrooms.pa().stacks.length) ok.push(qrooms.edit({ t: "unstack", index: 0 }).ok);
      ok.push(qrooms.edit({ t: "stack", at: [-6, -6] }).ok, qrooms.edit({ t: "stack", at: [6, -6] }).ok);
      return { ok, pa: qrooms.pa() };
    })()`);
    expect(placed.ok.every(Boolean)).toBe(true);
    expect(placed.pa.stacks.map((s) => s.at)).toEqual([[-6, -6], [6, -6]]);
    expect(placed.pa.coverage!.mean).toBeGreaterThan(90);

    // the right stack turned to face the right-hand edge of the ground: the floor it threw at, on its way to the
    // middle, goes quiet (the left stack, toed in the other way, barely reaches it)
    const aimed = await tab.eval<{ before: number; after: number; ok: boolean }>(`(() => {
      const before = qrooms.level(3, -3), ok = qrooms.edit({ t: "aimStack", index: 1, yaw: Math.PI / 2 }).ok;
      return { before, after: qrooms.level(3, -3), ok };
    })()`);
    expect(aimed.ok).toBe(true);
    expect(aimed.before - aimed.after).toBeGreaterThan(6);

    // on the 7 kVA set, the amp racks want more than it gives: it says so, in numbers
    const power = await tab.eval<{ auto: Pa["power"]; small: Pa["power"]; ok: boolean }>(`(() => {
      const auto = qrooms.pa().power, ok = qrooms.edit({ t: "generator", set: "generator-7kva" }).ok;
      return { auto, small: qrooms.pa().power, ok };
    })()`);
    expect(power.ok).toBe(true);
    expect(power.auto!.ok).toBe(true);
    expect(power.small!.ok).toBe(false);
    expect(power.small!.why[0]).toMatch(/7 kVA generator gives 6\.3 kW and the rig draws 1\d\.\d kW/);

    // take it away: every box and rack, the cable runs, the power plan with its failure, and the plan drawing
    const out = await tab.eval<{ list: { name: string; text: string }; plan: { name: string; text: string } }>(`({ list: qrooms.download("list"), plan: qrooms.download("plan") })`);
    expect(out.list.name).toBe("desert-gathering-gear-list.txt");
    for (const line of ["8 x horn-sub-21", "2 x amp-rack-12u", "speaker amp racks -> stack 2", "Fails:", "7 kVA generator gives"]) expect(out.list.text).toContain(line);
    expect(out.plan.name).toBe("desert-gathering-plan.svg");
    expect(out.plan.text.startsWith("<svg")).toBe(true);
    expect(out.plan.text).toContain("<image");
  } finally { await tab.close(); }
});

test.skipIf(!hasChrome)("indoors: stand two stacks in the scoring hall, read the far one landing late at the back, see the coverage on the 3D floor", async () => {
  const tab = await openTab(chrome.cdp, { w: 1280, h: 720 });
  try {
    await load(chrome.cdp, tab, `${vite.url}rooms.html`, 0);
    await until(tab, "!!window.qrooms");
    // a stack in each front corner of the hall's floor: the room's own PA, its power and its gear list
    const placed = await tab.eval<{ ok: boolean[]; pa: Pa; list: string | undefined }>(`(() => {
      qrooms.load("scoring-hall");
      const ok = [qrooms.edit({ t: "stack", at: [-11, -14] }).ok, qrooms.edit({ t: "stack", at: [11, -14] }).ok];
      return { ok, pa: qrooms.pa(), list: qrooms.download("list")?.text };
    })()`);
    expect(placed.ok).toEqual([true, true]);
    expect(placed.pa.stacks.map((s) => s.at)).toEqual([[-11, -14], [11, -14]]);
    expect(placed.pa.coverage!.mean).toBeGreaterThan(80);
    expect(placed.pa.power!.racks).toBeGreaterThan(0);
    expect(placed.list).toContain("2 x stack-mid-high");

    // at the back of the floor on the left, the right-hand stack's sound comes 7.6 m further: 22 ms after the left's, a
    // smear the delay view marks amber there (a delay tower's place)
    const late = await tab.eval<{ at: { ms: number; down: number }[]; cells: { smear: number; echo: number } | null }>(`({ at: qrooms.delay(-11, 14), cells: qrooms.showDelay(true) })`);
    expect(late.at[0]!.ms).toBe(0);
    expect(late.at[1]!.ms).toBeCloseTo(((Math.hypot(22, 28) - 28) / 343) * 1000, 0);
    expect(late.cells!.smear).toBeGreaterThan(0);

    // the coverage map on the 3D view's floor, not a jump to the blueprint
    const seen = await tab.eval<{ view: string; heatOnFloor: boolean }>(`(() => { qrooms.showDelay(false); qrooms.view("3d"); qrooms.showMap(true); return qrooms.view(); })()`);
    expect(seen).toEqual({ view: "3d", heatOnFloor: true });
  } finally { await tab.close(); }
});

test.skipIf(!hasChrome)("out of doors: set the night's air and ground in the outdoor panel, stand a bank in front of a stack and hear the floor behind it go dull, read the delay move with the cold", async () => {
  const tab = await openTab(chrome.cdp, { w: 1280, h: 720 });
  try {
    await load(chrome.cdp, tab, `${vite.url}rooms.html`, 0);
    await until(tab, "!!window.qrooms");
    type Field = { tempC: number; humidity: number; ground: string; speed: number; banks: unknown[] } | null;
    // one stack at the back of the Desert Gathering's floor, facing down it; then the panel's air, humidity and ground
    const set = await tab.eval<{ field: Field; ok: boolean[] }>(`(() => {
      qrooms.load("desert-gathering");
      const ok = [];
      while (qrooms.pa().stacks.length) ok.push(qrooms.edit({ t: "unstack", index: 0 }).ok);
      ok.push(qrooms.edit({ t: "stack", at: [0, -8], yaw: 0 }).ok);
      const pick = (sel, v) => { const i = document.querySelector(sel); i.value = String(v); i.dispatchEvent(new Event("change")); };
      pick('[data-field="tempC"]', 30); pick('[data-field="humidity"]', 80); pick("#ground", "grass");
      return { field: qrooms.pa().field, ok };
    })()`);
    expect(set.ok.every(Boolean)).toBe(true);
    expect(set.field).toEqual({ tempC: 30, humidity: 80, ground: "grass", speed: 349, banks: [] });

    // the panel's bank, 6 m out across the stack's throw: 6 m past it the floor loses its highs over the crest
    const bank = await tab.eval<{ before: number; after: number; banks: number }>(`(() => {
      qrooms.pickStack(0);
      const before = qrooms.level(0, 6);
      document.getElementById("bank").click();
      return { before, after: qrooms.level(0, 6), banks: qrooms.pa().field.banks.length };
    })()`);
    expect(bank.banks).toBe(1);
    expect(bank.before - bank.after).toBeGreaterThan(6);

    // a second stack: at the back left, its sound lands 4.3 m later, and later still on a freezing night than a hot one
    const late = await tab.eval<{ hot: number; cold: number }>(`(() => {
      qrooms.edit({ t: "stack", at: [8, -8], yaw: 0 });
      const hot = qrooms.delay(-10, 14)[1].ms;
      qrooms.edit({ t: "field", tempC: -10 });
      return { hot, cold: qrooms.delay(-10, 14)[1].ms };
    })()`);
    expect(late.hot).toBeCloseTo(((Math.hypot(18, 22) - Math.hypot(10, 22)) / 349) * 1000, 0);
    expect(late.cold - late.hot).toBeGreaterThan(0.5);
  } finally { await tab.close(); }
});
