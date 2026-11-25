// Speaker boxes from their plans: each plan lands on its textbook numbers (and the bookshelf on the tuning its builders
// measure), the curve falls at the slope its alignment says, and what the walls are made of and how they are braced
// moves where they ring and how loud.
import { expect, test } from "bun:test";
import { BoxFilter, PLANS, boxCurve, cutList, design, lowCut, material, panelMode, plan, portLength, portTuning, sealed, woofer, type Plan } from "../src/index.ts";

const near = (what: string, v: number, want: number, tol: number) => expect([what, Math.abs(v - want) <= tol ? "ok" : v]).toEqual([what, "ok"]);

test("each plan lands on its numbers", () => {
  const shelf = design(plan("bookshelf-vented")), sub = design(plan("sub-sealed-12")), pipe = design(plan("pipe-fullrange-8"));
  // Builders of the 9 x 6 x 8 3/8 in kit with its 6 in port report 4.5 L tuned to 58 Hz.
  near("bookshelf fb", shelf.tune, 58, 4);
  expect(shelf.portSpeed).toBeLessThan(17);
  // The 12" in about 35 L: Qtc 0.39 sqrt(1 + 84.1/Vb) near 0.72, fc near 45 Hz.
  near("sub Qtc", sub.q, 0.72, 0.03);
  near("sub fc", sub.tune, 45, 2);
  // A 2.3 m pipe is a quarter wave at about 37 Hz, a little under the 8"'s Fs of 42.
  near("pipe tune", pipe.tune, 37, 1.5);
  for (const p of PLANS) {
    const d = design(p);
    for (const s of d.series) expect(s.a0 > 0 && s.a1 > 0).toBe(true);
    expect(cutList(p).reduce((n, c) => n + c.n, 0)).toBeGreaterThanOrEqual(6);
    expect(Array.from(boxCurve(p, [1000]))[0]).toBeGreaterThan(-1);
  }
});

test("sealed, vented and port math agree with the closed forms", () => {
  const d = woofer(plan("sub-sealed-12"));
  // Butterworth: a box that makes Qtc 0.707 is down 3 dB right at fc.
  const vb = d.vas / ((0.7071 / d.qts) ** 2 - 1), s = sealed(d, vb);
  near("Qtc", s.qtc, 0.7071, 1e-4);
  near("f3 = fc", s.f3, s.fc, 0.05);
  // The port length for a tuning gives that tuning back.
  near("port round trip", portTuning(0.03, 0.075, portLength(0.03, 32, 0.075)), 32, 1e-9);
  // Below tuning, a sealed box falls 12 dB an octave and a vented one 24.
  const slope = (p: Plan, f: number) => { const [a, b] = boxCurve(p, [f, 2 * f]); return b - a; };
  near("sealed slope", slope(plan("sub-sealed-12"), 6), 12, 0.8);
  near("vented slope", slope(plan("bookshelf-vented"), 8), 24, 1.5);
  // A 2 mm aluminium plate 300 x 200 mm, simply supported: f11 = (pi/2) sqrt(D/rho h)(1/a^2 + 1/b^2), D = 51.6 N m, sqrt(D / 5.4 kg/m2) = 3.09: 175 Hz.
  near("plate f11", panelMode(material("aluminium"), 0.002, 0.3, 0.2), 175.4, 0.2);
});

test("walls: a brace raises the mode and quiets it, and the material sets how long it rings", () => {
  const base = plan("bookshelf-vented"), sideOf = (p: Plan) => design(p).walls.find((w) => w.id === "left")!;
  const braced = sideOf({ ...base, braces: 1 }), bare = sideOf(base);
  expect(braced.hz).toBeGreaterThan(bare.hz * 1.5);
  expect(braced.leak).toBeLessThan(bare.leak / 2);
  const ring = (m: string) => sideOf({ ...base, material: m }).ring;
  expect(ring("aluminium")).toBeGreaterThan(ring("mdf") * 20);
  expect(ring("damped-mdf")).toBeLessThan(ring("mdf") / 3);
  // A thin, ringing wall shows in the response as a dip and a bump at its mode, and the cone alone has none.
  const d = design({ ...base, material: "aluminium" }), f = [0.9, 1, 1.1].map((k) => k * d.walls[2].hz);
  const curve = boxCurve({ ...base, material: "aluminium" }, f);
  expect(Math.max(...curve) - Math.min(...curve)).toBeGreaterThan(1);
});

test("the filter plays what the curve says", () => {
  for (const p of PLANS) {
    const d = design(p), sr = 48000;
    for (const hz of [lowCut(d) * 2, 400]) {
      const n = sr, buf = Float64Array.from({ length: n }, (_, i) => Math.sin((2 * Math.PI * hz * i) / sr));
      new BoxFilter(d, sr).process(buf);
      let peak = 0;
      for (let i = n / 2; i < n; i++) peak = Math.max(peak, Math.abs(buf[i]));
      near(`${p.id} at ${hz.toFixed(0)} Hz`, 20 * Math.log10(peak), boxCurve(p, [hz])[0], 0.5);
    }
  }
});
