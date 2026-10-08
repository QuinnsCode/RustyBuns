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

test("while a menu owns the keyboard, Space and Enter reach the focused button, not the game", () => {
  const w = new EventTarget(), c = new Controls();
  let ui = true, prevented = 0;
  c.attach(w as unknown as Window, { uiKeys: () => ui });
  const down = (code: string) => { const e = new Event("keydown") as Event & { code: string; repeat: boolean }; Object.assign(e, { code, repeat: false, preventDefault() { prevented++; } }); w.dispatchEvent(e); };
  down("Enter"); down("Space");
  expect(c.sample(["kbAll"]).gulp).toBe(false);
  expect(prevented).toBe(0);                            // the browser still clicks the button
  down("KeyQ");                                         // other keys still play (Q readies up in the lobby)
  expect(c.sample(["kbAll"]).bellow).toBe(true);
  c.endFrame(); ui = false;
  down("Enter");
  expect(c.sample(["kbAll"]).gulp).toBe(true);
  expect(prevented).toBe(2);                            // Q and Enter: the page must not scroll
});

test("a networked player is controlled from any seat the server gives them", async () => {
  const { controlsFor } = await import("../src/client/input.ts");
  const solo = [["kbAll", "touch"], [], [], []] as const;
  for (const seat of [0, 1, 2, 3]) expect(controlsFor(solo as never, seat)).toEqual(["kbAll", "touch"]);
  const couch = [["kb1"], ["kb2"], [], ["pad0"]] as const;
  expect(controlsFor(couch as never, 1)).toEqual(["kb2"]);
  expect(controlsFor(couch as never, 3)).toEqual(["pad0"]);
});
