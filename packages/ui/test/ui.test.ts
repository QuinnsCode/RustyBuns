import { expect, test } from "bun:test";
import { uiCss } from "../src/css.ts";
import { TOKENS } from "../src/tokens.ts";

test("the kit's CSS takes every colour from a token, so a game re-themes it without a fork", () => {
  const css = uiCss.replace(/^:where\(:root\)\{[^}]*\}/m, "");
  expect(Object.keys(TOKENS).length).toBeGreaterThan(8);
  expect(css.match(/#[0-9a-fA-F]{3,8}\b/g)).toBeNull();
  for (const used of new Set(css.match(/--ui-[a-z-]+/g))) expect(Object.keys(TOKENS)).toContain(used);
});
