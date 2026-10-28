import { expect, test } from "bun:test";
import { arr, Bad, bool, check, int, num, obj, oneOf, opt, str, type Of } from "../src/guard.ts";

// A route's body (rejects) and a peer's message (makes it fit), the two ways the apps use guards.
const Run = obj({ ref: str(), name: str(100), runner: opt(oneOf(["desktop", "container"])), names: opt(arr(str(), 3)) });
const Note = obj({ s: num(0, 16), l: num(1 / 64, 16, 0.25), m: int(0, 127, 60), on: bool(false), tags: arr(str(8), 2, { drop: true }) });

test("a body through its guard comes back typed, with what's missing left out and what's extra dropped", () => {
  const r: Of<typeof Run> = Run({ ref: "main", name: "test", names: ["a"], junk: 1 });
  expect(r).toEqual({ ref: "main", name: "test", names: ["a"] });
});

test.each([
  [{ name: "x" }, "ref: text up to 1000 characters"],
  [{ ref: "main", name: "x".repeat(101) }, "name: text up to 100 characters"],
  [{ ref: "main", name: "x", runner: "laptop" }, "runner: one of desktop, container"],
  [{ ref: "main", name: "x", names: ["a", 2] }, "names.1: text up to 1000 characters"],
  [{ ref: "main", name: "x", names: ["a", "b", "c", "d"] }, "names: a list of up to 3"],
  ["not an object", "an object"],
])("a bad body says which field and why: %j", (body, why) => {
  expect(() => Run(body)).toThrow(new Bad(why));
  expect(check(Run, body)).toBeNull();
});

test("with defaults a guard never throws: numbers clamp, long lists cut, then bad items drop", () => {
  expect(Note({ s: 3, l: 99, m: 64.6, on: "yes", tags: ["ok", "much too long", 5, "two", "three"] }))
    .toEqual({ s: 3, l: 16, m: 65, on: false, tags: ["ok"] });
  expect(Note({ s: 0 })).toEqual({ s: 0, l: 0.25, m: 60, on: false, tags: [] });
  // A field with no default still has to be there.
  expect(check(Note, {})).toBeNull();
});
