// Typing the dashed spelling lands on the game, on the same page and query.
import { expect, test } from "bun:test";
import alias, { HOME } from "../src/edge/alias.ts";

test("super-splat-spy-shot sends players to supersplatspyshot", () => {
  const res = alias.fetch(new Request("https://super-splat-spy-shot.notryanquinn.workers.dev/?code=abc&state=x"));
  expect(res.status).toBe(301);
  expect(res.headers.get("Location")).toBe(`${HOME}/?code=abc&state=x`);
});
