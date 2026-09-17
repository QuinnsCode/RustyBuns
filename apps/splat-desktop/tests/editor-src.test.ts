// SuperSplat reads ?load= with URLSearchParams and then decodes once more
// (main.ts). Replay that exact sequence and check we get the file URL back,
// for names with spaces, percent signs and unicode.
import { test, expect } from "bun:test";
import { editorSrc } from "../src/editorBridge.ts";
import { fileUrl } from "../src/api.ts";

const asSuperSplatReadsIt = (src: string) => {
  const url = new URL(src, "http://local");
  return { load: url.searchParams.getAll("load").map(decodeURIComponent), filename: url.searchParams.getAll("filename").map(decodeURIComponent) };
};

for (const path of ["ring.ply", "captures/second ring.ply", "nested/100% done.spz", "café/シーン #1.sog"]) {
  test(`round trip: ${path}`, () => {
    const scene = { path, name: path.split("/").pop()!, bytes: 1, modified: 0 };
    const got = asSuperSplatReadsIt(editorSrc(scene));
    expect(got.load).toEqual([fileUrl(path)]);
    expect(got.filename).toEqual([scene.name]);
    // and the host can map the URL back to the file
    expect(decodeURIComponent(new URL(got.load[0]!, "http://local").pathname.slice("/files/".length))).toBe(path);
  });
}

test("no scene: plain editor", () => {
  expect(editorSrc(null)).toBe("/editor/");
});
