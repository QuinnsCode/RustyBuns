// Physics judge for Skate Tech Park: runs fixed headless rides and scores them against reference.json.
// bun score.ts [path to a RustyBuns checkout or to apps/skate-tech-park] [--json]
// Froude scaling: lengths in board lengths L, times in sqrt(L/g), speeds in sqrt(gL), accelerations in g.
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const DEFAULT = resolve(import.meta.dir, "../..");
const arg = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? DEFAULT;
const app = existsSync(join(arg, "src/sim.ts")) ? resolve(arg) : resolve(arg, "apps/skate-tech-park");
const sim = await import(join(app, "src/sim.ts"));
const lv = await import(join(app, "src/level.ts"));
const pcs = await import(join(app, "src/levels/pieces.ts"));
const ref = JSON.parse(readFileSync(join(import.meta.dir, "reference.json"), "utf8"));

const { DT, IDLE, start, step } = sim;
type S = ReturnType<typeof start>;
const BOUNDS = { minX: -2000, maxX: 2000, minZ: -2000, maxZ: 2000 };
const flat = lv.makeLevel({ name: "judge-flat", pieces: [], rails: [], spawns: [], bounds: BOUNDS });
const L = 2 * lv.BOARD.halfLen;
const run = (s: S, inp: object, level = flat) => step(s, { ...IDLE, ...inp }, level);

// gravity, measured: drop the board from high over flat ground
const G = (() => {
  const s = Object.assign(start(0, 0, 0, flat), { air: true, y: 500, vy: 0 });
  for (let i = 0; i < 30; i++) run(s, {});
  return -s.vy / (30 * DT);
})();
const t0 = Math.sqrt(L / G), v0 = Math.sqrt(G * L);

const at = (v: number) => Object.assign(start(0, 0, 0, flat), { speed: v });

function ollie() {
  const s = at(1.07 * v0); // 3 m/s real
  for (let i = 0; i < 30; i++) run(s, {});
  const before = s.speed;
  run(s, { jump: true });
  let n = 0;
  while (s.air && n < 1000) { run(s, {}); n++; }
  const air = s.airTime;
  run(s, {});
  return { ollieAir: air / t0, rollAway: s.speed / before };
}

function flip() {
  const s = at(1.07 * v0);
  run(s, { jump: true }); run(s, {});
  run(s, { flick: "kickflip" });
  let n = 1;
  while (s.air && !s.tricks.includes("kickflip") && n < 1000) { run(s, {}); n++; }
  return { flipTime: s.tricks.includes("kickflip") ? (n * DT) / t0 : sim.flickTime("kickflip") / t0 };
}

function coast() {
  const s = at(1.428 * v0);
  let d = 0;
  for (let i = 0; i < 600 / DT && Math.abs(s.speed) > 0.01; i++) { const z = s.z; run(s, {}); d += s.z - z; }
  return { coastDistance: d / L };
}

function push() {
  const s = at(0);
  let top = 0, half = -1;
  const speeds: number[] = [];
  for (let i = 0; i < 40 / DT; i++) { run(s, { throttle: 1 }); speeds.push(s.speed); top = Math.max(top, s.speed); }
  half = speeds.findIndex((v) => v >= top / 2);
  return { pushTop: top / v0, pushAccel: top / 2 / ((half + 1) * DT) / G };
}

function carve() {
  const s = at(0);
  for (let i = 0; i < 40 / DT; i++) run(s, { throttle: 1 });
  for (let i = 0; i < 1 / DT; i++) run(s, { throttle: 1, steer: 1 });
  const y0 = s.yaw, n = Math.round(1 / DT);
  let v = 0;
  for (let i = 0; i < n; i++) { run(s, { throttle: 1, steer: 1 }); v += s.speed / n; }
  const lat = (v * (s.yaw - y0)) / (n * DT) / G;
  const k = at(0.536 * v0); // 1.5 m/s real
  run(k, { steer: 1 }); run(k, { steer: 1 });
  const ky = k.yaw, m = Math.round(0.25 / DT);
  let kv = 0;
  for (let i = 0; i < m; i++) { run(k, { steer: 1 }); kv += k.speed / m; }
  const rate = (k.yaw - ky) / (m * DT);
  return { carveLateral: lat, carveRadiusSlow: kv / rate / L };
}

function grind() {
  const rail = { kind: "rail" as const, a: { x: 0, z: 0 }, b: { x: 0, z: 400 }, y: 1.5 };
  const level = lv.makeLevel({ name: "judge-rail", pieces: [], rails: [rail], spawns: [], bounds: BOUNDS });
  const v = 1.428 * v0;
  const s = Object.assign(start(0, 5, 0, level), { air: true, y: 1.6, vx: 0, vz: v, vy: -0.5, speed: v, airTime: 0.5 });
  for (let i = 0; i < 10 && s.grind < 0; i++) step(s, { ...IDLE }, level);
  if (s.grind < 0) return { grindKeep: NaN };
  const z0 = s.z, entry = s.speed;
  while (s.grind >= 0 && s.z - z0 < 3 * L) step(s, { ...IDLE, steer: Math.max(-1, Math.min(1, s.balance * 2)) }, level);
  return { grindKeep: s.grind >= 0 || s.bail <= 0 ? s.speed / entry : NaN };
}

function pipe(rider: (s: S, h: number) => object, secs: number, speed?: number) {
  const hp = pcs.halfpipe({ x: 0, z: 0 }, { w: 20, d: 40, h: 3 });
  const level = lv.makeLevel({ name: "judge-pipe", pieces: hp.pieces, rails: [], spawns: [], bounds: BOUNDS });
  const h = Math.max(...hp.rails.map((r: { y: number }) => r.y));
  const s = Object.assign(start(0, 0, Math.PI / 2, level), { speed: speed ?? Math.sqrt(2 * G * 0.5 * h) });
  const peaks: number[] = [];
  let side = 0, peak = 0;
  for (let i = 0; i < secs / DT; i++) {
    step(s, { ...IDLE, ...rider(s, h) }, level);
    const w = Math.abs(s.x) > 5 ? Math.sign(s.x) : 0;
    if (w && w !== side) { if (side) peaks.push(peak); side = w; peak = 0; }
    if (w) peak = Math.max(peak, s.y);
  }
  if (side) peaks.push(peak);
  return { peaks, h };
}

function halfpipe() {
  const idle = pipe(() => ({}), 12).peaks.slice(0, 4);
  const decay = idle.length > 1 ? (idle[idle.length - 1]! / idle[0]!) ** (1 / (idle.length - 1)) : NaN;
  // a rider pumping the walls only: legs held on the transitions (where the game's push turns into a pump), never on the flat bottom, and let go near the coping
  const pumped = pipe((s, h) => ({ throttle: Math.abs(s.x) > 4 && s.y < 0.85 * h ? 1 : 0 }), 15);
  // gain on the first wall: the ride starts at the bottom with just enough speed for half the wall
  const gain = pumped.peaks.length ? Math.min(pumped.peaks[0]!, pumped.h) / (0.5 * pumped.h) : NaN; // capped at the coping: past it the rider let go
  // sustained vert: the repo's own vert journey (in at 18 m/s, push held), best air over the coping
  const vert = pipe(() => ({ throttle: 1 }), 15, 18);
  const best = Math.max(...vert.peaks);
  return { pipeDecay: decay, pumpGain: gain, vertAir: Math.max(0, best - vert.h) / vert.h, _peaksIdle: idle, _peaksPumped: pumped.peaks.slice(0, 8), _peaksVert: vert.peaks.slice(0, 8) };
}

const game: Record<string, number | number[]> = { ...ollie(), ...flip(), ...coast(), ...push(), ...carve(), ...grind(), ...halfpipe() };
const score = (x: number, t: number, tol: number) => (!Number.isFinite(x) ? 0 : Math.max(0, Math.min(100, 100 * (1 - (Math.abs(x - t) - tol) / (2 * tol)))));
const rows = Object.entries(ref.metrics as Record<string, { target: number; tol: number; unit: string; weight: number; kind: string }>).map(([k, m]) => {
  const x = game[k] as number;
  return { metric: k, target: m.target, tol: m.tol, game: Number.isFinite(x) ? +x.toFixed(3) : null, score: Math.round(score(x, m.target, m.tol)), weight: m.weight, kind: m.kind, unit: m.unit };
});
const total = rows.reduce((n, r) => n + r.score * r.weight, 0) / rows.reduce((n, r) => n + r.weight, 0);
if (process.argv.includes("--json")) console.log(JSON.stringify({ app, G, L, t0, v0, rows, total, raw: game }, null, 2));
else {
  console.log(`judge: ${app}\nscale: L ${L} m, g ${G.toFixed(2)}, t0 ${t0.toFixed(3)} s, v0 ${v0.toFixed(2)} m/s\n`);
  console.log("metric".padEnd(16) + "target".padStart(8) + "  +/-".padEnd(8) + "game".padStart(8) + "score".padStart(7) + "  w   kind");
  for (const r of rows) console.log(r.metric.padEnd(16) + String(r.target).padStart(8) + `  ${r.tol}`.padEnd(8) + String(r.game ?? "n/a").padStart(8) + String(r.score).padStart(7) + `  ${String(r.weight).padEnd(3)} ${r.kind}`);
  console.log(`\nweighted total: ${total.toFixed(1)} / 100`);
  console.log(`pipe peaks idle ${(game._peaksIdle as number[]).map((p) => p.toFixed(2)).join(" ")} | wall-pumped ${(game._peaksPumped as number[]).map((p) => p.toFixed(2)).join(" ")} | vert ${(game._peaksVert as number[]).map((p) => p.toFixed(2)).join(" ")} (coping 6)`);
}
