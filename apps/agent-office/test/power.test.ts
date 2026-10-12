import { expect, setDefaultTimeout, test } from "bun:test";
import { POWER_PATCHES } from "../power/patch.ts";
import { fps, gate, parseMode, pixelRatio, type State } from "../power/policy.ts";
import { read, unpackPinned } from "./pinned.ts";

// the first run downloads the pinned release into .cache, as rustybunsify.ts does
setDefaultTimeout(60_000);

const at = (s: Partial<State>): number => fps({ mode: "auto", focused: true, idleMs: 0, onBattery: false, ...s });

test("Automatic: 60 while you play, 30 while you watch, 15 behind another window", () => {
  expect(at({})).toBe(60);
  expect(at({ idleMs: 30_000 })).toBe(30);
  expect(at({ focused: false })).toBe(15);
});

test("on battery it watches at 20 and idles in the background at 5, with fewer pixels", () => {
  expect(at({ onBattery: true })).toBe(60);
  expect(at({ onBattery: true, idleMs: 30_000 })).toBe(20);
  expect(at({ onBattery: true, focused: false })).toBe(5);
  expect(pixelRatio("auto", true, 2)).toBe(1.5);
  expect(pixelRatio("auto", false, 2)).toBe(2);
  expect(pixelRatio("auto", false, 3)).toBe(2);
});

test("Smooth draws every frame in focus; Battery saver caps at 30 and 1x", () => {
  expect(at({ mode: "smooth", onBattery: true })).toBe(Infinity);
  expect(at({ mode: "smooth", focused: false })).toBe(30);
  expect(at({ mode: "saver" })).toBe(30);
  expect(pixelRatio("saver", false, 2)).toBe(1);
  expect(pixelRatio("smooth", true, 2)).toBe(2);
  expect(parseMode("saver")).toBe("saver");
  expect(parseMode("turbo")).toBe("auto");
  expect(parseMode(null)).toBe("auto");
});

test("the gate keeps 60 of a 120 Hz display's frames, and every frame of a 60 Hz one", () => {
  const count = (hz: number, rate: number) => {
    const due = gate();
    let n = 0;
    for (let i = 0; i < hz; i++) if (due((i * 1000) / hz, rate)) n++;
    return n;
  };
  expect(count(120, 60)).toBe(60);
  expect(count(60, 60)).toBe(60);
  expect(count(120, 30)).toBe(30);
  expect(count(120, Infinity)).toBe(120);
});

test("both patch targets are in the pinned release's 3D bundle, once each", async () => {
  const pkg = await unpackPinned();
  const [main] = [...new Bun.Glob("dist/public/assets/main-*.js").scanSync({ cwd: pkg })];
  const js = read(`${pkg}/${main}`);
  for (const [from] of POWER_PATCHES) expect(js.split(from).length - 1).toBe(1);
});
