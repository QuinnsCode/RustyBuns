import { analyze } from "@rustybuns/rig";
import { loadGlb } from "@rustybuns/rig/model";
const id = process.argv[2]!;
const file = process.argv[3] ?? `public/models/${id}.glb`;
const model = await loadGlb(await Bun.file(file).arrayBuffer(), id);
const r = analyze(model.positions, model.indices, { resolution: 96 });
const hasKids = new Array<boolean>(r.parents.length).fill(false);
for (const p of r.parents) if (p >= 0) hasKids[p] = true;
let height = 0, extent = 0;
for (let i = 0; i < model.positions.length; i += 3) { height = Math.max(height, model.positions[i + 1]!); extent = Math.max(extent, Math.abs(model.positions[i]!) * 2, Math.abs(model.positions[i + 2]!) * 2); }
console.log(id, "tris", model.triangles, "joints", r.parents.length, "height", height.toFixed(2), "extent", extent.toFixed(2), "wing needs y>", (height*0.5).toFixed(2), "|z|>", (extent*0.3).toFixed(2));
for (let j = 1; j < r.parents.length; j++) if (!hasKids[j]) console.log("tip", j, [0,1,2].map(k => r.joints[j*3+k]!.toFixed(2)).join(" "));
