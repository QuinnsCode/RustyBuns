import { expect, test } from "bun:test";
import { modelPaths, sideBySide } from "../src/model-review.ts";

test("only models are picked from a change, and the page shows before beside after", () => {
  expect(modelPaths(["a/src/x.ts", "a/public/models/z.glb", "a/public/models/b.GLB"])).toEqual(["a/public/models/b.GLB", "a/public/models/z.glb"]);
  const html = sideBySide([{ path: "m/<b>.glb", before: null, after: "data:image/png;base64,AA" }]);
  expect(html).toContain("m/&lt;b&gt;.glb");
  expect(html).toContain("new");
  expect(html).toContain('src="data:image/png;base64,AA"');
  expect(sideBySide([])).toContain("No models changed");
});
