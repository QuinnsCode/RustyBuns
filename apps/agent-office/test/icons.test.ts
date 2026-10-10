import { expect, test } from "bun:test";
import { EMOJI } from "../icons/emoji.ts";
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
  expect(hasEmoji("🟢 live")).toBe(false);
  expect(hasEmoji("🟢 🍺")).toBe(true);
});
