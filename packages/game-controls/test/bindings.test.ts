import { expect, test } from "bun:test";
import { createBindings, keyName, parseBindings } from "../src/index.ts";

const ACTIONS = [
  { id: "fwd", label: "Forward", keys: ["KeyW", "ArrowUp"] },
  { id: "jump", label: "Jump", keys: ["Space"] },
  { id: "crouch", label: "Crouch", keys: ["KeyC"] },
];

test("a rebound action answers to the new key and its old key goes quiet", () => {
  const b = createBindings(ACTIONS);
  expect(b.canon("ArrowUp")).toBe("KeyW");
  expect(b.set("fwd", "KeyI")).toEqual({ ok: true });
  expect([b.canon("KeyI"), b.canon("KeyW"), b.canon("ArrowUp"), b.canon("KeyP")]).toEqual(["KeyW", "", "", "KeyP"]);
});

test("a key can't hold two actions, and Esc can't be taken", () => {
  const b = createBindings(ACTIONS);
  expect(b.set("jump", "KeyC")).toEqual({ ok: false, why: "clash", with: "Crouch" });
  expect(b.set("jump", "ArrowUp")).toEqual({ ok: false, why: "clash", with: "Forward" });
  expect(b.set("jump", "Escape")).toEqual({ ok: false, why: "reserved" });
  expect(b.get("jump")).toEqual(["Space"]);
  expect(b.canUndo()).toBe(false);
});

test("undo steps back one move at a time, and reset goes to the defaults", () => {
  const b = createBindings(ACTIONS);
  b.set("jump", "KeyJ");
  b.set("crouch", "KeyK");
  b.set("jump", "KeyL");
  expect(b.undo()).toBe(true);
  expect(b.get("jump")).toEqual(["KeyJ"]);
  b.resetAll();
  expect(b.toJSON()).toEqual({});
  expect(b.undo()).toBe(true); // even a reset can be taken back
  expect(b.get("crouch")).toEqual(["KeyK"]);
  while (b.undo());
  expect(b.get("jump")).toEqual(["Space"]);
  expect(b.undo()).toBe(false);
});

test("one action back to default is refused while another has taken its key", () => {
  const b = createBindings(ACTIONS);
  b.set("jump", "KeyJ");
  b.set("crouch", "Space");
  expect(b.resetOne("jump")).toEqual({ ok: false, why: "clash", with: "Crouch" });
  expect(b.resetOne("crouch")).toEqual({ ok: true });
  expect(b.resetOne("jump")).toEqual({ ok: true });
  expect(b.isDefault("jump")).toBe(true);
});

test("a hand-edited save can't smuggle in a clash, Esc or junk", () => {
  expect(parseBindings({ jump: ["KeyW"], crouch: ["Escape"], fwd: "KeyZ", nope: ["KeyQ"] }, ACTIONS)).toEqual({});
  expect(createBindings(ACTIONS, { jump: ["KeyW"] }).get("jump")).toEqual(["Space"]);
});

test.each([["KeyW", "W"], ["Digit1", "1"], ["ShiftLeft", "Shift"], ["ArrowUp", "↑"]])("keyName(%s)", (c, n) => expect(keyName(c)).toBe(n));
