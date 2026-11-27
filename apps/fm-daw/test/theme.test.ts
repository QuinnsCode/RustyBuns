import { expect, test } from "bun:test";
import { shownTheme, themeOf } from "../src/ui/theme.ts";

// what was saved → the look every page shows (its data-theme) on a dark OS and on a light one
test.each([
  [null, "dark", "light"],
  ["system", "dark", "light"],
  ["light", "light", "light"],
  ["dark", "dark", "dark"],
  ["sepia", "dark", "light"],
] as const)("saved %p shows %p on a dark OS, %p on a light one", (saved, onDarkOs, onLightOs) => {
  const choice = themeOf(saved);
  expect(shownTheme(choice, false)).toBe(onDarkOs);
  expect(shownTheme(choice, true)).toBe(onLightOs);
});
