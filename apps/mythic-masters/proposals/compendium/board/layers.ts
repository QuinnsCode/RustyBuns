import { existsSync, readdirSync } from "node:fs";
import { REGIONS } from "./src/regions.ts";
import { neighbours } from "./src/world/world.ts";
import { ROWS } from "./src/creatures.ts";
import { STARTERS } from "./src/journey.ts";
const DONE = new Set("jersey-devil mothman wampus-cat agropelter hodag squonk sasquatch chupacabra jackalope rougarou ozark-howler black-shuck tatzelwurm gevaudan kappa tengu yeti".split(" "));
const layer = new Map<number, number>([[1, 0]]), q = [1];
while (q.length) { const n = q.shift()!; const g = REGIONS.find((r) => r.n === n)!; for (const o of neighbours(g)) if (o.tier !== "coming-soon" && !layer.has(o.n)) { layer.set(o.n, layer.get(n)! + 1); q.push(o.n); } }
const out = REGIONS.filter((g) => layer.has(g.n)).map((g) => ({
  n: g.n, name: g.name, tier: g.tier, layer: layer.get(g.n)!, next: neighbours(g).filter((o) => layer.has(o.n)).map((o) => o.n),
  beasts: ROWS.filter((r) => r.region === g.n).map((r) => {
    const dir = `refs/${r.id}`, pics = existsSync(dir) ? readdirSync(dir).filter((f) => /\.(jpe?g|png|webp)$/i.test(f)).length : 0;
    return { id: r.id, name: r.name, starter: (STARTERS as readonly string[]).includes(r.id), rebuilt: DONE.has(r.id), refs: existsSync(`${dir}.json`), pics };
  }),
}));
await Bun.write(process.argv[2]!, JSON.stringify(out, null, 1));
for (const g of out) console.log(`L${g.layer} ${g.n} ${g.name} [${g.tier}] -> ${g.next.join(",")} :: ${g.beasts.map((b) => `${b.id}${b.rebuilt ? "*" : ""}(${b.pics})`).join(" ")}`);
