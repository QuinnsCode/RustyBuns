// The Blender board (blender/fingerboard.py) at each polygon budget: it takes the built board's place at the
// same size, so the sim's collision deck still matches what you see, and the parts picker still paints it.
import { expect, test } from "bun:test";
import * as THREE from "three";
import { BOARD_BUDGETS, DECK, dressBoard, fingerboard } from "../src/models.ts";
import { CATALOG } from "../src/parts.ts";

const glb = (budget: string) => Bun.file(new URL(`../public/models/fingerboard-${budget}.glb`, import.meta.url)).arrayBuffer();
const triangles = (g: THREE.Object3D) => {
  let n = 0;
  g.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) n += (m.geometry.index?.count ?? m.geometry.attributes.position!.count) / 3; });
  return n;
};

test.each([...BOARD_BUDGETS])("the %s board sits where the built one does, within its budget, and paints", async (budget) => {
  const built = new THREE.Box3().setFromObject(fingerboard());
  const board = fingerboard();
  expect(await dressBoard(board, await glb(budget))).toBe(true);
  const box = new THREE.Box3().setFromObject(board);
  expect(box.min.y).toBeCloseTo(0, 2); // on its wheels
  expect(box.getSize(new THREE.Vector3()).z).toBeCloseTo(DECK.length, 1);
  for (const k of ["x", "y", "z"] as const) expect(Math.abs(box.max[k] - built.max[k])).toBeLessThan(0.05);
  expect(triangles(board)).toBeLessThanOrEqual({ hi: 30000, mid: 6000, low: 1500 }[budget]!);

  board.userData.paint({ deck: "teal", trucks: "gold", wheels: "red", grip: "grey" });
  const colours = new Set<number>();
  board.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) colours.add((m.material as THREE.MeshStandardMaterial).color.getHex()); });
  expect(colours).toContain(CATALOG.deck[1].color);
  expect(colours).toContain(CATALOG.wheels[1].color);
});
