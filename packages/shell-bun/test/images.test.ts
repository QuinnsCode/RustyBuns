import { expect, test } from "bun:test";
import { images } from "../src/bindings/images.ts";

const png = (w: number, h: number) => {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const v = new DataView(b.buffer);
  v.setUint32(16, w); v.setUint32(20, h);
  return b;
};
// SOI, an APP0 segment to skip, then SOF0 with height 300, width 400.
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 17, 8, 0x01, 0x2c, 0x01, 0x90, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
const gif = new Uint8Array([...new TextEncoder().encode("GIF89a"), 10, 0, 20, 0, 0, 0, 0]);
const stream = (b: Uint8Array<ArrayBuffer>) => new Response(b).body!;

test("images: info reads format and size from the header", async () => {
  const img = images();
  expect(await img.info(stream(png(640, 480)))).toEqual({ format: "image/png", width: 640, height: 480, fileSize: 33 });
  expect(await img.info(stream(jpeg))).toMatchObject({ format: "image/jpeg", width: 400, height: 300 });
  expect(await img.info(gif)).toMatchObject({ format: "image/gif", width: 10, height: 20 });
  expect(await img.info(stream(new TextEncoder().encode('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"/>')))).toEqual({ format: "image/svg+xml" });
  await expect(img.info(stream(new TextEncoder().encode("hello")))).rejects.toThrow(/9412/);
});

test("images: transforms pass the original through with its own content type", async () => {
  const src = png(2, 2);
  const res = (await images().input(stream(src)).transform({ width: 1 }).draw(stream(gif)).output({ format: "image/webp", quality: 50 })).response();
  expect(res.headers.get("content-type")).toBe("image/png");
  expect(new Uint8Array(await res.arrayBuffer())).toEqual(src);
});
