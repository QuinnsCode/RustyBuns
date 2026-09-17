// bun scripts/build-editor.ts
//
// Builds SuperSplat, unmodified, from a pinned commit and places it at
// dist/ui/editor (served at /editor/ and embedded in the binary). Then writes
// the third-party license notices for the shell and the editor.
//
// To update SuperSplat: change SUPERSPLAT_COMMIT, run `bun run build`,
// and run `bun test` (it checks the editor still exposes the hook we use).
import { $ } from "bun";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { collectNotices, writeNotices } from "./licenses.ts";

export const SUPERSPLAT_REPO = "https://github.com/playcanvas/supersplat";
export const SUPERSPLAT_COMMIT = "3ab7965632864a1ed9cf241b23db5a151279996f";

const APP = join(import.meta.dir, "..");
const VENDOR = join(APP, ".vendor", "supersplat");
const OUT = join(APP, "dist", "ui", "editor");

async function checkout() {
  if (existsSync(join(VENDOR, ".git"))) {
    const head = (await $`git -C ${VENDOR} rev-parse HEAD`.quiet().text()).trim();
    if (head === SUPERSPLAT_COMMIT) return false;
  } else {
    mkdirSync(VENDOR, { recursive: true });
    await $`git -C ${VENDOR} init -q`;
    await $`git -C ${VENDOR} remote add origin ${SUPERSPLAT_REPO}`;
  }
  console.log(`editor: fetching SuperSplat ${SUPERSPLAT_COMMIT.slice(0, 7)}`);
  await $`git -C ${VENDOR} fetch -q --depth 1 origin ${SUPERSPLAT_COMMIT}`;
  await $`git -C ${VENDOR} checkout -q --force FETCH_HEAD`;
  return true;
}

const changed = await checkout();
if (changed || !existsSync(join(VENDOR, "node_modules"))) {
  console.log("editor: installing SuperSplat dependencies");
  await $`bun install`.cwd(VENDOR).quiet();
}
const built = join(VENDOR, "dist", "index.html");
if (changed || !existsSync(built)) {
  console.log("editor: building SuperSplat (about a minute)");
  await $`bun run build`.cwd(VENDOR).env({ ...process.env, BASE_HREF: "/editor/", BUILD_TYPE: "release" }).quiet();
}
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
cpSync(join(VENDOR, "dist"), OUT, { recursive: true, filter: (src) => !src.endsWith(".map") });
console.log(`editor: SuperSplat ${SUPERSPLAT_COMMIT.slice(0, 7)} -> dist/ui/editor`);

const notices = await collectNotices();
writeNotices(notices.text, [join(APP, "dist", "ui"), join(APP, "dist")]);
console.log(notices.summary);
if (notices.flagged.length && process.env.LICENSES_STRICT) {
  console.error(`${notices.flagged.length} component(s) need a license review`);
  process.exit(1);
}
