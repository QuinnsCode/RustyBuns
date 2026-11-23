// Fetches the gear room's lounge furniture (src/room/lounge.ts) from Poly Haven, all CC0: each model's 1k glTF set,
// every texture shrunk to 512 px with macOS `sips` (JPEG quality 70), into public/lounge/<id>/. Run it again only to
// add or swap a model: the files are committed. `bun scripts/lounge-models.ts [id ...]` (no ids: every model in MODELS).
import { mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { help } from "../../../scripts/help.ts";
import { check, num, obj, opt, rec, str } from "@rustybuns/util/guard";
import { LOUNGE_MODELS } from "../src/room/lounge-models.ts";

if (process.argv.includes("--help")) { help(import.meta.path); process.exit(0); }

const File = obj({ url: str(), size: num(0, 1e9) });
const Gltf = obj({ gltf: obj({ "1k": obj({ gltf: obj({ url: str(), size: num(0, 1e9), include: opt(rec(File)) }) }) }) });
const OUT = join(import.meta.dir, "../public/lounge");
const ids = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const want = ids.length ? ids : Object.keys(LOUNGE_MODELS);

for (const id of want) {
  const files = check(Gltf, await (await fetch(`https://api.polyhaven.com/files/${id}`, { headers: { "User-Agent": "rustybuns-lounge" } })).json());
  if (!files) throw new Error(`${id}: Poly Haven has no 1k glTF`);
  const g = files.gltf["1k"].gltf, dir = join(OUT, id);
  await rm(dir, { recursive: true, force: true });
  const get = async (url: string, to: string) => {
    await mkdir(dirname(to), { recursive: true });
    await Bun.write(to, await (await fetch(url)).arrayBuffer());
  };
  await get(g.url, join(dir, `${id}.gltf`));
  for (const [path, f] of Object.entries(g.include ?? {})) {
    const to = join(dir, path);
    await get(f.url, to);
    if (/\.(jpe?g|png)$/i.test(path)) {
      const p = Bun.spawnSync(["sips", "-Z", "512", ...(/\.jpe?g$/i.test(path) ? ["-s", "formatOptions", "70"] : []), to], { stdout: "ignore", stderr: "pipe" });
      if (p.exitCode) throw new Error(`sips ${to}: ${p.stderr.toString()}`);
    }
  }
  const size = [...new Bun.Glob("**/*").scanSync(dir)].reduce((s, f) => s + Bun.file(join(dir, f)).size, 0);
  console.log(`${id.padEnd(28)} ${(size / 1e6).toFixed(2)} MB`);
}
