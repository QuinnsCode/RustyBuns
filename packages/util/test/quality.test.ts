import { describe, expect, test } from "bun:test";
import { autoQuality, FrameWatch, guessQuality, pickQuality, type Quality, STORE_KEY, stepDown, type Machine } from "../src/quality.ts";

describe("autoQuality", () => {
  test("applies the picked tier, then steps down and remembers when frames stay slow", () => {
    const ratios: number[] = [];
    const renderer = { setPixelRatio: (n: number) => void ratios.push(n), shadowMap: { enabled: true } };
    const sun = { castShadow: true, shadow: { mapSize: { set: () => {} }, map: { dispose: () => {} } } };
    const changed: string[] = [];
    const auto = autoQuality(renderer, [sun], { quality: "mid", onChange: (q) => changed.push(q) });
    expect(auto.quality).toBe("mid");
    expect(renderer.shadowMap.enabled).toBe(true);
    for (let t = 0; t < 12000; t += 100) auto.tick(t); // 10 fps for 12 s
    expect(auto.quality).toBe("low");
    expect(changed).toEqual(["low"]);
    expect(renderer.shadowMap.enabled).toBe(false);
    expect(sun.castShadow).toBe(false);
    expect(ratios.at(-1)).toBe(1);
  });
});

const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
};
const nvidia: Machine = { gpu: "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)", webgl2: true, cores: 12, memory: 8 };

describe("guessQuality", () => {
  test.each<[string, Machine, Quality]>([
    ["no WebGL", { gpu: "", webgl2: false }, "low"],
    ["software rasteriser", { gpu: "Google SwiftShader", webgl2: true, cores: 8, memory: 8 }, "low"],
    ["old Intel HD", { gpu: "ANGLE (Intel, Intel(R) HD Graphics 4000 Direct3D11 vs_5_0 ps_5_0, D3D11)", webgl2: true, cores: 4, memory: 8 }, "low"],
    ["WebGL1 only", { gpu: "AMD Radeon HD 6870", webgl2: false, cores: 4, memory: 8 }, "low"],
    ["discrete, enough memory", nvidia, "high"],
    ["Apple silicon", { gpu: "Apple M2", webgl2: true, cores: 8, memory: 8 }, "high"],
    ["newer integrated, unknown", { gpu: "ANGLE (Intel, Intel(R) Iris(R) Xe Graphics, D3D11)", webgl2: true, cores: 8, memory: 8 }, "mid"],
    ["unknown name", { gpu: "Mesa Something", webgl2: true }, "mid"],
  ])("%s", (_, m, want) => expect(guessQuality(m)).toBe(want));
});

describe("pickQuality", () => {
  test("?quality wins and is remembered; the saved one is used next; ?quality=auto forgets it", () => {
    const store = mem();
    expect(pickQuality({ search: "?quality=low", store, machine: nvidia })).toEqual({ quality: "low", why: "url" });
    expect(store.m.get(STORE_KEY)).toBe("low");
    expect(pickQuality({ search: "", store, machine: nvidia })).toEqual({ quality: "low", why: "saved" });
    expect(pickQuality({ search: "?quality=auto", store, machine: nvidia })).toEqual({ quality: "high", why: "machine" });
    expect(pickQuality({ search: "?quality=bogus", store: null, machine: nvidia }).why).toBe("machine");
  });
});

describe("FrameWatch", () => {
  const run = (fps: number, seconds: number, w: FrameWatch, from = 0) => {
    let t = from, out: string | null = null;
    for (; t < from + seconds * 1000; t += 1000 / fps) out = w.tick(t) ?? out;
    return { out, t };
  };
  test("fires once after sustained slow frames, not during warm-up, not for a stutter", () => {
    const w = new FrameWatch(24, 4, 3);
    expect(run(10, 3, w).out).toBeNull(); // slow while loading: ignored
    expect(run(60, 5, w, 3000).out).toBeNull();
    expect(run(10, 2, w, 8000).out).toBeNull(); // a two-second hitch
    expect(run(60, 2, w, 10000).out).toBeNull();
    expect(run(10, 6, w, 12000).out).toBe("drop");
    expect(run(10, 10, w, 18000).out).toBeNull(); // only once until reset
    w.reset();
    expect(run(10, 10, w, 28000).out).toBe("drop");
  });
  test("stepDown walks to the floor", () => {
    expect(stepDown("high")).toBe("mid");
    expect(stepDown("mid")).toBe("low");
    expect(stepDown("low")).toBeNull();
  });
});

describe("setQuality", () => {
  test("tells every listener, saves a tier and forgets it on auto", async () => {
    const { onQuality, savedChoice, setQuality } = await import("../src/quality.ts");
    const store = mem(), heard: string[] = [];
    const off = onQuality((_q, choice) => heard.push(choice));
    expect(setQuality("low", store)).toBe("low");
    expect(savedChoice(store)).toBe("low");
    setQuality("auto", store);
    expect(savedChoice(store)).toBe("auto");
    expect(heard).toEqual(["low", "auto"]);
    off();
    setQuality("high", store);
    expect(heard).toHaveLength(2);
  });
});
