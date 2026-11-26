// The hulls built from their drawing sheets: each comes out the size its sheet says, its far level is cheaper than its
// near one, and the battle builds them that way.
import { expect, test } from "bun:test";
import * as THREE from "three";
import { shipModel } from "../src/view/models.ts";
import { SHEETS } from "../src/view/sheets.ts";
import { sheetModel, shipPieces } from "../src/view/ships.ts";

const tris = (o: THREE.Object3D) => { let n = 0; o.traverse((m) => { if (m instanceof THREE.Mesh) n += m.geometry.getAttribute("position").count / 3; }); return n; };

test("each sheet-built hull matches its sheet, pieces and all, and goes cheap far off", () => {
  for (const [kind, sheet] of Object.entries(SHEETS) as [keyof typeof SHEETS, (typeof SHEETS)[keyof typeof SHEETS]][]) {
    const whole = new THREE.Group();
    for (const p of shipPieces(kind)) { expect([kind, p.name, tris(p.group) > 0]).toEqual([kind, p.name, true]); whole.add(p.group); }
    const size = new THREE.Box3().setFromObject(whole).getSize(new THREE.Vector3());
    // Length and beam within 8% of the sheet's (the gun's muzzle and the drives stand a little proud), height within 15%.
    expect(Math.abs(size.x / sheet.length - 1)).toBeLessThan(0.08);
    expect(Math.abs(size.z / sheet.beam - 1)).toBeLessThan(0.08);
    expect(Math.abs(size.y / sheet.height - 1)).toBeLessThan(0.15);

    const g = sheetModel(kind), lod = g.children[0] as THREE.LOD;
    expect(g.scale.x * sheet.length).toBeCloseTo(sheet.gameLength);
    expect(tris(lod.levels[1]!.object)).toBeLessThan(tris(lod.levels[0]!.object) / 2);
  }
  expect(shipModel("destroyer", "navy").userData.sheet).toBe("destroyer");
});
