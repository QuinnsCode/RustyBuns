// Review a model change by picture: `bun scripts/model-review.ts [base] [head] [out.html]` (defaults origin/main, HEAD).
// Every .glb the head changed against the base is rendered before and after by headless Blender
// (scripts/glb-sheet.py, three views) and laid side by side in one HTML file. Needs Blender (or BLENDER_PATH).
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runBlender } from "@rustybuns/cli/blender";
import { modelPaths, sideBySide, type ModelPair } from "../src/model-review.ts";

const [base = "origin/main", head = "HEAD", out = "model-review.html"] = process.argv.slice(2);
const sh = async (cmd: string[], opts: { cwd?: string } = {}) => {
  const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe", ...opts });
  const [o, e] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  return { code: await p.exited, out: o, err: e };
};
const top = (await sh(["git", "rev-parse", "--show-toplevel"])).out.trim();
const changed = (await sh(["git", "diff", "--name-only", `${base}...${head}`], { cwd: top })).out.split("\n").filter(Boolean);
const dir = mkdtempSync(join(tmpdir(), "model-review-"));
const py = resolve(import.meta.dir, "glb-sheet.py");

async function render(ref: string, path: string, name: string): Promise<string | null> {
  const blob = Bun.spawn(["git", "show", `${ref}:${path}`], { cwd: top, stdout: "pipe", stderr: "ignore" });
  const bytes = new Uint8Array(await new Response(blob.stdout).arrayBuffer());
  if ((await blob.exited) !== 0) return null;   // not there at that ref
  const glb = join(dir, `${name}.glb`), png = join(dir, `${name}.png`);
  writeFileSync(glb, bytes);
  await runBlender({ script: py, args: [glb, png] });
  if (!existsSync(png)) throw new Error(`blender wrote no picture of ${path}@${ref}`);
  return `data:image/png;base64,${readFileSync(png).toString("base64")}`;
}

const pairs: ModelPair[] = [];
for (const [i, path] of modelPaths(changed).entries()) {
  pairs.push({ path, before: await render(base, path, `b${i}`), after: await render(head, path, `a${i}`) });
  console.log(`rendered ${path}`);
}
writeFileSync(out, sideBySide(pairs, `Model changes ${base}..${head}`));
console.log(`${pairs.length} model(s) -> ${out}`);
