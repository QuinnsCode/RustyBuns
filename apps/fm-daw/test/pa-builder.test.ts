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

test.skipIf(!hasChrome)("pick a premade stack in the PA panel: a cleared ground gets a pair with its boxes, a second pick swaps them and keeps where they stand", async () => {
  const tab = await openTab(chrome.cdp, { w: 1280, h: 720 });
  try {
    await load(chrome.cdp, tab, `${vite.url}rooms.html`, 0);
    await until(tab, "!!window.qrooms");
    const pick = (id: string) => `(() => { const s = document.querySelector("#premade"); s.value = "${id}"; s.dispatchEvent(new Event("change"));
      const pa = qrooms.pa(); return { rig: qrooms.state().def.outdoor.rig, at: pa.stacks.map((s) => s.at), sources: pa.sources.length, mean: pa.coverage?.mean ?? 0, list: qrooms.download("list")?.text ?? "" }; })()`;
    type Picked = { rig: string; at: [number, number][]; sources: number; mean: number; list: string };
    await tab.eval(`(() => { qrooms.load("desert-gathering"); while (qrooms.pa().stacks.length) qrooms.edit({ t: "unstack", index: 0 }); })()`);
    const horn = await tab.eval<Picked>(pick("horn-side"));
    expect(horn.rig).toBe("dance-stack");
    expect(horn.at).toHaveLength(2);
    expect(horn.at[0]![0]).toBe(-horn.at[1]![0]); // a pair, either side
    expect(horn.mean).toBeGreaterThan(90);
    expect(horn.list).toContain("10 x horn-sub-21"); // the field's sub block of six, and two side by side in each stack
    expect(horn.sources).toBe(8); // and each stack plays from two bins, its mid-bass and its mid-high
    const line = await tab.eval<Picked>(pick("line-array"));
    expect(line.rig).toBe("line-array");
    expect(line.at).toEqual(horn.at);
    expect(line.list).toContain("x line-array-10");
    // the bar pair has no rig of its own: the rig stays, the boxes are its
    const bar = await tab.eval<Picked>(pick("bar-pair"));
    expect(bar.rig).toBe("line-array");
    expect(bar.at).toEqual(horn.at);
    expect(bar.list).toContain("2 x top-15-passive");
    expect(bar.list).not.toContain("line-array-10");
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
    type Field = { tempC: number; humidity: number; ground: string; speed: number; banks: unknown[]; captured: boolean } | null;
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
    expect(set.field).toEqual({ tempC: 30, humidity: 80, ground: "grass", speed: 349, banks: [], captured: false });

    // the panel's bank, 6 m out across the stack's throw: 6 m past it the floor loses its highs over the crest
    const bank = await tab.eval<{ before: number; after: number; banks: number }>(`(() => {
      qrooms.pickStack(0);
      const before = qrooms.level(0, 6);
      document.getElementById("bank").click();
      return { before, after: qrooms.level(0, 6), banks: qrooms.pa().field.banks.length };
    })()`);
    expect(bank.banks).toBe(1);
    expect(bank.before - bank.after).toBeGreaterThan(6);

    // on the blueprint, Move drags the bank 12 m off the stack's line and the floor behind where it stood comes back up;
    // Turn turns it a twelfth
    const moved = await tab.eval<{ after: number; bank: { at: number[]; yaw: number } }>(`(() => {
      qrooms.view("plan");
      const plan = document.getElementById("plan"), m = plan.getScreenCTM();
      const at = (x, z) => { const p = new DOMPoint(x, z).matrixTransform(m); return { clientX: p.x, clientY: p.y, button: 0, pointerId: 1, bubbles: true }; };
      const rect = () => plan.querySelector('[data-bank="0"] rect');
      rect().dispatchEvent(new PointerEvent("pointerdown", at(0, -2)));
      plan.dispatchEvent(new PointerEvent("pointermove", at(12, -2)));
      plan.dispatchEvent(new PointerEvent("pointerup", at(12, -2)));
      const after = qrooms.level(0, 6);
      document.querySelector('[data-tool="turn"]').click();
      rect().dispatchEvent(new PointerEvent("pointerdown", at(12, -2)));
      plan.dispatchEvent(new PointerEvent("pointerup", at(12, -2)));
      return { after, bank: qrooms.pa().field.banks[0] };
    })()`);
    expect(moved.bank.at).toEqual([12, -2]);
    expect(moved.bank.yaw).toBeCloseTo(Math.PI / 12, 5);
    expect(Math.abs(moved.after - bank.before)).toBeLessThan(1);

    // a second stack: at the back left, its sound lands 4.3 m later, and later still on a freezing night than a hot one
    const late = await tab.eval<{ hot: number; cold: number }>(`(() => {
      qrooms.edit({ t: "stack", at: [8, -8], yaw: 0 });
      const hot = qrooms.delay(-10, 14)[1].ms;
      qrooms.edit({ t: "field", tempC: -10 });
      return { hot, cold: qrooms.delay(-10, 14)[1].ms };
    })()`);
    expect(late.hot).toBeCloseTo(((Math.hypot(18, 22) - Math.hypot(10, 22)) / 349) * 1000, 0);
    expect(late.cold - late.hot).toBeGreaterThan(0.5);

    // a captured venue whose ground rises 4 m in a ridge across the field 7 m out (its heights as groundMap reads them
    // off the splat): with the drawn bank gone and one stack again, the floor behind the ridge loses its highs the same way
    const ridge = { x0: -12, z0: -4, cell: 3, cols: 8, h: [...Array(8).fill(0), ...Array(8).fill(4), ...Array(8).fill(0)] };
    const lie = await tab.eval<{ before: number; after: number; ok: boolean; captured: boolean }>(`(() => {
      qrooms.edit({ t: "unbank", index: 0 }); qrooms.edit({ t: "unstack", index: 1 });
      const before = qrooms.level(0, 6);
      const ok = qrooms.edit({ t: "venue", venue: { src: "https://sharesplat.notryanquinn.workers.dev/s/0123456789abcdef0123.spz", scale: 1, at: [0, 0, 0], yaw: 0, land: ${JSON.stringify(ridge)} } }).ok;
      return { before, after: qrooms.level(0, 6), ok, captured: qrooms.pa().field.captured };
    })()`);
    expect([lie.ok, lie.captured]).toEqual([true, true]);
    expect(lie.before - lie.after).toBeGreaterThan(6);
  } finally { await tab.close(); }
});

test.skipIf(!hasChrome)("the Event Planner's lesson: the cap button starts it on a cleared field, the card ticks each step off and says done", async () => {
  const tab = await openTab(chrome.cdp, { w: 1280, h: 720 });
  try {
    await load(chrome.cdp, tab, `${vite.url}rooms.html`, 0);
    await until(tab, "!!window.qrooms");
    // the cap button in the corner starts it: the Desert Gathering with its stacks taken away, the card on the first step
    const started = await tab.eval<{ stacks: number; room: string; shown: boolean; next: string | null }>(`(() => {
      document.querySelector(".lesson-ask").click();
      const card = document.getElementById("lesson");
      return { stacks: qrooms.pa().stacks.length, room: qrooms.state().room, shown: !card.hidden && document.querySelector(".lesson-ask").hidden, next: card.querySelector("li.next span")?.textContent ?? null };
    })()`);
    expect(started).toMatchObject({ stacks: 0, room: "desert-gathering", shown: true });
    expect(started.next).toContain("Stand two stacks");
    // two stacks either side, facing the middle as the PA tool puts them down; the 100 kVA set; the gear list
    const done = await tab.eval<{ steps: boolean[]; why: string | null; done: boolean; doneLine: string | null }>(`(() => {
      qrooms.edit({ t: "stack", at: [-15, -16] });
      const why = document.querySelector("#lesson .lesson-why span")?.textContent ?? null;
      qrooms.edit({ t: "stack", at: [15, -16] });
      qrooms.edit({ t: "generator", set: "generator-100kva" });
      qrooms.download("list");
      const l = qrooms.lesson().lesson;
      return { steps: l.steps.map((s) => s.done), why, done: l.done, doneLine: document.querySelector("#lesson .lesson-done")?.textContent ?? null };
    })()`);
    expect(done.why).toMatch(/^One stack throws at its own side/);
    expect(done).toMatchObject({ steps: [true, true, true, true], done: true });
    expect(done.doneLine).toContain("The plan is yours");
  } finally { await tab.close(); }
});
