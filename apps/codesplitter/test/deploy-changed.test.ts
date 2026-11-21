import { expect, test } from "bun:test";
import { dropBinding, pick } from "../scripts/deploy-changed.ts";

const EX = ["astro-example", "hono-example", "nuxt-example"];

test.each([
  ["an example's own file", ["apps/frameworks/nuxt-example/nuxt.config.ts"], 0, ["nuxt-example"]],
  ["two examples", ["apps/frameworks/astro-example/a.ts", "apps/frameworks/hono-example/b.ts", "README.md"], 0, ["astro-example", "hono-example"]],
  ["machinery, rotation day 4", ["packages/cli/src/glue/deploy.ts"], 4, ["hono-example"]],
  ["an example beats the rotation", ["apps/codesplitter/src/deploy.ts", "apps/frameworks/astro-example/x"], 1, ["astro-example"]],
  ["nothing deploy-shaped", ["apps/mythic-masters/src/a.ts", "apps/codesplitter/src/util.ts"], 0, []],
])("%s", (_, changed, day, want) => {
  expect(pick(changed, EX, day).map((p) => p.app)).toEqual(want);
});

test("the drop binding is the config's first one", () => {
  expect(dropBinding(`export default defineConfig({\n  bindings: {\n    DB: { type: "d1" },\n    VISITS: { type: "kv" },\n  },\n});`)).toBe("DB");
  expect(dropBinding(`export default defineConfig({ name: "spa" });`)).toBeUndefined();
});
