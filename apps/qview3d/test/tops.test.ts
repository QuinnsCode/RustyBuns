// A picture keeps its shape on every top: in each print zone the cloth's stretch across (per unit of the zone's u,
// against its `width(v)`) matches its stretch up (against `height`), so a square sticker stays square. A tank's rows
// climb toward its armholes, and u measured along them once rounded a picture into an oval (#4591).
import { expect, test } from "bun:test";
import * as THREE from "three";

// The tops' cloth textures are drawn on canvases; geometry needs none of it.
const pen: object = new Proxy({}, { get: () => () => ({}) });
Object.assign(globalThis, { document: { createElement: () => ({ width: 0, height: 0, getContext: () => pen }) } });
const { buildTop, CUTS } = await import("../src/widget/tops.ts");

const MODELS = ["tee", "sweater", "hoodie", "tank", "racerback"] as const;

test.each([...MODELS])("a picture on the %s keeps its shape in every zone", (model) => {
  const g = buildTop(model);
  for (const z of g.zones) {
    // The stretch ratio, averaged over each sixteenth of the zone (a fold's single triangle is no fault).
    const cells = new Map<number, number[]>();
    for (const mesh of g.prints) {
      const P = mesh.geometry.getAttribute("position"), U = mesh.geometry.getAttribute("uv"), ix = mesh.geometry.getIndex()!;
      for (let k = 0; k < ix.count; k += 3) {
        const [a, b, c] = [ix.getX(k), ix.getX(k + 1), ix.getX(k + 2)];
        const uc = (U.getX(a) + U.getX(b) + U.getX(c)) / 3, vc = (U.getY(a) + U.getY(b) + U.getY(c)) / 3;
        if (uc < z.u0 || uc > z.u1 || vc < z.v0 || vc > z.v1) continue;
        const p = (i: number) => new THREE.Vector3(P.getX(i), P.getY(i), P.getZ(i));
        const e1 = p(b).sub(p(a)), e2 = p(c).sub(p(a));
        const du1 = U.getX(b) - U.getX(a), dv1 = U.getY(b) - U.getY(a), du2 = U.getX(c) - U.getX(a), dv2 = U.getY(c) - U.getY(a);
        const det = du1 * dv2 - du2 * dv1;
        if (Math.abs(det) < 1e-12) continue;
        const across = e1.clone().multiplyScalar(dv2).addScaledVector(e2, -dv1).divideScalar(det).length();
        const up = e2.clone().multiplyScalar(du1).addScaledVector(e1, -du2).divideScalar(det).length();
        const zu = (uc - z.u0) / (z.u1 - z.u0), zv = (vc - z.v0) / (z.v1 - z.v0);
        const ratio = (across / (z.width(zv) / (z.u1 - z.u0))) / (up / (z.height / (z.v1 - z.v0)));
        const key = Math.min(3, Math.floor(zv * 4)) * 4 + Math.min(3, Math.floor(zu * 4));
        cells.set(key, [...(cells.get(key) ?? []), ratio]);
      }
    }
    // 8%: a sweater's back zone reaches up where the half curves over the shoulder (0.93 there); the old tank was 1.26.
    expect(cells.size, `${model} ${z.name}`).toBe(16);
    for (const [key, rs] of cells) {
      const mean = rs.reduce((x, y) => x + y, 0) / rs.length;
      expect(Math.abs(mean - 1), `${model} ${z.name} quarter ${key}`).toBeLessThan(0.08);
    }
  }
});

// Seen from the front, a sleeved top's shoulder line rolls on into the sleeve: its slope barely turns at the shoulder
// tip. A shoulder still sloping there met the level top of the sleeve in a notch (#4642, a turn of 0.24).
test.each(["tee", "sweater", "hoodie"] as const)("the %s's shoulder rolls into its sleeve", (model) => {
  const g = buildTop(model), W = 0.01, top = new Map<number, number>();
  for (const mesh of g.prints) {
    const P = mesh.geometry.getAttribute("position"), ix = mesh.geometry.getIndex()!;
    for (let k = 0; k < ix.count; k += 3) {
      const v = [ix.getX(k), ix.getX(k + 1), ix.getX(k + 2)];
      if (Math.max(...v.map((i) => P.getX(i))) < 0.3) continue;
      // Sample each triangle, so the outline is the cloth's and not just its vertices'.
      for (let a = 0; a <= 10; a++) for (let b = 0; a + b <= 10; b++) {
        const w = [a / 10, b / 10, (10 - a - b) / 10];
        const x = w.reduce((s, q, j) => s + q * P.getX(v[j]!), 0), y = w.reduce((s, q, j) => s + q * P.getY(v[j]!), 0);
        const bin = Math.round(x / W);
        top.set(bin, Math.max(top.get(bin) ?? -Infinity, y));
      }
    }
  }
  const tip = Math.round(((0.47 + 0.05) * CUTS[model].ease) / W), y = (k: number) => top.get(k)!;
  const inside = (y(tip - 4) - y(tip)) / (4 * W), outside = (y(tip) - y(tip + 4)) / (4 * W);
  expect(Math.abs(outside - inside), model).toBeLessThan(0.08);
});
