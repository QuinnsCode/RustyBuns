// Hammer the solve API on a local Bun server (src/serve.ts's handler): no cloud, no bill.
//   bun scripts/stress.ts                 mixed load: 2000 requests, 32 at a time
//   bun scripts/stress.ts --storm         an error storm: bad JSON, bad sizes, huge bodies, wrong routes, mixed with real ones
//   bun scripts/stress.ts --n 10000 --c 64
// Prints requests per second, latency percentiles, status counts and memory. Exits 1 if any answer was a 5xx
// or the server stopped answering: an error storm must be answered with 4xx, never a crash.
import { serve } from "../src/serve.ts";
import { MAX_BODY } from "../src/worker.ts";

const arg = (name: string, fallback: number) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? Number(process.argv[i + 1]) : fallback; };
const N = arg("n", 2000), C = arg("c", 32), storm = process.argv.includes("--storm");

let seed = 7;
const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const size = (lo: number, hi: number) => Math.round((lo + rnd() * (hi - lo)) * 100) / 100;
const boxes = [{ name: "S", l: 8, w: 6, h: 4 }, { name: "M", l: 12, w: 9, h: 6 }, { name: "L", l: 16, w: 12, h: 8 }, { name: "XL", l: 24, w: 18, h: 12 }];
const thing = (i: number, inner = false) => {
  const [l, w, h] = [size(1, 7), size(1, 6), size(1, 4)] as [number, number, number];
  return { name: `item ${i}`, l, w, h, qty: 1 + Math.floor(rnd() * 3), ...(inner ? { inner: [l * 0.8, w * 0.8, h * 0.8] } : {}) };
};
const real = (pieces: number, nest: boolean) => ({ boxes, items: Array.from({ length: pieces }, (_, i) => thing(i, nest && i % 3 === 0)) });
const post = (body: string | object, path = "/api/solve", init: RequestInit = {}) => ({ path, init: { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body), ...init } });

type Job = { path: string; init: RequestInit; kind: string };
const kind = (k: string, j: { path: string; init: RequestInit }): Job => ({ ...j, kind: k });
const mixed = (i: number): Job => {
  const k = i % 4;
  return k === 0 ? kind("tiny", post(real(2, false))) : k === 1 ? kind("nested", post(real(8, true))) : k === 2 ? kind("medium", post(real(30, true))) : kind("health", { path: "/api/health", init: {} });
};
const bad = (i: number): Job => {
  switch (i % 12) {
    case 0: return kind("not json", post("{nope"));
    case 1: return kind("empty body", post(""));
    case 2: return kind("wrong shape", post({ boxes: 3, items: "x" }));
    case 3: return kind("zero size", post({ boxes, items: [{ name: "z", l: 0, w: 1, h: 1 }] }));
    case 4: return kind("negative", post({ boxes, items: [{ name: "n", l: -4, w: 1, h: 1 }] }));
    case 5: return i % 24 === 5 ? kind("too many boxes", post({ boxes: Array.from({ length: 31 }, (_, n) => ({ name: `b${n}`, l: 9, w: 9, h: 9 })), items: [{ name: "a", l: 1, w: 1, h: 1 }] })) : kind("too many pieces", post({ boxes, items: [{ name: "many", l: 1, w: 1, h: 1, qty: 100000 }] }));
    case 6: return kind("huge body", post("x".repeat(MAX_BODY + 1)));
    case 7: return kind("wrong method", { path: "/api/solve", init: { method: "GET" }, });
    case 8: return kind("unknown route", { path: `/api/${i}`, init: {} });
    case 9: return kind("float extremes", post({ boxes: [{ name: "b", l: 1e308, w: 1e308, h: 1e308 }], items: [{ name: "a", l: 1e-300, w: 1e-300, h: 1e-300, qty: 5 }] }));
    case 10: return kind("bad inner", post({ boxes, items: [{ name: "i", l: 2, w: 2, h: 2, inner: [5, 5, 5] }] }));
    default: return kind("real", post(real(6, true)));
  }
};

const server = serve(0, {});
const base = `http://localhost:${server.port}`;
const lat: number[] = [], status = new Map<string, number>(), by = new Map<string, number[]>();
let next = 0, fivexx = 0;
const rss0 = process.memoryUsage.rss();
const t0 = performance.now();
await Promise.all(Array.from({ length: C }, async () => {
  for (let i; (i = next++) < N; ) {
    const j = storm ? bad(i) : mixed(i);
    const s = performance.now();
    let code = 0;
    try { code = (await fetch(base + j.path, j.init)).status; } catch { code = -1; }
    const ms = performance.now() - s;
    lat.push(ms);
    (by.get(j.kind) ?? by.set(j.kind, []).get(j.kind)!).push(ms);
    status.set(String(code), (status.get(String(code)) ?? 0) + 1);
    if (code >= 500 || code < 0) fivexx++;
  }
}));
const secs = (performance.now() - t0) / 1000;
const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))]!.toFixed(1);
console.log(`${storm ? "error storm" : "mixed load"}: ${N} requests, ${C} at a time, ${secs.toFixed(2)}s => ${(N / secs).toFixed(0)} req/s`);
console.log(`latency ms  p50 ${pct(lat, 0.5)}  p95 ${pct(lat, 0.95)}  p99 ${pct(lat, 0.99)}  max ${Math.max(...lat).toFixed(1)}`);
console.log(`status      ${[...status].sort().map(([k, v]) => `${k}: ${v}`).join("  ")}`);
for (const [k, xs] of [...by].sort()) console.log(`  ${k.padEnd(16)} ${String(xs.length).padStart(5)}  p50 ${pct(xs, 0.5)}  p99 ${pct(xs, 0.99)}`);
const alive = await fetch(`${base}/api/health`).then((r) => r.ok).catch(() => false);
console.log(`memory      rss ${(rss0 / 1e6).toFixed(0)} -> ${(process.memoryUsage.rss() / 1e6).toFixed(0)} MB   still answering: ${alive}`);
server.stop(true);
process.exit(fivexx || !alive ? 1 : 0);
