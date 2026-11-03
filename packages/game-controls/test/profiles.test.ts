import { expect, test } from "bun:test";
import { DEFAULTS, EXTRAS, SECTIONS, SLOTS, parseBook, parseSettings, remember, switchTo, type Profile } from "../src/index.ts";

const profile = (lookX: number, keys: Profile["keys"] = {}): Profile => ({ settings: { ...DEFAULTS, lookX }, keys, pad: {} });

test("a stored book of any shape comes back as four slots with a valid active one", () => {
  for (const raw of [null, "junk", { active: 9, slots: "no" }, { active: -1 }]) {
    const b = parseBook(raw);
    expect([b.slots.length, b.active, b.slots.every((p) => p === null)]).toEqual([SLOTS, 0, true]);
  }
  const b = parseBook({ active: 2, slots: [{ settings: { lookX: 99 }, keys: { jump: ["Space", 4] }, pad: { jump: 1.5, fire: 7 } }] });
  expect(b.active).toBe(2);
  expect(b.slots[0]).toEqual({ settings: expect.objectContaining({ lookX: 3 }), keys: { jump: ["Space"] }, pad: { fire: 7 } });
});

test("switching saves where you were and loads where you go; an empty slot starts as a copy", () => {
  const a = profile(2, { jump: ["KeyF"] });
  const first = switchTo(parseBook(null), a, 1);
  expect(first.load).toBe(a);
  expect(first.book.active).toBe(1);
  expect(first.book.slots[0]).toBe(a);
  // Tweak slot 1, go back to 0, then to 1 again: each keeps its own.
  const b = remember(first.book, profile(0.5));
  const back = switchTo(b, profile(0.5), 0);
  expect(back.load.settings.lookX).toBe(2);
  expect(switchTo(back.book, profile(2), 1).load.settings.lookX).toBe(0.5);
});

test("optional rows: unknown ids drop, numbers clamp, kinds must match", () => {
  const s = parseSettings({ more: { fov: 500, rumble: "yes", headBob: false, nope: 1 } });
  expect(s.more).toEqual({ fov: 110, headBob: false });
});

test("the catalog has unique ids and every default sits inside its range", () => {
  const ids = SECTIONS.flatMap((s) => s.rows.map((r) => r.id));
  expect(new Set(ids).size).toBe(ids.length);
  for (const r of Object.values(EXTRAS)) if (r.kind === "slider") expect(r.def >= r.min && r.def <= r.max).toBe(true);
});
