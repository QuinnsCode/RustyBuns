import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadGlb } from "@rustybuns/rig/model";

// The Snallygaster's ochre belly is a body of blended blobs, and it carries darker bands between its ribs (#4372):
// walked from the hips to the throat, its underside turns dark and light again several times in the tone the game
// multiplies in (a band's vertices near black, the ochre around them several times lighter).
test("the Snallygaster's belly is banded dark and light from the hips to the throat", async () => {
  const model = await loadGlb(readFileSync(join(import.meta.dir, "../public/models/snallygaster.glb")).buffer as ArrayBuffer, "snallygaster");
  const dark: number[] = [];
  for (const part of model.parts) {
    const g = part.geometry, pos = g.getAttribute("position"), nor = g.getAttribute("normal"), col = g.getAttribute("color");
    if (!col) continue;
    for (let i = 0; i < pos.count; i++) {
      if (nor.getY(i) > -0.5 || Math.abs(pos.getZ(i)) > 0.12 || pos.getY(i) > 0.75) continue; // the underside, facing down
      if ((col.getX(i) + col.getY(i) + col.getZ(i)) / 3 < 0.15) dark.push(pos.getX(i));
    }
  }
  const xs = dark.sort((a, b) => a - b);
  const bands = xs.filter((x, i) => i === 0 || x - xs[i - 1]! > 0.015).length;
  console.log(xs.length, bands, xs.map((x) => x.toFixed(2)).join(" "));
  expect(bands).toBeGreaterThanOrEqual(4);
}, 30_000);
