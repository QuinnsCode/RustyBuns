// Faces: find them, line them up, fingerprint them, and put the fingerprints in the same index as
// the tiles. This file is the plain math on RGBA bytes (the page and the tests run the same code);
// run.ts feeds it the two models. A face's 128 numbers go through a fixed random projection to the
// index's 1024, then the crate's quantize and topk, exactly as a tile's do: one bit per random
// direction, so the bits two faces differ in track the angle between them.
import { mulberry32 } from "@rustybuns/util";
import type { Hit, SharedIndex } from "../engine/index.ts";
import { DIMS, WORDS, WORDS32 } from "../engine/layout.ts";

/** OpenCV's model zoo, pinned: YuNet finds faces (MIT), SFace fingerprints them (Apache 2.0). */
export const MODELS = {
  detect: { file: "face_detection_yunet_2023mar.onnx", repo: "opencv/face_detection_yunet", rev: "3cc26e7f1014a5ee5d74a42acee58bafc9d0a310", sha256: "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4", licence: "MIT" },
  embed: { file: "face_recognition_sface_2021dec_int8.onnx", repo: "opencv/face_recognition_sface", rev: "3d7082438a6e4551e840c9b2bb60b71e8da4b524", sha256: "2b0e941e6f16cc048c20aee0c8e31f569118f65d702914540f7bfdc14048d78a", licence: "Apache-2.0" },
} as const;

/** The detector's square input, the fingerprint's crop, and its length. */
export const DETECT = 640, CROP = 112, FEATS = 128;
/**
 * The cosine from which two faces are the same person. OpenCV publishes 0.363 for SFace; on the
 * sample photos the int8 weights score other people up to 0.35 and the same person from 0.61, so
 * a little higher keeps a browser's slightly different JPEG decode from letting a stranger in.
 */
export const SAME = 0.4;
const MIN_SCORE = 0.7, NMS = 0.3;

export interface Pixels { data: Uint8Array | Uint8ClampedArray; width: number; height: number }
/** One face on page `page`: its box (x, y, w, h), five points (eyes, nose, mouth corners), and fingerprint. */
export interface Face { page: number; box: [number, number, number, number]; kps: number[]; score: number; vec: Float32Array }
export type Found = Omit<Face, "page" | "vec">;

/** Channel `ch` at (x, y), bilinear, edges clamped. */
function sample(p: Pixels, x: number, y: number, ch: number): number {
  const { data, width: w, height: h } = p;
  const cx = Math.max(0, Math.min(w - 1, x)), cy = Math.max(0, Math.min(h - 1, y));
  const x0 = Math.floor(cx), y0 = Math.floor(cy), x1 = Math.min(x0 + 1, w - 1), y1 = Math.min(y0 + 1, h - 1);
  const fx = cx - x0, fy = cy - y0;
  const at = (xx: number, yy: number) => data[(yy * w + xx) * 4 + ch];
  return (at(x0, y0) * (1 - fx) + at(x1, y0) * fx) * (1 - fy) + (at(x0, y1) * (1 - fx) + at(x1, y1) * fx) * fy;
}

/** The picture scaled to fit DETECT x DETECT at the top left, black beyond: BGR planes, 0-255, as YuNet takes it. */
export function letterbox(p: Pixels): { input: Float32Array; scale: number } {
  const scale = DETECT / Math.max(p.width, p.height), n = DETECT * DETECT;
  const input = new Float32Array(3 * n);
  const w = Math.min(DETECT, Math.round(p.width * scale)), h = Math.min(DETECT, Math.round(p.height * scale));
  for (let v = 0; v < h; v++) for (let u = 0; u < w; u++) {
    const x = (u + 0.5) / scale - 0.5, y = (v + 0.5) / scale - 0.5, i = v * DETECT + u;
    input[i] = sample(p, x, y, 2); input[n + i] = sample(p, x, y, 1); input[2 * n + i] = sample(p, x, y, 0);
  }
  return { input, scale };
}

const iou = (a: Found["box"], b: Found["box"]) => {
  const w = Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]), h = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]);
  const inter = Math.max(0, w) * Math.max(0, h);
  return inter / (a[2] * a[3] + b[2] * b[3] - inter);
};

/** YuNet's twelve outputs (cls, obj, bbox, kps per stride 8, 16, 32) to faces in picture pixels, overlaps removed. */
export function decode(out: Record<string, Float32Array>, scale: number): Found[] {
  const found: Found[] = [];
  for (const s of [8, 16, 32]) {
    const cols = DETECT / s, cls = out[`cls_${s}`], obj = out[`obj_${s}`], bbox = out[`bbox_${s}`], kps = out[`kps_${s}`];
    for (let i = 0; i < cols * cols; i++) {
      const score = Math.sqrt(Math.min(1, Math.max(0, cls[i])) * Math.min(1, Math.max(0, obj[i])));
      if (score < MIN_SCORE) continue;
      const c = i % cols, r = Math.floor(i / cols);
      const w = Math.exp(bbox[i * 4 + 2]) * s, h = Math.exp(bbox[i * 4 + 3]) * s;
      const cx = (c + bbox[i * 4]) * s, cy = (r + bbox[i * 4 + 1]) * s;
      const pts: number[] = [];
      for (let k = 0; k < 5; k++) pts.push(((kps[i * 10 + 2 * k] + c) * s) / scale, ((kps[i * 10 + 2 * k + 1] + r) * s) / scale);
      found.push({ box: [(cx - w / 2) / scale, (cy - h / 2) / scale, w / scale, h / scale], kps: pts, score });
    }
  }
  found.sort((a, b) => b.score - a.score);
  const kept: Found[] = [];
  for (const f of found) if (kept.every((k) => iou(k.box, f.box) < NMS)) kept.push(f);
  return kept;
}

/** Where the five points sit in SFace's 112 px crop (the usual face-recognition template). */
const TEMPLATE = [38.2946, 51.6963, 73.5318, 51.5014, 56.0252, 71.7366, 41.5493, 92.3655, 70.7299, 92.2041];

/** The rotation, scale and shift that best lays `src` points on `dst`: x' = a x - b y + tx, y' = b x + a y + ty. */
export function similarity(src: number[], dst = TEMPLATE): [number, number, number, number] {
  const n = src.length / 2;
  let sx = 0, sy = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { sx += src[2 * i]; sy += src[2 * i + 1]; dx += dst[2 * i]; dy += dst[2 * i + 1]; }
  sx /= n; sy /= n; dx /= n; dy /= n;
  let na = 0, nb = 0, den = 0;
  for (let i = 0; i < n; i++) {
    const xs = src[2 * i] - sx, ys = src[2 * i + 1] - sy, xd = dst[2 * i] - dx, yd = dst[2 * i + 1] - dy;
    na += xs * xd + ys * yd; nb += xs * yd - ys * xd; den += xs * xs + ys * ys;
  }
  const a = na / den, b = nb / den;
  return [a, b, dx - (a * sx - b * sy), dy - (b * sx + a * sy)];
}

/** The face lined up on the template, CROP px square: RGB planes, 0-255, as SFace takes it. */
export function crop(p: Pixels, kps: number[]): Float32Array {
  const [a, b, tx, ty] = similarity(kps), k = 1 / (a * a + b * b), n = CROP * CROP;
  const out = new Float32Array(3 * n);
  for (let v = 0; v < CROP; v++) for (let u = 0; u < CROP; u++) {
    const ux = u - tx, vy = v - ty, x = k * (a * ux + b * vy), y = k * (a * vy - b * ux), i = v * CROP + u;
    out[i] = sample(p, x, y, 0); out[n + i] = sample(p, x, y, 1); out[2 * n + i] = sample(p, x, y, 2);
  }
  return out;
}

/** Scaled to length 1, so a dot product is the cosine. */
export function unit(v: Float32Array): Float32Array {
  let s = 0;
  for (const x of v) s += x * x;
  const out = new Float32Array(v.length), k = s ? 1 / Math.sqrt(s) : 0;
  for (let i = 0; i < v.length; i++) out[i] = v[i] * k;
  return out;
}
export const dot = (a: Float32Array, b: Float32Array) => { let d = 0; for (let i = 0; i < a.length; i++) d += a[i] * b[i]; return d; };

let directions: Float32Array | null = null;
/** The fingerprint against DIMS fixed random directions (Gaussian, seeded): the index's vector length. */
export function project(v: Float32Array): Float32Array {
  if (!directions) {
    const rand = mulberry32(3497);
    directions = new Float32Array(DIMS * FEATS);
    for (let i = 0; i < directions.length; i += 2) {
      const r = Math.sqrt(-2 * Math.log(1 - rand())), t = 2 * Math.PI * rand();
      directions[i] = r * Math.cos(t); directions[i + 1] = r * Math.sin(t);
    }
  }
  const out = new Float32Array(DIMS);
  for (let d = 0; d < DIMS; d++) {
    let s = 0;
    for (let j = 0; j < FEATS; j++) s += directions[d * FEATS + j] * v[j];
    out[d] = s;
  }
  return out;
}

/** The faces' codes into rows [at, at + faces.length): projected, then the crate's quantize. `scratch` holds DIMS floats. */
export function indexFaces(index: SharedIndex, faces: Face[], at: number, scratch: number) {
  faces.forEach((f, i) => {
    index.local.f32(scratch, DIMS).set(project(f.vec));
    index.local.quantize(scratch, 1, DIMS, index.layout.codes + (at + i) * WORDS * 8);
  });
}

export interface FaceMatch extends Hit { face: number; score: number }

/**
 * Every face that is the same person as face `i`: a bit search over the face rows for `k`, rescored
 * by cosine, kept from SAME up, best first (face `i` itself leads).
 */
export async function askFace(index: SharedIndex, faces: Face[], at: number, i: number, k = 64): Promise<{ matches: FaceMatch[]; searchMs: number }> {
  const code = index.codes().slice((at + i) * WORDS32, (at + i + 1) * WORDS32);
  const s = await index.search(code, k, at, at + faces.length);
  const matches = s.hits.map((h) => ({ ...h, face: h.row - at, score: dot(faces[i].vec, faces[h.row - at].vec) })).filter((m) => m.score >= SAME);
  matches.sort((a, b) => b.score - a.score);
  return { matches, searchMs: s.ms };
}
