import { describe, expect, test } from "bun:test";
import { buttons, NO_STICK, PAD_ACTIONS, PAD_DEFAULT, PAD_ZONE, push, readPad, touchStick } from "../src/controls.ts";
import { createBindings, createPad, createPadBindings, type PadSnapshot } from "@rustybuns/game-controls";
import { ACTIONS, PRESETS } from "../src/binds.ts";

const press = (...on: number[]): PadSnapshot["buttons"] => Array.from({ length: 17 }, (_, i) => ({ pressed: on.includes(i) }));
/** What the game reads off a pad in one frame: the shared pad, then this app's mapping of it. */
const frame = (on: number[], axes: number[], binds = createPadBindings(PAD_ACTIONS)) => {
  const pad = createPad(binds, PAD_ZONE, () => [{ connected: true, axes, buttons: press(...on) }]), st = pad.poll();
  return readPad(st.held, st.left, st.right, pad.down());
};

describe("touch and gamepad feed the same actions as the keys", () => {
  test.each([
    ["a resting stick does nothing", 0, 0, 0, 0],
    ["a thumb jitter inside the dead zone does nothing", 5, -6, 0, 0],
    ["pushed all the way up goes full forward", 0, -56, 1, 0],
    ["dragged past the rim still tops out at 1", 200, 0, 0, 1],
  ])("touch stick: %s", (_n, dx, dy, fx, sx) => {
    const s = touchStick(dx, dy, 56);
    expect(s.fx).toBeCloseTo(fx); expect(s.sx).toBeCloseTo(sx);
  });

  test("a gamepad plays like a platform fighter: A attacks, X jumps, B is special, RT guards, and the left stick moves", () => {
    const { keys, stick } = frame([0, 1, 2, 7], [0.7, 0.7, 0, 0]);
    expect(keys.sort()).toEqual(["guard", "jump", "light", "special"]);
    expect(stick.sx).toBeGreaterThan(0.5);
    expect(stick.fx).toBeLessThan(-0.5); // stick down pulls toward the camera
    expect(frame([5, 12], [0, 0]).keys.sort()).toEqual(["dash", "forward"]);
  });

  test.each([
    ["resting: nothing", NO_STICK, { heavy: false, up: false, down: false }],
    ["a small drift: nothing", { fx: 0.3, sx: 0.2 }, { heavy: false, up: false, down: false }],
    ["pushed sideways: the strong attack", { fx: 0, sx: 0.9 }, { heavy: true, up: false, down: false }],
    ["pushed up: the launcher", { fx: 0.9, sx: 0.1 }, { heavy: true, up: true, down: false }],
    ["pulled down: the dive", { fx: -0.9, sx: 0 }, { heavy: true, up: false, down: true }],
  ] as const)("the right stick in a fight: %s", (_n, aim, want) => {
    const b = buttons(new Set(), aim);
    expect({ heavy: b.heavy, up: b.up, down: b.down }).toEqual(want);
  });

  test("in the open world a gamepad's right stick turns the camera, and a drift doesn't", () => {
    expect(frame([], [0, 0, -1, 0]).aim.sx).toBeCloseTo(-1);
    expect(frame([], [0, 0, 0.1, 0]).aim.sx).toBe(0);
  });

  test.each([
    ["a light push walks slowly", [], touchStick(0, -28, 56), 0.39, 0],
    ["forward and the stick together still top out at 1", ["forward"], touchStick(0, -56, 56), 1, 0],
    ["a diagonal on the keys is no faster than straight", ["forward", "right"], NO_STICK, Math.SQRT1_2, Math.SQRT1_2],
  ] as const)("keys and a stick push together: %s", (_n, held, s, fx, sx) => {
    const p = push(new Set(held), s);
    expect(p.fx).toBeCloseTo(fx, 2); expect(p.sx).toBeCloseTo(sx, 2);
  });
});

describe("rebinding", () => {
  test("a gamepad button moved to another action is refused while another action holds it", () => {
    const m = createPadBindings(PAD_ACTIONS);
    expect(m.set("jump", 0)).toEqual({ ok: false, with: "Attack" });
    expect(m.set("jump", 8)).toEqual({ ok: true });
    expect(frame([8], [0, 0], m).keys).toEqual(["jump"]);
    expect(PAD_DEFAULT.jump).toBe(2);
  });
  test("a keyboard key moved to attack answers for it, and the old key does nothing", () => {
    const k = createBindings(ACTIONS);
    expect(k.set("light", "KeyF")).toEqual({ ok: true });
    expect(k.canon("KeyF")).toBe("KeyJ");
    expect(k.canon("KeyJ")).toBe("");
    expect(k.set("heavy", "KeyF")).toEqual({ ok: false, why: "clash", with: "Attack" });
  });
  test.each(PRESETS.map((p) => [p.label, p] as const))("the %s layout applies whole, with no key on two actions", (_n, p) => {
    const k = createBindings(ACTIONS);
    k.apply(p.keys);
    for (const [id, codes] of Object.entries(p.keys)) expect(k.get(id)).toEqual(codes);
    const all = ACTIONS.flatMap((a) => k.get(a.id));
    expect(new Set(all).size).toBe(all.length);
  });
});
