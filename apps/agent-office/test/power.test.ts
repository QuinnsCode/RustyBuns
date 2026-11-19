import { expect, setDefaultTimeout, test } from "bun:test";
import { POWER_PATCHES } from "../power/patch.ts";
import { fps, gate, parseMode, pixelRatio, type State } from "../power/policy.ts";
import { read, unpackPinned, pinnedTest } from "./pinned.ts";

// the first run downloads the pinned release into .cache, as rustybunsify.ts does
setDefaultTimeout(60_000);

const at = (s: Partial<State>): number => fps({ mode: "auto", focused: true, idleMs: 0, onBattery: false, ...s });

test("Automatic slows down while you watch, behind another window and on battery; Smooth and Battery saver set their own", () => {
  const cases: [Partial<State>, number][] = [
    [{}, 60], [{ idleMs: 30_000 }, 30], [{ focused: false }, 15],
    [{ onBattery: true }, 60], [{ onBattery: true, idleMs: 30_000 }, 20], [{ onBattery: true, focused: false }, 5],
    [{ mode: "smooth", onBattery: true }, Infinity], [{ mode: "smooth", focused: false }, 30], [{ mode: "saver" }, 30],
  ];
  for (const [s, want] of cases) expect(at(s)).toBe(want);
  expect(pixelRatio("auto", true, 2)).toBe(1.5);
  expect(pixelRatio("auto", false, 3)).toBe(2);
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

pinnedTest("both patch targets are in the pinned release's 3D bundle, once each", async () => {
  const pkg = await unpackPinned();
  const [main] = [...new Bun.Glob("dist/public/assets/main-*.js").scanSync({ cwd: pkg })];
  const js = read(`${pkg}/${main}`);
  for (const [from] of POWER_PATCHES) expect(js.split(from).length - 1).toBe(1);
});
