// Experiment (#6200), run on Bob: steer --eval with BM25 alone and with the text model blended in.
// bun scripts/steer-vec-exp.ts <docs.json>
import { readFileSync } from "node:fs";
import { bm25 } from "./steer-score.ts";
import { evaluate, type Doc } from "./steer.ts";
import { BIN, blend, DIM, embed, ensureModel, nearest } from "./steer-vec.ts";

const docs: Doc[] = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
if (!(await Bun.file(BIN).exists())) {
  const b = Bun.spawnSync(["cargo", "build", "--release", "--quiet"], { cwd: `${import.meta.dir}/steer-embed`, stdout: "inherit", stderr: "inherit" });
  if (b.exitCode !== 0) process.exit(1);
}
await ensureModel();

let t = performance.now();
const all = await embed(docs.map((d) => d.text));
console.log(`embedded ${docs.length} docs in ${((performance.now() - t) / 1000).toFixed(1)} s`);
const queries = new Map<string, Float32Array>();
const asks = docs.filter((d) => d.ask).map((d) => d.text.slice(0, d.ask));
t = performance.now();
const qv = await embed(asks);
asks.forEach((a, i) => queries.set(a, qv.subarray(i * DIM, (i + 1) * DIM)));
console.log(`embedded ${asks.length} asks in ${((performance.now() - t) / 1000).toFixed(1)} s`);

const index = new Map(docs.map((d, i) => [d, i]));
const pastVecs = (past: Doc[]) => {
  const v = new Float32Array(past.length * DIM);
  past.forEach((d, i) => v.set(all.subarray(index.get(d)! * DIM, (index.get(d)! + 1) * DIM), i * DIM));
  return v;
};

evaluate(docs, 14, undefined, " (bm25)");
evaluate(docs, 14, (past) => { const v = pastVecs(past); return (q) => nearest(v, queries.get(q)!, 10); }, " (model only)");
for (const w of [0.3, 0.5, 0.7]) {
  evaluate(docs, 14, (past, ix) => { const v = pastVecs(past); return (q) => blend(bm25(ix, q, 40), nearest(v, queries.get(q)!, 40), w); }, ` (blend ${w})`);
}
