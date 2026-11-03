// A stand-in product for ?demo=1: a shoebox-sized carton as a .splat file built in the page, so the viewer
// can be seen (and probed) without a capture. The .splat layout is 32 bytes a splat: position (3 floats),
// scale (3 floats), colour RGBA (4 bytes), rotation quaternion (4 bytes, 128 = 0).

const W = 0.33, H = 0.12, D = 0.2; // metres
const STEP = 0.006;

export function demoCarton(): ArrayBuffer {
  const pts: Array<[number, number, number, number, number, number]> = [];
  const face = (n: [number, number, number], u: [number, number, number], v: [number, number, number], su: number, sv: number) => {
    for (let a = -su / 2; a <= su / 2; a += STEP) {
      for (let b = -sv / 2; b <= sv / 2; b += STEP) {
        const p = [0, 1, 2].map((k) => n[k]! + u[k]! * a + v[k]! * b) as [number, number, number];
        // Kraft brown, an orange band round the middle and a dark label on the top.
        const band = Math.abs(p[1]) < H * 0.12 && n[1] === 0;
        const label = n[1] > 0 && Math.abs(a) < su * 0.3 && Math.abs(b) < sv * 0.18;
        const shade = 0.9 + 0.1 * Math.sin(a * 900) * Math.sin(b * 700);
        const [r, g, bl] = label ? [40, 42, 46] : band ? [242, 92, 5] : [196 * shade, 150 * shade, 104 * shade];
        pts.push([p[0], p[1], p[2], r, g, bl]);
      }
    }
  };
  face([0, 0, D / 2], [1, 0, 0], [0, 1, 0], W, H);
  face([0, 0, -D / 2], [1, 0, 0], [0, 1, 0], W, H);
  face([W / 2, 0, 0], [0, 0, 1], [0, 1, 0], D, H);
  face([-W / 2, 0, 0], [0, 0, 1], [0, 1, 0], D, H);
  face([0, H / 2, 0], [1, 0, 0], [0, 0, 1], W, D);
  face([0, -H / 2, 0], [1, 0, 0], [0, 0, 1], W, D);

  const buf = new ArrayBuffer(pts.length * 32);
  const f = new Float32Array(buf), u = new Uint8Array(buf);
  pts.forEach(([x, y, z, r, g, b], i) => {
    // y-down, like most capture tools write, so the viewer's upright turn is exercised.
    f.set([x, -y, z, STEP * 0.6, STEP * 0.6, STEP * 0.6], i * 8);
    u.set([r, g, b, 255, 255, 128, 128, 128], i * 32 + 24);
  });
  return buf;
}
