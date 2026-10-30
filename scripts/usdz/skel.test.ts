import { expect, test } from "bun:test";
import { exportBeast } from "./beasts.ts";
import { jointPaths, usdz } from "./skel.ts";

const dir = "apps/mythic-masters/public/models";

test("a beast comes out as a USDZ whose file data starts on a 64-byte boundary and keeps its CRC", async () => {
  const bytes = await exportBeast(await Bun.file(`${dir}/yeti.glb`).arrayBuffer(), await Bun.file(`${dir}/yeti.rig.json`).json(), "yeti");
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  expect(v.getUint32(0, true)).toBe(0x04034b50);
  const nameLen = v.getUint16(26, true), extraLen = v.getUint16(28, true), size = v.getUint32(22, true);
  const start = 30 + nameLen + extraLen;
  expect(start % 64).toBe(0);
  const data = bytes.subarray(start, start + size);
  expect(Bun.hash.crc32(data) >>> 0).toBe(v.getUint32(14, true));

  const usda = new TextDecoder().decode(data);
  const rig = await Bun.file(`${dir}/yeti.rig.json`).json();
  const joints = /uniform token\[\] joints = \[(.*)\]/.exec(usda)![1]!.split(", ");
  expect(joints.length).toBe(Buffer.from(rig.parents, "base64").length / 4);
  expect(usda.match(/def Mesh /g)!.length).toBeGreaterThan(0);
});

test("joint paths nest under their parents, even when a child is listed before its parent", () => {
  expect(jointPaths([-1, 0, 1, 0])).toEqual(["j0", "j0/j1", "j0/j1/j2", "j0/j3"]);
  expect(jointPaths([2, 0, -1])).toEqual(["j2/j0", "j2/j0/j1", "j2"]);
});

test("every file in a USDZ is aligned, whatever came before it", () => {
  const files = ["a.usda", "longer-name.usda", "x"].map((name, i) => ({ name, data: new Uint8Array(i * 37 + 5).fill(i) }));
  const bytes = usdz(files);
  const v = new DataView(bytes.buffer);
  let at = 0;
  for (const f of files) {
    expect(v.getUint32(at, true)).toBe(0x04034b50);
    const start = at + 30 + v.getUint16(at + 26, true) + v.getUint16(at + 28, true);
    expect(start % 64).toBe(0);
    at = start + f.data.length;
  }
});
