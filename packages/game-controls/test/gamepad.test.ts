import { expect, test } from "bun:test";
import { createPadBindings as reservedPad } from "../src/index.ts";

test("a button the game keeps for itself can't take an action, and a save that put one there goes back", () => {
  const acts = [{ id: "jump", label: "Jump", button: 0 }, { id: "guard", label: "Guard", button: 7 }];
  const b = reservedPad(acts, { guard: 9 }, [9, 12]);
  expect(b.get("guard")).toBe(7);
  expect(b.set("jump", 12)).toEqual({ ok: false, with: "" });
  expect(b.set("jump", 3)).toEqual({ ok: true });
});
import { createPad, createPadBindings, deadZone, parsePadBindings, type PadSnapshot } from "../src/gamepad.ts";

const actions = [{ id: "fire", label: "Fire", button: 7 }, { id: "jump", label: "Jump", button: 0 }];
const snap = (down: number[], axes = [0, 0, 0, 0]): PadSnapshot => ({ connected: true, axes, buttons: Array.from({ length: 16 }, (_, i) => ({ pressed: down.includes(i) })) });

test("a stick inside the dead zone is still, and the edge still reaches 1", () => {
  expect(deadZone(0.1, 0.1)).toEqual({ x: 0, y: 0 });
  expect(deadZone(1, 0).x).toBeCloseTo(1);
  expect(deadZone(0.575, 0).x).toBeCloseTo(0.5);
});

test("pressed fires once, held stays; a rebound button moves the action", () => {
  let now: PadSnapshot[] = [snap([7])];
  const binds = createPadBindings(actions);
  const pad = createPad(binds, 0.15, () => now);
  const a = pad.poll();
  expect([a.held.has("fire"), a.pressed.has("fire")]).toEqual([true, true]);
  const b = pad.poll();
  expect([b.held.has("fire"), b.pressed.has("fire")]).toEqual([true, false]);
  expect(binds.set("fire", 0)).toEqual({ ok: false, with: "Jump" });
  expect(binds.set("fire", 5)).toEqual({ ok: true });
  now = [snap([5])];
  expect(pad.poll().pressed.has("fire")).toBe(true);
});

test("no pad connected reads as nothing held", () => {
  const s = createPad(createPadBindings(actions), 0.15, () => [null]).poll();
  expect(s.connected).toBe(false);
  expect(s.held.size).toBe(0);
});

test("a saved clash or junk falls back to shipped buttons", () => {
  expect(parsePadBindings({ fire: 0, jump: 0, x: 3 }, actions)).toEqual({ fire: 0 });
  expect(parsePadBindings({ fire: "7", jump: -1 }, actions)).toEqual({});
});
