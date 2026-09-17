// A small, valid 3D Gaussian Splatting PLY (the layout Brush, gsplat and
// SuperSplat read): a ring of colored gaussians. Used by tests and handy for
// checking the viewer without a real capture.
export function makeTestSplat(count = 2000): Uint8Array {
  const props = ["x", "y", "z", "nx", "ny", "nz", "f_dc_0", "f_dc_1", "f_dc_2", "opacity",
    "scale_0", "scale_1", "scale_2", "rot_0", "rot_1", "rot_2", "rot_3"];
  const header = [
    "ply", "format binary_little_endian 1.0", `element vertex ${count}`,
    ...props.map((p) => `property float ${p}`), "end_header", "",
  ].join("\n");
  const head = new TextEncoder().encode(header);
  const body = new DataView(new ArrayBuffer(count * props.length * 4));
  const SH_C0 = 0.28209479177387814;
  for (let i = 0; i < count; i++) {
    const t = (i / count) * Math.PI * 2;
    const r = [Math.cos(t) * 0.5 + 0.5, Math.sin(t) * 0.5 + 0.5, 0.6];
    const v = [
      Math.cos(t) * 2, Math.sin(t * 3) * 0.3, Math.sin(t) * 2, 0, 0, 0,
      (r[0]! - 0.5) / SH_C0, (r[1]! - 0.5) / SH_C0, (r[2]! - 0.5) / SH_C0,
      4, Math.log(0.03), Math.log(0.03), Math.log(0.03), 1, 0, 0, 0,
    ];
    v.forEach((x, j) => body.setFloat32((i * props.length + j) * 4, x, true));
  }
  const out = new Uint8Array(head.length + body.byteLength);
  out.set(head, 0);
  out.set(new Uint8Array(body.buffer), head.length);
  return out;
}

if (import.meta.main) {
  const path = process.argv[2] ?? "test-ring.ply";
  await Bun.write(path, makeTestSplat(Number(process.argv[3] ?? 2000)));
  console.log(`wrote ${path}`);
}
