import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tourSteps } from "../src/app/tour-steps.ts";

const dir = join(import.meta.dir, "../src/features");
const read = () => Object.fromEntries(readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => [f.slice(0, -5), JSON.parse(readFileSync(join(dir, f), "utf8")) as unknown]));
const order = readFileSync(join(dir, "order.txt"), "utf8");

test("the tour's files are whole, in order.txt's order, and the demo step hands on to the app", () => {
  const steps = tourSteps(read(), order);
  expect(steps.map((s) => s.id)).toEqual(order.split("\n").filter(Boolean));
  expect(steps.find((s) => s.id === "demo")?.go).toStartWith("/app");
  expect(steps.find((s) => s.id === "search")).toBeDefined();
});

test.each([
  [{ a: { icon: "x", title: "A", at: "#a" } }, "", "src/features/a.json needs what"],
  [{ a: { icon: "x", title: "A", what: "w", at: "#a" } }, "a\nghost\n", "ghost"],
])("a step that isn't whole, or an order naming a ghost, fails: %j", (files, ord, why) => {
  expect(() => tourSteps(files, ord)).toThrow(why);
});
