// The balance climb's score (#3476), one `bun` process per sector and measure so it takes every core:
// `bun scripts/climb.ts [--seeds 16] [--from 1] [--only bot,ai,hold]`. Seed s attacks with the Marines when odd, the Wooka when even.
// bot: the scripted player attacking at even forces with orders (the score). ai: AI against AI.
// hold: the scripted player defending against the AI attacker at +45% (HUMAN_HANDICAP), on half the seeds.
import { HUMAN_HANDICAP } from "../src/battle/handicap.ts";
import type { Faction, SectorKind } from "../src/battle/contract.ts";
import { SECTORS, play, specFor } from "./balance.ts";

type Measure = "bot" | "ai" | "hold";
interface Row { sector: SectorKind; measure: Measure; seed: number; att: Faction; won: boolean }
const arg = (k: string, d: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] ?? d : d; };
const attOf = (seed: number): Faction => (seed % 2 ? "marines" : "wooka");

function run(sector: SectorKind, measure: Measure, from: number, seeds: number): Row[] {
  const rows: Row[] = [];
  for (let seed = from; seed < from + (measure === "hold" ? seeds / 2 : seeds); seed++) {
    const att = attOf(seed);
    const r = measure === "bot" ? play(specFor(sector, seed, att, "attacker"), true, true)
      : measure === "ai" ? play(specFor(sector, seed, att, null), false)
      : play(specFor(sector, seed, att, "defender", HUMAN_HANDICAP), true, true);
    rows.push({ sector, measure, seed, att, won: measure === "hold" ? r.winner === "defender" : r.winner === "attacker" });
  }
  return rows;
}

if (import.meta.main) {
  const seeds = Number(arg("seeds", "16")), from = Number(arg("from", "1")), one = arg("one", "");
  if (one) {
    const [sector, measure] = one.split(":") as [SectorKind, Measure];
    for (const r of run(sector, measure, from, seeds)) console.log(`${r.seed} ${r.att} ${r.won ? 1 : 0}`);
  } else {
    const measures = arg("only", "bot,ai,hold").split(",") as Measure[];
    const started = performance.now();
    const jobs = SECTORS.flatMap((s) => measures.map((m) => `${s}:${m}`));
    const rows = (await Promise.all(jobs.map(async (j) => {
      const p = Bun.spawn(["bun", import.meta.path, "--one", j, "--seeds", String(seeds), "--from", String(from)], { stdout: "pipe", stderr: "inherit" });
      const out = await new Response(p.stdout).text();
      if ((await p.exited) !== 0) throw new Error(`${j} failed`);
      const [sector, measure] = j.split(":") as [SectorKind, Measure]; // from SECTORS and measures, just above
      return out.trim().split("\n").map((l): Row => { const [seed, att, won] = l.split(" "); return { sector, measure, seed: Number(seed), att: att === "wooka" ? "wooka" : "marines", won: won === "1" }; });
    }))).flat();
    const names: Record<Measure, string> = { bot: "Bot attacking, even forces, with orders", ai: "AI against AI, attacker wins", hold: `Bot defending against +${Math.round(HUMAN_HANDICAP * 100)}%` };
    for (const m of measures) {
      const rs = rows.filter((r) => r.measure === m), won = rs.filter((r) => r.won);
      const by = SECTORS.map((s) => won.filter((r) => r.sector === s).length).join(", ");
      const byAtt = (["marines", "wooka"] as const).map((f) => `${f} ${won.filter((r) => r.att === f).length}/${rs.filter((r) => r.att === f).length}`).join(", ");
      console.log(`${names[m]}: ${won.length}/${rs.length} (${Math.round((100 * won.length) / rs.length)}%)  by sector ${by}  (by attacker: ${byAtt})`);
    }
    console.log(`${rows.length} battles in ${Math.round((performance.now() - started) / 1000)} s`);
  }
}
