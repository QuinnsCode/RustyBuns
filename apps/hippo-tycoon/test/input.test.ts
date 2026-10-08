import { expect, test } from "bun:test";
import { Controls } from "../src/client/input.ts";

/** A window stand-in: just enough EventTarget for the keyboard. */
function rig() {
  const w = new EventTarget();
  const c = new Controls();
  c.attach(w as unknown as Window);
  const key = (type: "keydown" | "keyup", code: string, repeat = false) => {
    const e = new Event(type) as Event & { code: string; repeat: boolean; target: unknown; preventDefault(): void };
    Object.assign(e, { code, repeat, preventDefault() {} });
    w.dispatchEvent(e);
  };
  return { c, down: (k: string) => key("keydown", k), up: (k: string) => key("keyup", k), repeat: (k: string) => key("keydown", k, true) };
}

test("two keyboard players share one keyboard without crosstalk", () => {
  const { c, down, up } = rig();
  down("KeyD"); down("ArrowLeft"); down("KeyW"); down("Enter");
  expect(c.sample(["kb1"])).toEqual({ move: 1, gulp: true, bellow: false });
  expect(c.sample(["kb2"])).toEqual({ move: -1, gulp: true, bellow: false });
  c.endFrame();
  expect(c.sample(["kb1"]).gulp).toBe(false);          // gulp is an edge
  expect(c.sample(["kb1"]).move).toBe(1);              // move is a level
  up("KeyD");
  expect(c.sample(["kb1"]).move).toBe(0);
  down("Slash"); down("KeyQ");
  expect(c.sample(["kb1"]).bellow).toBe(true);
  expect(c.sample(["kb2"]).bellow).toBe(true);
});

test("kbAll answers to both layouts; held keys do not repeat a gulp", () => {
  const { c, down, repeat } = rig();
  down("Space");
  expect(c.sample(["kbAll"]).gulp).toBe(true);
  c.endFrame();
  repeat("Space");
  expect(c.sample(["kbAll"]).gulp).toBe(false);
  down("ArrowRight");
  expect(c.sample(["kbAll"]).move).toBe(1);
});

test("a bot seat samples as nothing", () => {
  const { c } = rig();
  expect(c.sample(["bot"])).toEqual({ move: 0, gulp: false, bellow: false });
  expect(c.sample([])).toEqual({ move: 0, gulp: false, bellow: false });
});
