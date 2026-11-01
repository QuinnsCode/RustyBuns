import { describe, expect, test } from "bun:test";
import { bindPad, NO_STICK, PAD_DEFAULT, parsePad, push, readPad, touchStick } from "../src/controls.ts";
import { createBindings } from "@rustybuns/game-controls";
import { ACTIONS } from "../src/binds.ts";

const press = (...on: number[]) => Array.from({ length: 17 }, (_, i) => ({ pressed: on.includes(i) }));

describe("touch and gamepad feed the keyboard's codes", () => {
  test.each([
    ["a resting stick does nothing", 0, 0, 0, 0],
    ["a thumb jitter inside the dead zone does nothing", 5, -6, 0, 0],
    ["pushed all the way up goes full forward", 0, -56, 1, 0],
    ["dragged past the rim still tops out at 1", 200, 0, 0, 1],
  ])("touch stick: %s", (_n, dx, dy, fx, sx) => {
    const s = touchStick(dx, dy, 56);
    expect(s.fx).toBeCloseTo(fx); expect(s.sx).toBeCloseTo(sx);
  });

  test("a gamepad's jump + heavy (the launcher) and its left stick come through", () => {
    const { keys, stick } = readPad(press(0, 3), [0.7, 0.7, 0, 0]);
    expect(keys.sort()).toEqual(["KeyK", "Space"]);
    expect(stick.sx).toBeGreaterThan(0.5);
    expect(stick.fx).toBeLessThan(-0.5); // stick down pulls toward the camera
  });

  test("a gamepad's d-pad, guard and dash hold their keys", () => {
    expect(readPad(press(4, 5, 12), [0, 0]).keys.sort()).toEqual(["KeyQ", "KeyW", "ShiftLeft"]);
  });

  test("in the open world a gamepad's right stick turns the camera and RB runs", () => {
    const { keys, turn } = readPad(press(5), [0, 0, -1, 0]);
    expect(turn).toBeCloseTo(-1);
    expect(keys).toEqual(["ShiftLeft"]);
    expect(readPad(press(), [0, 0, 0.1, 0]).turn).toBe(0); // a drifting stick doesn't spin the world
  });

  test.each([
    ["a light push walks slowly", [], touchStick(0, -28, 56), 0.39, 0],
    ["W and the stick together still top out at 1", ["KeyW"], touchStick(0, -56, 56), 1, 0],
    ["a diagonal on the keys is no faster than straight", ["KeyW", "KeyD"], NO_STICK, Math.SQRT1_2, Math.SQRT1_2],
    ["the up arrow walks in the world", ["ArrowUp"], NO_STICK, 1, 0],
  ] as const)("keys and a stick push together: %s", (_n, held, s, fx, sx) => {
    const p = push(new Set(held), s, true);
    expect(p.fx).toBeCloseTo(fx, 2); expect(p.sx).toBeCloseTo(sx, 2);
  });
});

describe("rebinding", () => {
  test("a gamepad button moved to another action swaps with the one that had it", () => {
    const m = bindPad(PAD_DEFAULT, "KeyJ", 0); // light onto A, where jump was
    expect(m.KeyJ).toBe(0); expect(m.Space).toBe(2);
    expect(readPad(press(0), [0, 0], m).keys).toEqual(["KeyJ"]);
  });
  test("a saved gamepad map with a button twice, or nonsense, falls back to the shipped buttons", () => {
    expect(parsePad({ KeyJ: 0 })).toEqual(PAD_DEFAULT);
    expect(parsePad("x")).toEqual(PAD_DEFAULT);
    expect(parsePad({ Space: 9 }).Space).toBe(9);
  });
  test("a keyboard key moved to attack feeds the game the shipped code, and the old key does nothing", () => {
    const k = createBindings(ACTIONS);
    expect(k.set("light", "KeyF")).toEqual({ ok: true });
    expect(k.canon("KeyF")).toBe("KeyJ");
    expect(k.canon("KeyJ")).toBe("");
    expect(k.set("heavy", "KeyF")).toEqual({ ok: false, why: "clash", with: "Light attack" });
  });
});
