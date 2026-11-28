// The hulls and craft built from their drawing sheets: each comes out the size its sheet says, its far level is cheaper than its
// near one, and the battle builds them that way.
import { expect, test } from "bun:test";
import * as THREE from "three";
import { craftGeometry } from "../src/view/craft.ts";
import { CRAFT_SHEETS } from "../src/view/craft-sheets.ts";
import { CRAFT_NAME, SHIP_NAME } from "../src/names.ts";
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
  expect(Object.keys(SHEETS).sort()).toEqual(Object.keys(SHIP_NAME).sort());
});

test("each craft is one painted geometry the size its sheet says, a few hundred triangles", () => {
  for (const sheet of Object.values(CRAFT_SHEETS).flatMap((roles) => Object.values(roles))) {
    const g = craftGeometry(sheet.role, sheet.side), n = g.getAttribute("position").count;
    expect([sheet.title, n / 3 <= 400, g.getAttribute("color").count]).toEqual([CRAFT_NAME[sheet.side][sheet.role], true, n]);
    g.computeBoundingBox();
    const size = g.boundingBox!.getSize(new THREE.Vector3()).multiplyScalar(sheet.length / sheet.gameLength);
    for (const [axis, got, want, within] of [["length", size.x, sheet.length, 0.08], ["beam", size.z, sheet.beam, 0.08], ["height", size.y, sheet.height, 0.15]] as const) {
      expect([sheet.title, axis, Math.abs(got / want - 1) < within]).toEqual([sheet.title, axis, true]);
    }
  }
});
