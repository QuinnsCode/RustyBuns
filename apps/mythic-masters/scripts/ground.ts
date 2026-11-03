// The ground layers: `bun run ground [layer ...] [--sheet-only]`. Each layer (blender/ground.py's LAYERS) goes through
// headless Blender (a 2 m tileable patch of real scattered geometry, rendered top-down for albedo with real occlusion and
// a normal map) into public/ground-tex/<layer>.jpg and <layer>.n.jpg, then the contact sheet blender/out/ground-sheet.png
// (every layer tiled 2 x 2, tinted as the game would) is made to look at. Prints each file's size and the total, which
// has a budget (BUDGET_KB): the textures are downloaded by the game.
import { readdirSync, statSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join } from "node:path";

const APP = join(import.meta.dir, "..");
const TEX = join(APP, "public", "ground-tex");
/** The shipped textures, in KB, may not pass this. */
export const BUDGET_KB = 1500;
const flags = new Set(process.argv.slice(2).filter((a) => a.startsWith("--")));
const picked = process.argv.slice(2).filter((a) => !a.startsWith("--"));

async function blender(...args: string[]): Promise<string> {
  const p = Bun.spawn(["blender", "-b", "--factory-startup", "--python-exit-code", "1", "-P", "blender/ground.py", "--", ...args], { cwd: APP, stdout: "pipe", stderr: "pipe" });
  const out = await new Response(p.stdout).text() + await new Response(p.stderr).text();
  if ((await p.exited) !== 0) throw new Error(`blender failed on ${args.join(" ")}:\n${out.split("\n").filter((l) => /Error|Traceback|line \d+/.test(l)).join("\n")}`);
  return out.split("\n").filter((l) => /^ground /.test(l)).join("\n");
}

if (!flags.has("--sheet-only")) {
  // the layer names come from the script itself, so a new layer needs no change here
  const listing = await Bun.file(join(APP, "blender", "ground.py")).text();
  const all = [...(/^LAYERS = \{(.+)\}$/m.exec(listing)?.[1] ?? "").matchAll(/"(\w+)":/g)].map((m) => m[1]!);
  const todo = picked.length ? picked : all;
  const bad = todo.filter((n) => !all.includes(n));
  if (bad.length) { console.error(`no layer ${bad.join(", ")}: ${all.join(", ")}`); process.exit(1); }
  const queue = [...todo];
  // each Blender renders on every core, so two at a time
  await Promise.all(Array.from({ length: Math.min(2, availableParallelism()) }, async () => { for (let n = queue.shift(); n; n = queue.shift()) console.log(await blender(n)); }));
}
console.log(await blender("--sheet"));
const kb = readdirSync(TEX).filter((f) => f.endsWith(".jpg")).reduce((s, f) => s + statSync(join(TEX, f)).size, 0) / 1024;
console.log(`${kb.toFixed(0)} KB of ground textures (budget ${BUDGET_KB})`);
if (kb > BUDGET_KB) { console.error("over budget: lower the quality or the normal size in blender/ground.py"); process.exit(1); }
