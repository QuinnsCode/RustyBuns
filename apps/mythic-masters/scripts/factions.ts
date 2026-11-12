// Checks the factions' words (content/faction-*.json) against the plan in docs/FACTIONS.md: the shape, the quest's
// places, the posts' grid, teams made only of what is behind you, the manual's English (20 words a sentence, no
// contractions), flags that something sets, and enough lines that read the small things.
//
//   bun scripts/factions.ts               all three
//   bun scripts/factions.ts office        one (office, institute, lamplighters, or weave: the crossings between them)
//   bun scripts/factions.ts --behind 3    the creatures a team may hold by region 3
//
// Exits 1 when a file is missing or has problems, each on its own line.
import { help } from "../../../scripts/help.ts";
import { behind, problems, weaveProblems } from "../src/factions/check.ts";
import { FACTIONS } from "../src/factions/model.ts";

help(import.meta.path);
const args = process.argv.slice(2);
if (args[0] === "--behind") { console.log([...behind(Number(args[1] ?? 8))].sort().join(" ")); process.exit(0); }
const ids = FACTIONS.filter((f) => !args.length || args.includes(f));
let bad = 0;
for (const id of ids) {
  const file = Bun.file(new URL(`../content/faction-${id}.json`, import.meta.url));
  if (!(await file.exists())) { console.log(`${id}: content/faction-${id}.json is not written yet`); bad++; continue; }
  let raw: unknown;
  try { raw = await file.json(); } catch (e) { console.log(`${id}: not JSON: ${e instanceof Error ? e.message : e}`); bad++; continue; }
  const ps = problems(id, raw);
  console.log(ps.length ? `${id}: ${ps.length} problem${ps.length === 1 ? "" : "s"}\n${ps.map((p) => `  ${p}`).join("\n")}` : `${id}: fits the plan`);
  if (ps.length) bad++;
}
if (!args.length || args.includes("weave")) {
  const ps = weaveProblems(await Bun.file(new URL("../content/faction-weave.json", import.meta.url)).json());
  console.log(ps.length ? `weave: ${ps.length} problem${ps.length === 1 ? "" : "s"}\n${ps.map((p) => `  ${p}`).join("\n")}` : "weave: fits the plan");
  if (ps.length) bad++;
}
process.exit(bad ? 1 : 0);
