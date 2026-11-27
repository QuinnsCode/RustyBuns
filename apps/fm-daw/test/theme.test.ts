import { expect, test } from "bun:test";
import { shownTheme, themeAttr, themeOf } from "../src/ui/theme.ts";

// what was saved → the data-theme the page gets → the look shown on a dark OS and on a light one
test.each([
  [null, null, "dark", "light"],
  ["system", null, "dark", "light"],
  ["light", "light", "light", "light"],
  ["dark", "dark", "dark", "dark"],
  ["sepia", null, "dark", "light"],
] as const)("saved %p sets data-theme %p", (saved, attr, onDarkOs, onLightOs) => {
  const choice = themeOf(saved);
  expect(themeAttr(choice)).toBe(attr);
  expect(shownTheme(choice, false)).toBe(onDarkOs);
  expect(shownTheme(choice, true)).toBe(onLightOs);
});
