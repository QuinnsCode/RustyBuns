// Planning a sound system in the studio builder (#5863), in headless Chrome over CDP (scripts/chrome.ts): on
// /rooms.html start from the Desert Gathering, clear its stacks and place two, aim one off at the edge of the ground and
// watch the coverage map drop on the floor it left, put the rig on the small generator and read why it fails, then take
// the gear list and the plan drawing away.
import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromePath, launchChrome, load, openTab, startVite, until as pageUntil } from "../../../scripts/chrome.ts";

setDefaultTimeout(240_000); // vite serves cold, then redraws a room's coverage map in software GL
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
