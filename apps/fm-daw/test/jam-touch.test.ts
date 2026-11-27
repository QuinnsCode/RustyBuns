// The jam room by touch on a phone (#6425, src/studio/touch.ts), in headless Chrome over CDP with touch emulated: the
// left stick walks, a drag on the room looks about, a tap on the bass synth walks you up to it and sits you, its touch
// keyboard plays a note and a slide moves to the next, the view stays still while you sit there, and Stand gets you up.
import { expect, setDefaultTimeout, test } from "bun:test";
import { load, openTab, until } from "../../../scripts/chrome.ts";
import { chrome, hasChrome, useBrowser, vite, waitFor } from "./browser-kit.ts";

setDefaultTimeout(240_000); // a jam room in software GL on CI's runners
useBrowser("--autoplay-policy=no-user-gesture-required");

type Me = { x: number; z: number; yaw: number; seat: string | null };
type Box = { x: number; y: number };

test.skipIf(!hasChrome)("on a phone: walk with the stick, look with a drag, tap the bass to sit, play its keys, stand", async () => {
  const tab = await openTab(chrome.cdp, { w: 390, h: 844 }, true);
  try {
    await load(chrome.cdp, tab, `${vite.url}jam.html?room=jam-touch&studio=desert-gathering&quality=low`, 0);
    const page = <T>(expr: string) => tab.eval<T>(`(async () => (${expr}))()`);
    const me = () => page<Me>("qjam.state().you");
    const touch = (type: string, ...at: Box[]) => tab.call("Input.dispatchTouchEvent", { type, touchPoints: at.map((p, i) => ({ ...p, id: i + 1 })) });
    const centre = (sel: string) => page<Box>(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    const drag = async (from: Box, to: Box) => {
      await touch("touchStart", from);
      for (let i = 1; i <= 6; i++) await touch("touchMove", { x: from.x + ((to.x - from.x) * i) / 6, y: from.y + ((to.y - from.y) * i) / 6 });
      await touch("touchEnd");
    };
    // stamped 80 ms from down to up: unstamped, the finger stays down for as long as the page takes to answer between the
    // two sends, which on CI's software GL is past a tap's 350 ms
    const tap = async (at: Box, between = async () => {}) => {
      const timestamp = Date.now() / 1000;
      await tab.call("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...at, id: 1 }], timestamp });
      await between();
      await tab.call("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [], timestamp: timestamp + 0.08 });
    };
    const drawn = () => page("new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))");

    await until(tab, "!!window.qjam && !!window.qjam.state().me.wearing", "the room", 60_000);
    await page("qjam.start()");
    await until(tab, "qjam.touch()?.shown", "the touch controls", 30_000);
    expect(await page<unknown>("qjam.touch()")).toMatchObject({ stick: { x: 0, y: 0 }, stand: false, keys: [] });

    // the stick pushed up walks you forward
    const before = await me(), stick = await centre(".qt-stick");
    await touch("touchStart", stick);
    await touch("touchMove", { x: stick.x, y: stick.y - 40 });
    await until(tab, `Math.hypot(qjam.state().you.x - ${before.x}, qjam.state().you.z - ${before.z}) > 0.3`, "a walk", 30_000);
    await touch("touchEnd");

    // a drag across the room turns you
    const turned = (await me()).yaw;
    await drag({ x: 300, y: 380 }, { x: 200, y: 380 });
    await until(tab, `Math.abs(qjam.state().you.yaw - ${turned}) > 0.2`, "a look", 20_000);

    // the bass, a few steps off and in view: a tap on it walks you there and sits you
    const bass = await page<{ id: string; at: [number, number] }>(`(() => {
      const s = qjam.state().spots.find((x) => x.kind === "bass");
      qjam.walkTo(s.at[0], s.at[1]);
      const m = qjam.state().you, dx = m.x - s.at[0], dz = m.z - s.at[1], d = Math.hypot(dx, dz) || 1;
      qjam.walkTo(s.at[0] + (dx / d) * 3, s.at[1] + (dz / d) * 3);
      const n = qjam.state().you;
      qjam.look(Math.atan2(-(s.at[0] - n.x), -(s.at[1] - n.z)), -0.15);
      return s;
    })()`);
    await drawn(); // the camera is where the walk and the look put it, so the bass is where the tap will find it
    await until(tab, `!!qjam.onScreen(${JSON.stringify(bass.id)})`, "the bass on the screen", 20_000);
    const [bx, by] = (await page<[number, number]>(`qjam.onScreen(${JSON.stringify(bass.id)})`));
    // on a slow phone (or CI's software GL) a long frame lands between the finger down and up: still a tap
    await tap({ x: bx, y: by }, async () => {
      await page("void setTimeout(() => { const t = performance.now(); while (performance.now() - t < 600); })");
      await Bun.sleep(100); // the page is busy now: the finger lifts while it is
    });
    const id = JSON.stringify(bass.id);
    await waitFor(tab, "the tap taken", `qjam.touch().goal === ${id} || qjam.state().you.seat === ${id}`, 10_000,
      `({ tapped: [${bx}, ${by}], bass: qjam.onScreen(${id}), touch: qjam.touch(), you: qjam.state().you })`);
    await until(tab, `qjam.state().you.seat === ${JSON.stringify(bass.id)}`, "sat at the bass", 30_000);

    // seated: Stand and the keyboard show, the stick doesn't
    await until(tab, "qjam.touch().keys.length > 0", "the touch keyboard", 30_000);
    expect(await page<unknown>("qjam.touch()")).toMatchObject({ stick: null, stand: true });
    // a finger on A plays its note; slid onto S, S's note takes over; lifted, nothing is held
    const [a, s] = await Promise.all([centre(`.qt-key[data-code="KeyA"]`), centre(`.qt-key[data-code="KeyS"]`)]);
    await touch("touchStart", a);
    await until(tab, "qjam.state().holding.length === 1", "A held", 10_000);
    const first = await page<number[]>("qjam.state().holding.map((n) => n.midi)");
    await touch("touchMove", s);
    await until(tab, `qjam.state().holding.length === 1 && qjam.state().holding[0].midi === ${first[0]! + 2}`, "S held", 10_000);
    await touch("touchEnd");
    await until(tab, "qjam.state().holding.length === 0", "let go", 10_000);

    // the view holds still while you sit at the keys
    const sat = (await me()).yaw;
    await drag({ x: 300, y: 300 }, { x: 150, y: 300 });
    await drawn();
    expect((await me()).yaw).toBe(sat);

    // Stand gets you up, and the stick is back
    await tap(await centre(".qt-stand"));
    await until(tab, "qjam.state().you.seat === null", "stood up", 10_000);
    await until(tab, "!!qjam.touch().stick", "the stick back", 10_000);
  } finally { await tab.close(); }
});
