import { expect, test } from "bun:test";
import { bindKeys, keyOf, refuseKey, type KeyTarget } from "../src/keys.ts";

const press = (key: string, o: Partial<{ code: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; target: unknown; repeat: boolean }> = {}) =>
  ({ key, code: o.code ?? (/^[a-z]$/i.test(key) ? `Key${key.toUpperCase()}` : ""), metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, repeat: false, defaultPrevented: false, target: null, prevented: false, preventDefault() { this.prevented = true; }, ...o });

test("a key press is named as people read it, and a browser key, a moving key or a taken one is refused by name", () => {
  expect(keyOf(press("n"))).toBe("N");
  expect(keyOf(press("N", { shiftKey: true }))).toBe("Shift+N");
  expect(keyOf(press("˜", { code: "KeyN", altKey: true }), true)).toBe("Alt+N"); // a Mac's Alt types a symbol
  expect(keyOf(press("?", { shiftKey: true }))).toBe("?");
  expect(keyOf(press("Shift", { shiftKey: true }))).toBeNull();

  const taken = { thread_newest: "N" }, title = (n: string) => (n === "thread_newest" ? "Open the newest thread" : n);
  const rows: [string, string | null][] = [
    [keyOf(press("k", { metaKey: true }), true)!, "⌘K belongs to the browser"],
    [keyOf(press("s", { ctrlKey: true }), false)!, "Ctrl+S belongs to the browser"],
    [keyOf(press("Escape"))!, "Esc moves around the page"],
    [keyOf(press("ArrowRight"))!, "→ moves around the page"],
    ["N", "N is taken by “Open the newest thread”"],
    ["A", null],
    ["Shift+N", null],
  ];
  for (const [k, why] of rows) expect(refuseKey(k, "thread_all", taken, title)).toBe(why);
  expect(refuseKey("N", "thread_newest", taken, title)).toBeNull(); // its own key again
});

test("a chosen key runs its command, but not while typing, in a dialog, or for a key nobody picked", () => {
  let fire: (e: KeyboardEvent) => void = () => {};
  const target: KeyTarget = { addEventListener: (_, f) => { fire = f; }, removeEventListener: () => { fire = () => {}; } };
  const ran: string[] = [];
  let dialog = false;
  const off = bindKeys({ keys: () => ({ thread_all: "A" }), run: (n) => ran.push(n), busy: () => dialog, target });
  const send = (e: ReturnType<typeof press>) => { fire(e as unknown as KeyboardEvent); return e; };

  expect(send(press("a")).prevented).toBe(true);
  send(press("b"));
  send(press("a", { target: { closest: (s: string) => (s.includes("input") ? {} : null) } }));
  dialog = true; send(press("a")); dialog = false;
  send(press("a", { repeat: true }));
  expect(ran).toEqual(["thread_all"]);
  off(); send(press("a"));
  expect(ran).toEqual(["thread_all"]);
});
