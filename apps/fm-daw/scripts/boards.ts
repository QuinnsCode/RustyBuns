// Renders every Q Amp board (`circuits/*.tsx`) to the circuit JSON the solver reads
// and the schematic and PCB SVGs the board view shows. Run it after editing a board:
//   bun scripts/boards.ts            every board
//   bun scripts/boards.ts dist fuzz  just these
// tscircuit is parked in this repo (it pins zod 3, see apps/tscircuit-desktop), so
// this installs it once into a cache folder outside the workspace and renders there
// (circuits/render.tsx). The app and its tests read only the files it writes.
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { help } from "../../../scripts/help.ts";

help(import.meta.path);

const TSCIRCUIT = "0.0.2565";
const here = join(import.meta.dir, "..", "circuits");
const cache = join(homedir(), ".cache", "rustybuns", `tscircuit-${TSCIRCUIT}`);

if (!existsSync(join(cache, "node_modules", "tscircuit"))) {
  mkdirSync(cache, { recursive: true });
  await Bun.write(join(cache, "package.json"), JSON.stringify({ name: "fm-daw-boards", private: true, type: "module" }));
  console.log(`installing tscircuit ${TSCIRCUIT} into ${cache}`);
  const add = Bun.spawnSync(["bun", "add", `tscircuit@${TSCIRCUIT}`, "react@19.3.1"], { cwd: cache, stdout: "inherit", stderr: "inherit" });
  if (add.exitCode !== 0) process.exit(add.exitCode ?? 1);
}
await Bun.write(join(cache, "render.tsx"), Bun.file(join(here, "render.tsx")));

const asked = process.argv.slice(2);
const boards = readdirSync(here).filter((f) => f.endsWith(".tsx") && f !== "render.tsx").map((f) => f.slice(0, -4)).filter((b) => !asked.length || asked.includes(b));
let failed = 0;
for (const b of boards) {
  // A copy beside render.tsx, so the board's JSX resolves tscircuit's react from the cache.
  await Bun.write(join(cache, `${b}.tsx`), Bun.file(join(here, `${b}.tsx`)));
  const run = Bun.spawnSync(["bun", "render.tsx", `./${b}.tsx`, join(here, b)], { cwd: cache, stdout: "inherit", stderr: "inherit" });
  if (run.exitCode !== 0) failed++;
}
if (failed) { console.error(`${failed} board(s) failed`); process.exit(1); }
