import { join } from "node:path";
const app = process.argv[2]!;
const sim = await import(join(app, "src/sim.ts"));
const lv = await import(join(app, "src/level.ts"));
const pcs = await import(join(app, "src/levels/pieces.ts"));
const { DT, IDLE, start, step } = sim;
const B = { minX: -2000, maxX: 2000, minZ: -2000, maxZ: 2000 };
const mk = (o: any) => lv.makeLevel({ name: "p", pieces: [], rails: [], spawns: [], bounds: B, ...o });
const out: any = {};
// 1. held W in halfpipe from half-wall speed: walls to reach coping
{
  const hp = pcs.halfpipe({ x: 0, z: 0 }, { w: 20, d: 40, h: 3 }); const level = mk({ pieces: hp.pieces });
  const h = Math.max(...hp.rails.map((r: any) => r.y));
  for (const mode of ["heldW", "wallsOnly"]) {
    const s = Object.assign(start(0, 0, Math.PI / 2, level), { speed: Math.sqrt(2 * 20 * 0.5 * h) });
    const peaks: number[] = []; let side = 0, pk = 0, bails = 0;
    for (let i = 0; i < 20 / DT; i++) {
      const thr = mode === "heldW" ? 1 : (Math.abs(s.x) > 4 && s.y < 0.85 * h ? 1 : 0);
      step(s, { ...IDLE, throttle: thr }, level); if (s.bail > 0 && s.last?.name?.startsWith("Bail")) bails++;
      const w = Math.abs(s.x) > 5 ? Math.sign(s.x) : 0;
      if (w && w !== side) { if (side) peaks.push(+pk.toFixed(2)); side = w; pk = 0; } if (w) pk = Math.max(pk, s.y);
    }
    out[mode] = { h, peaks: peaks.slice(0, 10), firstCoping: peaks.findIndex((p) => p >= h) + 1 };
  }
}
// 2. push up a slope from rest
for (const deg of [3, 6, 10, 15]) {
  const d = 60, h1 = d * Math.tan(deg * Math.PI / 180);
  const level = mk({ pieces: [lv.piece("ramp", "hill", 0, 40, 0, 40, d, 0, h1)] });
  const s = start(0, 0, 0, level); let maxY = 0;
  for (let i = 0; i < 12 / DT; i++) { step(s, { ...IDLE, throttle: 1 }, level); maxY = Math.max(maxY, s.y); }
  out[`climb${deg}deg`] = { maxY: +maxY.toFixed(2), top: +h1.toFixed(2), speedEnd: +s.speed.toFixed(2) };
  // also start on the slope from rest
  const s2 = start(0, 30, 0, level); for (let i = 0; i < 4 / DT; i++) step(s2, { ...IDLE, throttle: 1 }, level);
  out[`startOn${deg}deg`] = { dz: +(s2.z - 30).toFixed(2), speed: +s2.speed.toFixed(2) };
}
// 3. kicker gap: kicker at z=20, landing box after a gap
{
  const k = pcs.kicker({ x: 0, z: 20 }, {}); const box = lv.piece("box", "land", 0, 40, 0, 10, 12, 1.5, 1.5);
  const level = mk({ pieces: [...k.pieces, box] });
  for (const thr of [1]) {
    const s = start(0, 0, 0, level); let maxY = 0, landedOnBox = false, bail = "";
    for (let i = 0; i < 5 / DT; i++) { step(s, { ...IDLE, throttle: 1, jump: s.z > 23 && s.z < 23.5 }, level); maxY = Math.max(maxY, s.y); if (!s.air && s.z > 34 && s.z < 46 && s.y > 1.4) landedOnBox = true; if (s.last?.name?.startsWith("Bail")) bail = s.last.name; }
    out.kickerGap = { maxY: +maxY.toFixed(2), landedOnBox, bail, z: +s.z.toFixed(1) };
  }
}
// 4. grind at low speeds: drop on rail, steer to balance
for (const v of [2, 4, 8, 16]) {
  const level = mk({ rails: [{ kind: "rail", a: { x: 0, z: 0 }, b: { x: 0, z: 60 }, y: 0.9 }] });
  const s = start(0, 2, 0, level); Object.assign(s, { air: true, y: 1.0, vy: -1, vz: v, speed: v });
  let ground = 0, onRail = 0, names: string[] = [], reGrab = 0, wasOff = false;
  for (let i = 0; i < 6 / DT; i++) {
    step(s, { ...IDLE, steer: Math.max(-1, Math.min(1, s.balance * 2)) }, level);
    if (s.grind >= 0) { onRail += DT; if (wasOff) reGrab++; } else if (onRail > 0) wasOff = true;
    if (s.last && names.at(-1) !== s.last.name) names.push(s.last.name);
  }
  out[`grind${v}`] = { onRail: +onRail.toFixed(2), reGrab, names, y: +s.y.toFixed(2), x: +s.x.toFixed(2), speed: +s.speed.toFixed(2), air: s.air };
}
// 5. flips land from push top
{
  const level = mk({});
  const { TRICKS } = await import(join(app, "src/tricks.ts"));
  const res: Record<string, string> = {};
  for (const f of Object.keys(TRICKS)) {
    const s = start(0, 0, 0, level); for (let i = 0; i < 3 / DT; i++) step(s, { ...IDLE, throttle: 1 }, level);
    step(s, { ...IDLE, jump: true }, level); step(s, { ...IDLE }, level); step(s, { ...IDLE, flick: f }, level);
    for (let i = 0; i < 3 / DT; i++) step(s, { ...IDLE }, level);
    res[f] = (s.last?.name ?? "") + (s.tricks?.length ? "" : "");
  }
  out.flips = res;
}
console.log(JSON.stringify(out));
