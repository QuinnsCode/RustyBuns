// The pinned Agent Office release, unpacked into a temp dir for the patch tests; the first run downloads it into .cache.
import { $ } from "bun";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PINNED, releaseTarball } from "../scripts/release.ts";

export async function unpackPinned() {
  const tgz = await releaseTarball(PINNED.tag, PINNED.sha256, path.join(import.meta.dir, "../.cache"));
  const dir = mkdtempSync(path.join(tmpdir(), "rb-pinned-"));
  await $`tar -xzf ${tgz} -C ${dir}`.quiet();
  return path.join(dir, "package");
}

/** The client chunk the boards and prompt settings live in. */
export function askOf(pkg: string) {
  const [ask] = [...new Bun.Glob("dist/public/assets/ask-*.js").scanSync({ cwd: pkg })];
  return path.join(pkg, ask!);
}

export const read = (file: string) => readFileSync(file, "utf8");
