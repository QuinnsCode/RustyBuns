// A room you build, walked into (#5843), in headless Chrome over CDP (scripts/chrome.ts): on /rooms.html start from
// the Desert Gathering, park a camper van and set a fire pit out of doors, take the link qrooms.enter() hands out
// (the room rides in it: a fresh browser has none of the page's storage), and walk up to each in /jam.html.
import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromePath, launchChrome, load, openTab, startVite, until as pageUntil } from "../../../scripts/chrome.ts";

// the room is a 3D scene, drawn in software on CI's runners: a case takes most of a minute there
setDefaultTimeout(240_000); // vite serves cold, then a 3D room is built and walked in headless Chrome's software GL
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

test.skipIf(!hasChrome)("build a desert room with a van and a fire pit, walk in, and walk up to each", async () => {
  const tab = await openTab(chrome.cdp, { w: 1280, h: 720 });
  try {
    await load(chrome.cdp, tab, `${vite.url}rooms.html`, 0);
    await until(tab, "!!window.qrooms");
    const built = await tab.eval<{ ok: boolean[]; link: string }>(`(() => {
      qrooms.load("desert-gathering");
      const ok = [qrooms.edit({ t: "addProp", kind: "van", at: [8, 4] }).ok, qrooms.edit({ t: "addProp", kind: "firePit", at: [-6, 6] }).ok];
      return { ok, link: qrooms.enter("built-walk") };
    })()`);
    expect(built.ok).toEqual([true, true]);

    await load(chrome.cdp, tab, `${built.link}&quality=low`, 0);
    await until(tab, "!!window.qjam");
    const room = await tab.eval<{ here: string; room: string; props: { kind: string; at: [number, number]; w: number; d: number }[] }>(
      `(() => { const s = qjam.state(); return { here: s.studio.here, room: s.room, props: s.props }; })()`);
    expect([room.here, room.room]).toEqual(["yours", "desert-gathering"]);
    const decor = room.props.filter((p) => p.kind === "van" || p.kind === "firePit");
    expect(decor.map((p) => [p.kind, p.at])).toEqual([["van", [8, 4]], ["firePit", [-6, 6]]]);

    // walking at one stops at its side (you walk round both): close enough to touch
    for (const p of decor) {
      const you = await tab.eval<{ x: number; z: number }>(`(() => { qjam.walkTo(${p.at[0]}, ${p.at[1]}); return qjam.state().you; })()`);
      expect(Math.hypot(you.x - p.at[0], you.z - p.at[1])).toBeLessThan(Math.max(p.w, p.d) / 2 + 0.6);
    }
  } finally { await tab.close(); }
});
