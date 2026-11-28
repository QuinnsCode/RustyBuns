// The symbols where you sit or stand (#6551, src/studio/seat-bar.ts) in headless Chrome with a stand-in microphone:
// from the front door's seat at the keys, to the piano, your mic, a guitar on a board that grows and loops back, its
// head and cabinet, and the Design desk. Then the board's rig as sound: the loop back and the cabinets change it.
import { expect, setDefaultTimeout, test } from "bun:test";
import { CAB_IDS, CABS, cabIR, DEFAULT_MIC, gainAt, runRig } from "@rustybuns/gear/circuit";
import { load, openTab, until } from "../../../scripts/chrome.ts";
import { chrome, hasChrome, useBrowser, vite } from "./browser-kit.ts";
import { rigSpec } from "../src/amp/live.ts";
import { BOARD_CABS, loopBack, newBoard, addPedal, PEDAL_IDS, removePedal } from "../src/amp/board-rig.ts";
import { PEDALS } from "../src/circuit/amps.ts";
import { boardSettings } from "../src/guitar.ts";

setDefaultTimeout(180_000); // the jam room is a 3D scene, drawn in software on CI's runners
useBrowser("--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required");

test.skipIf(!hasChrome)("from the keys: piano, mic, guitar and pedals, amp and cabinet, then the Design desk", async () => {
  const tab = await openTab(chrome.cdp, { w: 1280, h: 800 });
  const page = <T>(js: string) => tab.eval(js) as Promise<T>;
  const press = async (id: string) => {
    await until(tab, `!!document.querySelector('[data-seat="${id}"]')`, `the ${id} symbol`, 30_000);
    await page(`document.querySelector('[data-seat="${id}"]').click()`);
  };
  await load(chrome.cdp, tab, `${vite.url}jam.html?start=keys`, 0);
  await until(tab, `new URLSearchParams(location.search).get("sit") === "keys" && !!window.qjam && !!document.getElementById("play")`, "the room", 60_000);
  await page(`document.getElementById("play").click()`);
  await until(tab, `qjam.state().you.seat === "keys"`, "sat at the keys", 60_000);

  // the keys: the live room's synth to the piano and back
  expect(await page<string>("qjam.seat().keys")).toBe("synth");
  await press("keys");
  await until(tab, `qjam.seat().voice === "tine-ep" && qjam.seat().keys === "piano"`, "the piano");
  await press("keys");
  await until(tab, `qjam.seat().voice === "wood-poly"`, "the synth again");

  // the mic, from the keys seat; then a guitar in its place, on a board with one pedal
  await press("mic");
  await until(tab, `qjam.guitars().input === "mic"`, "the mic in", 30_000);
  await press("guitar");
  await until(tab, `qjam.guitars().input === "guitar" && qjam.seat().onBoard`, "the guitar in", 30_000);
  await until(tab, `document.querySelectorAll(".seat-pedal").length === 1`, "a board with one pedal");

  // the plus: a second pedal lands at the end; a drag from it back to the first loops it
  await press("add");
  await press("add-fuzz");
  await until(tab, `qjam.seat().board.pedals.map((p) => p.pedal).join() === "drive,fuzz"`, "the fuzz at the end");
  await page(`(() => {
    const [a, b] = document.querySelectorAll(".seat-pedal b"), r = a.getBoundingClientRect(), x = r.x + 4, y = r.y + 4;
    b.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1 }));
    a.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1, clientX: x, clientY: y }));
  })()`);
  await until(tab, `qjam.seat().board.back?.from === 1 && qjam.seat().board.back?.to === 0`, "the loop back");

  // the head and the cabinet from their pictures
  await press("amp");
  await press("head-clean");
  await press("cab-4x12");
  await until(tab, `qjam.seat().board.amp === "clean" && qjam.seat().board.cab === "4x12"`, "the picks");
  await press("guitar");
  await until(tab, `qjam.guitars().mine === null`, "the guitar out");

  // stood at the Design desk, its three ways on
  await page(`qjam.stand(); const d = qjam.seat().desk; qjam.walkTo(d.x, d.z)`);
  await until(tab, `qjam.seat().design`, "at the desk", 30_000);
  await press("design");
  await until(tab, `[...document.querySelectorAll('#seat-panel a')].map((a) => a.getAttribute("href")).join() === "/rooms.html#party,/rooms.html,/speakers.html"`, "the three ways on");

});

test("a loop back and the cabinet change what a board sounds like, and the lists the wire checks match the circuits", () => {
  expect<string[]>([...PEDAL_IDS].sort()).toEqual(PEDALS.map((p) => p.id).sort());
  expect([...BOARD_CABS]).toEqual([...CAB_IDS]);
  const sr = 48000, tone = Float32Array.from({ length: 2400 }, (_, i) => (i < 600 ? 0.3 * Math.sin((2 * Math.PI * 220 * i) / sr) : 0));
  const two = addPedal(newBoard(), "dist"), looped = loopBack(two, 1, 0);
  const play = (b: typeof two) => runRig(rigSpec(boardSettings(b)).spec, tone, sr, 2).out;
  const dry = play(two), fed = play(looped);
  expect(fed.every(Number.isFinite)).toBe(true);
  expect(fed.some((v, i) => Math.abs(v - dry[i]!) > 1e-4)).toBe(true);
  // the same drag again takes the loop out, and taking a looped pedal out takes it with it
  expect(loopBack(looped, 0, 1).back).toBeUndefined();
  expect(removePedal(looped, 0).back).toBeUndefined();
  // more speakers, more low end
  const low = CAB_IDS.map((box) => gainAt(cabIR({ ...DEFAULT_MIC, box }, sr), 90, sr));
  expect(low[0]!).toBeLessThan(low[1]!);
  expect(low[1]!).toBeLessThan(low[2]!);
  expect(CABS["2x12"].speakers).toBe(2);
});
