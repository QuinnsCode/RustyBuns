// The face models, fetched once into public/models (gitignored) from OpenCV's model zoo at pinned
// revisions and checked by sha256, so the page serves them from its own origin and runs them on
// the user's machine. Both licences allow redistribution: YuNet MIT, SFace Apache 2.0.
// --optional: if the download fails, say so and exit 0; the app runs without faces.
import { mkdir, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { hex } from "@rustybuns/util/bytes";
import { MODELS } from "../src/faces/face.ts";

export const MODEL_DIR = join(import.meta.dir, "..", "public", "models");

/** Every model in `dir`, downloading the missing ones. Returns the directory. */
export async function ensureModels(dir = MODEL_DIR): Promise<string> {
  await mkdir(dir, { recursive: true });
  for (const m of Object.values(MODELS)) {
    const to = join(dir, m.file);
    if (existsSync(to)) continue;
    const url = `https://huggingface.co/${m.repo}/resolve/${m.rev}/${m.file}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${m.file}: HTTP ${r.status} from ${url}`);
    const body = await r.arrayBuffer();
    const sum = hex(await crypto.subtle.digest("SHA-256", body));
    if (sum !== m.sha256) throw new Error(`${m.file}: sha256 ${sum}, expected ${m.sha256}`);
    await writeFile(`${to}.part`, new Uint8Array(body));
    await rename(`${to}.part`, to);
    console.log(`models: ${m.file} (${(body.byteLength / 2 ** 20).toFixed(1)} MB, ${m.licence})`);
  }
  return dir;
}

if (import.meta.main) {
  try {
    await ensureModels();
  } catch (e) {
    if (!process.argv.includes("--optional")) throw e;
    console.log(`models: skipped (${e instanceof Error ? e.message : e}); the app runs without faces`);
  }
}
