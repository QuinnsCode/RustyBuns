// A lineup for judging the house look (docs/ART-STYLE.md): the named beasts' GLBs side by side in ONE picture, through
// one camera (three-quarter, orthographic) under one light (the close-ups', blender/closeups.py), at true relative
// scale, each with its name under it. Run from apps/mythic-masters:
//
//   bun proposals/house/lineup.ts <id> [id ...] [--out file.png] [--px 2400]
//
// Default out: blender/out/lineup.png. The beasts stand left to right in the order given; it reads the built
// public/models/<id>.glb, so build first (`bun scripts/beasts.ts <id>`). One Blender run for the whole lineup.
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { runBlender } from "@rustybuns/cli/blender";
import { obj, str } from "@rustybuns/util/guard";
import { help } from "../../../../scripts/help.ts";
import { queued } from "../../../../scripts/blender-queue.ts";

await queued(); // Blender runs on the builder Mac, one job at a time (scripts/blender-queue.ts)
const APP = join(import.meta.dir, "..", "..");
const Named = obj({ name: str(40) });

help(import.meta.path);
const argv = process.argv.slice(2);
const flag = (name: string) => { const i = argv.indexOf(name); return i < 0 ? undefined : argv[i + 1]; };
const out = resolve(flag("--out") ?? join(APP, "blender", "out", "lineup.png"));
const px = Number(flag("--px") ?? 2400);
const ids = argv.filter((a, i) => !a.startsWith("--") && argv[i - 1] !== "--out" && argv[i - 1] !== "--px");
if (!ids.length) { console.error("name at least one beast: bun proposals/house/lineup.ts hodag kelpie"); process.exit(1); }
if (!(Number.isInteger(px) && px >= 400 && px <= 6000)) { console.error("--px takes a width from 400 to 6000"); process.exit(1); }

const pairs: string[] = [];
for (const id of ids) {
  const glb = join(APP, "public", "models", `${id}.glb`), sheet = join(APP, "beasts", `${id}.json`);
  if (!existsSync(glb)) { console.error(`no ${glb}: build it first (bun scripts/beasts.ts ${id})`); process.exit(1); }
  const raw: unknown = existsSync(sheet) ? await Bun.file(sheet).json() : { name: id };
  pairs.push(glb, Named(raw).name);
}
mkdirSync(dirname(out), { recursive: true });
await runBlender({ script: join(import.meta.dir, "lineup.py"), args: [out, String(px), ...pairs], cwd: APP });
console.log(out);
