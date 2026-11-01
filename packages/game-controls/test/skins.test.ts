import { expect, test } from "bun:test";
import { TOKENS, skinCss } from "../src/skins.ts";

test("none adds no CSS, house keeps the layout rules and defines every token, a game's css comes last", () => {
  expect(skinCss("none")).toBe("");
  const house = skinCss("house", ".mine{}");
  expect(house).toContain(".gc-card");
  for (const t of Object.keys(TOKENS)) expect(house).toContain(`${t}:`);
  expect(house.endsWith(".mine{}")).toBe(true);
  expect(skinCss("none", ".mine{}")).toBe(".mine{}");
});
