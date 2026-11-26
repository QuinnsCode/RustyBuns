// Review a model change by picture: `bun scripts/model-review.ts [base] [head] [out.html]` (defaults origin/main, HEAD).
// Every .glb the head changed against the base is rendered before and after by headless Blender
// (scripts/glb-sheet.py, three views, all in one run) and laid side by side in one HTML file. The GLBs are read out of
// git here and written beside the page (<out>.files/, so it must be in the repo); on the office Mac the run is one
// Blender queue job on the builder Mac (scripts/blender-queue.ts), elsewhere it needs Blender (or BLENDER_PATH).
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { blender } from "../../../scripts/blender-queue.ts";
import { modelPaths, sideBySide, type ModelPair } from "../src/model-review.ts";
import { help } from "../../../scripts/help.ts";

help(import.meta.path);
const [base = "origin/main", head = "HEAD", out = "model-review.html"] = process.argv.slice(2);
const sh = async (cmd: string[], opts: { cwd?: string } = {}) => {
  const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe", ...opts });
  const [o, e] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  return { code: await p.exited, out: o, err: e };
};
const top = (await sh(["git", "rev-parse", "--show-toplevel"])).out.trim();
const changed = (await sh(["git", "diff", "--name-only", `${base}...${head}`], { cwd: top })).out.split("\n").filter(Boolean);
const dir = `${resolve(out).replace(/\.html$/, "")}.files`;
const py = resolve(import.meta.dir, "glb-sheet.py");

/** The GLB at `ref` written into `dir` as `<name>.glb`; answers its path, or null when it isn't there at that ref. */
async function glbAt(ref: string, path: string, name: string): Promise<string | null> {
  const blob = Bun.spawn(["git", "show", `${ref}:${path}`], { cwd: top, stdout: "pipe", stderr: "ignore" });
  const bytes = new Uint8Array(await new Response(blob.stdout).arrayBuffer());
  if ((await blob.exited) !== 0) return null;
  const glb = join(dir, `${name}.glb`);
  writeFileSync(glb, bytes);
  return glb;
}
const png = (glb: string) => glb.replace(/\.glb$/, ".png");
const picture = (glb: string | null, what: string) => {
  if (!glb) return null;
  if (!existsSync(png(glb))) throw new Error(`blender wrote no picture of ${what}`);
  return `data:image/png;base64,${readFileSync(png(glb)).toString("base64")}`;
};

rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
try {
  const found = [];
  for (const [i, path] of modelPaths(changed).entries())
    found.push({ path, before: await glbAt(base, path, `b${i}`), after: await glbAt(head, path, `a${i}`) });
  const glbs = found.flatMap((f) => [f.before, f.after]).filter((g): g is string => g !== null);
  if (glbs.length) await blender({ script: py, args: glbs.flatMap((g) => [g, png(g)]), out: [dir], send: glbs });
  const pairs: ModelPair[] = found.map((f) => ({ path: f.path, before: picture(f.before, `${f.path}@${base}`), after: picture(f.after, `${f.path}@${head}`) }));
  for (const p of pairs) console.log(`rendered ${p.path}`);
  writeFileSync(out, sideBySide(pairs, `Model changes ${base}..${head}`));
  console.log(`${pairs.length} model(s) -> ${out}`);
} finally { rmSync(dir, { recursive: true, force: true }); }
