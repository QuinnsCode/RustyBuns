import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import { fetchLfs, pointerSize } from "./trial-lfs.ts";

const oid = "a".repeat(64);
const pointer = (size: number) => `version https://git-lfs.github.com/spec/v1\noid sha256:${oid}\nsize ${size}\n`;

test("pointerSize reads a pointer and nothing else", () => {
  expect(pointerSize(pointer(1234))).toBe(1234);
  expect(pointerSize("hello\n")).toBeUndefined();
  expect(pointerSize("version https://git-lfs.github.com/spec/v1\nsize 5\n")).toBeUndefined();
});

test("a repo with LFS pointers gets the real files, within the cap, and says which", async () => {
  const root = mkdtempSync(join(tmpdir(), "trial-lfs-"));
  mkdirSync(join(root, "public"));
  writeFileSync(join(root, ".gitattributes"), "*.jpg filter=lfs diff=lfs merge=lfs -text\n");
  writeFileSync(join(root, "public/sky 1.jpg"), pointer(4));
  writeFileSync(join(root, "public/big.jpg"), pointer(1000));
  writeFileSync(join(root, "public/readme.txt"), "plain\n");
  await $`git -C ${root} init -q && git -C ${root} add -A && git -C ${root} -c user.name=t -c user.email=t@t commit -qm x`.quiet();
  const urls: string[] = [];
  const get = (async (u: string) => { urls.push(u); return new Response("JPEG"); }) as unknown as typeof fetch;
  const lines = await fetchLfs("o/r", root, 500, get);
  expect(readFileSync(join(root, "public/sky 1.jpg"), "utf8")).toBe("JPEG");
  expect(readFileSync(join(root, "public/big.jpg"), "utf8")).toBe(pointer(1000));
  expect(readFileSync(join(root, "public/readme.txt"), "utf8")).toBe("plain\n");
  expect(urls).toHaveLength(1);
  expect(urls[0]).toMatch(/^https:\/\/media\.githubusercontent\.com\/media\/o\/r\/[0-9a-f]{40}\/public\/sky%201\.jpg$/);
  expect(lines.some((l) => l.startsWith("fetched public/sky 1.jpg"))).toBe(true);
  expect(lines.some((l) => l.startsWith("skipped public/big.jpg"))).toBe(true);
});
