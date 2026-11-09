// The pinned Agent Office release, unpacked into a temp dir for the patch tests; the first run downloads it into .cache.
// When GitHub's release downloads are down (5xx after the retries), the tests that need it skip with a note instead of
// failing the PR (#3950). A 404 still fails: that means the pin is wrong.
import { $ } from "bun";
import { beforeAll, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PINNED, ReleaseDown, releaseTarball } from "../scripts/release.ts";

const cache = path.join(import.meta.dir, "../.cache");
const tarball = () => releaseTarball(PINNED.tag, PINNED.sha256, cache);

/** Why the pinned release can't be had right now, or "" once it's in .cache. */
export const pinnedDown = await tarball().then(
  () => "",
  (e: unknown) => {
    if (!(e instanceof ReleaseDown)) throw e;
    console.warn(`skipping the pinned-release tests: ${e.message} (#3950)`);
    return e.message;
  },
);

/** `test`, skipped while the pinned release can't be downloaded. */
export const pinnedTest = pinnedDown ? test.skip : test;
/** `beforeAll`, left out while the pinned release can't be downloaded. */
export const beforePinned: typeof beforeAll = pinnedDown ? () => {} : beforeAll;

export async function unpackPinned() {
  const tgz = await tarball();
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
