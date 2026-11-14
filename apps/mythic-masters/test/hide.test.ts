import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadGlb } from "@rustybuns/rig/model";
import { surfaceFor, surfaceOf } from "../src/hide.ts";

const dir = join(import.meta.dir, "../beasts");
const sheets = readdirSync(dir).map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as { id: string; material: string; palette: Record<string, unknown> });

test("a beast's hide detail follows what its sheet says it is covered in", () => {
  const wrong = sheets.filter((s) => (s.material === "fur" || s.material === "scale") && surfaceOf(Object.keys(s.palette)) !== s.material).map((s) => s.id);
  expect(wrong).toEqual([]);
});

test("every built beast's baked hide spreads over most of its map, so its fur or scales aren't coarse", async () => {
  // the share of the 0-1 UV square the body's triangles cover in the committed GLB (beast.py `bake_hide` prints the same);
  // a tuft island left out of `crumbs` takes its own margin in the pack, and four furry beasts filled 15-25% (#4298)
  const models = join(import.meta.dir, "../public/models");
  const loose: string[] = [];
  for (const f of readdirSync(models).filter((f) => f.endsWith(".glb"))) {
    const model = await loadGlb(await Bun.file(join(models, f)).arrayBuffer(), f);
    for (const part of model.parts) {
      const mat = Array.isArray(part.material) ? part.material[0]! : part.material;
      if (!mat.userData.hide_mean) continue; // only a body with a baked hide carries its mean colour
      const uv = part.geometry.getAttribute("uv"), index = part.geometry.getIndex();
      const at = (i: number) => (index ? index.getX(i) : i);
      let cover = 0;
      for (let i = 0; i + 2 < (index ? index.count : uv.count); i += 3) {
        const [a, b, c] = [at(i), at(i + 1), at(i + 2)];
        cover += Math.abs((uv.getX(b) - uv.getX(a)) * (uv.getY(c) - uv.getY(a)) - (uv.getX(c) - uv.getX(a)) * (uv.getY(b) - uv.getY(a))) / 2;
      }
      if (cover < 0.35) loose.push(`${f} ${Math.round(cover * 100)}%`);
    }
  }
  expect(loose).toEqual([]);
});

test("horns, claws and eyes stay smooth; a mane is fur on any beast", () => {
  expect([surfaceFor("horn", "hide"), surfaceFor("claw", "fur"), surfaceFor("eye", "scale")]).toEqual([null, null, null]);
  expect(surfaceFor("mane", "scale")).toBe("fur");
});
