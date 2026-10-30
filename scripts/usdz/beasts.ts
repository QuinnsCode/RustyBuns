// Every beast in a models dir (<id>.glb beside <id>.rig.json) as <id>.usdz: mesh, UsdSkel skeleton and skin weights.
import { mkdirSync, readdirSync } from "node:fs";
import { rigFromWire } from "../../packages/rig/src/index.ts";
import { loadGlb } from "../../packages/rig/src/model.ts";
import { BeastRig } from "../../apps/mythic-masters/src/beasts.ts";
import { beastUsda, usdz, type BeastSkin } from "./skel.ts";

export async function exportBeast(glb: ArrayBuffer, json: unknown, id: string): Promise<Uint8Array> {
  const model = await loadGlb(glb, id);
  const sidecar = BeastRig(json);
  const three = (a: number[]): [number, number, number] => [a[0]!, a[1]!, a[2]!];
  const rig = rigFromWire({ ...sidecar, grid: { ...sidecar.grid, dims: three(sidecar.grid.dims), origin: three(sidecar.grid.origin) } });
  if (rig.skinIndex.length !== model.positions.length / 3 * 4) throw new Error(`${id}: rig skins ${rig.skinIndex.length / 4} vertices, model has ${model.positions.length / 3}`);
  const skin: BeastSkin = { tips: sidecar.tips, feet: sidecar.feet, wings: sidecar.wings };
  return usdz([{ name: `${id}.usda`, data: new TextEncoder().encode(beastUsda(id, model, rig, skin)) }]);
}

export async function exportBeasts(dir: string, out: string): Promise<number> {
  mkdirSync(out, { recursive: true });
  let n = 0;
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".rig.json"))) {
    const id = f.slice(0, -".rig.json".length);
    const glb = Bun.file(`${dir}/${id}.glb`);
    if (!(await glb.exists())) continue;
    await Bun.write(`${out}/${id}.usdz`, await exportBeast(await glb.arrayBuffer(), await Bun.file(`${dir}/${f}`).json(), id));
    n++;
  }
  return n;
}
