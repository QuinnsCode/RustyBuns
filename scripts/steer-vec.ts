// The meaning half of `bun run steer` (#6200, step 2 of #5844): a small text model (all-MiniLM-L6-v2, int8, 23 MB)
// turns a task's words into 384 numbers, so tasks asked in other words still come up as near. The Rust binary in
// scripts/steer-embed does the model; this file runs it, scans the vectors and blends their score with BM25's.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export const DIM = 384;
export const MODEL_DIR = path.join(homedir(), ".rustybuns", "models", "all-MiniLM-L6-v2-int8");
export const BIN = path.join(import.meta.dir, "steer-embed", "target", "release", "steer-embed");
const HF = "https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main";
const FILES = { "model.onnx": "onnx/model_quantized.onnx", "tokenizer.json": "tokenizer.json" };

/** The model's two files under ~/.rustybuns/models, fetched once from Hugging Face. */
export async function ensureModel(dir = MODEL_DIR): Promise<string> {
  mkdirSync(dir, { recursive: true });
  for (const [name, from] of Object.entries(FILES)) {
    const to = path.join(dir, name);
    if (existsSync(to)) continue;
    const r = await fetch(`${HF}/${from}`);
    if (!r.ok) throw new Error(`fetching ${from}: ${r.status}`);
    writeFileSync(to, new Uint8Array(await r.arrayBuffer()));
  }
  return dir;
}

/** One vector per text, in order, each of length 1: `out.subarray(i * DIM, (i + 1) * DIM)`. */
export async function embed(texts: string[], bin = BIN, dir = MODEL_DIR): Promise<Float32Array> {
  const p = Bun.spawn([bin, dir], { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  p.stdin.write(texts.map((t) => `${t.replaceAll("\0", " ").slice(0, 2000)}\0`).join(""));
  await p.stdin.end();
  const [out, err, code] = await Promise.all([new Response(p.stdout).arrayBuffer(), new Response(p.stderr).text(), p.exited]);
  if (code !== 0) throw new Error(`steer-embed exited ${code}: ${err.trim()}`);
  if (out.byteLength !== texts.length * DIM * 4) throw new Error(`steer-embed wrote ${out.byteLength} bytes for ${texts.length} texts`);
  return new Float32Array(out);
}

/** The rows nearest `q` by cosine (a dot product, as every vector has length 1), best first: a plain scan. */
export function nearest(vecs: Float32Array, q: Float32Array, top = 10): { doc: number; score: number }[] {
  const n = vecs.length / DIM, best: { doc: number; score: number }[] = [];
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let d = 0, o = i * DIM; d < DIM; d++) s += vecs[o + d]! * q[d]!;
    if (best.length < top || s > best[best.length - 1]!.score) {
      best.push({ doc: i, score: s });
      best.sort((a, b) => b.score - a.score);
      if (best.length > top) best.pop();
    }
  }
  return best;
}

/** BM25's hits and the vectors' hits (best first, a few dozen each) as one list: each score scaled 0 to 1 between
 *  its own list's last and best, then `w` of the meaning score and the rest of the word score, times 20 so the
 *  weights sit where BM25's did for the file and app votes. */
export function blend(words: { doc: number; score: number }[], meaning: { doc: number; score: number }[], w = 0.5, top = 10) {
  const s = new Map<number, number>();
  const unit = (hits: { score: number }[]) => {
    const hi = hits[0]?.score ?? 1, lo = hits.length > 1 ? hits[hits.length - 1]!.score : 0;
    return (x: number) => (hi > lo ? (x - lo) / (hi - lo) : 1);
  };
  const wu = unit(words), mu = unit(meaning);
  for (const h of words) s.set(h.doc, (1 - w) * wu(h.score));
  for (const h of meaning) s.set(h.doc, (s.get(h.doc) ?? 0) + w * mu(h.score));
  return [...s].map(([doc, v]) => ({ doc, score: 20 * v })).sort((a, b) => b.score - a.score || a.doc - b.doc).slice(0, top);
}
