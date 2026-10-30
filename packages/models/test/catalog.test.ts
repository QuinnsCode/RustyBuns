import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { writeProceduralGlbs } from "../src/catalog.ts";

test("every procedural model comes out as a GLB, the same each run", async () => {
  const a = mkdtempSync(`${tmpdir()}/glb-`), b = mkdtempSync(`${tmpdir()}/glb-`);
  const first = await writeProceduralGlbs(a), second = await writeProceduralGlbs(b);
  expect(first.length).toBeGreaterThan(4);
  for (let i = 0; i < first.length; i++) {
    const bytes = await Bun.file(first[i]!).bytes();
    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe("glTF");
    expect(bytes).toEqual(await Bun.file(second[i]!).bytes());
  }
});
