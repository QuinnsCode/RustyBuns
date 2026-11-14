// The source-art board's data: every region you can reach, in layers out from the Pine Barrens (open from the start;
// beating a region's arena opens its neighbours), each with its cryptids and its boss (the keeper of its last section).
// Run from apps/mythic-masters: bun proposals/compendium/board/layers.ts <layers.json>, then board.ts on that file.
import { existsSync, readdirSync } from "node:fs";
import { REGIONS } from "../../../src/regions.ts";
import { neighbours } from "../../../src/world/world.ts";
import { ROWS } from "../../../src/creatures.ts";
import { STARTERS, sections } from "../../../src/journey.ts";

// the cryptids already rebuilt from references (#4172, #4249, and the compendium pass)
const DONE = new Set("jersey-devil mothman wampus-cat agropelter hodag squonk sasquatch chupacabra jackalope rougarou ozark-howler black-shuck tatzelwurm gevaudan kappa tengu yeti snallygaster".split(" "));
const layer = new Map<number, number>([[1, 0]]), q = [1];
while (q.length) {
  const n = q.shift()!, g = REGIONS.find((r) => r.n === n)!;
  for (const o of neighbours(g)) if (o.tier !== "coming-soon" && !layer.has(o.n)) { layer.set(o.n, layer.get(n)! + 1); q.push(o.n); }
}
const out = REGIONS.filter((g) => layer.has(g.n)).map((g) => {
  const s = sections(g);
  return {
    n: g.n, name: g.name, tier: g.tier, layer: layer.get(g.n)!, next: neighbours(g).filter((o) => layer.has(o.n)).map((o) => o.n),
    boss: s.length ? s[s.length - 1]!.keeper : null,
    beasts: ROWS.filter((r) => r.region === g.n).map((r) => {
      const dir = `refs/${r.id}`, pics = existsSync(dir) ? readdirSync(dir).filter((f) => /\.(jpe?g|png|webp)$/i.test(f)).length : 0;
      return { id: r.id, name: r.name, starter: (STARTERS as readonly string[]).includes(r.id), rebuilt: DONE.has(r.id), refs: existsSync(`${dir}.json`), pics };
    }),
  };
});
await Bun.write(process.argv[2]!, JSON.stringify(out, null, 1));
for (const g of out) console.log(`L${g.layer} ${g.n} ${g.name} [${g.tier}] boss ${g.boss ?? "-"} :: ${g.beasts.map((b) => `${b.id}${b.rebuilt ? "*" : ""}(${b.pics})`).join(" ")}`);
