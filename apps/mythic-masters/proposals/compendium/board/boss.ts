import { REGIONS } from "./src/regions.ts";
import { sections } from "./src/journey.ts";
const f = process.argv[2]!; const L = await Bun.file(f).json();
for (const g of L) { const r = REGIONS.find((x) => x.n === g.n)!; const s = sections(r); g.boss = s.length ? s[s.length - 1]!.keeper : null; console.log(g.n, g.name, "boss:", g.boss, "own:", g.beasts.map((b: { id: string }) => b.id).join(",")); }
await Bun.write(f, JSON.stringify(L, null, 1));
