// The ground layers: `bun run ground [layer ...] [--sheet-only]`. Each layer (blender/ground.py's LAYERS) goes through
// headless Blender (a 2 m tileable patch of real scattered geometry, rendered top-down for albedo with real occlusion and
// a normal map) into public/ground-tex/<layer>.jpg and <layer>.n.jpg, then the contact sheet blender/out/ground-sheet.png
// (every layer tiled 2 x 2, tinted as the game would) is made to look at. Prints each file's size and the total, which
// has a budget (BUDGET_KB): the textures are downloaded by the game.
//   --as before|now   keep that contact sheet as the BEFORE or NOW one (blender/out/shots/ground/<label>/)
//   --judge           keep it as NOW and have a fresh judge score it against BEFORE (scripts/judge-loop.ts), its table in
//                     blender/out/judge-ground.md (take BEFORE first, on the old build: `bun run ground --sheet-only --as before`)
import { readdirSync, statSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join } from "node:path";
import { judgePairs, keep, keptDir, OUT } from "./judge-loop.ts";

const APP = join(import.meta.dir, "..");
const TEX = join(APP, "public", "ground-tex");
/** The shipped textures, in KB, may not pass this. */
export const BUDGET_KB = 1500;
const argv = process.argv.slice(2), asAt = argv.indexOf("--as"), label = asAt >= 0 ? argv[asAt + 1] : undefined;
if (asAt >= 0 && label !== "before" && label !== "now") { console.error("--as takes before or now"); process.exit(1); }
const flags = new Set(argv.filter((a) => a.startsWith("--")));
const picked = argv.filter((a, i) => !a.startsWith("--") && i !== asAt + 1);

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
const sheet = join(OUT, "ground-sheet.png");
if (label || flags.has("--judge")) for (const f of keep("ground", flags.has("--judge") ? "now" : label as "before" | "now", [sheet])) console.log(f);
if (flags.has("--judge")) console.log(await judgePairs(keptDir("ground", "before"), keptDir("ground", "now"), {
  subject: "the ground's contact sheet: every ground layer (needles, leaves, turf, dirt, mud, sand, rock, snow) tiled 2 x 2 and tinted as the game draws it",
  rubric: "For each layer that looks different between BEFORE and NOW, score NOW from 1 to 10 on: reads as its material at a glance, no visible repeat or seams across the 2 x 2 tiling, and detail that holds up close without noise. Say BEFORE's total too.",
  row: "| layer | material | seams | detail | BEFORE total | NOW total | note (one short phrase) |",
  out: join(OUT, "judge-ground.md"),
  take: "run `bun run ground --sheet-only --as before` on the old build first",
}));
if (kb > BUDGET_KB) { console.error("over budget: lower the quality or the normal size in blender/ground.py"); process.exit(1); }
