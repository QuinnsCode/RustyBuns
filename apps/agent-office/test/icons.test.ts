import { expect, test } from "bun:test";
import { EMOJI, TINT, iconFor } from "../icons/emoji.ts";
import { hasEmoji, split } from "../icons/split.ts";

test("every emoji has an icon, keyed without U+FE0F", () => {
  for (const [k, icon] of Object.entries(EMOJI)) {
    expect(k).not.toContain("️");
    expect(icon.length).toBeGreaterThan(0);
  }
});

test("text splits around the emoji that have icons", () => {
  expect(split("✅ DONE")).toEqual([{ emoji: "✅", raw: "✅" }, " DONE"]);
  expect(split("⚠️ Under pressure")).toEqual([{ emoji: "⚠", raw: "⚠️" }, " Under pressure"]);
  expect(split("PR #3 🔀 open")).toEqual(["PR #3 ", { emoji: "🔀", raw: "🔀" }, " open"]);
  expect(split("plain")).toEqual(["plain"]);
});

test("hasEmoji leaves nothing behind for split", () => {
  // V8's matchAll starts at a shared global regex's lastIndex, which once hung the page
  expect(hasEmoji("✅ DONE")).toBe(true);
  expect(split("✅ DONE")[0]).toEqual({ emoji: "✅", raw: "✅" });
});

test("a ZWJ sequence beats the person it starts with", () => {
  expect(split("🧑‍💻 Worker")).toEqual([{ emoji: "🧑‍💻", raw: "🧑‍💻" }, " Worker"]);
});

test("emoji without an icon stay as they are", () => {
  expect(hasEmoji("🧩 puzzle")).toBe(false);
  expect(hasEmoji("🧩 🍺")).toBe(true);
});

test("a passing check is a solid green badge with a white tick", () => {
  const [ring, tick] = iconFor("✅");
  expect(ring![1]).toMatchObject({ fill: "#2da44e", stroke: "#2da44e" });
  expect(tick![1]).toMatchObject({ stroke: "#fff" });
});

test("a solid tint fills the outline wherever it sits", () => {
  // the octagon sits between OctagonX's two strokes; filled there, it would hide the first
  const [first, ...rest] = iconFor("⛔");
  expect(String(first![1].d)).toMatch(/z$/i);
  expect(first![1].fill).toBe("#d1242f");
  expect(rest.map(([, a]) => a.stroke)).toEqual(["#fff", "#fff"]);
});

test("every tint has an icon, and an outline to fill when solid", () => {
  for (const [k, t] of Object.entries(TINT)) {
    expect(EMOJI[k]).toBeDefined();
    if (t.solid) expect(iconFor(k).some(([, a]) => a.fill === t.color)).toBe(true);
  }
});
